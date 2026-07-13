const assert = require('assert')
const fs = require('fs')
const path = require('path')
const { createFulfillmentActions } = require('../src/services/fulfillment-actions')

function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)) }

function createRepository(seed = {}) {
  const state = {
    admins: clone(seed.admins || {}), batches: clone(seed.batches || {}), batchStations: clone(seed.batchStations || {}),
    windows: clone(seed.windows || {}), orders: clone(seed.orders || {}),
    verificationLogs: {}, contactLogs: {}, placementLogs: {}, operationLogs: {}, notifications: {}
  }
  const tx = {
    getBatchStation: async (id) => clone(state.batchStations[id] || null),
    getDeliveryWindowByStation: async (id) => clone(Object.values(state.windows).find((row) => row.batchStationId === id) || null),
    getOrder: async (id) => clone(state.orders[id] || null),
    findOrderByCode: async (code) => clone(Object.values(state.orders).find((row) => row.verifyCode === code) || null),
    findAdminByOpenid: async (openid) => clone(Object.values(state.admins).find((row) => row.openid === openid) || null),
    listOrdersByStation: async (id, statuses) => clone(Object.values(state.orders).filter((row) => row.batchStationId === id && (!statuses || statuses.includes(row.status)))),
    listBatchStations: async (batchId) => clone(Object.values(state.batchStations).filter((row) => row.batchId === batchId)),
    saveOrder: async (id, patch) => { state.orders[id] = { ...state.orders[id], ...clone(patch) } },
    saveBatchStation: async (id, patch) => { state.batchStations[id] = { ...state.batchStations[id], ...clone(patch) } },
    saveBatch: async (id, patch) => { state.batches[id] = { ...(state.batches[id] || { _id: id }), ...clone(patch) } },
    saveDeliveryWindow: async (id, patch) => { state.windows[id] = { ...state.windows[id], ...clone(patch) } },
    saveAdmin: async (id, row) => { state.admins[id] = { ...(state.admins[id] || { _id: id }), ...clone(row) } },
    saveVerificationLog: async (id, row) => { state.verificationLogs[id] = clone(row) },
    saveContactLog: async (id, row) => { state.contactLogs[id] = clone(row) },
    savePlacementLog: async (id, row) => { state.placementLogs[id] = clone(row) },
    saveOperationLog: async (id, row) => { state.operationLogs[id] = clone(row) },
    saveNotification: async (id, row) => { state.notifications[id] = clone(row) }
  }
  return {
    state,
    runTransaction: async (work) => work(tx),
    listBatchStations: async () => clone(Object.values(state.batchStations)),
    listOrdersByStation: async (id, statuses) => tx.listOrdersByStation(id, statuses)
  }
}

async function test(name, fn) {
  try { await fn(); console.log(`PASS ${name}`) } catch (err) { console.error(`FAIL ${name}`); console.error(err.stack || err.message); process.exitCode = 1 }
}

const superAdmin = { openid: 'root', role: 'superAdmin', status: 'active' }
const verifier = { openid: 'v1', role: 'verifier', status: 'active', authorizationScopes: [{ batchId: 'b1', stationIds: ['st1'] }] }
const seed = () => ({
  batches: { b1: { _id: 'b1', status: '配送进行中' } },
  batchStations: {
    bs1: { _id: 'bs1', batchId: 'b1', stationId: 'st1', status: '已确认配送' },
    bs2: { _id: 'bs2', batchId: 'b1', stationId: 'st2', status: '已确认配送' }
  },
  windows: {
    w1: { _id: 'w1', batchStationId: 'bs1', arriveAtTimestamp: 900, leaveAtTimestamp: 1300 },
    w2: { _id: 'w2', batchStationId: 'bs2', arriveAtTimestamp: 900, leaveAtTimestamp: 1300 }
  },
  orders: {
    o1: { _id: 'o1', batchId: 'b1', batchStationId: 'bs1', stationId: 'st1', status: '待自提', verifyCode: '111111', phone: '13800138000', items: [] },
    o2: { _id: 'o2', batchId: 'b1', batchStationId: 'bs2', stationId: 'st2', status: '待自提', verifyCode: '222222', phone: '13900139000', items: [] }
  }
})

test('verifier workspace only exposes authorized stations and their phones', async () => {
  const actions = createFulfillmentActions({ repository: createRepository(seed()), now: () => 1200 })
  const result = await actions.getWorkspace({ actor: verifier })
  assert.equal(result.ok, true); assert.deepEqual(result.batchStations.map((row) => row._id), ['bs1'])
  assert.equal(result.batchStations[0].orders[0].phone, '13800138000')
})

test('verifier cannot verify another station and superAdmin cross-station requires confirmation and reason', async () => {
  const repository = createRepository(seed())
  const actions = createFulfillmentActions({ repository, now: () => 1200 })
  assert.equal((await actions.verifyOrder({ actor: verifier, batchStationId: 'bs1', code: '222222' })).ok, false)
  assert.equal((await actions.verifyOrder({ actor: superAdmin, batchStationId: 'bs1', code: '222222' })).ok, false)
  const result = await actions.verifyOrder({ actor: superAdmin, batchStationId: 'bs1', code: '222222', crossStationConfirmed: true, reason: '顾客临时改到本站', method: 'scan' })
  assert.equal(result.ok, true); assert.equal(repository.state.orders.o2.status, '已完成')
  assert.equal(Object.values(repository.state.verificationLogs)[0].isCrossStation, true)
})

