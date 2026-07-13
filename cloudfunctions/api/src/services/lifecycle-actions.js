const crypto = require('crypto')
const { ERROR_CODES, success, failure } = require('../shared/response')
const { lockStationAtCutoff } = require('../../domain')

const ACCEPTING = '接单中'
const WAITING_CONFIRMATION = '已截单待配送确认'
const DELIVERY_CONFIRMED = '已确认配送'
const CLOSED = '已关闭'
const CLOSING = '关闭退款中'
const REFUNDABLE_ORDER_STATUSES = ['待配送确认', '待自提', '退款处理中', '待退款', '退款失败']
const UNSETTLED_REFUND_STATUSES = ['待退款', '退款处理中', '退款失败']

function id(prefix, seed) {
  return `${prefix}-${crypto.createHash('sha256').update(String(seed)).digest('hex').slice(0, 24)}`
}

function isRefundSettled(result) {
  return Boolean(result && result.ok && !UNSETTLED_REFUND_STATUSES.includes(result.refundStatus))
}

function createLifecycleActions({ repository, orderActions, now = Date.now } = {}) {
  if (!repository || typeof repository.runTransaction !== 'function') throw new Error('repository.runTransaction is required')
  if (!orderActions || typeof orderActions.expirePendingOrders !== 'function') throw new Error('orderActions.expirePendingOrders is required')

  async function cutoffSales(t) {
    const batches = await repository.listDueBatches(ACCEPTING, 'deadlineAt', t)
    for (const row of batches) {
      await repository.runTransaction(async (tx) => {
        const batch = await tx.getBatch(row._id)
        if (!batch || batch.status !== ACCEPTING || t < Number(batch.deadlineAt)) return
        await tx.saveBatch(batch._id, { status: WAITING_CONFIRMATION, cutoffAt: t, updatedAt: t })
        const stations = await tx.listBatchStations(batch._id)
        for (const station of stations) {
          if ([DELIVERY_CONFIRMED, CLOSED, CLOSING, '已完成'].includes(station.status)) continue
          await tx.saveBatchStation(station._id, { ...lockStationAtCutoff(station, t), updatedAt: t })
        }
        await tx.saveOperationLog(id('op', `${batch._id}:cutoff`), {
          action: 'closeSalesAt22', batchId: batch._id, operatorOpenid: 'system', reason: '到达销售日22:00', createdAt: t
        })
      })
    }
    return batches.length
  }

  async function confirmStation(batch, station, t) {
    if (station.status === DELIVERY_CONFIRMED || station.status === CLOSED) return { confirmed: 0, closed: 0, refunded: 0 }
    if (station.status !== CLOSING && (station.status === '已成团待确认' || Number(station.paidUserCount || 0) >= 5)) {
      return repository.runTransaction(async (tx) => {
        const current = await tx.getBatchStation(station._id)
        if (!current || current.status === DELIVERY_CONFIRMED || current.status === CLOSED || current.status === CLOSING) return { confirmed: 0, closed: 0, refunded: 0 }
        await tx.saveBatchStation(current._id, { status: DELIVERY_CONFIRMED, confirmedAt: t, confirmedBy: 'system', updatedAt: t })
        const orders = await tx.listOrdersByStation(current._id, ['待配送确认'])
        for (const order of orders) await tx.saveOrder(order._id, { status: '待自提', deliveryConfirmedAt: t, updatedAt: t })
        await tx.saveOperationLog(id('op', `${current._id}:auto-confirm`), {
          action: 'confirmPickupDayStation', batchId: batch._id, batchStationId: current._id,
          operatorOpenid: 'system', reason: '已付款用户达到5人', createdAt: t
        })
        await tx.saveNotification(id('notice', `${current._id}:delivery-confirmed`), {
          type: 'deliveryConfirmed', batchStationId: current._id, status: '待发送', createdAt: t, updatedAt: t
        })
        return { confirmed: 1, closed: 0, refunded: 0 }
      })
    }

    const prepared = await repository.runTransaction(async (tx) => {
      const current = await tx.getBatchStation(station._id)
      if (!current || current.status === DELIVERY_CONFIRMED || current.status === CLOSED) {
        return { orderIds: [], skipped: true }
      }
      if (current.status !== CLOSING) {
        await tx.saveBatchStation(current._id, { status: CLOSING, closeReason: '取货日12:00未达到5人', updatedAt: t })
      }
      const orders = await tx.listOrdersByStation(current._id, REFUNDABLE_ORDER_STATUSES)
      return { orderIds: orders.map((order) => order._id), skipped: false }
    })
    if (prepared.skipped) return { confirmed: 0, closed: 0, refunded: 0 }
    if (typeof orderActions.systemRefundOrder !== 'function') throw new Error('orderActions.systemRefundOrder is required')
    let refunded = 0
    let incomplete = 0
    for (const orderId of prepared.orderIds) {
      const result = await orderActions.systemRefundOrder({
        system: true, orderId, reason: '取货日12:00未达到5人', requestId: `noon-${station._id}-${orderId}`
      })
      if (isRefundSettled(result)) refunded += 1
      else incomplete += 1
    }
    if (incomplete > 0) return { confirmed: 0, closed: 0, refunded, incomplete }
    await repository.runTransaction(async (tx) => {
      const current = await tx.getBatchStation(station._id)
      if (!current || current.status === CLOSED) return
      await tx.saveBatchStation(station._id, { status: CLOSED, closedAt: t, updatedAt: t })
      await tx.saveOperationLog(id('op', `${station._id}:auto-close`), {
        action: 'closeBatchStationAtNoon', batchId: batch._id, batchStationId: station._id,
        operatorOpenid: 'system', reason: '取货日12:00未达到5人', createdAt: t
      })
    })
    return { confirmed: 0, closed: 1, refunded, incomplete: 0 }
  }

  async function confirmPickupDay(t) {
    const waiting = await repository.listDueBatches(WAITING_CONFIRMATION, 'confirmAt', t)
    const closing = await repository.listDueBatches(CLOSING, 'confirmAt', t)
    const batches = [...waiting, ...closing.filter((row) => !waiting.some((candidate) => candidate._id === row._id))]
    let confirmed = 0
    let closed = 0
    let refunded = 0
    let incomplete = 0
    for (const batch of batches) {
      const stations = await repository.listBatchStations(batch._id)
      for (const station of stations) {
        const result = await confirmStation(batch, station, t)
        confirmed += result.confirmed
        closed += result.closed
        refunded += result.refunded
        incomplete += Number(result.incomplete || 0)
      }
      const currentStations = await repository.listBatchStations(batch._id)
      const hasClosing = currentStations.some((station) => station.status === CLOSING)
      const hasDelivery = currentStations.some((station) => station.status === DELIVERY_CONFIRMED)
      const batchStatus = hasClosing ? CLOSING : (hasDelivery ? '配送进行中' : '已结束')
      await repository.runTransaction(async (tx) => {
        const current = await tx.getBatch(batch._id)
        if (current && [WAITING_CONFIRMATION, CLOSING].includes(current.status)) {
          await tx.saveBatch(batch._id, { status: batchStatus, deliveryConfirmedAt: batchStatus === CLOSING ? null : t, updatedAt: t })
        }
      })
    }
    return { confirmed, closed, refunded, incomplete }
  }

  async function lifecycleTick(input = {}) {
    const t = Number(now())
    if (input.system !== true) return failure(input, t, ERROR_CODES.FORBIDDEN, '仅可信系统任务可执行生命周期处理')
    const expiredResult = await orderActions.expirePendingOrders({ system: true, requestId: `${input.requestId || 'lifecycle'}-expire` })
    if (!expiredResult.ok) return expiredResult
    const cutoff = await cutoffSales(t)
    const noon = await confirmPickupDay(t)
    return success(input, t, { expired: Number(expiredResult.expired || 0), released: Number(expiredResult.released || 0), cutoff, ...noon })
  }

  return { lifecycleTick }
}

module.exports = { createLifecycleActions }
