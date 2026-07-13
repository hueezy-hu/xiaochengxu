const { ORDER_STATUS } = require('../constants/v17')
const { recalculateStationCounts } = require('./grouping')

const SELF_REFUNDABLE = new Set([
  ORDER_STATUS.WAITING_DELIVERY,
  ORDER_STATUS.WAITING_PICKUP
])
const POST_DELIVERY_REFUNDABLE = new Set([
  ORDER_STATUS.PLACED,
  ORDER_STATUS.COMPLETED,
  ORDER_STATUS.COMPLETED_NO_SHOW,
  ORDER_STATUS.REFUND_REQUESTED
])

function quantitiesBySku(items = []) {
  const quantities = {}
  for (const item of items) {
    const quantity = Number(item && item.quantity || 0)
    if (!item || !item.skuId || !Number.isInteger(quantity) || quantity <= 0) return null
    quantities[item.skuId] = Number(quantities[item.skuId] || 0) + quantity
  }
  return Object.keys(quantities).length ? quantities : null
}

function refundInventoryPatch(inventory, skuId, quantity) {
  return {
    _id: inventory._id,
    skuId,
    totalQty: Number(inventory.totalQty || 0),
    availableQty: Number(inventory.availableQty || 0) + quantity,
    reservedQty: Number(inventory.reservedQty || 0),
    soldQty: Number(inventory.soldQty || 0),
    refundedQty: Number(inventory.refundedQty || 0) + quantity,
    isUnlimited: Boolean(inventory.isUnlimited),
    status: '上架'
  }
}

function applyV17Refund({
  order,
  batchStation,
  inventoryBySkuId = {},
  remainingActiveOrders = [],
  allowPostDelivery = false,
  now = Date.now()
} = {}) {
  if (order && (order.refundAccountingApplied || order.refundedAt)) return { ok: false, reason: '退款库存已处理', inventoryPatches: [] }
  const eligible = order && (SELF_REFUNDABLE.has(order.status) || (allowPostDelivery && POST_DELIVERY_REFUNDABLE.has(order.status)))
  if (!eligible) return { ok: false, reason: '当前状态不可自助退款', inventoryPatches: [] }
  const quantities = quantitiesBySku(order.items)
  if (!quantities) return { ok: false, reason: '订单商品无效', inventoryPatches: [] }

  const inventoryPatches = []
  for (const [skuId, quantity] of Object.entries(quantities)) {
    const inventory = inventoryBySkuId[skuId]
    if (!inventory) return { ok: false, reason: '退款库存不存在', inventoryPatches: [] }
    if (!inventory.isUnlimited) inventoryPatches.push(refundInventoryPatch(inventory, skuId, quantity))
  }

  return {
    ok: true,
    orderPatch: {
      status: ORDER_STATUS.REFUNDED,
      refundedAt: Number(now),
      refundAccountingApplied: true
    },
    batchStationPatch: recalculateStationCounts({ batchStation, activeOrders: remainingActiveOrders }),
    inventoryPatches
  }
}

module.exports = { applyV17Refund }
