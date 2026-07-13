const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const root = path.resolve(__dirname, '..', '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

test('app registers cart checkout and three-minute payment pages', () => {
  const app = JSON.parse(read('miniprogram/app.json'))
  for (const page of ['pages/cart/cart', 'pages/checkout/checkout', 'pages/payment/payment']) assert(app.pages.includes(page))
})

test('product supports add-to-cart and buy-now while cart persists server-side', () => {
  const product = read('miniprogram/pages/product/product.js')
  const cart = read('miniprogram/pages/cart/cart.js')
  assert.match(product, /addToCart/); assert.match(product, /buyNow/)
  for (const action of ['getCart', 'updateCartItem', 'removeCartItem', 'clearInvalidCart']) assert.match(cart, new RegExp(action))
  assert.match(read('miniprogram/pages/cart/cart.wxml'), /加购不占库存/)
})

test('checkout creates one multi-SKU reservation and payment owns the countdown', () => {
  const checkout = read('miniprogram/pages/checkout/checkout.js')
  const payment = read('miniprogram/pages/payment/payment.js')
  assert.match(checkout, /createOrder/); assert.match(checkout, /items/); assert.match(checkout, /contactName/); assert.match(checkout, /phone/)
  assert.match(payment, /180/); assert.match(payment, /payOrder/); assert.match(payment, /cancelPendingOrder/); assert.match(payment, /onUnload/)
  assert.match(read('miniprogram/pages/payment/payment.wxml'), /无待支付列表/)
})

test('V1.7 user screens use people, phone tail, two subscriptions and two-stage refunds', () => {
  const files = ['miniprogram/app.js', 'miniprogram/pages/pickStation/pickStation.js', 'miniprogram/pages/paySuccess/paySuccess.js', 'miniprogram/pages/orderDetail/orderDetail.js', 'miniprogram/pages/orderDetail/orderDetail.wxml']
  const body = files.map(read).join('\n')
  assert.match(body, /paidUserCount/); assert.match(body, /手机尾号|phoneTail/); assert.match(body, /groupResultTemplateId/); assert.match(body, /pickupTemplateId/); assert.match(body, /applyRefundRequest/)
  assert.doesNotMatch(body, /6位自取码|累计5件|15分钟/)
})

test('home exposes three business states and catalog has a cart entry', () => {
  assert.match(read('miniprogram/pages/home/home.js'), /getHomeStatus/)
  assert.match(read('miniprogram/pages/home/home.wxml'), /开团中|今日休息|未开团/)
  assert.match(read('miniprogram/pages/catalog/catalog.wxml'), /购物车/)
})
