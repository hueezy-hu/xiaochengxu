const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const root = path.resolve(__dirname, '..', '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

test('workspace shows people progress, nudges, rest and pending refund requests', () => {
  const body = read('miniprogram/pages/adminHome/adminHome.js') + read('miniprogram/pages/adminHome/adminHome.wxml')
  assert.match(body, /paidUserCount/); assert.match(body, /nudgeCount|催开团/); assert.match(body, /setTodayRest|今日休息/); assert.match(body, /退款申请|refund/)
  assert.match(body, /manualConfirmDelivery/); assert.match(body, /closeBatchStation/)
})

test('batch release only selects SKU stock and enabled fixed stations', () => {
  const body = read('miniprogram/pages/adminBatch/adminBatch.js') + read('miniprogram/pages/adminBatch/adminBatch.wxml')
  assert.match(body, /stationIds/); assert.match(body, /skuRows/); assert.match(body, /10:00/)
  assert.doesNotMatch(body, /stationWindows|addWindowImage|onWindowInput/)
})

test('catalog and station admin expose deletion protection and fixed station material', () => {
  const product = read('miniprogram/pages/adminProducts/adminProducts.js')
  const station = read('miniprogram/pages/adminStations/adminStations.js') + read('miniprogram/pages/adminStations/adminStations.wxml')
  assert.match(product, /deleteProduct/); assert.match(product, /deleteSku/)
  assert.match(station, /verifyMode/); assert.match(station, /arriveAt/); assert.match(station, /leaveAt/); assert.match(station, /defaultLocationImages/)
})

test('fulfillment UI supports QR tail photos unattended placement and no-show finish', () => {
  const body = read('miniprogram/pages/adminVerify/adminVerify.js') + read('miniprogram/pages/adminVerify/adminVerify.wxml')
  assert.match(body, /qrToken/); assert.match(body, /phoneTail/); assert.match(body, /chooseMedia/); assert.match(body, /placeOrderAtLocation/); assert.match(body, /finishNoShow/)
  assert.doesNotMatch(body, /输入6位码|verifyCode/)
})
