const assert = require('assert')
const {
  createReservation,
  confirmReservationPayment,
  releaseReservation,
  inventoryBalance
} = require('../domain')

function baseInventory(availableQty) {
  return {
    'sku-a': {
      _id: 'inv-a',
      skuId: 'sku-a',
      totalQty: availableQty,
      availableQty,
      reservedQty: 0,
      soldQty: 0,
      refundedQty: 0,
      status: '上架'
    }
  }
}

function applyInventory(snapshot, patches) {
  const next = JSON.parse(JSON.stringify(snapshot))
  for (const patch of patches) {
    next[patch.skuId] = { ...next[patch.skuId], ...patch }
  }
  return next
}

function simulateLastItemReservationRace() {
  let stock = baseInventory(1)
  const first = createReservation({ items: [{ skuId: 'sku-a', quantity: 1 }], inventoryBySkuId: stock })
  assert.equal(first.ok, true)
  stock = applyInventory(stock, first.inventoryPatches)

  const second = createReservation({ items: [{ skuId: 'sku-a', quantity: 1 }], inventoryBySkuId: stock })
  assert.equal(second.ok, false)
  assert.equal(second.reason, '库存不足')
  assert.equal(inventoryBalance(stock['sku-a']).balanced, true)
  return { first: 'reserved', second: second.reason }
}

function simulateCancelPayRace() {
  let stock = baseInventory(1)
  const reservation = createReservation({ items: [{ skuId: 'sku-a', quantity: 1 }], inventoryBySkuId: stock })
  stock = applyInventory(stock, reservation.inventoryPatches)
  const order = {
    status: '待支付',
    items: [{ skuId: 'sku-a', quantity: 1 }],
    expiresAt: reservation.expiresAt
  }

  const payment = confirmReservationPayment({
    now: 1000,
    batch: { status: '接单中', deadlineAt: 3000 },
    order: { ...order, expiresAt: 2000 },
    batchStation: { status: '待配送确认', paidItemCount: 4, paidOrderCount: 1 },
    inventoryBySkuId: stock
  })
  assert.equal(payment.ok, true)
  stock = applyInventory(stock, payment.inventoryPatches)

  const cancellation = releaseReservation({
    order: { ...order, ...payment.orderPatch },
    inventoryBySkuId: stock,
    reason: '支付后迟到的取消请求'
  })
  assert.equal(cancellation.released, false)
  assert.equal(inventoryBalance(stock['sku-a']).balanced, true)
  return { payment: 'sold', cancellation: 'ignored', thresholdTriggered: payment.triggeredThreshold }
}

const stockRace = simulateLastItemReservationRace()
const cancelPayRace = simulateCancelPayRace()

console.log('领域快照：最后一件库存预占顺序模拟:', stockRace)
console.log('领域快照：支付与取消顺序模拟:', cancelPayRace)
console.log('PASS V1.6 domain snapshot ordering simulations (not database concurrency)')
