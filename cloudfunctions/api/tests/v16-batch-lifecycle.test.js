const assert = require('assert')
const fs = require('fs')
const path = require('path')
const { createBatchActions } = require('../src/services/batch-actions')
const { createLifecycleActions } = require('../src/services/lifecycle-actions')

function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)) }

function createRepository(seed = {}) {
  const state = {
    batches: clone(seed.batches || {}), stations: clone(seed.stations || {}), skus: clone(seed.skus || {}),
    batchStations: clone(seed.batchStations || {}), windows: clone(seed.windows || {}), inventories: clone(seed.inventories || {}),
    orders: clone(seed.orders || {}), logs: clone(seed.logs || {}), notifications: clone(seed.notifications || {}), locks: clone(seed.locks || {})
  }
  let sequence = 0
  const tx = () => ({
    getBatch: async (id) => clone(state.batches[id] || null),
    getBatchStation: async (id) => clone(state.batchStations[id] || null),
    findPublishedBatchBySaleDate: async (saleDate, exceptId) => clone(Object.values(state.batches).find((b) => b._id !== exceptId && b.saleDate === saleDate && b.status !== '草稿') || null),
    findAcceptingBatch: async (exceptId) => clone(Object.values(state.batches).find((b) => b._id !== exceptId && b.status === '接单中') || null),
    getStation: async (id) => clone(state.stations[id] || null), getSku: async (id) => clone(state.skus[id] || null),
    saveBatch: async (id, patch) => { state.batches[id] = { ...(state.batches[id] || { _id: id }), ...clone(patch) } },
    createBatchStation: async (id, row) => { state.batchStations[id] = { _id: id, ...clone(row) } },
    createDeliveryWindow: async (id, row) => { state.windows[id] = { _id: id, ...clone(row) } },
    createInventory: async (id, row) => { state.inventories[id] = { _id: id, ...clone(row) } },
    saveOperationLog: async (id, row) => { state.logs[id] = { _id: id, ...clone(row) } },
    listBatchStations: async (batchId) => clone(Object.values(state.batchStations).filter((s) => s.batchId === batchId)),
    listOrdersByBatch: async (batchId, statuses) => clone(Object.values(state.orders).filter((o) => o.batchId === batchId && statuses.includes(o.status))),
    listOrdersByStation: async (batchStationId, statuses) => clone(Object.values(state.orders).filter((o) => o.batchStationId === batchStationId && statuses.includes(o.status))),
    saveBatchStation: async (id, patch) => { state.batchStations[id] = { ...state.batchStations[id], ...clone(patch) } },
    saveOrder: async (id, patch) => { state.orders[id] = { ...state.orders[id], ...clone(patch) } },
    saveNotification: async (id, row) => { state.notifications[id] = { _id: id, ...clone(row) } },
    touchPublishLock: async (id, row) => { state.locks[id] = { _id: id, ...clone(row) } }
  })
  return {
    state,
    newId(prefix) { sequence += 1; return `${prefix}-${sequence}` },
    async runTransaction(work) { return work(tx()) },
    async getBatch(id) { return clone(state.batches[id] || null) },
    async listDueBatches(status, field, now) { return clone(Object.values(state.batches).filter((b) => b.status === status && Number(b[field]) <= now)) },
    async listBatchStations(batchId) { return clone(Object.values(state.batchStations).filter((s) => s.batchId === batchId)) }
  }
}

async function test(name, fn) {
  try { await fn(); console.log(`PASS ${name}`) } catch (err) { console.error(`FAIL ${name}`); console.error(err.stack || err.message); process.exitCode = 1 }
}

const D22 = Date.UTC(2026, 6, 11, 14, 0, 0)
const D1NOON = Date.UTC(2026, 6, 12, 4, 0, 0)

function validDraft() {
  return { name: '7月12日批次', saleDate: '2026-07-11', pickupDate: '2026-07-12',
    stations: [{ stationId: 'st1', arriveAt: '18:00', leaveAt: '19:00', locationNote: 'A口', locationImages: ['cloud://one.jpg'] }],
    inventory: [{ skuId: 'sku1', totalQty: 10, isUnlimited: false }] }
}

