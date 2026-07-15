const assert = require('assert')
const fs = require('fs')
const path = require('path')
const root = path.resolve(__dirname, '..', '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

function test(name, fn) {
  try { fn(); console.log(`PASS ${name}`) } catch (err) { console.error(`FAIL ${name}`); console.error(err.stack || err.message); process.exitCode = 1 }
}

test('home is a brand page without station selection or group progress', () => {
  const js = read('miniprogram/pages/home/home.js')
  const wxml = read('miniprogram/pages/home/home.wxml')
  assert.doesNotMatch(js, /stationCards|getCatalogPage|取货日 10:00/)
  assert.doesNotMatch(wxml, /home-station-card|已拼|还差.*成团/)
  assert.match(wxml, /去点单/)
})

test('product navigation never passes a client-controlled price', () => {
  const js = read('miniprogram/pages/product/product.js')
  assert.doesNotMatch(js, /[?&]price=/)
})

test('V1.7 checkout sends required contact identity and opens a dedicated payment page', () => {
  const js = read('miniprogram/pages/checkout/checkout.js')
  assert.match(js, /contactName/)
  assert.match(js, /clientRequestId/)
  assert.match(js, /createOrder/)
  assert.match(js, /pages\/payment\/payment/)
  assert.match(js, /redirectTo/)
  assert.doesNotMatch(js, /options\.price/)
})

test('orders and order detail use direct V1.6 refund without review, postpone, or 10:00 rule', () => {
  const orders = read('miniprogram/pages/orders/orders.js')
  const detailJs = read('miniprogram/pages/orderDetail/orderDetail.js')
  const detailWxml = read('miniprogram/pages/orderDetail/orderDetail.wxml')
  assert.match(orders, /requestRefund/); assert.doesNotMatch(orders, /cancelOrder|待审核/)
  assert.match(detailJs, /requestRefund/); assert.doesNotMatch(detailJs, /applyAfterSale|postpone|cancelOrder|10:00/)
  assert.doesNotMatch(detailWxml, /顺延|售后申请|10:00/)
})

test('share and payment-success exits cannot return to a locked station or duplicate payment', () => {
  const group = read('miniprogram/pages/groupPage/groupPage.js')
  const success = read('miniprogram/pages/paySuccess/paySuccess.js')
  assert.match(group, /pages\/groupPage\/groupPage\?batchStationId=/)
  assert.match(group, /wx\.switchTab\(\{ url: '\/pages\/catalog\/catalog' \}\)/)
  assert.match(success, /pages\/groupPage\/groupPage\?batchStationId=/)
  assert.match(success, /redirectTo|switchTab/)
})

test('station options remain orderable after reaching five until 22:00', () => {
  const index = read('cloudfunctions/api/index.js')
  const body = index.match(/async function getStationOptions[\s\S]*?\n}/)[0]
  assert.match(body, /已达门槛待确认/)
  assert.doesNotMatch(body, /已成团继续接单|待自提/)
})
