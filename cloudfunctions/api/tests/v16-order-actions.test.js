const assert = require('assert')
const fs = require('fs')
const path = require('path')
const {
  createOrderActions,
  ERROR_CODES
} = require('../src/services/order-actions')

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value))
}

function createMemoryRepository(seed = {}, options = {}) {
  const state = {
    orders: clone(seed.orders || {}),
    batches: clone(seed.batches || {}),
    batchStations: clone(seed.batchStations || {}),
    skus: clone(seed.skus || {}),
    inventories: clone(seed.inventories || {}),
    refunds: clone(seed.refunds || {})
  }
  let orderSequence = Object.keys(state.orders).length

  return {
    state,
    async listPendingOrderIds(limit = 100) {
      return Object.values(state.orders).filter((row) => row.status === '预占中').slice(0, limit).map((row) => row._id)
    },
    async runTransaction(work) {
      const draft = clone(state)
      const tx = {
        findOrderByClientRequestId: async (openid, clientRequestId) => clone(Object.values(draft.orders).find((row) => row.userOpenid === openid && row.clientRequestId === clientRequestId) || null),
        getOrder: async (id) => clone(draft.orders[id] || null),
        getBatch: async (id) => clone(draft.batches[id] || null),
        getBatchStation: async (id) => clone(draft.batchStations[id] || null),
        getSku: async (id) => clone(draft.skus[id] || null),
        getInventory: async (batchId, skuId) => clone(draft.inventories[`${batchId}:${skuId}`] || null),
        getRefund: async (id) => clone(draft.refunds[id] || null),
        listOrdersByStation: async (batchStationId, statuses) => clone(Object.values(draft.orders).filter((row) => row.batchStationId === batchStationId && statuses.includes(row.status))),
        createOrder: async (data, requestedId) => {
          const id = requestedId || `order-${++orderSequence}`
          draft.orders[id] = { _id: id, ...clone(data) }
          return id
        },
        saveOrder: async (id, patch) => { draft.orders[id] = { ...draft.orders[id], ...clone(patch) } },
        saveBatchStation: async (id, patch) => { draft.batchStations[id] = { ...draft.batchStations[id], ...clone(patch) } },
        saveInventory: async (row) => { draft.inventories[`${row.batchId}:${row.skuId}`] = clone(row) },
        saveRefund: async (id, data) => { draft.refunds[id] = { _id: id, ...clone(data) } }
      }
      const result = await work(tx)
      Object.assign(state, draft)
      if (options.throwAfterFirstCommit) {
        options.throwAfterFirstCommit = false
        throw new Error('simulated write conflict after commit')
      }
      return result
    }
  }
}

function baseSeed(overrides = {}) {
  return {
    batches: { b1: { _id: 'b1', status: '接单中', deadlineAt: 2000000 } },
    batchStations: { s1: { _id: 's1', batchId: 'b1', stationId: 'station-1', status: '拼团中', paidItemCount: 0, paidOrderCount: 0 } },
    skus: { sku1: { _id: 'sku1', name: 'Cake', spec: '1pc', price: 2800, status: '上架' } },
    inventories: { 'b1:sku1': { _id: 'inv1', batchId: 'b1', skuId: 'sku1', totalQty: 10, availableQty: 10, reservedQty: 0, soldQty: 0, refundedQty: 0, status: '上架' } },
    ...overrides
  }
}

function createHarness(seed = baseSeed(), now = 1000000) {
  const repository = createMemoryRepository(seed)
  const actions = createOrderActions({ repository, now: () => now, mockPay: true })
  return { repository, actions }
}

async function test(name, fn) {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (err) {
    console.error(`FAIL ${name}`)
    console.error(err.stack || err.message)
    process.exitCode = 1
  }
}

