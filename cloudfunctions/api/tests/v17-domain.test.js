const test = require('node:test')
const assert = require('node:assert/strict')

const {
  createReservation,
  evaluatePaidOrder,
  confirmReservationPayment,
  releaseReservation,
  inventoryBalance,
  confirmPickupDayStations,
  applyV16Refund,
  applyRefundToSnapshots,
  advanceBatchLifecycle,
  recalculateStationCounts,
  lockStationAtCutoff,
  decideStationAtNoon,
  applyV17Refund,
  transitionV17Order
} = require('../domain')

function inventory(availableQty = 10) {
  return {
    _id: 'inv-sku1',
    skuId: 'sku1',
    totalQty: availableQty,
    availableQty,
    reservedQty: 0,
    soldQty: 0,
    refundedQty: 0,
    status: '上架'
  }
}

test('V1.7 reservation lasts exactly three minutes and uses the hidden reservation status', () => {
  const now = 1000
  const result = createReservation({
    items: [{ skuId: 'sku1', quantity: 2 }],
    inventoryBySkuId: { sku1: inventory() },
    now
  })

  assert.equal(result.ok, true)
  assert.equal(result.expiresAt, now + 3 * 60 * 1000)
  assert.equal(result.orderPatch.status, '预占中')
  assert.equal(result.inventoryPatches[0].availableQty, 8)
  assert.equal(result.inventoryPatches[0].reservedQty, 2)
  assert.equal(inventoryBalance(result.inventoryPatches[0]).balanced, true)
})

test('V1.7 payment counts one buyer once even when the buyer purchases five items', () => {
  const now = 2000
  const inv = { ...inventory(10), availableQty: 5, reservedQty: 5 }
  const result = confirmReservationPayment({
    order: {
      _id: 'o1',
      userOpenid: 'buyer-a',
      status: '预占中',
      expiresAt: now + 1000,
      items: [{ skuId: 'sku1', quantity: 5 }]
    },
    batch: { _id: 'b1', status: '接单中', deadlineAt: now + 1000 },
    batchStation: {
      _id: 'bs1',
      status: '拼团中',
      thresholdN: 5,
      paidUserOpenids: [],
      paidUserCount: 0,
      paidItemCount: 0,
      paidOrderCount: 0
    },
    inventoryBySkuId: { sku1: inv },
    now
  })

  assert.equal(result.ok, true)
  assert.deepEqual(result.batchStationPatch.paidUserOpenids, ['buyer-a'])
  assert.equal(result.batchStationPatch.paidUserCount, 1)
  assert.equal(result.batchStationPatch.paidItemCount, 5)
  assert.equal(result.batchStationPatch.status, '拼团中')
  assert.equal(result.triggeredThreshold, false)
})

test('V1.7 station counters derive people, items and orders from active paid orders', () => {
  assert.equal(typeof recalculateStationCounts, 'function')
  const result = recalculateStationCounts({
    batchStation: { status: '拼团中', thresholdN: 5 },
    activeOrders: [
      { userOpenid: 'buyer-a', items: [{ skuId: 'sku1', quantity: 2 }] },
      { userOpenid: 'buyer-a', items: [{ skuId: 'sku2', quantity: 1 }] },
      { userOpenid: 'buyer-b', items: [{ skuId: 'sku1', quantity: 4 }] }
    ]
  })

  assert.deepEqual(result.paidUserOpenids, ['buyer-a', 'buyer-b'])
  assert.equal(result.paidUserCount, 2)
  assert.equal(result.paidItemCount, 7)
  assert.equal(result.paidOrderCount, 3)
  assert.equal(result.status, '拼团中')
})

test('V1.7 locked or confirmed delivery does not dissolve below five unless every order is gone', () => {
  const activeOrders = [{ userOpenid: 'buyer-a', items: [{ skuId: 'sku1', quantity: 1 }] }]
  const locked = recalculateStationCounts({
    batchStation: { status: '已成团待确认', thresholdN: 5, cutoffLockedAt: 1000 },
    activeOrders
  })
  const confirmed = recalculateStationCounts({
    batchStation: { status: '已确认配送', thresholdN: 5 },
    activeOrders
  })
  const empty = recalculateStationCounts({
    batchStation: { status: '已确认配送', thresholdN: 5 },
    activeOrders: []
  })

  assert.equal(locked.status, '已成团待确认')
  assert.equal(confirmed.status, '已确认配送')
  assert.equal(empty.status, '已关闭')
})

