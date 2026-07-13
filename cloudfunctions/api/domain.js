const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000
const {
  STATION_THRESHOLD,
  RESERVATION_TTL_MS,
  ORDER_STATUS,
  STATION_STATUS
} = require('./src/constants/v17')
const { recalculateStationCounts } = require('./src/domain/grouping')
const { lockStationAtCutoff, decideStationAtNoon } = require('./src/domain/lifecycle')
const { applyV17Refund } = require('./src/domain/inventory')
const { transitionV17Order } = require('./src/domain/order-state')
const V16_STATION_THRESHOLD = STATION_THRESHOLD
const V16_RESERVATION_TTL_MS = RESERVATION_TTL_MS

function pad2(value) {
  return String(value).padStart(2, '0')
}

function beijingTime(input = Date.now()) {
  const ms = input instanceof Date ? input.getTime() : Number(input)
  const shifted = new Date(ms + BEIJING_OFFSET_MS)
  const year = shifted.getUTCFullYear()
  const month = shifted.getUTCMonth() + 1
  const day = shifted.getUTCDate()
  const hour = shifted.getUTCHours()
  const minute = shifted.getUTCMinutes()
  const second = shifted.getUTCSeconds()
  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    date: `${year}-${pad2(month)}-${pad2(day)}`,
    time: `${pad2(hour)}:${pad2(minute)}:${pad2(second)}`
  }
}

function beijingTimestamp(date, time = '00:00') {
  const [year, month, day] = String(date || '').split('-').map(Number)
  const [hour, minute = 0, second = 0] = String(time || '00:00').split(':').map(Number)
  if (!year || !month || !day || Number.isNaN(hour)) throw new Error('无效北京时间')
  return Date.UTC(year, month - 1, day, hour, minute, second) - BEIJING_OFFSET_MS
}

function sumItems(items) {
  return (items || []).reduce((sum, item) => sum + Number(item.quantity || item.count || 0), 0)
}

function cloneInventoryMap(inventoryBySkuId) {
  const next = {}
  for (const [skuId, inventory] of Object.entries(inventoryBySkuId || {})) {
    next[skuId] = { ...inventory }
  }
  return next
}

function evaluatePaidOrder(snapshots) {
  return confirmReservationPayment({
    order: snapshots.order,
    batch: snapshots.batch,
    batchStation: snapshots.batchStation,
    inventoryBySkuId: cloneInventoryMap(snapshots.inventoryBySkuId),
    now: snapshots.now || Date.now()
  })
}

function canSelfCancelOrder({ order }) {
  return canRefundOrder(order)
}

function applyRefundToSnapshots(snapshots) {
  return applyV17Refund({
    order: snapshots.order,
    batchStation: snapshots.batchStation,
    inventoryBySkuId: cloneInventoryMap(snapshots.inventoryBySkuId),
    remainingActiveOrders: snapshots.remainingActiveOrders || [],
    now: snapshots.now || Date.now()
  })
}

function advanceBatchLifecycle({ batch, now = Date.now(), operatorOpenid = 'timer' }) {
  return closeSalesAt22({ batch, now, operatorOpenid })
}

function itemQuantitiesBySku(items) {
  const quantities = {}
  for (const item of items || []) {
    const skuId = item && item.skuId
    const quantity = Number(item && (item.quantity || item.count || 0))
    if (!skuId || !Number.isInteger(quantity) || quantity <= 0) {
      return { ok: false, reason: '商品数量无效', quantities: {} }
    }
    quantities[skuId] = Number(quantities[skuId] || 0) + quantity
  }
  if (Object.keys(quantities).length === 0) return { ok: false, reason: '订单商品不能为空', quantities: {} }
  return { ok: true, quantities }
}

function inventoryBalance(inventory) {
  const totalQty = Number(inventory && inventory.totalQty || 0)
  const accountedQty = Number(inventory && inventory.availableQty || 0) +
    Number(inventory && inventory.reservedQty || 0) +
    Number(inventory && inventory.soldQty || 0) -
    Number(inventory && inventory.refundedQty || 0)
  return { totalQty, accountedQty, balanced: totalQty === accountedQty }
}

