const {
  createReservation,
  confirmReservationPayment,
  releaseReservation,
  transitionOrderFulfillment,
  applyV16Refund
} = require('../../domain')
const crypto = require('crypto')
const { ERROR_CODES, success, failure } = require('../shared/response')
const { PHONE_RE } = require('../shared/validation')
const { randomToken } = require('../shared/ids')

const ORDER_PENDING = '预占中'
const ORDER_CANCELLED = '已取消'
const ORDER_EXPIRED = '已超时'
const ORDER_REFUNDED = '已退款'
const BATCH_ACCEPTING = '接单中'
const STATION_ORDERABLE = new Set(['拼团中', '已成团待确认'])
const ACTIVE_PAID_ORDER_STATUSES = ['待配送确认', '待自提', '已放置待自取', '已完成', '已完成未取', '退款申请待处理']

function normalizeInventory(original, patch) {
  return {
    ...original,
    ...patch,
    totalQty: Number(patch.totalQty),
    availableQty: Number(patch.availableQty),
    reservedQty: Number(patch.reservedQty),
    soldQty: Number(patch.soldQty),
    refundedQty: Number(patch.refundedQty),
    status: patch.status
  }
}

function normalizeInventorySnapshot(inventory) {
  if (!inventory) return null
  const availableQty = Number(inventory.availableQty || 0)
  const reservedQty = Number(inventory.reservedQty || 0)
  const soldQty = Number(inventory.soldQty || 0)
  const refundedQty = Number(inventory.refundedQty || 0)
  const hasTotal = Object.prototype.hasOwnProperty.call(inventory, 'totalQty') && Number.isFinite(Number(inventory.totalQty))
  return {
    ...inventory,
    totalQty: hasTotal ? Number(inventory.totalQty) : availableQty + reservedQty + soldQty - refundedQty,
    availableQty,
    reservedQty,
    soldQty,
    refundedQty
  }
}

function mapDomainError(reason, fallback = ERROR_CODES.ORDER_STATE_CONFLICT) {
  if (/库存不足|预占库存不足/.test(reason || '')) return ERROR_CODES.INVENTORY_INSUFFICIENT
  if (/超时|截单/.test(reason || '')) return ERROR_CODES.ORDER_EXPIRED
  if (/批次/.test(reason || '')) return ERROR_CODES.BATCH_NOT_ACCEPTING
  return fallback
}

async function loadOrderInventory(tx, order) {
  const rows = {}
  for (const item of order.items || []) {
    if (!rows[item.skuId]) rows[item.skuId] = normalizeInventorySnapshot(await tx.getInventory(order.batchId, item.skuId))
  }
  return rows
}

async function persistInventory(tx, originals, patches, updatedAt) {
  for (const patch of patches || []) {
    const original = originals[patch.skuId]
    await tx.saveInventory({ ...normalizeInventory(original, patch), updatedAt })
  }
}

function validateCreate(input) {
  if (!input.openid || input.openid === 'anonymous') return '缺少用户身份'
  if (!String(input.clientRequestId || '').trim()) return 'clientRequestId必填'
  if (!String(input.batchStationId || '').trim()) return 'batchStationId必填'
  if (!Array.isArray(input.items) || input.items.length === 0) return 'items至少包含一项'
  for (const item of input.items) {
    if (!String(item && item.skuId || '').trim() || !Number.isInteger(Number(item && item.quantity)) || Number(item.quantity) <= 0) return 'SKU和数量不合法'
  }
  if (!String(input.contactName || '').trim()) return 'contactName必填'
  if (!PHONE_RE.test(String(input.phone || ''))) return 'phone必须是11位手机号'
  return ''
}

function idempotentOrderId(openid, clientRequestId) {
  const digest = crypto.createHash('sha256').update(`${openid}\0${clientRequestId}`).digest('hex').slice(0, 32)
  return `order-${digest}`
}

async function remainingPaidOrders(tx, order) {
  if (typeof tx.listOrdersByStation !== 'function') return []
  const rows = await tx.listOrdersByStation(order.batchStationId, ACTIVE_PAID_ORDER_STATUSES)
  return rows.filter((row) => row._id !== order._id)
}

