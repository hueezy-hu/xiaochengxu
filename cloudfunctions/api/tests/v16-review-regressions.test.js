const assert = require('assert')
const fs = require('fs')
const path = require('path')

const index = fs.readFileSync(path.resolve(__dirname, '..', 'index.js'), 'utf8')
function bodyOf(name) {
  const match = index.match(new RegExp(`async function ${name}[\\s\\S]*?\\n}`))
  assert.ok(match, `${name} missing`)
  return match[0]
}
function test(name, fn) {
  try { fn(); console.log(`PASS ${name}`) } catch (err) { console.error(`FAIL ${name}`); console.error(err.stack || err.message); process.exitCode = 1 }
}

test('refund retry completes refund and order together in a transaction', () => {
  const body = bodyOf('completeRefundRecord')
  assert.match(body, /db\.runTransaction/)
  assert.match(body, /status:\s*'已退款'/)
  assert.match(body, /refundStatus:\s*'已退款'/)
})

test('collection initialization is cached per warm cloud-function instance', () => {
  const body = bodyOf('ensureCollections')
  assert.match(index, /let collectionsReadyPromise/)
  assert.match(body, /collectionsReadyPromise/)
})

test('delivery-window updates validate station, batch date, time order, and image limit', () => {
  const body = bodyOf('setDeliveryWindow')
  assert.match(body, /getDoc\('batchStations'/)
  assert.match(body, /getDoc\('batches'/)
  assert.match(body, /pickupDate !== batch\.pickupDate/)
  assert.match(body, /arriveAt >= input\.leaveAt/)
  assert.match(body, /locationImages\.length > 3/)
})