test('saveBatchDraft derives fixed V1.6 times and increments revision without publishing', async () => {
  const repository = createRepository()
  const actions = createBatchActions({ repository, now: () => D22 - 1 })
  const first = await actions.saveBatchDraft({ batch: validDraft(), openid: 'admin', requestId: 'r1' })
  const second = await actions.saveBatchDraft({ batch: { ...validDraft(), _id: first.batchId }, openid: 'admin', requestId: 'r2' })
  const batch = repository.state.batches[first.batchId]
  assert.equal(batch.status, '草稿'); assert.equal(batch.thresholdN, 5); assert.equal(batch.deadlineAt, D22); assert.equal(batch.confirmAt, D1NOON)
  assert.equal(second.revision, 2); assert.equal(Object.keys(repository.state.batchStations).length, 0)
})

test('publishBatch validates active station images and uniqueness before materializing documents', async () => {
  const repository = createRepository({ stations: { st1: { _id: 'st1', status: 'active', locationImages: [] } }, skus: { sku1: { _id: 'sku1', status: '上架' } } })
  const actions = createBatchActions({ repository, now: () => D22 - 1 })
  const saved = await actions.saveBatchDraft({ batch: { ...validDraft(), stations: [{ ...validDraft().stations[0], locationImages: [] }] }, openid: 'admin' })
  const noImage = await actions.publishBatch({ batchId: saved.batchId, revision: 1, openid: 'admin' })
  assert.equal(noImage.ok, false); assert.match(noImage.msg, /图片/)
  repository.state.stations.st1.locationImages = ['cloud://default.jpg']
  const published = await actions.publishBatch({ batchId: saved.batchId, revision: 1, openid: 'admin' })
  assert.equal(published.ok, true); assert.equal(repository.state.batches[saved.batchId].status, '接单中')
  assert.equal(Object.values(repository.state.batchStations)[0].thresholdN, 5)
  const inventory = Object.values(repository.state.inventories)[0]
  assert.deepEqual([inventory.totalQty, inventory.availableQty, inventory.reservedQty, inventory.soldQty, inventory.refundedQty], [10, 10, 0, 0, 0])
  const saved2 = await actions.saveBatchDraft({ batch: validDraft(), openid: 'admin' })
  const duplicate = await actions.publishBatch({ batchId: saved2.batchId, revision: 1, openid: 'admin' })
  assert.equal(duplicate.ok, false); assert.match(duplicate.msg, /销售日|接单/)
})

test('lifecycle does not cutoff at 21:59:59 and at 22:00 only cuts off sales', async () => {
  const seed = { batches: { b1: { _id: 'b1', status: '接单中', deadlineAt: D22, confirmAt: D1NOON } } }
  const beforeRepo = createRepository(seed)
  const before = createLifecycleActions({ repository: beforeRepo, orderActions: { expirePendingOrders: async () => ({ ok: true, expired: 0 }) }, now: () => D22 - 1 })
  await before.lifecycleTick({ system: true }); assert.equal(beforeRepo.state.batches.b1.status, '接单中')
  const atRepo = createRepository(seed)
  const at = createLifecycleActions({ repository: atRepo, orderActions: { expirePendingOrders: async () => ({ ok: true, expired: 2 }) }, now: () => D22 })
  const result = await at.lifecycleTick({ system: true })
  assert.equal(atRepo.state.batches.b1.status, '已截单待配送确认'); assert.equal(result.expired, 2)
})

test('12:00 confirms stations with five items and refunds stations below five idempotently', async () => {
  const repository = createRepository({
    batches: { b1: { _id: 'b1', status: '已截单待配送确认', deadlineAt: D22, confirmAt: D1NOON } },
    batchStations: { s5: { _id: 's5', batchId: 'b1', status: '已达门槛待确认', paidItemCount: 5 }, s4: { _id: 's4', batchId: 'b1', status: '拼团中', paidItemCount: 4 } },
    orders: { o5: { _id: 'o5', batchId: 'b1', batchStationId: 's5', status: '待配送确认' }, o4: { _id: 'o4', batchId: 'b1', batchStationId: 's4', status: '待配送确认' } }
  })
  const refunded = []
  const orderActions = { expirePendingOrders: async () => ({ ok: true, expired: 0 }), systemRefundOrder: async ({ orderId }) => { refunded.push(orderId); repository.state.orders[orderId].status = '已退款'; return { ok: true } } }
  const actions = createLifecycleActions({ repository, orderActions, now: () => D1NOON })
  await actions.lifecycleTick({ system: true }); await actions.lifecycleTick({ system: true })
  assert.equal(repository.state.batchStations.s5.status, '已确认配送'); assert.equal(repository.state.orders.o5.status, '待自提')
  assert.equal(repository.state.batchStations.s4.status, '已关闭'); assert.deepEqual(refunded, ['o4'])
  assert.equal(repository.state.batches.b1.status, '配送进行中')
})