test('V1.7 cutoff locks each station by paid people without confirming delivery', () => {
  assert.equal(typeof lockStationAtCutoff, 'function')
  const formed = lockStationAtCutoff({ _id: 's1', paidUserCount: 5, thresholdN: 5 }, 2200)
  const unformed = lockStationAtCutoff({ _id: 's2', paidUserCount: 4, thresholdN: 5 }, 2200)

  assert.equal(formed.status, '已成团待确认')
  assert.equal(unformed.status, '未成团待处理')
  assert.equal(formed.cutoffLockedAt, 2200)
  assert.equal(unformed.cutoffLockedAt, 2200)
})

test('V1.7 noon confirms formed stations and closes unformed stations for refund', () => {
  assert.equal(typeof decideStationAtNoon, 'function')
  const formed = decideStationAtNoon({ _id: 's1', status: '已成团待确认', paidUserCount: 5 }, 1200)
  const unformed = decideStationAtNoon({ _id: 's2', status: '未成团待处理', paidUserCount: 4 }, 1200)

  assert.equal(formed.status, '已确认配送')
  assert.equal(formed.shouldRefund, false)
  assert.equal(unformed.status, '关闭退款中')
  assert.equal(unformed.shouldRefund, true)
})

test('V1.7 cancellation releases a hidden reservation exactly once', () => {
  const order = {
    _id: 'o1',
    status: '预占中',
    items: [{ skuId: 'sku1', quantity: 2 }]
  }
  const inv = { ...inventory(10), availableQty: 8, reservedQty: 2 }
  const released = releaseReservation({ order, inventoryBySkuId: { sku1: inv }, now: 3000, reason: '用户取消' })
  const duplicate = releaseReservation({ order: { ...order, ...released.orderPatch }, inventoryBySkuId: { sku1: inv }, now: 3001, reason: '用户取消' })

  assert.equal(released.released, true)
  assert.equal(released.orderPatch.status, '已取消')
  assert.equal(released.inventoryPatches[0].availableQty, 10)
  assert.equal(released.inventoryPatches[0].reservedQty, 0)
  assert.equal(duplicate.released, false)
})

test('V1.7 refund restores item inventory and derives people from remaining active orders', () => {
  assert.equal(typeof applyV17Refund, 'function')
  const result = applyV17Refund({
    order: {
      _id: 'o1',
      userOpenid: 'buyer-a',
      status: '待自提',
      items: [{ skuId: 'sku1', quantity: 2 }]
    },
    batchStation: {
      _id: 'bs1',
      status: '已确认配送',
      thresholdN: 5,
      paidUserOpenids: ['buyer-a', 'buyer-b'],
      paidUserCount: 2,
      paidItemCount: 3,
      paidOrderCount: 2
    },
    inventoryBySkuId: {
      sku1: { ...inventory(10), availableQty: 7, soldQty: 3 }
    },
    remainingActiveOrders: [
      { _id: 'o2', userOpenid: 'buyer-b', items: [{ skuId: 'sku1', quantity: 1 }] }
    ],
    now: 4000
  })

  assert.equal(result.ok, true)
  assert.equal(result.inventoryPatches[0].availableQty, 9)
  assert.equal(result.inventoryPatches[0].soldQty, 3)
  assert.equal(result.inventoryPatches[0].refundedQty, 2)
  assert.equal(inventoryBalance(result.inventoryPatches[0]).balanced, true)
  assert.equal(result.batchStationPatch.paidUserCount, 1)
  assert.equal(result.batchStationPatch.paidItemCount, 1)
  assert.equal(result.batchStationPatch.status, '已确认配送')
  assert.equal(result.orderPatch.status, '已退款')
})

test('V1.7 manual approval can apply accounting after delivery', () => {
  const result = applyV17Refund({
    order: { _id: 'o1', userOpenid: 'buyer-a', status: '已完成', items: [{ skuId: 'sku1', quantity: 1 }] },
    batchStation: { _id: 'bs1', status: '已确认配送', paidUserCount: 1, paidItemCount: 1, paidOrderCount: 1 },
    inventoryBySkuId: { sku1: { ...inventory(10), availableQty: 9, soldQty: 1 } },
    remainingActiveOrders: [],
    allowPostDelivery: true,
    now: 4500
  })

  assert.equal(result.ok, true)
  assert.equal(result.orderPatch.status, '已退款')
  assert.equal(result.batchStationPatch.paidUserCount, 0)
})

