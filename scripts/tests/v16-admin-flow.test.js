const assert = require('assert')
const fs = require('fs')
const path = require('path')
const root = path.resolve(__dirname, '..', '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
function test(name, fn) { try { fn(); console.log(`PASS ${name}`) } catch (err) { console.error(`FAIL ${name}`); console.error(err.stack || err.message); process.exitCode = 1 } }

test('V1.7 batch page is a simplified manual-publish form with fixed station material', () => {
  const js = read('miniprogram/pages/adminBatch/adminBatch.js'); const wxml = read('miniprogram/pages/adminBatch/adminBatch.wxml')
  assert.match(js, /saveBatchDraft/); assert.match(js, /publishBatch/); assert.doesNotMatch(js, /createBatch|thresholdN|manualFormGroup/)
  for (const label of ['基础信息', '勾选 SKU', '勾选启用站点', '确认手动发布']) assert.match(wxml, new RegExp(label))
  assert.match(wxml, /固定资料/); assert.match(wxml, /10:00/)
})

test('admin workspace contains no old group, extension, review, postpone, or no-show actions', () => {
  const js = read('miniprogram/pages/adminHome/adminHome.js'); const wxml = read('miniprogram/pages/adminHome/adminHome.wxml')
  for (const old of ['manualFormGroup', 'manualCutoff', 'extendDeadline', 'reviewRefund', 'markOrderPostponed', 'markNoShowOrders']) { assert.doesNotMatch(js, new RegExp(old)); assert.doesNotMatch(wxml, new RegExp(old)) }
  assert.match(js, /manualConfirmDelivery/); assert.match(js, /closeBatchStation/); assert.match(wxml, /isSuperAdmin/)
})

test('verifier page uses authorized workspace and supports contact placement and safe session ending', () => {
  const js = read('miniprogram/pages/adminVerify/adminVerify.js')
  for (const action of ['getVerifierWorkspace', 'contactOrder', 'placeOrderAtLocation', 'endPickupSession']) assert.match(js, new RegExp(action))
  assert.doesNotMatch(js, /markNoShowOrders|未取货待处理|顺延/)
})

test('station and product forms cover V1.6 image and merchandising fields', () => {
  assert.match(read('miniprogram/pages/adminStations/adminStations.js'), /locationImages/)
  const product = read('miniprogram/pages/adminProducts/adminProducts.js')
  for (const field of ['thaiName', 'category', 'tags']) assert.match(product, new RegExp(field, 'i'))
})
