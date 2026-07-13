const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { resolveMockPay, resolveManualPhone, parseBooleanEnv } = require('../src/shared/runtime-config')
const {
  toWechatTimeExpire,
  reservationAlignedTimeExpire,
  paymentEventId,
  classifyPaymentCallback
} = require('../src/services/payment-helpers')
const { createNotificationOutbox, STATUSES } = require('../src/services/notification-outbox')

test('MOCK_PAY defaults true and only flips false on explicit env values', () => {
  assert.equal(resolveMockPay({}), true)
  assert.equal(resolveMockPay({ MOCK_PAY: '' }), true)
  assert.equal(resolveMockPay({ MOCK_PAY: 'true' }), true)
  assert.equal(resolveMockPay({ MOCK_PAY: '1' }), true)
  assert.equal(resolveMockPay({ MOCK_PAY: 'false' }), false)
  assert.equal(resolveMockPay({ MOCK_PAY: '0' }), false)
  assert.equal(resolveMockPay({ MOCK_PAY: 'maybe' }), true)
  assert.equal(resolveManualPhone({}), true)
  assert.equal(parseBooleanEnv('off', true), false)
})

test('time_expire strictly aligns with remaining 3-minute reservation', () => {
  const nowMs = Date.parse('2026-07-13T12:00:00+08:00')
  const expiresAt = nowMs + 90 * 1000
  const aligned = reservationAlignedTimeExpire({ expiresAt }, nowMs)
  assert.equal(aligned.ok, true)
  assert.equal(aligned.expiresAt, expiresAt)
  assert.equal(aligned.time_expire, toWechatTimeExpire(expiresAt))
  assert.match(aligned.time_expire, /\+08:00$/)

  const expired = reservationAlignedTimeExpire({ expiresAt: nowMs - 1 }, nowMs)
  assert.equal(expired.ok, false)

  const longWindow = reservationAlignedTimeExpire({ expiresAt: nowMs + 10 * 60 * 1000 }, nowMs)
  assert.equal(longWindow.ok, true)
  assert.equal(longWindow.expiresAt, nowMs + 3 * 60 * 1000)
})

test('payment callback classification is idempotent and marks late success', () => {
  assert.equal(classifyPaymentCallback({ order: null, nowMs: 1, eventType: 'SUCCESS' }).action, 'ignore')
  assert.equal(classifyPaymentCallback({
    order: { status: '待自提', paidAt: 1 },
    nowMs: 10,
    eventType: 'SUCCESS'
  }).action, 'idempotent')
  assert.equal(classifyPaymentCallback({
    order: { status: '预占中', expiresAt: 100 },
    nowMs: 50,
    eventType: 'SUCCESS'
  }).action, 'confirm')
  assert.equal(classifyPaymentCallback({
    order: { status: '预占中', expiresAt: 100 },
    nowMs: 150,
    eventType: 'SUCCESS'
  }).action, 'late_success')
  assert.equal(paymentEventId('out1', 'tx1'), 'payevt-out1-tx1')
})

test('notification outbox skips missing template without claiming success', async () => {
  const saved = []
  const outbox = createNotificationOutbox({
    listPending: async () => ([{ _id: 'n1', type: 'deliveryConfirmed', status: '待发送', batchStationId: 'bs1' }]),
    saveNotice: async (id, row) => { saved.push({ id, ...row }) },
    listOrdersForNotice: async () => ([{ _id: 'o1', userOpenid: 'u1', subscribeGroupResult: true }]),
    getConfig: async () => ({ groupResultTemplateId: '', pickupTemplateId: '' }),
    sendSubscribeMessage: async () => { throw new Error('must not send') },
    now: () => 1000
  })
  const result = await outbox.processPendingNotifications()
  assert.equal(result.ok, true)
  assert.equal(result.skipped, 1)
  assert.equal(result.sent, 0)
  assert.equal(saved[0].status, STATUSES.SKIPPED_NO_TEMPLATE)
})

test('notification outbox respects per-template authorization and is idempotent by notice id', async () => {
  const sent = []
  const saved = []
  const outbox = createNotificationOutbox({
    listPending: async () => ([{
      _id: 'n2', type: 'pickupReminder', status: '待发送', batchStationId: 'bs1'
    }]),
    saveNotice: async (id, row) => { saved.push({ id, ...row }) },
    listOrdersForNotice: async () => ([
      { _id: 'o1', userOpenid: 'u1', subscribePickupNotice: true, stationName: '布吉站' },
      { _id: 'o2', userOpenid: 'u2', subscribePickupNotice: false, stationName: '布吉站' }
    ]),
    getStation: async () => ({ name: '布吉站', windowText: '12:00-13:00' }),
    getConfig: async () => ({ groupResultTemplateId: 'T_GROUP', pickupTemplateId: 'T_PICKUP' }),
    sendSubscribeMessage: async (payload) => { sent.push(payload) },
    now: () => 2000
  })
  const result = await outbox.processPendingNotifications()
  assert.equal(result.sent, 1)
  assert.equal(result.skipped, 1)
  assert.equal(sent[0].touser, 'u1')
  assert.equal(sent[0].templateId, 'T_PICKUP')
  assert.equal(saved[0].status, STATUSES.SENT)

  // already processed notices are not re-listed; empty pending stays zero
  const idle = createNotificationOutbox({
    listPending: async () => ([]),
    saveNotice: async () => {},
    listOrdersForNotice: async () => ([]),
    getConfig: async () => ({ pickupTemplateId: 'T_PICKUP' }),
    sendSubscribeMessage: async () => { throw new Error('no') },
    now: () => 3000
  })
  const idleResult = await idle.processPendingNotifications()
  assert.equal(idleResult.processed, 0)
})

