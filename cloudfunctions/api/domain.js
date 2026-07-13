const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000
const V16_STATION_THRESHOLD = 5
const V16_RESERVATION_TTL_MS = 15 * 60 * 1000

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

function isBatchAccepting(batch, now) {
  return batch && batch.status === '接单中' && !batch.closedAt && Number(batch.deadlineAt || 0) > now
}

function isStationAccepting(batchStation) {
  return batchStation && ['拼团中', '已成团继续接单', '待自提'].includes(batchStation.status)
}

function validateInventory(items, inventoryBySkuId) {
  for (const item of items || []) {
    const skuId = item.skuId
    const qty = Number(item.quantity || item.count || 0)
    const inventory = inventoryBySkuId[skuId]
    if (!inventory || inventory.status !== '上架') return { ok: false, reason: 'SKU未在本批次上架' }
    if (!inventory.isUnlimited && Number(inventory.availableQty || 0) < qty) {
      return { ok: false, reason: '库存不足，整单退款' }
    }
  }
  return { ok: true }
}

function evaluatePaidOrder(snapshots) {
  const now = snapshots.now || Date.now()
  const { batch, batchStation, order } = snapshots
  const inventoryBySkuId = cloneInventoryMap(snapshots.inventoryBySkuId)
  const items = order.items || []
  const totalQty = sumItems(items)

  if (!isBatchAccepting(batch, now)) return refundDecision('批次未接单', now)
  if (!isStationAccepting(batchStation)) return refundDecision('站点不可下单', now)
  const inventoryCheck = validateInventory(items, inventoryBySkuId)
  if (!inventoryCheck.ok) return refundDecision(inventoryCheck.reason, now)

  const inventoryPatches = []
  for (const item of items) {
    const inventory = inventoryBySkuId[item.skuId]
    const qty = Number(item.quantity || item.count || 0)
    if (!inventory.isUnlimited) {
      inventory.availableQty = Number(inventory.availableQty || 0) - qty
      inventory.soldQty = Number(inventory.soldQty || 0) + qty
    }
    inventoryPatches.push({
      _id: inventory._id,
      skuId: item.skuId,
      availableQty: inventory.availableQty,
      soldQty: inventory.soldQty,
      status: inventory.availableQty <= 0 && !inventory.isUnlimited ? '售罄' : inventory.status
    })
  }

  const previousPaid = Number(batchStation.paidItemCount || 0)
  const paidItemCount = previousPaid + totalQty
  const paidOrderCount = Number(batchStation.paidOrderCount || 0) + 1
  const wasFormed = previousPaid >= Number(batchStation.thresholdN || 0) || ['已成团继续接单', '待自提'].includes(batchStation.status)
  const isFormed = paidItemCount >= Number(batchStation.thresholdN || 0)
  const triggeredGroupSuccess = !wasFormed && isFormed
  const stationStatus = isFormed ? '已成团继续接单' : '拼团中'
  const allFiniteInventorySoldOut = Object.values(inventoryBySkuId).every((inventory) => {
    if (inventory.isUnlimited || inventory.status !== '上架') return false
    return Number(inventory.availableQty || 0) <= 0
  })

  return {
    ok: true,
    orderPatch: {
      status: isFormed && snapshots.deliveryWindow ? '待自提' : (isFormed ? '已成团待截单' : '待成团'),
      paidAt: now
    },
    batchStationPatch: {
      paidItemCount,
      paidOrderCount,
      status: stationStatus,
      leaderOpenid: batchStation.leaderOpenid || order.userOpenid,
      formedAt: triggeredGroupSuccess ? now : batchStation.formedAt || null
    },
    inventoryPatches,
    batchPatch: allFiniteInventorySoldOut ? { status: '已截单', closedAt: now, closeReason: '库存售罄自动截单' } : null,
    triggeredGroupSuccess,
    shouldAutoCutoffBatch: allFiniteInventorySoldOut
  }
}

function refundDecision(reason, now) {
  return {
    ok: false,
    reason,
    refundPatch: {
      status: '支付后退款中',
      refundReason: reason,
      refundRequestedAt: now
    },
    inventoryPatches: []
  }
}

function canSelfCancelOrder({ order }) {
  return canRefundOrder(order)
}

function stationWasFormed(batchStation) {
  const threshold = Number(batchStation.thresholdN || 0)
  return Boolean(
    batchStation.formedAt ||
    ['已成团继续接单', '待自提'].includes(batchStation.status) ||
    (threshold > 0 && Number(batchStation.paidItemCount || 0) >= threshold)
  )
}

function applyRefundToSnapshots(snapshots) {
  const now = snapshots.now || Date.now()
  const { order, batchStation } = snapshots
  const inventoryBySkuId = cloneInventoryMap(snapshots.inventoryBySkuId)
  const totalQty = sumItems(order.items || [])
  const inventoryPatches = []

  for (const item of order.items || []) {
    const inventory = inventoryBySkuId[item.skuId]
    if (!inventory || inventory.isUnlimited) continue
    const qty = Number(item.quantity || item.count || 0)
    inventory.availableQty = Number(inventory.availableQty || 0) + qty
    inventory.soldQty = Math.max(0, Number(inventory.soldQty || 0) - qty)
    inventoryPatches.push({
      _id: inventory._id,
      skuId: item.skuId,
      availableQty: inventory.availableQty,
      soldQty: inventory.soldQty,
      status: '上架'
    })
  }

  const paidItemCount = Math.max(0, Number(batchStation.paidItemCount || 0) - totalQty)
  const paidOrderCount = Math.max(0, Number(batchStation.paidOrderCount || 0) - 1)
  let status = batchStation.status
  if (!stationWasFormed(batchStation)) {
    if (paidItemCount === 0) status = '已关闭'
    else if (paidItemCount < Number(batchStation.thresholdN || 0)) status = '拼团中'
  }

  return {
    orderPatch: {
      status: '已退款',
      refundedAt: now
    },
    batchStationPatch: {
      paidItemCount,
      paidOrderCount,
      status
    },
    inventoryPatches
  }
}

