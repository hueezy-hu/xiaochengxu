const assert = require('assert')
const domain = require('../domain')

const {
  V16_STATION_THRESHOLD,
  V16_RESERVATION_TTL_MS,
  beijingTime,
  beijingTimestamp,
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
  canPlaceOrderAtLocation
} = domain

function test(name, fn) {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (err) {
    console.error(`FAIL ${name}`)
    console.error(err.stack || err.message)
    process.exitCode = 1
  }
}

function inventory(overrides = {}) {
  return {
    _id: 'inv-a',
    skuId: 'sku-a',
    totalQty: 10,
    availableQty: 7,
    reservedQty: 1,
    soldQty: 3,
    refundedQty: 1,
    status: '上架',
    ...overrides
  }
}

test('V1.6 uses Beijing time, a fixed five-item station threshold, and a fifteen-minute reservation', () => {
  assert.equal(V16_STATION_THRESHOLD, 5)
  assert.equal(V16_RESERVATION_TTL_MS, 15 * 60 * 1000)
  assert.equal(beijingTime(Date.UTC(2026, 6, 7, 14, 0)).time, '22:00:00')
  assert.equal(beijingTimestamp('2026-07-08', '12:00'), Date.UTC(2026, 6, 8, 4, 0))
})

test('inventory balance follows available + reserved + sold - refunded = total', () => {
  assert.deepEqual(inventoryBalance(inventory()), {
    totalQty: 10,
    accountedQty: 10,
    balanced: true
  })
})

test('creating a reservation moves available stock to reserved without counting station items', () => {
  const now = Date.UTC(2026, 6, 7, 5, 0)
  const result = createReservation({
    now,
    items: [{ skuId: 'sku-a', quantity: 2 }],
    inventoryBySkuId: { 'sku-a': inventory() },
    batchStation: { paidItemCount: 4 }
  })

  assert.equal(result.ok, true)
  assert.equal(result.expiresAt, now + 15 * 60 * 1000)
  assert.equal(result.orderPatch.status, '待支付')
  assert.equal(result.inventoryPatches[0].availableQty, 5)
  assert.equal(result.inventoryPatches[0].reservedQty, 3)
  assert.equal(result.batchStationPatch, null)
  assert.equal(inventoryBalance(result.inventoryPatches[0]).balanced, true)
})

test('payment confirmation moves reserved to cumulative sold and marks the order pending delivery confirmation', () => {
  const result = confirmReservationPayment({
    now: 1000,
    batch: { status: '接单中', deadlineAt: 3000 },
    order: { status: '待支付', expiresAt: 2000, items: [{ skuId: 'sku-a', quantity: 2 }] },
    batchStation: { status: '待配送确认', paidItemCount: 2, paidOrderCount: 1 },
    inventoryBySkuId: { 'sku-a': inventory({ availableQty: 5, reservedQty: 3 }) }
  })

  assert.equal(result.ok, true)
  assert.equal(result.orderPatch.status, '待配送确认')
  assert.equal(result.inventoryPatches[0].reservedQty, 1)
  assert.equal(result.inventoryPatches[0].soldQty, 5)
  assert.equal(result.batchStationPatch.paidItemCount, 4)
  assert.equal(result.batchStationPatch.status, '拼团中')
  assert.equal(inventoryBalance(result.inventoryPatches[0]).balanced, true)
})

test('the fifth paid item changes the station to reached-threshold pending confirmation', () => {
  const result = confirmReservationPayment({
    now: 1000,
    batch: { status: '接单中', deadlineAt: 3000 },
    order: { status: '待支付', expiresAt: 2000, items: [{ skuId: 'sku-a', quantity: 1 }] },
    batchStation: { status: '待配送确认', paidItemCount: 4, paidOrderCount: 2 },
    inventoryBySkuId: { 'sku-a': inventory() }
  })

  assert.equal(result.batchStationPatch.paidItemCount, 5)
  assert.equal(result.batchStationPatch.status, '已达门槛待确认')
  assert.equal(result.triggeredThreshold, true)
})

