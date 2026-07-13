const ERROR_CODES = Object.freeze({
  INVALID_ARGUMENT: 'INVALID_ARGUMENT',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  BATCH_NOT_ACCEPTING: 'BATCH_NOT_ACCEPTING',
  STATION_CLOSED: 'STATION_CLOSED',
  INVENTORY_INSUFFICIENT: 'INVENTORY_INSUFFICIENT',
  ORDER_EXPIRED: 'ORDER_EXPIRED',
  ORDER_STATE_CONFLICT: 'ORDER_STATE_CONFLICT',
  PAYMENT_UNKNOWN: 'PAYMENT_UNKNOWN',
  REFUND_IN_PROGRESS: 'REFUND_IN_PROGRESS',
  INTERNAL_ERROR: 'INTERNAL_ERROR'
})

function requestIdOf(input = {}, now = Date.now()) {
  return String(input.requestId || input.clientRequestId || `server-${now}`)
}

function success(input, now, data = {}) {
  return { ok: true, serverNow: now, requestId: requestIdOf(input, now), ...data }
}

function failure(input, now, code, msg, extra = {}) {
  return { ok: false, code, msg, serverNow: now, requestId: requestIdOf(input, now), ...extra }
}

module.exports = { ERROR_CODES, requestIdOf, success, failure }