test('12:00 keeps station and batch in closing state when any refund fails', async () => {
  const repository = createRepository({
    batches: { b1: { _id: 'b1', status: '已截单待配送确认', deadlineAt: D22, confirmAt: D1NOON } },
    batchStations: { s1: { _id: 's1', batchId: 'b1', status: '拼团中', paidItemCount: 1 } },
    orders: { o1: { _id: 'o1', batchId: 'b1', batchStationId: 's1', status: '待配送确认' } }
  })
  const orderActions = {
    expirePendingOrders: async () => ({ ok: true, expired: 0 }),
    systemRefundOrder: async () => ({ ok: false, code: 'PAYMENT_UNKNOWN' })
  }
  const lifecycle = createLifecycleActions({ repository, orderActions, now: () => D1NOON })
  const result = await lifecycle.lifecycleTick({ system: true })
  assert.equal(result.ok, true)
  assert.equal(repository.state.batchStations.s1.status, '关闭退款中')
  assert.equal(repository.state.batches.b1.status, '关闭退款中')
})

test('12:00 stale five-item snapshot cannot revive a concurrently closing station', async () => {
  const repository = createRepository({
    batches: { b1: { _id: 'b1', status: '已截单待配送确认', deadlineAt: D22, confirmAt: D1NOON } },
    batchStations: { s1: { _id: 's1', batchId: 'b1', status: '关闭退款中', paidItemCount: 5 } }
  })
  let first = true
  const list = repository.listBatchStations.bind(repository)
  repository.listBatchStations = async (batchId) => {
    if (first) { first = false; return [{ _id: 's1', batchId, status: '已达门槛待确认', paidItemCount: 5 }] }
    return list(batchId)
  }
  const lifecycle = createLifecycleActions({
    repository,
    orderActions: { expirePendingOrders: async () => ({ ok: true, expired: 0 }), systemRefundOrder: async () => ({ ok: true, refundStatus: '已退款' }) },
    now: () => D1NOON
  })
  await lifecycle.lifecycleTick({ system: true })
  assert.equal(repository.state.batchStations.s1.status, '关闭退款中')
})

test('manual confirmation is allowed only after cutoff and before noon, requires reason and is skipped at noon', async () => {
  const repository = createRepository({ batches: { b1: { _id: 'b1', status: '已截单待配送确认', deadlineAt: D22, confirmAt: D1NOON } }, batchStations: { s1: { _id: 's1', batchId: 'b1', status: '拼团中', paidItemCount: 2 } }, orders: { o1: { _id: 'o1', batchId: 'b1', batchStationId: 's1', status: '待配送确认' } } })
  const actions = createBatchActions({ repository, now: () => D22 + 1 })
  assert.equal((await actions.manualConfirmDelivery({ batchStationId: 's1', reason: '' })).ok, false)
  assert.equal((await actions.manualConfirmDelivery({ batchStationId: 's1', reason: '小商家照常配送', openid: 'admin' })).ok, true)
  const lifecycle = createLifecycleActions({ repository, orderActions: { expirePendingOrders: async () => ({ ok: true }), systemRefundOrder: async () => { throw new Error('must skip') } }, now: () => D1NOON })
  await lifecycle.lifecycleTick({ system: true })
  assert.equal(repository.state.batchStations.s1.status, '已确认配送'); assert.equal(repository.state.orders.o1.status, '待自提')
})

test('manual confirmation cannot revive a closing station', async () => {
  const repository = createRepository({
    batches: { b1: { _id: 'b1', status: '已截单待配送确认', deadlineAt: D22, confirmAt: D1NOON } },
    batchStations: { s1: { _id: 's1', batchId: 'b1', status: '关闭退款中', paidItemCount: 4 } }
  })
  const actions = createBatchActions({ repository, now: () => D22 + 1 })
  const result = await actions.manualConfirmDelivery({ batchStationId: 's1', reason: '照常配送', openid: 'admin' })
  assert.equal(result.ok, false)
  assert.equal(repository.state.batchStations.s1.status, '关闭退款中')
})