test('payment confirmation rejects callbacks after batch deadline or reservation expiry', () => {
  const input = {
    now: 2000,
    batch: { status: '接单中', deadlineAt: 3000 },
    order: { status: '待支付', expiresAt: 2000, items: [{ skuId: 'sku-a', quantity: 1 }] },
    batchStation: { status: '拼团中', paidItemCount: 1, paidOrderCount: 1 },
    inventoryBySkuId: { 'sku-a': inventory() }
  }
  assert.equal(confirmReservationPayment(input).reason, '支付已超时')
  assert.equal(confirmReservationPayment({
    ...input,
    now: 3000,
    order: { ...input.order, expiresAt: 4000 }
  }).reason, '批次已截单')
  assert.equal(confirmReservationPayment({
    ...input,
    batch: { ...input.batch, status: '已截单待配送确认' }
  }).reason, '批次未接单')
})

test('payment confirmation never downgrades a station already confirmed for delivery', () => {
  const result = confirmReservationPayment({
    now: 1000,
    batch: { status: '接单中', deadlineAt: 3000 },
    order: { status: '待支付', expiresAt: 2000, items: [{ skuId: 'sku-a', quantity: 1 }] },
    batchStation: { status: '已确认配送', paidItemCount: 5, paidOrderCount: 2 },
    inventoryBySkuId: { 'sku-a': inventory() }
  })
  assert.equal(result.ok, true)
  assert.equal(result.batchStationPatch.status, '已确认配送')
  assert.equal(result.orderPatch.status, '待自提')
})

test('cancelling or expiring a pending order releases its reservation only once', () => {
  const input = {
    now: 2000,
    reason: '用户取消',
    order: { status: '待支付', items: [{ skuId: 'sku-a', quantity: 1 }] },
    inventoryBySkuId: { 'sku-a': inventory() }
  }
  const first = releaseReservation(input)
  assert.equal(first.released, true)
  assert.equal(first.inventoryPatches[0].availableQty, 8)
  assert.equal(first.inventoryPatches[0].reservedQty, 0)
  assert.equal(first.orderPatch.status, '已取消')

  const timeout = releaseReservation({ ...input, reason: '支付超时' })
  assert.equal(timeout.orderPatch.status, '已超时')

  const second = releaseReservation({
    ...input,
    order: { ...input.order, ...first.orderPatch },
    inventoryBySkuId: { 'sku-a': { ...inventory(), ...first.inventoryPatches[0] } }
  })
  assert.equal(second.released, false)
  assert.deepEqual(second.inventoryPatches, [])
})

test('22:00 only closes sales and never decides station delivery success', () => {
  const result = closeSalesAt22({
    now: beijingTimestamp('2026-07-07', '22:00'),
    batch: { status: '接单中', deadlineAt: beijingTimestamp('2026-07-07', '22:00') },
    batchStations: [
      { _id: 'low', status: '待配送确认', paidItemCount: 2 },
      { _id: 'enough', status: '已达门槛待确认', paidItemCount: 5 }
    ]
  })

  assert.equal(result.shouldClose, true)
  assert.equal(result.batchPatch.status, '已截单待配送确认')
  assert.deepEqual(result.stationPatches, [])
  assert.equal(result.shouldExpirePending, true)
})

test('pickup-day 12:00 confirms stations at five and closes/refunds stations below five', () => {
  const result = confirmPickupDayStations({
    now: beijingTimestamp('2026-07-08', '12:00'),
    batchStations: [
      { _id: 'enough', status: '已达门槛待确认', paidItemCount: 5 },
      { _id: 'low', status: '拼团中', paidItemCount: 4 }
    ]
  })

  assert.equal(result.stationPatches[0].status, '已确认配送')
  assert.equal(result.stationPatches[0].shouldRefund, false)
  assert.equal(result.stationPatches[1].status, '已关闭退款中')
  assert.equal(result.stationPatches[1].shouldRefund, true)
  assert.equal(Object.hasOwn(result, 'orderPatches'), false)
})