function v16InventoryPatch(inventory, skuId, values) {
  const patch = {
    _id: inventory._id,
    skuId,
    totalQty: Number(inventory.totalQty || 0),
    availableQty: Number(values.availableQty),
    reservedQty: Number(values.reservedQty),
    soldQty: Number(values.soldQty),
    refundedQty: Number(values.refundedQty),
    status: values.status || inventory.status
  }
  return patch
}

function createReservation({ items = [], inventoryBySkuId = {}, now = Date.now() } = {}) {
  const grouped = itemQuantitiesBySku(items)
  if (!grouped.ok) return { ok: false, reason: grouped.reason, inventoryPatches: [] }

  for (const [skuId, quantity] of Object.entries(grouped.quantities)) {
    const inventory = inventoryBySkuId[skuId]
    if (!inventory || !['上架', '预占完'].includes(inventory.status)) {
      return { ok: false, reason: 'SKU未在本批次上架', inventoryPatches: [] }
    }
    if (!inventory.isUnlimited && Number(inventory.availableQty || 0) < quantity) {
      return { ok: false, reason: '库存不足', inventoryPatches: [] }
    }
  }

  const inventoryPatches = Object.entries(grouped.quantities).map(([skuId, quantity]) => {
    const inventory = inventoryBySkuId[skuId]
    if (inventory.isUnlimited) return v16InventoryPatch(inventory, skuId, inventory)
    const availableQty = Number(inventory.availableQty || 0) - quantity
    return v16InventoryPatch(inventory, skuId, {
      ...inventory,
      availableQty,
      reservedQty: Number(inventory.reservedQty || 0) + quantity,
      status: availableQty === 0 ? '预占完' : inventory.status
    })
  })
  const expiresAt = Number(now) + V16_RESERVATION_TTL_MS

  return {
    ok: true,
    expiresAt,
    orderPatch: { status: ORDER_STATUS.RESERVED, reservedAt: Number(now), expiresAt },
    batchStationPatch: null,
    inventoryPatches
  }
}

function confirmReservationPayment({ order, batch, batchStation, inventoryBySkuId = {}, now = Date.now() } = {}) {
  if (!order || order.status !== ORDER_STATUS.RESERVED) {
    return { ok: false, reason: '订单已处理', inventoryPatches: [] }
  }
  if (!batch || batch.status !== '接单中') {
    return { ok: false, reason: '批次未接单', inventoryPatches: [] }
  }
  if (Number(now) >= Number(batch.deadlineAt || 0)) {
    return { ok: false, reason: '批次已截单', inventoryPatches: [] }
  }
  if (Number(now) >= Number(order.expiresAt || 0)) {
    return { ok: false, reason: '支付已超时', inventoryPatches: [] }
  }
  const grouped = itemQuantitiesBySku(order.items)
  if (!grouped.ok) return { ok: false, reason: grouped.reason, inventoryPatches: [] }

  for (const [skuId, quantity] of Object.entries(grouped.quantities)) {
    const inventory = inventoryBySkuId[skuId]
    if (!inventory || (!inventory.isUnlimited && Number(inventory.reservedQty || 0) < quantity)) {
      return { ok: false, reason: '预占库存不足', inventoryPatches: [] }
    }
  }

  const inventoryPatches = Object.entries(grouped.quantities).map(([skuId, quantity]) => {
    const inventory = inventoryBySkuId[skuId]
    if (inventory.isUnlimited) return v16InventoryPatch(inventory, skuId, inventory)
    return v16InventoryPatch(inventory, skuId, {
      ...inventory,
      reservedQty: Number(inventory.reservedQty || 0) - quantity,
      soldQty: Number(inventory.soldQty || 0) + quantity,
      status: Number(inventory.availableQty || 0) === 0 && Number(inventory.reservedQty || 0) === quantity
        ? '售罄'
        : inventory.status
    })
  })
  const paidItemCount = Number(batchStation && batchStation.paidItemCount || 0) + sumItems(order.items)
  const paidUserOpenids = [...new Set([
    ...((batchStation && batchStation.paidUserOpenids) || []),
    order.userOpenid
  ].filter(Boolean))]
  const previousPaidUserCount = Number(batchStation && batchStation.paidUserCount || 0)
  const paidUserCount = paidUserOpenids.length

  return {
    ok: true,
    orderPatch: {
      status: batchStation && batchStation.status === STATION_STATUS.DELIVERY_CONFIRMED
        ? ORDER_STATUS.WAITING_PICKUP
        : ORDER_STATUS.WAITING_DELIVERY,
      paidAt: Number(now)
    },
    batchStationPatch: {
      paidItemCount,
      paidOrderCount: Number(batchStation && batchStation.paidOrderCount || 0) + 1,
      paidUserOpenids,
      paidUserCount,
      status: batchStation && batchStation.status === STATION_STATUS.DELIVERY_CONFIRMED
        ? STATION_STATUS.DELIVERY_CONFIRMED
        : (paidUserCount >= STATION_THRESHOLD ? STATION_STATUS.FORMED : STATION_STATUS.GROUPING)
    },
    inventoryPatches,
    triggeredThreshold: previousPaidUserCount < STATION_THRESHOLD && paidUserCount >= STATION_THRESHOLD
  }
}

