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
    findOrderByQrToken: async (token) => clone(Object.values(state.orders).find((row) => row.pickupQrToken === token) || null),
    findOrdersByPhoneTail: async (batchStationId, phoneTail) => clone(Object.values(state.orders).filter((row) => row.batchStationId === batchStationId && (row.phoneTail || String(row.phone || '').slice(-4)) === phoneTail)),
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
    bs1: { _id: 'bs1', batchId: 'b1', stationId: 'st1', verifyMode: '有人核销', status: '已确认配送' },
    bs2: { _id: 'bs2', batchId: 'b1', stationId: 'st2', verifyMode: '无人放置', status: '已确认配送' }
  },
  windows: {
    w1: { _id: 'w1', batchStationId: 'bs1', arriveAtTimestamp: 900, leaveAtTimestamp: 1300 },
    w2: { _id: 'w2', batchStationId: 'bs2', arriveAtTimestamp: 900, leaveAtTimestamp: 1300 }
  },
  orders: {
    o1: { _id: 'o1', batchId: 'b1', batchStationId: 'bs1', stationId: 'st1', status: '待自提', pickupQrToken: 'qr-o1-random-token', phoneTail: '8000', phone: '13800138000', items: [] },
    o2: { _id: 'o2', batchId: 'b1', batchStationId: 'bs2', stationId: 'st2', status: '待自提', pickupQrToken: 'qr-o2-random-token', phoneTail: '9000', phone: '13900139000', items: [] }
  }
})

test('verifier workspace only exposes authorized stations and their phones', async () => {
  const actions = createFulfillmentActions({ repository: createRepository(seed()), now: () => 1200 })
  const result = await actions.getWorkspace({ actor: verifier })
  assert.equal(result.ok, true); assert.deepEqual(result.batchStations.map((row) => row._id), ['bs1'])
  assert.equal(result.batchStations[0].orders[0].phone, '13800138000')
})

test('QR verification requires delivery photos; cross-station verification requires superAdmin confirmation', async () => {
  const repository = createRepository(seed())
  const actions = createFulfillmentActions({ repository, now: () => 1200 })
  assert.equal((await actions.verifyOrder({ actor: verifier, batchStationId: 'bs1', method: 'scan', qrToken: 'qr-o1-random-token' })).ok, false)
  assert.equal((await actions.verifyOrder({ actor: verifier, batchStationId: 'bs1', method: 'scan', qrToken: 'qr-o2-random-token', images: ['cloud://proof.jpg'] })).ok, false)
  assert.equal((await actions.verifyOrder({ actor: superAdmin, batchStationId: 'bs1', method: 'scan', qrToken: 'qr-o2-random-token', images: ['cloud://proof.jpg'] })).ok, false)
  const result = await actions.verifyOrder({ actor: superAdmin, batchStationId: 'bs1', method: 'scan', qrToken: 'qr-o2-random-token', images: ['cloud://proof.jpg'], crossStationConfirmed: true, reason: '顾客临时改到本站' })
  assert.equal(result.ok, true); assert.equal(repository.state.orders.o2.status, '已完成')
  assert.deepEqual(repository.state.orders.o2.deliveryImages, ['cloud://proof.jpg'])
  assert.equal(Object.values(repository.state.verificationLogs)[0].isCrossStation, true)
})

test('duplicate phone tails return candidates and manual selection completes only the chosen order', async () => {
  const repository = createRepository(seed())
  repository.state.orders.o3 = { ...clone(repository.state.orders.o1), _id: 'o3', pickupQrToken: 'qr-o3-random-token' }
  const actions = createFulfillmentActions({ repository, now: () => 1200 })
  const warning = await actions.verifyOrder({ actor: verifier, batchStationId: 'bs1', method: 'tail', phoneTail: '8000', images: ['cloud://proof.jpg'] })
  assert.equal(warning.ok, true); assert.equal(warning.ambiguous, true); assert.equal(warning.candidates.length, 2)
  assert.equal(repository.state.orders.o1.status, '待自提'); assert.equal(repository.state.orders.o3.status, '待自提')
  const result = await actions.verifyOrder({ actor: verifier, batchStationId: 'bs1', method: 'manual', orderId: 'o3', images: ['cloud://proof.jpg'] })
  assert.equal(result.ok, true); assert.equal(repository.state.orders.o3.status, '已完成'); assert.equal(repository.state.orders.o1.status, '待自提')
})

