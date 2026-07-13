const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const apiRoot = path.resolve(__dirname, '..')

test('V1.7 cloud repositories are injectable modules outside index', () => {
  const order = require('../src/repositories/order-repository')
  const batch = require('../src/repositories/batch-repository')
  const fulfillment = require('../src/repositories/fulfillment-repository')
  const cloudDb = require('../src/repositories/cloud-db')

  assert.equal(typeof order.createOrderRepository, 'function')
  assert.equal(typeof batch.createBatchRepository, 'function')
  assert.equal(typeof fulfillment.createFulfillmentRepository, 'function')
  assert.equal(typeof cloudDb.createCloudDbHelpers, 'function')
})

test('shared validation and id generation have stable public contracts', () => {
  const validation = require('../src/shared/validation')
  const ids = require('../src/shared/ids')

  assert.equal(validation.isPhone('13800138000'), true)
  assert.equal(validation.isPhone('1380013800'), false)
  assert.equal(ids.stableId('order', 'buyer:request'), ids.stableId('order', 'buyer:request'))
  assert.notEqual(ids.randomToken(16), ids.randomToken(16))
})

test('index imports repositories instead of declaring cloud repository factories', () => {
  const source = fs.readFileSync(path.join(apiRoot, 'index.js'), 'utf8')

  assert.match(source, /src\/repositories\/order-repository/)
  assert.match(source, /src\/repositories\/batch-repository/)
  assert.match(source, /src\/repositories\/fulfillment-repository/)
  assert.doesNotMatch(source, /function createCloudOrderRepository\s*\(/)
  assert.doesNotMatch(source, /function createCloudBatchRepository\s*\(/)
  assert.doesNotMatch(source, /function createCloudFulfillmentRepository\s*\(/)
})

test('index does not retain unrouted V1.5 order and group implementations', () => {
  const source = fs.readFileSync(path.join(apiRoot, 'index.js'), 'utf8')
  const deadFunctions = [
    'createOrder', 'payOrder', 'payCallback', 'confirmPaidOrder', 'cancelOrder', 'refundOrder',
    'adminDashboard', 'createBatch', 'manualFormGroup', 'manualCutoff', 'closeGroupRefund',
    'extendDeadline', 'pushPickupNoticeIfConfigured', 'markArrived'
  ]

  for (const name of deadFunctions) {
    assert.doesNotMatch(source, new RegExp(`async function ${name}\\s*\\(`), `${name}仍是入口死代码`)
  }
})
