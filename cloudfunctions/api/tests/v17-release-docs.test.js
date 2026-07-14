const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const root = path.resolve(__dirname, '..', '..', '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

test('demo data separates people and items and contains both delivery modes plus duplicate tails', () => {
  const index = read('cloudfunctions/api/index.js')
  assert.match(index, /paidUserCount: 3/); assert.match(index, /paidItemCount: 6/)
  assert.match(index, /verifyMode: '有人核销'/); assert.match(index, /verifyMode: '无人放置'/)
  assert.match(index, /duplicatePhoneTail: '8000'/); assert.match(index, /pickupQrToken/)
  assert.doesNotMatch(index, /verifyCode: '638274'|generateVerifyCode/)
})

test('demo ordering stations stay selectable and start with two or three paid users', () => {
  const index = read('cloudfunctions/api/index.js')
  assert.match(index, /bsA, \{[^\n]+status: '拼团中'[^\n]+paidUserCount: 3/)
  assert.match(index, /bsB, \{[^\n]+status: '拼团中'[^\n]+paidUserCount: 2/)
  assert.match(index, /id: 'demo-order-d'[^\n]+batchStationId: bsB/)
  assert.match(index, /id: 'demo-order-e'[^\n]+batchStationId: bsB/)
})

test('mock mode exposes merchant pages to every tester without writing admin records', () => {
  const index = read('cloudfunctions/api/index.js')
  assert.match(index, /const DEMO_OPEN_ADMIN = resolveDemoAdminAccess\(process\.env\)/)
  assert.match(index, /function demoAdminActor\(openid\)/)
  assert.match(index, /async function getEffectiveAdmin\(openid\)/)
  assert.match(index, /const admin = await getEffectiveAdmin\(openid\)/)
  assert.doesNotMatch(index, /source: 'DEMO_OPEN_ADMIN'/)
})

test('project documents describe current V1.7 implementation and retain real-payment gate', () => {
  const currentDocs = [read('README.md'), read('AGENTS.md'), read('cloudfunctions/api/ACTIONS.md')].join('\n')
  const docs = currentDocs + '\n' + read('CLAUDE.md')
  assert.match(docs, /V1\.7/); assert.match(docs, /MOCK_PAY=true/); assert.match(docs, /真实支付/)
  assert.doesNotMatch(currentDocs, /现有代码仍是 V1\.5\/V1\.6|ACTIONS\.md.*待重修|README\.md.*待同步/)
  assert.match(read('V1.7-上线验收.md'), /同一 Git 提交/)
})