test('V1.7 order transitions separate self-refund, delivery and post-delivery requests', () => {
  assert.equal(typeof transitionV17Order, 'function')
  const selfRefund = transitionV17Order({ order: { status: '待自提' }, operation: 'refund', now: 5000 })
  const verify = transitionV17Order({ order: { status: '待自提' }, operation: 'verify', now: 5000 })
  const place = transitionV17Order({ order: { status: '待自提' }, operation: 'place', now: 5000 })
  const request = transitionV17Order({ order: { status: '已完成' }, operation: 'requestRefund', now: 5000 })

  assert.equal(selfRefund.orderPatch.status, '退款处理中')
  assert.equal(verify.orderPatch.status, '已完成')
  assert.equal(place.orderPatch.status, '已放置待自取')
  assert.equal(request.orderPatch.status, '退款申请待处理')
  assert.equal(request.orderPatch.refundRequest.originalOrderStatus, '已完成')
})

test('compatibility lifecycle entry uses paid people instead of paid items', () => {
  const result = confirmPickupDayStations({
    now: 6000,
    batchStations: [
      { _id: 'many-items', status: '未成团待处理', paidUserCount: 1, paidItemCount: 20 },
      { _id: 'five-people', status: '已成团待确认', paidUserCount: 5, paidItemCount: 5 }
    ]
  })

  assert.equal(result.stationPatches[0].status, '关闭退款中')
  assert.equal(result.stationPatches[0].shouldRefund, true)
  assert.equal(result.stationPatches[1].status, '已确认配送')
  assert.equal(result.stationPatches[1].shouldRefund, false)
})

test('legacy paid-order entry delegates to V1.7 reservation confirmation', () => {
  const result = evaluatePaidOrder({
    now: 6500,
    batch: { status: '接单中', deadlineAt: 7000 },
    order: { userOpenid: 'buyer-a', status: '预占中', expiresAt: 6800, items: [{ skuId: 'sku1', quantity: 5 }] },
    batchStation: { status: '拼团中', thresholdN: 5, paidUserCount: 0, paidItemCount: 0, paidOrderCount: 0 },
    inventoryBySkuId: { sku1: { ...inventory(10), availableQty: 5, reservedQty: 5 } }
  })

  assert.equal(result.ok, true)
  assert.equal(result.batchStationPatch.paidUserCount, 1)
  assert.equal(result.batchStationPatch.status, '拼团中')
  assert.equal(result.orderPatch.status, '待配送确认')
})

test('compatibility refund entry derives people from remaining active orders', () => {
  const result = applyV16Refund({
    now: 7000,
    order: { _id: 'o1', userOpenid: 'buyer-a', status: '待自提', items: [{ skuId: 'sku1', quantity: 2 }] },
    batchStation: { _id: 'bs1', status: '已确认配送', paidUserCount: 2, paidItemCount: 4, paidOrderCount: 3 },
    inventoryBySkuId: { sku1: { ...inventory(10), availableQty: 6, soldQty: 4 } },
    remainingActiveOrders: [
      { _id: 'o2', userOpenid: 'buyer-a', items: [{ skuId: 'sku1', quantity: 1 }] },
      { _id: 'o3', userOpenid: 'buyer-b', items: [{ skuId: 'sku1', quantity: 1 }] }
    ]
  })

  assert.equal(result.batchStationPatch.paidUserCount, 2)
  assert.equal(result.batchStationPatch.paidItemCount, 2)
  assert.equal(result.batchStationPatch.paidOrderCount, 2)
  assert.equal(result.batchStationPatch.status, '已确认配送')
})

test('legacy snapshot refund preserves cumulative sold and V1.7 people counters', () => {
  const result = applyRefundToSnapshots({
    now: 8000,
    order: { _id: 'o1', userOpenid: 'buyer-a', status: '待自提', items: [{ skuId: 'sku1', quantity: 2 }] },
    batchStation: { _id: 'bs1', status: '拼团中', paidUserCount: 2, paidItemCount: 3, paidOrderCount: 2 },
    inventoryBySkuId: { sku1: { ...inventory(10), availableQty: 7, soldQty: 3 } },
    remainingActiveOrders: [{ _id: 'o2', userOpenid: 'buyer-b', items: [{ skuId: 'sku1', quantity: 1 }] }]
  })

  assert.equal(result.inventoryPatches[0].soldQty, 3)
  assert.equal(result.inventoryPatches[0].refundedQty, 2)
  assert.equal(result.batchStationPatch.paidUserCount, 1)
})

test('legacy lifecycle entry only closes sales at cutoff and does not decide delivery', () => {
  const result = advanceBatchLifecycle({
    now: 9000,
    batch: { status: '接单中', deadlineAt: 9000 },
    batchStations: [{ _id: 'bs1', paidUserCount: 1, paidItemCount: 20 }]
  })

  assert.equal(result.shouldClose, true)
  assert.equal(result.batchPatch.status, '已截单待配送确认')
  assert.deepEqual(result.stationPatches, [])
})
