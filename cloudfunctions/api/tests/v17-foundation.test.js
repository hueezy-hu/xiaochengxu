const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const assert = require('node:assert/strict')

const constantsPath = path.resolve(__dirname, '..', 'src', 'constants', 'v17.js')

test('V1.7 constants define one three-minute reservation and one status vocabulary', () => {
  assert.equal(fs.existsSync(constantsPath), true, 'src/constants/v17.js must exist')
  const constants = require(constantsPath)
  assert.equal(constants.STATION_THRESHOLD, 5)
  assert.equal(constants.RESERVATION_TTL_MS, 3 * 60 * 1000)
  assert.deepEqual(constants.VERIFY_MODES, { STAFF: '有人核销', UNATTENDED: '无人放置' })
  assert.equal(constants.ORDER_STATUS.RESERVED, '预占中')
  assert.equal(constants.STATION_STATUS.UNFORMED, '未成团待处理')
  assert.equal(constants.BATCH_STATUS.WAITING_CONFIRMATION, '已截单待配送确认')
})

test('V1.7 response errors distinguish business closure, cart, tail, photo and refund conflicts', () => {
  const { ERROR_CODES } = require('../src/shared/response')
  assert.equal(ERROR_CODES.BUSINESS_CLOSED, 'BUSINESS_CLOSED')
  assert.equal(ERROR_CODES.CART_INVALID, 'CART_INVALID')
  assert.equal(ERROR_CODES.SKU_UNAVAILABLE, 'SKU_UNAVAILABLE')
  assert.equal(ERROR_CODES.PHONE_TAIL_AMBIGUOUS, 'PHONE_TAIL_AMBIGUOUS')
  assert.equal(ERROR_CODES.PHOTO_REQUIRED, 'PHOTO_REQUIRED')
  assert.equal(ERROR_CODES.REFUND_REQUEST_EXISTS, 'REFUND_REQUEST_EXISTS')
  assert.equal(ERROR_CODES.ACTIVE_BATCH_EXISTS, 'ACTIVE_BATCH_EXISTS')
})
