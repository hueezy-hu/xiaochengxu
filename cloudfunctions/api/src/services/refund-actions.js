const { transitionV17Order } = require('../../domain')
const { ERROR_CODES, success, failure } = require('../shared/response')

function requestId(orderId) {
  return `refund-request-${orderId}`
}

function createRefundActions({ repository, systemRefundOrder, now = Date.now } = {}) {
  if (!repository || typeof repository.runTransaction !== 'function') throw new Error('repository.runTransaction is required')

  async function applyRefundRequest(input = {}) {
    const t = Number(now())
    if (!input.orderId || !String(input.reason || '').trim()) return failure(input, t, ERROR_CODES.INVALID_ARGUMENT, 'orderId和reason必填')
    const result = await repository.runTransaction(async (tx) => {
      const order = await tx.getOrder(input.orderId)
      if (!order || order.userOpenid !== input.openid) return { error: [ERROR_CODES.FORBIDDEN, '订单不存在或无权操作'] }
      const id = requestId(order._id)
      const existing = await tx.getRefundRequest(id)
      if (existing) return { orderId: order._id, refundRequestId: id, status: existing.status, idempotent: true }
      const transition = transitionV17Order({ order, operation: 'requestRefund', reason: input.reason, now: t })
      if (!transition.ok) return { error: [ERROR_CODES.ORDER_STATE_CONFLICT, transition.reason] }
      await tx.saveOrder(order._id, { ...transition.orderPatch, updatedAt: t })
      await tx.saveRefundRequest(id, {
        orderId: order._id,
        userOpenid: input.openid,
        reason: String(input.reason).trim(),
        originalOrderStatus: order.status,
        status: '待处理',
        requestedAt: t,
        createdAt: t,
        updatedAt: t
      })
      return { orderId: order._id, refundRequestId: id, status: '待处理' }
    })
    return result.error ? failure(input, t, result.error[0], result.error[1]) : success(input, t, result)
  }

  async function resolveRefundRequest(input = {}) {
    const t = Number(now())
    if (!input.orderId || !['refund', 'reject'].includes(input.decision)) return failure(input, t, ERROR_CODES.INVALID_ARGUMENT, 'orderId和有效decision必填')
    const id = requestId(input.orderId)
    const prepared = await repository.runTransaction(async (tx) => {
      const request = await tx.getRefundRequest(id)
      const order = await tx.getOrder(input.orderId)
      if (!request || !order) return { error: [ERROR_CODES.NOT_FOUND, '退款申请不存在'] }
      if (request.status !== '待处理') return { orderId: order._id, refundRequestId: id, status: request.status, idempotent: true }
      if (input.decision === 'reject') {
        await tx.saveOrder(order._id, { status: request.originalOrderStatus, refundRequest: { ...(order.refundRequest || {}), status: '已拒绝', resolvedAt: t }, updatedAt: t })
        await tx.saveRefundRequest(id, { status: '已拒绝', decision: 'reject', note: String(input.note || '').trim(), resolvedBy: input.openid || '', resolvedAt: t, updatedAt: t })
        return { orderId: order._id, refundRequestId: id, status: '已拒绝' }
      }
      await tx.saveRefundRequest(id, { status: '处理中', decision: 'refund', note: String(input.note || '').trim(), resolvedBy: input.openid || '', updatedAt: t })
      return { orderId: order._id, refundRequestId: id, processRefund: true }
    })
    if (prepared.error) return failure(input, t, prepared.error[0], prepared.error[1])
    if (!prepared.processRefund) return success(input, t, prepared)
    if (typeof systemRefundOrder !== 'function') return failure(input, t, ERROR_CODES.INTERNAL_ERROR, '退款服务不可用')

    const refunded = await systemRefundOrder({
      system: true,
      allowPostDelivery: true,
      orderId: input.orderId,
      reason: String(input.note || '人工审批退款').trim(),
      requestId: `manual-refund-${input.orderId}`
    })
    await repository.runTransaction(async (tx) => {
      await tx.saveRefundRequest(id, refunded.ok
        ? { status: refunded.refundStatus || '已退款', refundNo: refunded.refundNo || '', resolvedAt: t, updatedAt: t }
        : { status: '待处理', lastError: refunded.msg || refunded.code || '退款失败', updatedAt: t })
    })
    return refunded.ok
      ? success(input, t, { orderId: input.orderId, refundRequestId: id, status: refunded.refundStatus || '已退款', refundNo: refunded.refundNo || '' })
      : failure(input, t, refunded.code || ERROR_CODES.INTERNAL_ERROR, refunded.msg || '退款失败')
  }

  return { applyRefundRequest, resolveRefundRequest }
}

module.exports = { createRefundActions }