test('pickup-day confirmation skips a station already confirmed manually', () => {
  const result = confirmPickupDayStations({
    batchStations: [{
      _id: 'manual',
      status: '已确认配送',
      paidItemCount: 2,
      manuallyConfirmedAt: 123,
      orderIds: ['服务层不应依赖此字段']
    }]
  })

  assert.deepEqual(result.stationPatches, [])
  assert.deepEqual(result.skippedStationIds, ['manual'])
})

test('pickup-day confirmation idempotently skips terminal and refunding stations', () => {
  const result = confirmPickupDayStations({
    batchStations: [
      { _id: 'refunding', status: '已关闭退款中', paidItemCount: 2 },
      { _id: 'closed', status: '已关闭', paidItemCount: 0 },
      { _id: 'completed', status: '已完成', paidItemCount: 5 }
    ]
  })
  assert.deepEqual(result.stationPatches, [])
  assert.deepEqual(result.skippedStationIds, ['refunding', 'closed', 'completed'])
})

test('refunds keep sold cumulative, increase refunded and available, and keep confirmed delivery above zero', () => {
  const result = applyV16Refund({
    now: 3000,
    order: { status: '待自提', items: [{ skuId: 'sku-a', quantity: 2 }] },
    batchStation: { status: '已确认配送', paidItemCount: 5, paidOrderCount: 3 },
    inventoryBySkuId: { 'sku-a': inventory({ availableQty: 4, reservedQty: 0, soldQty: 6, refundedQty: 0 }) }
  })

  assert.equal(result.inventoryPatches[0].availableQty, 6)
  assert.equal(result.inventoryPatches[0].soldQty, 6)
  assert.equal(result.inventoryPatches[0].refundedQty, 2)
  assert.equal(result.batchStationPatch.paidItemCount, 3)
  assert.equal(result.batchStationPatch.status, '已确认配送')
  assert.equal(inventoryBalance(result.inventoryPatches[0]).balanced, true)
  assert.equal(result.orderPatch.refundAccountingApplied, true)
})

test('refunds close a confirmed station only when its paid item count reaches zero', () => {
  const result = applyV16Refund({
    order: { status: '待自提', items: [{ skuId: 'sku-a', quantity: 2 }] },
    batchStation: { status: '已确认配送', paidItemCount: 2, paidOrderCount: 1 },
    inventoryBySkuId: { 'sku-a': inventory({ availableQty: 4, reservedQty: 0, soldQty: 6, refundedQty: 0 }) }
  })

  assert.equal(result.batchStationPatch.paidItemCount, 0)
  assert.equal(result.batchStationPatch.status, '已关闭')
})

test('refunds return an unconfirmed station to grouping even when its count reaches zero', () => {
  const input = {
    order: { status: '待配送确认', items: [{ skuId: 'sku-a', quantity: 2 }] },
    inventoryBySkuId: { 'sku-a': inventory({ availableQty: 4, reservedQty: 0, soldQty: 6, refundedQty: 0 }) }
  }
  const zero = applyV16Refund({
    ...input,
    batchStation: { status: '已达门槛待确认', paidItemCount: 2, paidOrderCount: 1 }
  })
  const belowThreshold = applyV16Refund({
    ...input,
    batchStation: { status: '已达门槛待确认', paidItemCount: 5, paidOrderCount: 2 }
  })
  assert.equal(zero.batchStationPatch.paidItemCount, 0)
  assert.equal(zero.batchStationPatch.status, '拼团中')
  assert.equal(belowThreshold.batchStationPatch.paidItemCount, 3)
  assert.equal(belowThreshold.batchStationPatch.status, '拼团中')
})

