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

test('only pickup-ready orders expose the pickup ticket UI', () => {
  const { showsPickupTicket } = require('../../miniprogram/utils/status')
  assert.equal(showsPickupTicket('待自提'), true)
  assert.equal(showsPickupTicket('已放置待自取'), true)
  for (const status of ['预占中', '退款处理中', '支付后退款中', '已退款']) {
    assert.equal(showsPickupTicket(status), false)
  }

  const ordersJs = read('miniprogram/pages/orders/orders.js')
  const ordersWxml = read('miniprogram/pages/orders/orders.wxml')
  const detailJs = read('miniprogram/pages/orderDetail/orderDetail.js')
  const detailWxml = read('miniprogram/pages/orderDetail/orderDetail.wxml')
  assert.match(ordersJs, /showsPickupTicket/)
  assert.match(ordersJs, /showPickupTicket:/)
  assert.match(ordersWxml, /item\.showPickupTicket/)
  assert.match(ordersWxml, /查看订单详情/)
  assert.match(detailJs, /showsPickupTicket/)
  assert.match(detailJs, /showPickupTicket/)
  assert.match(detailWxml, /order && showPickupTicket/)
  assert.match(detailWxml, /订单详情/)
})

test('pickup time is explicit about date weekday and time range across user pages', () => {
  const { formatPickupTime } = require('../../miniprogram/utils/pickup-time')
  assert.equal(formatPickupTime({ pickupDate: '2026-07-15', arriveAt: '18:30', leaveAt: '19:10' }), '7月15日（星期三）18:30–19:10')
  assert.equal(formatPickupTime({ pickupDate: '2026-07-16' }), '7月16日（星期四）时间待确认')
  assert.equal(formatPickupTime({}), '取货时间待确认')

  for (const file of [
    'miniprogram/pages/pickStation/pickStation.js',
    'miniprogram/pages/checkout/checkout.js',
    'miniprogram/pages/paySuccess/paySuccess.js',
    'miniprogram/pages/groupPage/groupPage.js',
    'miniprogram/pages/orders/orders.js',
    'miniprogram/pages/orderDetail/orderDetail.js'
  ]) assert.match(read(file), /formatPickupTime/)

  assert.match(read('cloudfunctions/api/index.js'), /listDocsWhereIn\('deliveryWindows', 'batchStationId', batchStationIds\)/)
  assert.match(read('miniprogram/pages/orderDetail/orderDetail.wxml'), /pickupTimeText/)
})