test('notification outbox records send failure for retry without inventing success', async () => {
  const saved = []
  const outbox = createNotificationOutbox({
    listPending: async () => ([{ _id: 'n3', type: 'groupResult', status: '待发送' }]),
    saveNotice: async (id, row) => { saved.push({ id, ...row }) },
    listOrdersForNotice: async () => ([{ _id: 'o1', userOpenid: 'u1', subscribeGroupResult: true }]),
    getConfig: async () => ({ groupResultTemplateId: 'T_GROUP' }),
    sendSubscribeMessage: async () => { throw new Error('template rejected') },
    now: () => 4000
  })
  const result = await outbox.processPendingNotifications()
  assert.equal(result.failed, 1)
  assert.equal(result.sent, 0)
  assert.equal(saved[0].status, STATUSES.FAILED)
  assert.match(saved[0].lastError, /template rejected/)
  assert.equal(saved[0].retryCount, 1)
})

test('notification outbox retries only failed recipients after partial success', async () => {
  let notice = { _id: 'n4', type: 'groupResult', status: '待发送', batchStationId: 'bs1' }
  const attempts = []
  let failSecond = true
  const outbox = createNotificationOutbox({
    listPending: async () => ([notice]),
    saveNotice: async (id, row) => { notice = { ...row, _id: id } },
    listOrdersForNotice: async () => ([
      { _id: 'o1', userOpenid: 'u1', subscribeGroupResult: true },
      { _id: 'o2', userOpenid: 'u2', subscribeGroupResult: true }
    ]),
    getConfig: async () => ({ groupResultTemplateId: 'T_GROUP' }),
    sendSubscribeMessage: async (payload) => {
      attempts.push(payload.touser)
      if (payload.touser === 'u2' && failSecond) throw new Error('temporary')
    },
    now: () => 5000
  })
  const first = await outbox.processPendingNotifications()
  assert.equal(first.sent, 1)
  assert.equal(first.failed, 1)
  assert.equal(notice.status, STATUSES.FAILED)
  assert.deepEqual(notice.sentOrderIds, ['o1'])

  failSecond = false
  const second = await outbox.processPendingNotifications()
  assert.equal(second.sent, 1)
  assert.equal(second.failed, 0)
  assert.equal(notice.status, STATUSES.SENT)
  assert.deepEqual(attempts, ['u1', 'u2', 'u2'])
})

test('notification outbox can recover notices skipped before templates were configured', async () => {
  let notice = { _id: 'n5', type: 'pickupReminder', status: '跳过-无模板', orderId: 'o1' }
  let sent = 0
  const outbox = createNotificationOutbox({
    listPending: async () => ([notice]),
    saveNotice: async (id, row) => { notice = { ...row, _id: id } },
    listOrdersForNotice: async () => ([{ _id: 'o1', userOpenid: 'u1', subscribePickupNotice: true }]),
    getConfig: async () => ({ pickupTemplateId: 'T_PICKUP' }),
    sendSubscribeMessage: async () => { sent += 1 },
    now: () => 6000
  })
  await outbox.processPendingNotifications()
  assert.equal(sent, 1)
  assert.equal(notice.status, STATUSES.SENT)
})

test('cloud outbox loader includes retryable states and fulfillment emits no third template type', () => {
  const root = path.resolve(__dirname, '..')
  const index = fs.readFileSync(path.join(root, 'index.js'), 'utf8')
  const fulfillment = fs.readFileSync(path.join(root, 'src/services/fulfillment-actions.js'), 'utf8')
  assert.match(index, /status:\s*_\.in\(\['待发送', '发送失败'\]\)/)
  assert.match(index, /status:\s*'跳过-无模板'/)
  assert.doesNotMatch(fulfillment, /type:\s*'orderPlaced'/)
})

test('notification outbox permanently skips unsupported legacy notice types', async () => {
  const saved = []
  const outbox = createNotificationOutbox({
    listPending: async () => ([{ _id: 'legacy', type: 'orderPlaced', status: '跳过-无模板', orderId: 'o1' }]),
    saveNotice: async (id, row) => { saved.push({ id, ...row }) },
    listOrdersForNotice: async () => ([{ _id: 'o1', userOpenid: 'u1', subscribePickupNotice: true }]),
    getConfig: async () => ({ pickupTemplateId: 'T_PICKUP' }),
    sendSubscribeMessage: async () => { throw new Error('must not send unsupported notice') },
    now: () => 7000
  })
  await outbox.processPendingNotifications()
  assert.equal(saved[0].status, STATUSES.SKIPPED_UNSUPPORTED)
})