test('a placed order can still be picked up with its code', async () => {
  const repository = createRepository(seed())
  repository.state.orders.o1.status = '已放置待自取'
  const actions = createFulfillmentActions({ repository, now: () => 1200 })
  const result = await actions.verifyOrder({ actor: verifier, batchStationId: 'bs1', code: '111111' })
  assert.equal(result.ok, true); assert.equal(repository.state.orders.o1.status, '已完成')
})

test('contact and fixed-location placement require station permission and write audit logs', async () => {
  const repository = createRepository(seed())
  const actions = createFulfillmentActions({ repository, now: () => 1200 })
  assert.equal((await actions.contactOrder({ actor: verifier, orderId: 'o2', contactStatus: '已联系' })).ok, false)
  assert.equal((await actions.contactOrder({ actor: verifier, orderId: 'o1', contactStatus: '已联系', note: '放到A口' })).ok, true)
  assert.equal((await actions.placeOrderAtLocation({ actor: verifier, orderId: 'o1', locationNote: 'A口服务台', images: [] })).ok, false)
  const placed = await actions.placeOrderAtLocation({ actor: verifier, orderId: 'o1', locationNote: 'A口服务台', images: ['cloud://proof.jpg'] })
  assert.equal(placed.ok, true); assert.equal(repository.state.orders.o1.status, '已放置待自取')
  assert.equal(Object.keys(repository.state.contactLogs).length, 1); assert.equal(Object.keys(repository.state.placementLogs).length, 1)
})

test('end session requires leave time and zero untreated pickup orders', async () => {
  const repository = createRepository(seed())
  repository.state.windows.w1.leaveAtTimestamp = 1000
  const early = createFulfillmentActions({ repository, now: () => 999 })
  assert.equal((await early.endPickupSession({ actor: verifier, batchStationId: 'bs1' })).ok, false)
  const late = createFulfillmentActions({ repository, now: () => 1200 })
  const pending = await late.endPickupSession({ actor: verifier, batchStationId: 'bs1' })
  assert.equal(pending.ok, false); assert.equal(pending.pendingCount, 1)
  repository.state.orders.o1.status = '已放置待自取'
  repository.state.batchStations.bs2.status = '已关闭'
  const done = await late.endPickupSession({ actor: verifier, batchStationId: 'bs1' })
  assert.equal(done.ok, true); assert.equal(repository.state.batchStations.bs1.status, '已完成')
  assert.equal(repository.state.batches.b1.status, '已结束')
})

test('markArrived advances only confirmed stations and contact is limited to the pickup window', async () => {
  const repository = createRepository(seed())
  const before = createFulfillmentActions({ repository, now: () => 899 })
  assert.equal((await before.contactOrder({ actor: verifier, orderId: 'o1', contactStatus: '未接通' })).ok, false)
  const during = createFulfillmentActions({ repository, now: () => 1200 })
  assert.equal((await during.markArrived({ actor: verifier, batchStationId: 'bs1' })).ok, true)
  assert.equal(repository.state.batchStations.bs1.status, '自提进行中')
  repository.state.batchStations.bs2.status = '关闭退款中'
  assert.equal((await during.markArrived({ actor: superAdmin, batchStationId: 'bs2' })).ok, false)
})

test('end session rejects a missing delivery window', async () => {
  const data = seed(); delete data.windows.w1
  const actions = createFulfillmentActions({ repository: createRepository(data), now: () => 2000 })
  const result = await actions.endPickupSession({ actor: verifier, batchStationId: 'bs1' })
  assert.equal(result.ok, false)
})

test('assignVerifier writes batch and station scope', async () => {
  const repository = createRepository(seed())
  const actions = createFulfillmentActions({ repository, now: () => 1200 })
  const result = await actions.assignVerifier({ actor: superAdmin, targetOpenid: 'v2', batchId: 'b1', stationIds: ['st1'] })
  const created = Object.values(repository.state.admins)[0]
  assert.equal(result.ok, true); assert.equal(created.role, 'verifier')
  assert.deepEqual(created.authorizationScopes, [{ batchId: 'b1', stationIds: ['st1'] }])
})

test('index routes V1.6 fulfillment actions and removes postpone/refund-review/no-show semantics', async () => {
  const index = fs.readFileSync(path.resolve(__dirname, '..', 'index.js'), 'utf8')
  for (const action of ['assignVerifier', 'getVerifierWorkspace', 'contactOrder', 'placeOrderAtLocation', 'endPickupSession']) assert.match(index, new RegExp(`case ['"]${action}['"]:`))
  for (const old of ['markNoShowOrders', 'markOrderPostponed', 'reviewRefund']) assert.doesNotMatch(index, new RegExp(`case ['"]${old}['"]:`))
})