test('createOrder validates V1.7 identity fields before reserving inventory', async () => {
  const { repository, actions } = createHarness()
  const result = await actions.createOrder({ openid: 'u1', requestId: 'r1', clientRequestId: '', batchStationId: 's1', items: [{ skuId: 'sku1', quantity: 1 }], contactName: 'A', phone: '13800138000' })
  assert.equal(result.ok, false)
  assert.equal(result.code, ERROR_CODES.INVALID_ARGUMENT)
  assert.equal(result.requestId, 'r1')
  assert.equal(typeof result.serverNow, 'number')
  assert.equal(repository.state.inventories['b1:sku1'].reservedQty, 0)
})

test('createOrder trusts server SKU price, reserves inventory and is idempotent', async () => {
  const { repository, actions } = createHarness()
  const input = { openid: 'u1', requestId: 'r1', clientRequestId: 'c1', batchStationId: 's1', items: [{ skuId: 'sku1', quantity: 2, price: 1, name: 'Fake' }], contactName: 'Alice', phone: '13800138000' }
  const first = await actions.createOrder(input)
  const second = await actions.createOrder({ ...input, requestId: 'r2' })
  assert.equal(first.ok, true)
  assert.equal(first.amount, 5600)
  assert.equal(first.expiresAt, 1180000)
  assert.equal(second.orderId, first.orderId)
  assert.equal(second.idempotent, true)
  assert.equal(repository.state.inventories['b1:sku1'].availableQty, 8)
  assert.equal(repository.state.inventories['b1:sku1'].reservedQty, 2)
  assert.equal(repository.state.orders[first.orderId].items[0].unitPrice, 2800)
  assert.equal(Object.keys(repository.state.orders).length, 1)
})

test('createOrder atomically reserves multiple SKUs and stores tail plus random pickup token', async () => {
  const seed = baseSeed()
  seed.skus.sku2 = { _id: 'sku2', name: 'Pandan', spec: '1box', price: 1500, status: '上架' }
  seed.inventories['b1:sku2'] = { _id: 'inv2', batchId: 'b1', skuId: 'sku2', totalQty: 4, availableQty: 4, reservedQty: 0, soldQty: 0, refundedQty: 0, status: '上架' }
  const { repository, actions } = createHarness(seed)
  const result = await actions.createOrder({
    openid: 'u1', requestId: 'r1', clientRequestId: 'multi-1', batchStationId: 's1', contactName: 'Alice', phone: '13800138000',
    items: [{ skuId: 'sku1', quantity: 2 }, { skuId: 'sku2', quantity: 3 }]
  })

  assert.equal(result.ok, true)
  assert.equal(result.amount, 10100)
  assert.equal(repository.state.inventories['b1:sku1'].reservedQty, 2)
  assert.equal(repository.state.inventories['b1:sku2'].reservedQty, 3)
  assert.equal(repository.state.orders[result.orderId].phoneTail, '8000')
  assert.match(repository.state.orders[result.orderId].pickupQrToken, /^[a-f0-9]{48}$/)
})

test('createOrder leaves every SKU untouched when any selected SKU is short', async () => {
  const seed = baseSeed()
  seed.skus.sku2 = { _id: 'sku2', name: 'Pandan', spec: '1box', price: 1500, status: '上架' }
  seed.inventories['b1:sku2'] = { _id: 'inv2', batchId: 'b1', skuId: 'sku2', totalQty: 1, availableQty: 1, reservedQty: 0, soldQty: 0, refundedQty: 0, status: '上架' }
  const { repository, actions } = createHarness(seed)
  const result = await actions.createOrder({
    openid: 'u1', requestId: 'r1', clientRequestId: 'multi-short', batchStationId: 's1', contactName: 'Alice', phone: '13800138000',
    items: [{ skuId: 'sku1', quantity: 2 }, { skuId: 'sku2', quantity: 2 }]
  })

  assert.equal(result.ok, false)
  assert.equal(result.code, ERROR_CODES.INVENTORY_INSUFFICIENT)
  assert.equal(repository.state.inventories['b1:sku1'].reservedQty, 0)
  assert.equal(repository.state.inventories['b1:sku2'].reservedQty, 0)
  assert.equal(Object.keys(repository.state.orders).length, 0)
})

