const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { createRefundActions } = require('../src/services/refund-actions')

function repositoryWith(order) {
  const state = { orders: { [order._id]: { ...order } }, requests: {} }
  return {
    state,
    async runTransaction(work) {
      return work({
        async getOrder(id) { return state.orders[id] || null },
        async saveOrder(id, patch) { state.orders[id] = { ...state.orders[id], ...patch } },
        async getRefundRequest(id) { return state.requests[id] || null },
        async saveRefundRequest(id, row) { state.requests[id] = { ...(state.requests[id] || {}), _id: id, ...row } }
      })
    }
  }
}

test('delivered user creates one idempotent manual refund request', async () => {
  const repository = repositoryWith({ _id: 'o1', userOpenid: 'buyer-a', status: '已完成' })
  const actions = createRefundActions({ repository, now: () => 1000, systemRefundOrder: async () => ({ ok: true }) })

  const first = await actions.applyRefundRequest({ openid: 'buyer-a', orderId: 'o1', reason: '没有取到货' })
  const duplicate = await actions.applyRefundRequest({ openid: 'buyer-a', orderId: 'o1', reason: '重复提交' })

  assert.equal(first.ok, true)
  assert.equal(first.status, '待处理')
  assert.equal(duplicate.idempotent, true)
  assert.equal(repository.state.orders.o1.status, '退款申请待处理')
})

test('admin rejection restores original delivered status and keeps decision record', async () => {
  const repository = repositoryWith({ _id: 'o1', userOpenid: 'buyer-a', status: '已完成' })
  const actions = createRefundActions({ repository, now: () => 1000, systemRefundOrder: async () => ({ ok: true }) })
  await actions.applyRefundRequest({ openid: 'buyer-a', orderId: 'o1', reason: '没有取到货' })
  const result = await actions.resolveRefundRequest({ openid: 'admin', orderId: 'o1', decision: 'reject', note: '现场照片显示已取走' })

  assert.equal(result.ok, true)
  assert.equal(repository.state.orders.o1.status, '已完成')
  assert.equal(repository.state.requests['refund-request-o1'].status, '已拒绝')
})

test('admin approval invokes stable full refund and marks request approved', async () => {
  const repository = repositoryWith({ _id: 'o1', userOpenid: 'buyer-a', status: '已放置待自取' })
  const calls = []
  const actions = createRefundActions({
    repository,
    now: () => 1000,
    systemRefundOrder: async (input) => { calls.push(input); repository.state.orders.o1.status = '已退款'; return { ok: true, refundStatus: '已退款', refundNo: 'refund-o1' } }
  })
  await actions.applyRefundRequest({ openid: 'buyer-a', orderId: 'o1', reason: '没有找到货' })
  const result = await actions.resolveRefundRequest({ openid: 'admin', orderId: 'o1', decision: 'refund', note: '核实退款' })

  assert.equal(result.ok, true)
  assert.equal(calls[0].allowPostDelivery, true)
  assert.equal(calls[0].requestId, 'manual-refund-o1')
  assert.equal(repository.state.requests['refund-request-o1'].status, '已退款')
})

test('index exposes two-stage refund routes with admin approval protected', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '..', 'index.js'), 'utf8')
  assert.match(source, /case ['"]applyRefundRequest['"]:/)
  assert.match(source, /case ['"]resolveRefundRequest['"]:[^\n]*adminOnly\(openid, \['superAdmin'\]/)
})
