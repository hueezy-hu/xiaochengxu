// Pure helpers for real WeChat Pay integration. No network I/O.
// MOCK_PAY remains the production gate; these helpers only shape payloads.

const RESERVATION_MS = 3 * 60 * 1000

function toWechatTimeExpire(expiresAtMs) {
  const ms = Number(expiresAtMs)
  if (!Number.isFinite(ms) || ms <= 0) throw new Error('expiresAt invalid')
  const d = new Date(ms)
  const pad = (n) => String(n).padStart(2, '0')
  // WeChat time_expire: yyyy-MM-DDTHH:mm:ss+08:00 (Beijing wall clock via offset)
  const bj = new Date(ms + 8 * 60 * 60 * 1000)
  const y = bj.getUTCFullYear()
  const m = pad(bj.getUTCMonth() + 1)
  const day = pad(bj.getUTCDate())
  const hh = pad(bj.getUTCHours())
  const mm = pad(bj.getUTCMinutes())
  const ss = pad(bj.getUTCSeconds())
  return y + '-' + m + '-' + day + 'T' + hh + ':' + mm + ':' + ss + '+08:00'
}

function reservationAlignedTimeExpire(order, nowMs = Date.now()) {
  const expiresAt = Number(order && order.expiresAt)
  if (!Number.isFinite(expiresAt) || expiresAt <= nowMs) {
    return { ok: false, reason: '预占已超时，不能发起支付' }
  }
  // Strictly align WeChat order validity with remaining reservation window (max 3 minutes).
  const capped = Math.min(expiresAt, nowMs + RESERVATION_MS)
  return { ok: true, expiresAt: capped, time_expire: toWechatTimeExpire(capped) }
}

function paymentEventId(outTradeNo, transactionId) {
  return 'payevt-' + String(outTradeNo || '') + '-' + String(transactionId || 'unknown')
}

function classifyPaymentCallback({ order, nowMs, eventType }) {
  if (!order) return { action: 'ignore', reason: '订单不存在' }
  if (order.paidAt || ['待配送确认', '待自提', '已放置待自取', '已完成', '已完成未取', '已退款', '退款处理中', '退款申请待处理'].includes(order.status)) {
    return { action: 'idempotent', reason: '订单已支付或终态' }
  }
  if (order.status !== '预占中') {
    return { action: 'ignore', reason: '订单状态不可确认支付' }
  }
  const expired = Number(order.expiresAt || 0) > 0 && nowMs >= Number(order.expiresAt)
  if (expired && eventType === 'SUCCESS') {
    // Late success after reservation expiry: reconfirm stock or auto-refund path.
    return { action: 'late_success', reason: '支付成功晚于预占超时' }
  }
  if (eventType === 'SUCCESS') return { action: 'confirm', reason: '正常确认支付' }
  return { action: 'ignore', reason: '非成功支付事件' }
}

module.exports = {
  RESERVATION_MS,
  toWechatTimeExpire,
  reservationAlignedTimeExpire,
  paymentEventId,
  classifyPaymentCallback
}