test('payOrder converts reserved inventory to sold while one buyer still counts as one person', async () => {
  const { repository, actions } = createHarness()
  const created = await actions.createOrder({ openid: 'u1', requestId: 'r1', clientRequestId: 'c1', batchStationId: 's1', items: [{ skuId: 'sku1', quantity: 5 }], contactName: 'Alice', phone: '13800138000' })
  const paid = await actions.payOrder({ openid: 'u1', requestId: 'pay1', orderId: created.orderId })
  const duplicate = await actions.payOrder({ openid: 'u1', requestId: 'pay2', orderId: created.orderId })
  assert.equal(paid.ok, true)
  assert.equal(paid.status, '待配送确认')
  assert.equal(duplicate.idempotent, true)
  assert.equal(repository.state.inventories['b1:sku1'].reservedQty, 0)
  assert.equal(repository.state.inventories['b1:sku1'].soldQty, 5)
  assert.equal(repository.state.batchStations.s1.paidItemCount, 5)
  assert.equal(repository.state.batchStations.s1.paidUserCount, 1)
  assert.equal(repository.state.batchStations.s1.status, '拼团中')
})

test('payOrder expires late payment and releases reservation', async () => {
  const { repository, actions } = createHarness(baseSeed(), 1180001)
  const seedOrder = { _id: 'o1', batchId: 'b1', batchStationId: 's1', stationId: 'station-1', userOpenid: 'u1', items: [{ skuId: 'sku1', quantity: 2, unitPrice: 2800, subtotal: 5600 }], amount: 5600, status: '预占中', expiresAt: 1180000 }
  repository.state.orders.o1 = seedOrder
  repository.state.inventories['b1:sku1'].availableQty = 8
  repository.state.inventories['b1:sku1'].reservedQty = 2
  const result = await actions.payOrder({ openid: 'u1', requestId: 'pay1', orderId: 'o1' })
  assert.equal(result.ok, false)
  assert.equal(result.code, ERROR_CODES.ORDER_EXPIRED)
  assert.equal(repository.state.orders.o1.status, '已超时')
  assert.equal(repository.state.inventories['b1:sku1'].availableQty, 10)
  assert.equal(repository.state.inventories['b1:sku1'].reservedQty, 0)
})

test('cancelPendingOrder releases reservation exactly once', async () => {
  const { repository, actions } = createHarness()
  const created = await actions.createOrder({ openid: 'u1', requestId: 'r1', clientRequestId: 'c1', batchStationId: 's1', items: [{ skuId: 'sku1', quantity: 1 }], contactName: 'Alice', phone: '13800138000' })
  const first = await actions.cancelPendingOrder({ openid: 'u1', requestId: 'cancel1', orderId: created.orderId })
  const second = await actions.cancelPendingOrder({ openid: 'u1', requestId: 'cancel2', orderId: created.orderId })
  assert.equal(first.ok, true)
  assert.equal(second.idempotent, true)
  assert.equal(repository.state.orders[created.orderId].status, '已取消')
  assert.equal(repository.state.inventories['b1:sku1'].availableQty, 10)
  assert.equal(repository.state.inventories['b1:sku1'].reservedQty, 0)
})

test('queryPaymentResult permits only the owner', async () => {
  const { actions } = createHarness({ ...baseSeed(), orders: { o1: { _id: 'o1', userOpenid: 'u1', status: '预占中', expiresAt: 123 } } })
  const denied = await actions.queryPaymentResult({ openid: 'u2', requestId: 'q1', orderId: 'o1' })
  const allowed = await actions.queryPaymentResult({ openid: 'u1', requestId: 'q2', orderId: 'o1' })
  assert.equal(denied.code, ERROR_CODES.FORBIDDEN)
  assert.deepEqual({ status: allowed.status, expiresAt: allowed.expiresAt }, { status: '预占中', expiresAt: 123 })
})