function releaseReservation({ order, inventoryBySkuId = {}, now = Date.now(), reason = '预占已释放' } = {}) {
  if (!order || order.status !== ORDER_STATUS.RESERVED || order.reservationReleasedAt) {
    return { released: false, orderPatch: null, inventoryPatches: [] }
  }
  const grouped = itemQuantitiesBySku(order.items)
  if (!grouped.ok) return { released: false, reason: grouped.reason, orderPatch: null, inventoryPatches: [] }

  for (const [skuId, quantity] of Object.entries(grouped.quantities)) {
    const inventory = inventoryBySkuId[skuId]
    if (!inventory || (!inventory.isUnlimited && Number(inventory.reservedQty || 0) < quantity)) {
      return { released: false, reason: '预占库存不足', orderPatch: null, inventoryPatches: [] }
    }
  }

  const inventoryPatches = Object.entries(grouped.quantities).map(([skuId, quantity]) => {
    const inventory = inventoryBySkuId[skuId]
    if (inventory.isUnlimited) return v16InventoryPatch(inventory, skuId, inventory)
    return v16InventoryPatch(inventory, skuId, {
      ...inventory,
      availableQty: Number(inventory.availableQty || 0) + quantity,
      reservedQty: Number(inventory.reservedQty || 0) - quantity,
      status: '上架'
    })
  })

  return {
    released: true,
    orderPatch: {
      status: reason === '支付超时' ? ORDER_STATUS.EXPIRED : ORDER_STATUS.CANCELLED,
      reservationReleasedAt: Number(now),
      cancelReason: reason
    },
    inventoryPatches
  }
}

function closeSalesAt22({ batch, now = Date.now(), operatorOpenid = 'timer' } = {}) {
  if (!batch || batch.status !== '接单中' || Number(batch.deadlineAt || 0) > Number(now)) {
    return { shouldClose: false, shouldExpirePending: false, batchPatch: null, stationPatches: [] }
  }
  return {
    shouldClose: true,
    shouldExpirePending: true,
    batchPatch: {
      status: '已截单待配送确认',
      closedAt: Number(now),
      closedBy: operatorOpenid,
      closeReason: '北京时间22:00截单'
    },
    stationPatches: []
  }
}

function confirmPickupDayStations({ batchStations = [], now = Date.now() } = {}) {
  const stationPatches = []
  const skippedStationIds = []

  for (const station of batchStations) {
    if (
      station.manuallyConfirmedAt ||
      ['已确认配送', '已关闭退款中', '已关闭', '已完成'].includes(station.status)
    ) {
      skippedStationIds.push(station._id)
      continue
    }
    stationPatches.push(decideStationAtNoon(station, now))
  }
  return { stationPatches, skippedStationIds }
}