test('closeBatchStation and closeBatch require reasons and never refund delivered orders', async () => {
  const repository = createRepository({ batches: { b1: { _id: 'b1', status: '已截单待配送确认' } }, batchStations: { s1: { _id: 's1', batchId: 'b1', status: '拼团中' } }, orders: { a: { _id: 'a', batchId: 'b1', batchStationId: 's1', status: '待配送确认' }, done: { _id: 'done', batchId: 'b1', batchStationId: 's1', status: '已完成' }, placed: { _id: 'placed', batchId: 'b1', batchStationId: 's1', status: '已放置待自取' } } })
  const refunded = []
  const actions = createBatchActions({ repository, now: () => D1NOON, systemRefundOrder: async ({ orderId }) => { refunded.push(orderId); repository.state.orders[orderId].status = '已退款'; return { ok: true } } })
  assert.equal((await actions.closeBatchStation({ batchStationId: 's1', reason: '' })).ok, false)
  const result = await actions.closeBatch({ batchId: 'b1', reason: '商家无法交付', openid: 'admin' })
  assert.equal(result.ok, true); assert.deepEqual(refunded, ['a']); assert.equal(repository.state.batches.b1.status, '已结束')
})

test('manual close does not report closed or end batch while a refund is incomplete', async () => {
  const repository = createRepository({
    batches: { b1: { _id: 'b1', status: '已截单待配送确认' } },
    batchStations: { s1: { _id: 's1', batchId: 'b1', status: '拼团中' } },
    orders: { o1: { _id: 'o1', batchId: 'b1', batchStationId: 's1', status: '待配送确认' } }
  })
  const actions = createBatchActions({ repository, now: () => D1NOON, systemRefundOrder: async () => ({ ok: false, code: 'PAYMENT_UNKNOWN' }) })
  const stationResult = await actions.closeBatchStation({ batchStationId: 's1', reason: '商家无法交付', openid: 'admin' })
  assert.equal(stationResult.ok, true)
  assert.equal(stationResult.status, '关闭退款中')
  assert.equal(repository.state.batchStations.s1.status, '关闭退款中')
  const batchResult = await actions.closeBatch({ batchId: 'b1', reason: '商家无法交付', openid: 'admin' })
  assert.equal(batchResult.ok, true)
  assert.equal(batchResult.status, '关闭退款中')
  assert.equal(repository.state.batches.b1.status, '关闭退款中')
})

test('closeBatch rejects a missing batch instead of creating a phantom batch', async () => {
  const repository = createRepository()
  const actions = createBatchActions({ repository, now: () => D1NOON, systemRefundOrder: async () => ({ ok: true, refundStatus: '已退款' }) })
  const result = await actions.closeBatch({ batchId: 'missing', reason: '商家无法交付', openid: 'admin' })
  assert.equal(result.ok, false)
  assert.equal(repository.state.batches.missing, undefined)
})

test('closing a completed station is idempotent and never rewrites it to closed', async () => {
  const repository = createRepository({
    batches: { b1: { _id: 'b1', status: '配送进行中' } },
    batchStations: { s1: { _id: 's1', batchId: 'b1', status: '已完成' } },
    orders: { o1: { _id: 'o1', batchId: 'b1', batchStationId: 's1', status: '已完成' } }
  })
  const actions = createBatchActions({ repository, now: () => D1NOON, systemRefundOrder: async () => { throw new Error('must not refund') } })
  const result = await actions.closeBatchStation({ batchStationId: 's1', reason: '误操作', openid: 'admin' })
  assert.equal(result.ok, true); assert.equal(result.status, '已完成')
  assert.equal(repository.state.batchStations.s1.status, '已完成')
})

test('index exposes only V1.6 batch routes behind superAdmin and timer is every minute', async () => {
  const index = fs.readFileSync(path.resolve(__dirname, '..', 'index.js'), 'utf8')
  for (const action of ['saveBatchDraft', 'getBatchDraft', 'publishBatch', 'manualConfirmDelivery', 'closeBatch', 'closeBatchStation']) {
    assert.match(index, new RegExp(`case ['"]${action}['"]:[^\\n]*adminOnly\\(openid, \\['superAdmin'\\]`))
  }
  for (const old of ['createBatch', 'manualFormGroup', 'manualCutoff', 'extendDeadline', 'closeGroupRefund']) assert.doesNotMatch(index, new RegExp(`case ['"]${old}['"]:`))
  assert.doesNotMatch(index, /case ['"]systemRefundOrder['"]:/)
  const config = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'config.json'), 'utf8'))
  assert.equal(config.triggers[0].name, 'lifecycleTick'); assert.equal(config.triggers[0].config, '0 */1 * * * * *')
  for (const collection of ['operationLogs', 'notificationOutbox', 'runtimeLocks']) assert.match(index, new RegExp(`['"]${collection}['"]`))
  assert.match(index, /touchPublishLock/)
  assert.match(index, /async function invokeV16BatchAction[\s\S]*?await ensureCollections\(\)/)
  assert.match(index, /async function runLifecycleTick[\s\S]*?await ensureCollections\(\)/)
})