test('requestRefund writes stable refund record and applies accounting once', async () => {
  const seed = baseSeed({
    orders: { o1: { _id: 'o1', batchId: 'b1', batchStationId: 's1', stationId: 'station-1', userOpenid: 'u1', items: [{ skuId: 'sku1', quantity: 2, unitPrice: 2800, subtotal: 5600 }], amount: 5600, status: '待配送确认', paidAt: 900000 } },
    batchStations: { s1: { _id: 's1', batchId: 'b1', stationId: 'station-1', status: '拼团中', paidItemCount: 2, paidOrderCount: 1 } },
    inventories: { 'b1:sku1': { _id: 'inv1', batchId: 'b1', skuId: 'sku1', totalQty: 10, availableQty: 8, reservedQty: 0, soldQty: 2, refundedQty: 0, status: '上架' } }
  })
  const { repository, actions } = createHarness(seed)
  const first = await actions.requestRefund({ openid: 'u1', requestId: 'rf1', orderId: 'o1', reason: 'changed mind' })
  const second = await actions.requestRefund({ openid: 'u1', requestId: 'rf2', orderId: 'o1' })
  assert.equal(first.ok, true)
  assert.equal(first.refundStatus, '已退款')
  assert.equal(second.idempotent, true)
  assert.equal(repository.state.orders.o1.status, '已退款')
  assert.equal(repository.state.inventories['b1:sku1'].availableQty, 10)
  assert.equal(repository.state.inventories['b1:sku1'].soldQty, 2)
  assert.equal(repository.state.inventories['b1:sku1'].refundedQty, 2)
  assert.equal(repository.state.batchStations.s1.paidItemCount, 0)
  assert.equal(repository.state.refunds['refund-o1'].refundNo, 'refund-o1')
  assert.equal(Object.keys(repository.state.refunds).length, 1)
})

test('requestRefund rejects delivered orders and foreign owners', async () => {
  const seed = baseSeed({ orders: { o1: { _id: 'o1', batchId: 'b1', batchStationId: 's1', userOpenid: 'u1', items: [{ skuId: 'sku1', quantity: 1 }], amount: 2800, status: '已完成', completedAt: 1 } } })
  const { actions } = createHarness(seed)
  const foreign = await actions.requestRefund({ openid: 'u2', requestId: 'rf1', orderId: 'o1' })
  const delivered = await actions.requestRefund({ openid: 'u1', requestId: 'rf2', orderId: 'o1' })
  assert.equal(foreign.code, ERROR_CODES.FORBIDDEN)
  assert.equal(delivered.code, ERROR_CODES.ORDER_STATE_CONFLICT)
})

test('index never trusts event.openid as the caller identity', async () => {
  const source = fs.readFileSync(path.resolve(__dirname, '..', 'index.js'), 'utf8')
  assert.doesNotMatch(source, /OPENID\s*\|\|\s*event\.openid/)
})

test('legacy inventory without V1.6 counters keeps its inferred total during reservation', async () => {
  const seed = baseSeed({
    inventories: { 'b1:sku1': { _id: 'inv1', batchId: 'b1', skuId: 'sku1', availableQty: 8, soldQty: 2, status: '上架' } }
  })
  const { repository, actions } = createHarness(seed)
  const result = await actions.createOrder({ openid: 'u1', requestId: 'r1', clientRequestId: 'legacy-1', batchStationId: 's1', items: [{ skuId: 'sku1', quantity: 1 }], contactName: 'Alice', phone: '13800138000' })
  assert.equal(result.ok, true)
  assert.equal(repository.state.inventories['b1:sku1'].totalQty, 10)
  assert.equal(repository.state.inventories['b1:sku1'].reservedQty, 1)
  assert.equal(repository.state.inventories['b1:sku1'].refundedQty, 0)
})

test('queryPaymentResult lazily expires a stale pending order and releases stock', async () => {
  const seed = baseSeed({
    orders: { o1: { _id: 'o1', batchId: 'b1', batchStationId: 's1', userOpenid: 'u1', items: [{ skuId: 'sku1', quantity: 2 }], status: '预占中', expiresAt: 999999 } },
    inventories: { 'b1:sku1': { _id: 'inv1', batchId: 'b1', skuId: 'sku1', totalQty: 10, availableQty: 8, reservedQty: 2, soldQty: 0, refundedQty: 0, status: '上架' } }
  })
  const { repository, actions } = createHarness(seed, 1000000)
  const result = await actions.queryPaymentResult({ openid: 'u1', requestId: 'q1', orderId: 'o1' })
  assert.equal(result.ok, true)
  assert.equal(result.status, '已超时')
  assert.equal(repository.state.inventories['b1:sku1'].availableQty, 10)
  assert.equal(repository.state.inventories['b1:sku1'].reservedQty, 0)
})