function aggregateItems(items) {
  const quantities = new Map()
  for (const item of items) quantities.set(String(item.skuId), Number(quantities.get(String(item.skuId)) || 0) + Number(item.quantity))
  return [...quantities.entries()].map(([skuId, quantity]) => ({ skuId, quantity }))
}

function createOrderActions({ repository, now = Date.now, mockPay = true } = {}) {
  if (!repository || typeof repository.runTransaction !== 'function') throw new Error('repository.runTransaction is required')

  async function createOrder(input = {}) {
    const t = Number(now())
    const invalid = validateCreate(input)
    if (invalid) return failure(input, t, ERROR_CODES.INVALID_ARGUMENT, invalid)

    let result
    try {
      result = await repository.runTransaction(async (tx) => {
      const existing = await tx.findOrderByClientRequestId(input.openid, input.clientRequestId)
      if (existing) return { existing }
      const station = await tx.getBatchStation(input.batchStationId)
      if (!station) return { error: [ERROR_CODES.NOT_FOUND, '站点拼团不存在'] }
      const batch = await tx.getBatch(station.batchId)
      if (!batch || batch.status !== BATCH_ACCEPTING || t >= Number(batch.deadlineAt || 0)) {
        return { error: [ERROR_CODES.BATCH_NOT_ACCEPTING, '批次未接单或已截单'] }
      }
      if (!STATION_ORDERABLE.has(station.status)) return { error: [ERROR_CODES.STATION_CLOSED, '站点不可下单'] }

      const orderItems = []
      const inventoryBySkuId = {}
      for (const item of aggregateItems(input.items)) {
        const sku = await tx.getSku(item.skuId)
        if (!sku || sku.status !== '上架') return { error: [ERROR_CODES.NOT_FOUND, 'SKU不存在或已下架'] }
        const inventory = normalizeInventorySnapshot(await tx.getInventory(batch._id, sku._id))
        inventoryBySkuId[sku._id] = inventory
        orderItems.push({
          skuId: sku._id,
          name: sku.name,
          spec: sku.spec || '',
          quantity: item.quantity,
          unitPrice: Number(sku.price),
          subtotal: Number(sku.price) * item.quantity
        })
      }
      const reservation = createReservation({ items: orderItems, inventoryBySkuId, now: t })
      if (!reservation.ok) return { error: [mapDomainError(reservation.reason, ERROR_CODES.INVENTORY_INSUFFICIENT), reservation.reason] }
      await persistInventory(tx, inventoryBySkuId, reservation.inventoryPatches, t)
      const amount = orderItems.reduce((sum, item) => sum + item.subtotal, 0)
      const orderId = await tx.createOrder({
        batchId: batch._id,
        batchStationId: station._id,
        stationId: station.stationId,
        userOpenid: input.openid,
        clientRequestId: input.clientRequestId,
        items: orderItems,
        amount,
        contactName: String(input.contactName).trim(),
        phone: String(input.phone),
        phoneTail: String(input.phone).slice(-4),
        pickupQrToken: randomToken(24),
        ...reservation.orderPatch,
        createdAt: t,
        updatedAt: t
      }, idempotentOrderId(input.openid, input.clientRequestId))
        return { orderId, amount, expiresAt: reservation.expiresAt }
      })
    } catch (err) {
      const existing = await repository.runTransaction((tx) => tx.findOrderByClientRequestId(input.openid, input.clientRequestId))
      if (!existing) throw err
      return success(input, t, { orderId: existing._id, amount: existing.amount, expiresAt: existing.expiresAt, status: existing.status, idempotent: true })
    }
    if (result.error) return failure(input, t, result.error[0], result.error[1])
    if (result.existing) return success(input, t, { orderId: result.existing._id, amount: result.existing.amount, expiresAt: result.existing.expiresAt, status: result.existing.status, idempotent: true })
    return success(input, t, result)
  }

  async function payOrder(input = {}) {
    const t = Number(now())
    if (!input.orderId) return failure(input, t, ERROR_CODES.INVALID_ARGUMENT, 'orderId必填')
    const result = await repository.runTransaction(async (tx) => {
      const order = await tx.getOrder(input.orderId)
      if (!order || order.userOpenid !== input.openid) return { error: [ERROR_CODES.FORBIDDEN, '订单不存在或无权操作'] }
      if (order.status !== ORDER_PENDING) {
        if (order.paidAt) return { orderId: order._id, status: order.status, idempotent: true }
        return { error: [ERROR_CODES.ORDER_STATE_CONFLICT, '订单状态不可支付'] }
      }
      const batch = await tx.getBatch(order.batchId)
      const station = await tx.getBatchStation(order.batchStationId)
      const inventoryBySkuId = await loadOrderInventory(tx, order)
      const expired = t >= Number(order.expiresAt || 0) || !batch || t >= Number(batch.deadlineAt || 0) || batch.status !== BATCH_ACCEPTING
      if (expired) {
        const released = releaseReservation({ order, inventoryBySkuId, now: t, reason: '支付超时' })
        if (released.released) {
          await persistInventory(tx, inventoryBySkuId, released.inventoryPatches, t)
          await tx.saveOrder(order._id, { ...released.orderPatch, status: ORDER_EXPIRED, updatedAt: t })
        }
        return { error: [ERROR_CODES.ORDER_EXPIRED, '订单已超时'] }
      }
      if (!mockPay) return { error: [ERROR_CODES.PAYMENT_UNKNOWN, '真实支付尚未接入，不能冒充支付完成'] }
      const confirmed = confirmReservationPayment({ order, batch, batchStation: station, inventoryBySkuId, now: t })
      if (!confirmed.ok) return { error: [mapDomainError(confirmed.reason), confirmed.reason] }
      await persistInventory(tx, inventoryBySkuId, confirmed.inventoryPatches, t)
      await tx.saveBatchStation(station._id, { ...confirmed.batchStationPatch, updatedAt: t })
      await tx.saveOrder(order._id, { ...confirmed.orderPatch, transactionId: `mock-${order._id}`, updatedAt: t })
      return { orderId: order._id, status: confirmed.orderPatch.status, formed: Boolean(confirmed.triggeredThreshold) }
    })
    return result.error ? failure(input, t, result.error[0], result.error[1]) : success(input, t, result)
  }

  async function cancelPendingOrder(input = {}) {
    const t = Number(now())
    if (!input.orderId) return failure(input, t, ERROR_CODES.INVALID_ARGUMENT, 'orderId必填')
    const result = await repository.runTransaction(async (tx) => {
      const order = await tx.getOrder(input.orderId)
      if (!order || order.userOpenid !== input.openid) return { error: [ERROR_CODES.FORBIDDEN, '订单不存在或无权操作'] }
      if (order.status === ORDER_CANCELLED) return { orderId: order._id, status: order.status, idempotent: true }
      if (order.status !== ORDER_PENDING) return { error: [ERROR_CODES.ORDER_STATE_CONFLICT, '只有待支付订单可以取消'] }
      const inventoryBySkuId = await loadOrderInventory(tx, order)
      const released = releaseReservation({ order, inventoryBySkuId, now: t, reason: '用户取消' })
      if (!released.released) return { error: [ERROR_CODES.ORDER_STATE_CONFLICT, released.reason || '预占已释放'] }
      await persistInventory(tx, inventoryBySkuId, released.inventoryPatches, t)
      await tx.saveOrder(order._id, { ...released.orderPatch, status: ORDER_CANCELLED, updatedAt: t })
      return { orderId: order._id, status: ORDER_CANCELLED }
    })
    return result.error ? failure(input, t, result.error[0], result.error[1]) : success(input, t, result)
  }

  async function queryPaymentResult(input = {}) {
    const t = Number(now())
    if (!input.orderId) return failure(input, t, ERROR_CODES.INVALID_ARGUMENT, 'orderId必填')
    const result = await repository.runTransaction(async (tx) => {
      const order = await tx.getOrder(input.orderId)
      if (!order || order.userOpenid !== input.openid) return { error: [ERROR_CODES.FORBIDDEN, '订单不存在或无权查看'] }
      const batch = order.status === ORDER_PENDING ? await tx.getBatch(order.batchId) : null
      if (order.status === ORDER_PENDING && isPendingOrderExpired(order, batch, t)) {
        const expired = await expireOrderInTransaction(tx, order, t)
        if (expired) return { orderId: order._id, status: ORDER_EXPIRED, expiresAt: order.expiresAt || null, paidAt: null }
      }
      return { orderId: order._id, status: order.status, expiresAt: order.expiresAt || null, paidAt: order.paidAt || null }
    })
    return result.error ? failure(input, t, result.error[0], result.error[1]) : success(input, t, result)
  }

  async function requestRefund(input = {}) {
    const t = Number(now())
    if (!input.orderId) return failure(input, t, ERROR_CODES.INVALID_ARGUMENT, 'orderId必填')
    const result = await repository.runTransaction(async (tx) => {
      const order = await tx.getOrder(input.orderId)
      if (!order || order.userOpenid !== input.openid) return { error: [ERROR_CODES.FORBIDDEN, '订单不存在或无权操作'] }
      const refundId = `refund-${order._id}`
      const existingRefund = await tx.getRefund(refundId)
      if (existingRefund || order.status === ORDER_REFUNDED || order.refundAccountingApplied) {
        return { orderId: order._id, refundId, refundNo: refundId, refundStatus: existingRefund ? existingRefund.status : ORDER_REFUNDED, idempotent: true }
      }
      const transition = transitionOrderFulfillment({ order, operation: 'refund', now: t })
      if (!transition.ok) return { error: [ERROR_CODES.ORDER_STATE_CONFLICT, transition.reason] }
      const station = await tx.getBatchStation(order.batchStationId)
      const inventoryBySkuId = await loadOrderInventory(tx, order)
      const remainingActiveOrders = await remainingPaidOrders(tx, order)
      const refund = applyV16Refund({ order, batchStation: station, inventoryBySkuId, remainingActiveOrders, now: t })
      if (!refund.ok) return { error: [ERROR_CODES.ORDER_STATE_CONFLICT, refund.reason] }
      await persistInventory(tx, inventoryBySkuId, refund.inventoryPatches, t)
      await tx.saveBatchStation(station._id, { ...refund.batchStationPatch, updatedAt: t })
      const refundStatus = mockPay ? ORDER_REFUNDED : '待退款'
      const orderPatch = mockPay
        ? { ...transition.orderPatch, ...refund.orderPatch }
        : { ...transition.orderPatch, refundAccountingApplied: true }
      await tx.saveOrder(order._id, { ...orderPatch, refundReason: input.reason || '用户申请退款', refundStatus, updatedAt: t })
      await tx.saveRefund(refundId, {
        orderId: order._id,
        refundNo: refundId,
        userOpenid: input.openid,
        amount: order.amount,
        reason: input.reason || '用户申请退款',
        status: refundStatus,
        requestedAt: t,
        completedAt: mockPay ? t : null,
        createdAt: t,
        updatedAt: t
      })
      return { orderId: order._id, refundId, refundNo: refundId, refundStatus }
    })
    return result.error ? failure(input, t, result.error[0], result.error[1]) : success(input, t, result)
  }

  async function systemRefundOrder(input = {}) {
    const t = Number(now())
    if (input.system !== true) return failure(input, t, ERROR_CODES.FORBIDDEN, '仅系统生命周期任务可发起系统退款')
    if (!input.orderId) return failure(input, t, ERROR_CODES.INVALID_ARGUMENT, 'orderId必填')
    const result = await repository.runTransaction(async (tx) => {
      const order = await tx.getOrder(input.orderId)
      if (!order) return { error: [ERROR_CODES.NOT_FOUND, '订单不存在'] }
      const refundId = `refund-${order._id}`
      const existingRefund = await tx.getRefund(refundId)
      if (existingRefund || order.status === ORDER_REFUNDED || order.refundAccountingApplied) {
        return { orderId: order._id, refundId, refundNo: refundId, refundStatus: existingRefund ? existingRefund.status : ORDER_REFUNDED, idempotent: true }
      }
      const transition = input.allowPostDelivery
        ? { ok: true, orderPatch: { status: '退款处理中', refundRequestedAt: t, fulfillmentOperation: 'refund' } }
        : transitionOrderFulfillment({ order, operation: 'refund', now: t })
      if (!transition.ok) return { error: [ERROR_CODES.ORDER_STATE_CONFLICT, transition.reason] }
      const station = await tx.getBatchStation(order.batchStationId)
      const inventoryBySkuId = await loadOrderInventory(tx, order)
      const remainingActiveOrders = await remainingPaidOrders(tx, order)
      const refund = applyV16Refund({ order, batchStation: station, inventoryBySkuId, remainingActiveOrders, allowPostDelivery: Boolean(input.allowPostDelivery), now: t })
      if (!refund.ok) return { error: [ERROR_CODES.ORDER_STATE_CONFLICT, refund.reason] }
      await persistInventory(tx, inventoryBySkuId, refund.inventoryPatches, t)
      await tx.saveBatchStation(station._id, { ...refund.batchStationPatch, updatedAt: t })
      const refundStatus = mockPay ? ORDER_REFUNDED : '待退款'
      const orderPatch = mockPay
        ? { ...transition.orderPatch, ...refund.orderPatch }
        : { ...transition.orderPatch, refundAccountingApplied: true }
      const reason = String(input.reason || '系统关闭退款').trim()
      await tx.saveOrder(order._id, { ...orderPatch, refundReason: reason, refundStatus, updatedAt: t })
      await tx.saveRefund(refundId, {
        orderId: order._id, refundNo: refundId, userOpenid: order.userOpenid,
        amount: order.amount, reason, status: refundStatus, requestedBy: 'system', requestedAt: t,
        completedAt: mockPay ? t : null, createdAt: t, updatedAt: t
      })
      return { orderId: order._id, refundId, refundNo: refundId, refundStatus }
    })
    return result.error ? failure(input, t, result.error[0], result.error[1]) : success(input, t, result)
  }

  async function expirePendingOrders(input = {}) {
    const t = Number(now())
    if (input.system !== true) return failure(input, t, ERROR_CODES.FORBIDDEN, '仅系统生命周期任务可批量清理待支付订单')
    if (typeof repository.listPendingOrderIds !== 'function') return failure(input, t, ERROR_CODES.INTERNAL_ERROR, '仓储未实现待支付订单查询')
    const ids = await repository.listPendingOrderIds(Math.min(100, Math.max(1, Number(input.limit || 100))))
    let expired = 0
    let released = 0
    for (const orderId of ids) {
      const result = await repository.runTransaction(async (tx) => {
        const order = await tx.getOrder(orderId)
        if (!order || order.status !== ORDER_PENDING) return { expired: false }
        const batch = await tx.getBatch(order.batchId)
        if (!isPendingOrderExpired(order, batch, t)) return { expired: false }
        return { expired: await expireOrderInTransaction(tx, order, t) }
      })
      if (result.expired) {
        expired += 1
        released += 1
      }
    }
    return success(input, t, { expired, released })
  }

  return { createOrder, payOrder, cancelPendingOrder, queryPaymentResult, requestRefund, systemRefundOrder, expirePendingOrders }
}

function isPendingOrderExpired(order, batch, now) {
  return Number(now) >= Number(order.expiresAt || 0) || !batch || batch.status !== BATCH_ACCEPTING || Number(now) >= Number(batch.deadlineAt || 0)
}

async function expireOrderInTransaction(tx, order, now) {
  const inventoryBySkuId = await loadOrderInventory(tx, order)
  const released = releaseReservation({ order, inventoryBySkuId, now, reason: '支付超时' })
  if (!released.released) return false
  await persistInventory(tx, inventoryBySkuId, released.inventoryPatches, now)
  await tx.saveOrder(order._id, { ...released.orderPatch, status: ORDER_EXPIRED, updatedAt: now })
  return true
}

module.exports = { createOrderActions, ERROR_CODES }
