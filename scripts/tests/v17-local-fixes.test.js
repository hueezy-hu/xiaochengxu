const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..', '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

test('frontend uses the hidden reservation status consistently', () => {
  const status = require('../../miniprogram/utils/status')
  assert.equal(status.ORDER_STATUS.RESERVED, '预占中')
  assert.equal(status.canCancelPending('预占中'), true)
  assert.equal(status.countsForBadge('预占中'), true)
  assert.doesNotMatch(read('cloudfunctions/api/index.js'), /\['待支付', '待配送确认'\]/)
  assert.doesNotMatch(read('miniprogram/pages/paySuccess/paySuccess.js'), /\['待支付', '待配送确认'/)
})

test('payment countdown follows server time instead of the phone clock', () => {
  const { createServerOffset, secondsUntil } = require('../../miniprogram/utils/payment-clock')
  const serverNow = 1_000_000
  const clientNow = 1_120_000
  const offset = createServerOffset(serverNow, clientNow)
  assert.equal(offset, -120_000)
  assert.equal(secondsUntil(serverNow + 180_000, offset, clientNow), 180)
  assert.match(read('miniprogram/pages/checkout/checkout.js'), /serverNow=/)
})

test('cancel feedback never claims inventory release when the API fails', () => {
  const { cancelFeedback } = require('../../miniprogram/utils/payment-clock')
  assert.deepEqual(cancelFeedback({ ok: true }), { ok: true, message: '已取消，库存已释放' })
  assert.deepEqual(cancelFeedback({ ok: false, msg: '订单状态不可取消' }), { ok: false, message: '订单状态不可取消' })
})