function applyV16Refund({ order, batchStation, inventoryBySkuId = {}, remainingActiveOrders = [], now = Date.now() } = {}) {
  return applyV17Refund({ order, batchStation, inventoryBySkuId, remainingActiveOrders, now })
}

function canRefundOrder(order) {
  if (!order) return { ok: false, reason: '订单不存在' }
  if (order.refundAccountingApplied || order.refundedAt) return { ok: false, reason: '退款库存已处理' }
  if (order.verifiedAt || order.completedAt || order.placedAt || ['已核销', '已完成', '已放置', '已放置待自取'].includes(order.status)) {
    return { ok: false, reason: '订单已完成交付，不可退款' }
  }
  const transition = transitionOrderFulfillment({ order, operation: 'refund' })
  return transition.ok ? { ok: true } : { ok: false, reason: transition.reason }
}

function canVerifyOrder({ order, batchStation } = {}) {
  if (!batchStation || batchStation.status !== '已确认配送') return { ok: false, reason: '站点未确认配送' }
  const transition = transitionOrderFulfillment({ order, operation: 'verify' })
  return transition.ok ? { ok: true } : { ok: false, reason: transition.reason }
}

function canPlaceOrderAtLocation({ order, batchStation } = {}) {
  if (!batchStation || batchStation.status !== '已确认配送') return { ok: false, reason: '站点未确认配送' }
  const transition = transitionOrderFulfillment({ order, operation: 'place' })
  return transition.ok ? { ok: true } : { ok: false, reason: transition.reason }
}

function transitionOrderFulfillment({ order, operation, now = Date.now() } = {}) {
  if (!order) return { ok: false, reason: '订单不存在' }
  const expectedStatus = order.status
  if (operation === 'refund') {
    if (!['待配送确认', '待自提'].includes(expectedStatus)) return { ok: false, reason: '当前状态不可退款' }
    return {
      ok: true,
      expectedStatus,
      orderPatch: { status: '退款处理中', refundRequestedAt: Number(now), fulfillmentOperation: 'refund' }
    }
  }
  if (operation === 'verify') {
    if (!['待自提', '已放置待自取'].includes(expectedStatus)) return { ok: false, reason: '订单不是可核销状态' }
    return {
      ok: true,
      expectedStatus,
      orderPatch: { status: '已完成', verifiedAt: Number(now), completedAt: Number(now), fulfillmentOperation: 'verify' }
    }
  }
  if (operation === 'place') {
    if (expectedStatus !== '待自提') return { ok: false, reason: '订单不是待自提状态' }
    return {
      ok: true,
      expectedStatus,
      orderPatch: { status: '已放置待自取', placedAt: Number(now), fulfillmentOperation: 'place' }
    }
  }
  return { ok: false, reason: '不支持的履约操作' }
}

function buildVerifyCode({ demo = false, seed = '' } = {}) {
  if (demo) return '638274'
  let hash = 0
  const text = String(seed || `${Date.now()}-${Math.random()}`)
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0
  }
  return String(100000 + (Math.abs(hash) % 900000))
}

module.exports = {
  V16_STATION_THRESHOLD,
  V16_RESERVATION_TTL_MS,
  beijingTime,
  beijingTimestamp,
  sumItems,
  inventoryBalance,
  createReservation,
  confirmReservationPayment,
  releaseReservation,
  closeSalesAt22,
  confirmPickupDayStations,
  applyV16Refund,
  transitionOrderFulfillment,
  canRefundOrder,
  canVerifyOrder,
  canPlaceOrderAtLocation,
  evaluatePaidOrder,
  canSelfCancelOrder,
  applyRefundToSnapshots,
  advanceBatchLifecycle,
  buildVerifyCode,
  recalculateStationCounts,
  lockStationAtCutoff,
  decideStationAtNoon,
  applyV17Refund,
  transitionV17Order
}
