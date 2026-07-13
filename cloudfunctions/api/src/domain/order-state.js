const { ORDER_STATUS } = require('../constants/v17')

const SELF_REFUNDABLE = new Set([ORDER_STATUS.WAITING_DELIVERY, ORDER_STATUS.WAITING_PICKUP])
const VERIFYABLE = new Set([ORDER_STATUS.WAITING_PICKUP, ORDER_STATUS.PLACED])
const POST_DELIVERY = new Set([ORDER_STATUS.COMPLETED, ORDER_STATUS.PLACED, ORDER_STATUS.COMPLETED_NO_SHOW])

function invalid(reason) {
  return { ok: false, reason }
}

function transitionV17Order({ order, operation, now = Date.now(), reason = '' } = {}) {
  if (!order) return invalid('订单不存在')
  const expectedStatus = order.status

  if (operation === 'refund') {
    if (!SELF_REFUNDABLE.has(expectedStatus)) return invalid('当前状态不可自助退款')
    return {
      ok: true,
      expectedStatus,
      orderPatch: { status: ORDER_STATUS.REFUNDING, refundRequestedAt: Number(now), fulfillmentOperation: 'refund' }
    }
  }
  if (operation === 'verify') {
    if (!VERIFYABLE.has(expectedStatus)) return invalid('订单不是可核销状态')
    return {
      ok: true,
      expectedStatus,
      orderPatch: { status: ORDER_STATUS.COMPLETED, verifiedAt: Number(now), completedAt: Number(now), fulfillmentOperation: 'verify' }
    }
  }
  if (operation === 'place') {
    if (expectedStatus !== ORDER_STATUS.WAITING_PICKUP) return invalid('订单不是待自提状态')
    return {
      ok: true,
      expectedStatus,
      orderPatch: { status: ORDER_STATUS.PLACED, placedAt: Number(now), fulfillmentOperation: 'place' }
    }
  }
  if (operation === 'requestRefund') {
    if (!POST_DELIVERY.has(expectedStatus)) return invalid('订单尚未交付或已有退款申请')
    return {
      ok: true,
      expectedStatus,
      orderPatch: {
        status: ORDER_STATUS.REFUND_REQUESTED,
        refundRequest: {
          status: '待处理',
          originalOrderStatus: expectedStatus,
          reason: String(reason || '').trim(),
          requestedAt: Number(now)
        }
      }
    }
  }
  return invalid('不支持的订单操作')
}

module.exports = { transitionV17Order }