function advanceBatchLifecycle({ batch, batchStations = [], now = Date.now(), operatorOpenid = 'timer' }) {
  if (!batch || batch.status !== '接单中' || Number(batch.deadlineAt || 0) > Number(now)) {
    return { shouldClose: false, batchPatch: null, stationPatches: [] }
  }
  const stationPatches = batchStations.map((station) => {
    const formed = stationWasFormed(station)
    return {
      _id: station._id,
      status: formed ? '待自提' : '已关闭',
      shouldRefund: !formed,
      refundReason: formed ? '' : '到期未成团',
      closedAt: formed ? null : now,
      updatedAt: now
    }
  })
  return {
    shouldClose: true,
    batchPatch: {
      status: '已截单',
      closedAt: now,
      closedBy: operatorOpenid,
      closeReason: '截止时间到达'
    },
    stationPatches
  }
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
    orderPatch: { status: '待支付', reservedAt: Number(now), expiresAt },
    batchStationPatch: null,
    inventoryPatches
  }
}

function confirmReservationPayment({ order, batch, batchStation, inventoryBySkuId = {}, now = Date.now() } = {}) {
  if (!order || order.status !== '待支付') {
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
  const previousPaidItemCount = Number(batchStation && batchStation.paidItemCount || 0)

  return {
    ok: true,
    orderPatch: {
      status: batchStation && batchStation.status === '已确认配送' ? '待自提' : '待配送确认',
      paidAt: Number(now)
    },
    batchStationPatch: {
      paidItemCount,
      paidOrderCount: Number(batchStation && batchStation.paidOrderCount || 0) + 1,
      status: batchStation && batchStation.status === '已确认配送'
        ? '已确认配送'
        : (paidItemCount >= V16_STATION_THRESHOLD ? '已达门槛待确认' : '拼团中')
    },
    inventoryPatches,
    triggeredThreshold: previousPaidItemCount < V16_STATION_THRESHOLD && paidItemCount >= V16_STATION_THRESHOLD
  }
}

function releaseReservation({ order, inventoryBySkuId = {}, now = Date.now(), reason = '预占已释放' } = {}) {
  if (!order || order.status !== '待支付' || order.reservationReleasedAt) {
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
      status: reason === '支付超时' ? '已超时' : '已取消',
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
    const delivers = Number(station.paidItemCount || 0) >= V16_STATION_THRESHOLD
    stationPatches.push({
      _id: station._id,
      status: delivers ? '已确认配送' : '已关闭退款中',
      shouldRefund: !delivers,
      confirmedAt: delivers ? Number(now) : null,
      closedAt: delivers ? null : Number(now)
    })
  }
  return { stationPatches, skippedStationIds }
}

function applyV16Refund({ order, batchStation, inventoryBySkuId = {}, now = Date.now() } = {}) {
  if (order && (order.refundAccountingApplied || order.refundedAt)) {
    return { ok: false, reason: '退款库存已处理', inventoryPatches: [] }
  }
  const eligibility = canRefundOrder(order)
  if (!eligibility.ok) return { ok: false, reason: eligibility.reason, inventoryPatches: [] }
  const grouped = itemQuantitiesBySku(order && order.items)
  if (!grouped.ok) return { ok: false, reason: grouped.reason, inventoryPatches: [] }
  const inventoryPatches = []

  for (const [skuId, quantity] of Object.entries(grouped.quantities)) {
    const inventory = inventoryBySkuId[skuId]
    if (!inventory) return { ok: false, reason: '退款库存不存在', inventoryPatches: [] }
    if (inventory.isUnlimited) continue
    inventoryPatches.push(v16InventoryPatch(inventory, skuId, {
      ...inventory,
      availableQty: Number(inventory.availableQty || 0) + quantity,
      soldQty: Number(inventory.soldQty || 0),
      refundedQty: Number(inventory.refundedQty || 0) + quantity,
      status: '上架'
    }))
  }

  const paidItemCount = Math.max(0, Number(batchStation && batchStation.paidItemCount || 0) - sumItems(order.items))
  let status = batchStation && batchStation.status
  if (status === '已确认配送') {
    status = paidItemCount === 0 ? '已关闭' : '已确认配送'
  } else {
    status = paidItemCount >= V16_STATION_THRESHOLD ? '已达门槛待确认' : '拼团中'
  }

  return {
    ok: true,
    orderPatch: { status: '已退款', refundedAt: Number(now), refundAccountingApplied: true },
    batchStationPatch: {
      paidItemCount,
      paidOrderCount: Math.max(0, Number(batchStation && batchStation.paidOrderCount || 0) - 1),
      status
    },
    inventoryPatches
  }
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
  buildVerifyCode
}