test('unattended placement is batch-scoped, photo-required, and rejects staffed stations', async () => {
  const repository = createRepository(seed())
  const actions = createFulfillmentActions({ repository, now: () => 1200 })
  assert.equal((await actions.contactOrder({ actor: verifier, orderId: 'o2', contactStatus: '已联系' })).ok, false)
  assert.equal((await actions.contactOrder({ actor: verifier, orderId: 'o1', contactStatus: '已联系', note: '放到A口' })).ok, true)
  assert.equal((await actions.placeOrderAtLocation({ actor: verifier, batchStationId: 'bs1', orderIds: ['o1'], locationNote: 'A口服务台', images: ['cloud://proof.jpg'] })).ok, false)
  const placed = await actions.placeOrderAtLocation({ actor: superAdmin, batchStationId: 'bs2', orderIds: ['o2'], locationNote: 'A口服务台', images: ['cloud://proof.jpg'] })
  assert.equal(placed.ok, true); assert.equal(repository.state.orders.o2.status, '已放置待自取')
  assert.equal(Object.keys(repository.state.contactLogs).length, 1); assert.equal(Object.keys(repository.state.placementLogs).length, 1)
})

test('staffed mode can finish no-show orders only with delivery photos', async () => {
  const repository = createRepository(seed())
  const during = createFulfillmentActions({ repository, now: () => 1200 })
  assert.equal((await during.finishNoShow({ actor: verifier, batchStationId: 'bs1', orderIds: ['o1'], images: ['cloud://end.jpg'] })).ok, false)
  const actions = createFulfillmentActions({ repository, now: () => 1400 })
  assert.equal((await actions.finishNoShow({ actor: verifier, batchStationId: 'bs1', orderIds: ['o1'], images: [] })).ok, false)
  const result = await actions.finishNoShow({ actor: verifier, batchStationId: 'bs1', orderIds: ['o1'], images: ['cloud://end.jpg'] })
  assert.equal(result.ok, true); assert.equal(repository.state.orders.o1.status, '已完成未取')
  assert.deepEqual(repository.state.orders.o1.deliveryImages, ['cloud://end.jpg'])
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

test('assignVerifier merges multiple stations and batches without dropping prior scopes', async () => {
  const repository = createRepository(seed())
  const actions = createFulfillmentActions({ repository, now: () => 1200 })
  await actions.assignVerifier({ actor: superAdmin, targetOpenid: 'v2', batchId: 'b1', stationIds: ['st1'] })
  await actions.assignVerifier({ actor: superAdmin, targetOpenid: 'v2', batchId: 'b1', stationIds: ['st2'] })
  const result = await actions.assignVerifier({ actor: superAdmin, targetOpenid: 'v2', batchId: 'b2', stationIds: ['st3'] })
  const created = Object.values(repository.state.admins)[0]
  assert.equal(result.ok, true)
  assert.deepEqual(created.authorizationScopes, [
    { batchId: 'b1', stationIds: ['st1', 'st2'] },
    { batchId: 'b2', stationIds: ['st3'] }
  ])
  assert.deepEqual(created.batchIds, ['b1', 'b2'])
  assert.deepEqual(created.stationIds, ['st1', 'st2', 'st3'])
})

test('index routes V1.7 fulfillment actions and removes obsolete postpone/refund-review semantics', async () => {
  const index = fs.readFileSync(path.resolve(__dirname, '..', 'index.js'), 'utf8')
  for (const action of ['assignVerifier', 'getVerifierWorkspace', 'contactOrder', 'placeOrderAtLocation', 'finishNoShow', 'endPickupSession']) assert.match(index, new RegExp(`case ['"]${action}['"]:`))
  for (const old of ['markNoShowOrders', 'markOrderPostponed', 'reviewRefund']) assert.doesNotMatch(index, new RegExp(`case ['"]${old}['"]:`))
})