test('refund accounting rejects ineligible and duplicate orders without returning stock twice', () => {
  const input = {
    order: { status: '待自提', items: [{ skuId: 'sku-a', quantity: 2 }] },
    batchStation: { status: '已确认配送', paidItemCount: 2, paidOrderCount: 1 },
    inventoryBySkuId: { 'sku-a': inventory({ availableQty: 4, reservedQty: 0, soldQty: 6, refundedQty: 0 }) }
  }
  const first = applyV16Refund(input)
  assert.equal(first.ok, true)
  const duplicate = applyV16Refund({
    ...input,
    order: { ...input.order, ...first.orderPatch },
    inventoryBySkuId: { 'sku-a': { ...input.inventoryBySkuId['sku-a'], ...first.inventoryPatches[0] } }
  })
  assert.equal(duplicate.ok, false)
  assert.equal(duplicate.reason, '退款库存已处理')
  assert.deepEqual(duplicate.inventoryPatches, [])

  const verified = applyV16Refund({ ...input, order: { ...input.order, status: '已核销', verifiedAt: 1 } })
  assert.equal(verified.ok, false)
  assert.deepEqual(verified.inventoryPatches, [])
})

test('fulfillment transition returns CAS expectedStatus and makes refund verify and place mutually exclusive', () => {
  const base = { status: '待自提' }
  for (const operation of ['refund', 'verify', 'place']) {
    const first = transitionOrderFulfillment({ order: base, operation, now: 123 })
    assert.equal(first.ok, true)
    assert.equal(first.expectedStatus, '待自提')
    const nextOrder = { ...base, ...first.orderPatch }
    for (const competingOperation of ['refund', 'verify', 'place']) {
      const competing = transitionOrderFulfillment({ order: nextOrder, operation: competingOperation, now: 124 })
      const placedThenPickedUp = operation === 'place' && competingOperation === 'verify'
      assert.equal(competing.ok, placedThenPickedUp, `${operation} 后 ${competingOperation} 状态不符合预期`)
    }
  }
})

test('fulfillment transition uses the strict PRD completion and placed-for-pickup statuses', () => {
  const verify = transitionOrderFulfillment({ order: { status: '待自提' }, operation: 'verify', now: 123 })
  const place = transitionOrderFulfillment({ order: { status: '待自提' }, operation: 'place', now: 123 })
  assert.equal(verify.orderPatch.status, '已完成')
  assert.equal(place.orderPatch.status, '已放置待自取')
  const pickupAfterPlacement = transitionOrderFulfillment({ order: { status: '已放置待自取' }, operation: 'verify', now: 124 })
  assert.equal(pickupAfterPlacement.ok, true)
  assert.equal(pickupAfterPlacement.orderPatch.status, '已完成')
})

test('refund eligibility ends after verification, completion, or fixed-location placement', () => {
  assert.equal(canRefundOrder({ status: '待配送确认' }).ok, true)
  assert.equal(canRefundOrder({ status: '待自提' }).ok, true)
  assert.equal(canRefundOrder({ status: '已核销', verifiedAt: 1 }).ok, false)
  assert.equal(canRefundOrder({ status: '已完成', completedAt: 1 }).ok, false)
  assert.equal(canRefundOrder({ status: '已放置', placedAt: 1 }).ok, false)
})

test('verification and fixed-location placement require a confirmed station and pending-pickup order', () => {
  assert.equal(canVerifyOrder({ order: { status: '待自提' }, batchStation: { status: '已确认配送' } }).ok, true)
  assert.equal(canVerifyOrder({ order: { status: '待配送确认' }, batchStation: { status: '已确认配送' } }).ok, false)
  assert.equal(canPlaceOrderAtLocation({ order: { status: '待自提' }, batchStation: { status: '已确认配送' } }).ok, true)
  assert.equal(canPlaceOrderAtLocation({ order: { status: '待自提' }, batchStation: { status: '已关闭' } }).ok, false)
})

test('legacy domain exports stay available while callers migrate', () => {
  for (const name of [
    'evaluatePaidOrder',
    'canSelfCancelOrder',
    'applyRefundToSnapshots',
    'advanceBatchLifecycle',
    'buildVerifyCode'
  ]) {
    assert.equal(typeof domain[name], 'function', `${name} must remain exported`)
  }
})