test('createOrder re-reads its deterministic order after a commit conflict', async () => {
  const options = { throwAfterFirstCommit: true }
  const repository = createMemoryRepository(baseSeed(), options)
  const actions = createOrderActions({ repository, now: () => 1000000, mockPay: true })
  const result = await actions.createOrder({ openid: 'u1', requestId: 'r1', clientRequestId: 'conflict-1', batchStationId: 's1', items: [{ skuId: 'sku1', quantity: 1 }], contactName: 'Alice', phone: '13800138000' })
  assert.equal(result.ok, true)
  assert.equal(result.idempotent, true)
  assert.equal(Object.keys(repository.state.orders).length, 1)
  assert.equal(repository.state.inventories['b1:sku1'].reservedQty, 1)
})

test('non-MOCK refund writes a stable pending refund and applies accounting once', async () => {
  const seed = baseSeed({
    orders: { o1: { _id: 'o1', batchId: 'b1', batchStationId: 's1', userOpenid: 'u1', items: [{ skuId: 'sku1', quantity: 1, unitPrice: 2800, subtotal: 2800 }], amount: 2800, status: '待配送确认', paidAt: 900000 } },
    batchStations: { s1: { _id: 's1', batchId: 'b1', status: '拼团中', paidItemCount: 1, paidOrderCount: 1 } },
    inventories: { 'b1:sku1': { _id: 'inv1', batchId: 'b1', skuId: 'sku1', totalQty: 10, availableQty: 9, reservedQty: 0, soldQty: 1, refundedQty: 0, status: '上架' } }
  })
  const repository = createMemoryRepository(seed)
  const actions = createOrderActions({ repository, now: () => 1000000, mockPay: false })
  const first = await actions.requestRefund({ openid: 'u1', requestId: 'rf1', orderId: 'o1' })
  const second = await actions.requestRefund({ openid: 'u1', requestId: 'rf2', orderId: 'o1' })
  assert.equal(first.ok, true)
  assert.equal(first.refundStatus, '待退款')
  assert.equal(repository.state.orders.o1.status, '退款处理中')
  assert.equal(repository.state.refunds['refund-o1'].status, '待退款')
  assert.equal(repository.state.refunds['refund-o1'].completedAt, null)
  assert.equal(repository.state.inventories['b1:sku1'].refundedQty, 1)
  assert.equal(second.idempotent, true)
  assert.equal(repository.state.inventories['b1:sku1'].refundedQty, 1)
})

test('expirePendingOrders is restricted and releases stale orders one by one', async () => {
  const seed = baseSeed({
    orders: { o1: { _id: 'o1', batchId: 'b1', batchStationId: 's1', userOpenid: 'u1', items: [{ skuId: 'sku1', quantity: 1 }], status: '预占中', expiresAt: 999999 } },
    inventories: { 'b1:sku1': { _id: 'inv1', batchId: 'b1', skuId: 'sku1', totalQty: 10, availableQty: 9, reservedQty: 1, soldQty: 0, refundedQty: 0, status: '上架' } }
  })
  const { repository, actions } = createHarness(seed, 1000000)
  const denied = await actions.expirePendingOrders({ openid: 'u1', requestId: 'e1' })
  const result = await actions.expirePendingOrders({ system: true, requestId: 'e2' })
  assert.equal(denied.code, ERROR_CODES.FORBIDDEN)
  assert.equal(result.expired, 1)
  assert.equal(repository.state.orders.o1.status, '已超时')
  assert.equal(repository.state.inventories['b1:sku1'].reservedQty, 0)
})
