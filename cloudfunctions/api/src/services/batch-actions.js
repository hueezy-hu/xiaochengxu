const crypto = require('crypto')
const { ERROR_CODES, success, failure } = require('../shared/response')

const THRESHOLD = 5
const ORDER_REFUNDABLE = ['待配送确认', '待自提', '退款处理中', '待退款', '退款失败']
const MANUAL_CONFIRMABLE_STATION_STATUSES = ['拼团中', '已达门槛待确认']
const UNSETTLED_REFUND_STATUSES = ['待退款', '退款处理中', '退款失败']

function id(prefix, seed) {
  return `${prefix}-${crypto.createHash('sha256').update(String(seed)).digest('hex').slice(0, 24)}`
}

function beijingTimestamp(date, time) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ''))
  const clock = /^(\d{2}):(\d{2})$/.exec(String(time || ''))
  if (!match || !clock) return NaN
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(clock[1]) - 8, Number(clock[2]))
}

function addDate(date, days) {
  const timestamp = beijingTimestamp(date, '00:00') + Number(days) * 86400000
  return new Date(timestamp + 8 * 3600000).toISOString().slice(0, 10)
}

function isRefundSettled(result) {
  return Boolean(result && result.ok && !UNSETTLED_REFUND_STATUSES.includes(result.refundStatus))
}

function validateDraft(batch) {
  if (!batch || !String(batch.name || '').trim()) return '批次名称必填'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(batch.saleDate || ''))) return 'saleDate格式错误'
  if (batch.pickupDate !== addDate(batch.saleDate, 1)) return '取货日必须是销售日次日'
  if (!Array.isArray(batch.stations) || !batch.stations.length) return '至少选择一个站点'
  if (!Array.isArray(batch.inventory) || !batch.inventory.length) return '至少选择一个SKU'
  const stationIds = new Set()
  for (const row of batch.stations) {
    if (!row.stationId || stationIds.has(row.stationId)) return '站点不能为空或重复'
    stationIds.add(row.stationId)
    if (!/^\d{2}:\d{2}$/.test(String(row.arriveAt || '')) || !/^\d{2}:\d{2}$/.test(String(row.leaveAt || '')) || row.arriveAt >= row.leaveAt) return '站点取货窗口必须开始早于结束'
  }
  const skuIds = new Set()
  for (const row of batch.inventory) {
    if (!row.skuId || skuIds.has(row.skuId)) return 'SKU不能为空或重复'
    skuIds.add(row.skuId)
    if (!row.isUnlimited && (!Number.isInteger(Number(row.totalQty)) || Number(row.totalQty) < 0)) return 'SKU库存必须是非负整数'
  }
  return ''
}

function createBatchActions({ repository, now = Date.now, systemRefundOrder } = {}) {
  if (!repository || typeof repository.runTransaction !== 'function') throw new Error('repository.runTransaction is required')

  async function saveBatchDraft(input = {}) {
    const t = Number(now())
    const draft = input.batch || {}
    const invalid = validateDraft(draft)
    if (invalid) return failure(input, t, ERROR_CODES.INVALID_ARGUMENT, invalid)
    const batchId = draft._id || (repository.newId ? repository.newId('batch') : id('batch', `${input.openid}-${t}-${Math.random()}`))
    const result = await repository.runTransaction(async (tx) => {
      const existing = draft._id ? await tx.getBatch(batchId) : null
      if (existing && existing.status !== '草稿') return { error: '只有草稿批次可以编辑' }
      const revision = Number(existing && existing.revision || 0) + 1
      await tx.saveBatch(batchId, {
        name: String(draft.name).trim(), saleDate: draft.saleDate, pickupDate: draft.pickupDate,
        deadlineAt: beijingTimestamp(draft.saleDate, '22:00'), confirmAt: beijingTimestamp(draft.pickupDate, '12:00'),
        thresholdN: THRESHOLD, status: '草稿', revision,
        draftStations: draft.stations.map((row) => ({ ...row, thresholdN: THRESHOLD, locationImages: (row.locationImages || []).slice(0, 3) })),
        draftInventory: draft.inventory.map((row) => ({ skuId: row.skuId, totalQty: row.isUnlimited ? 0 : Number(row.totalQty), isUnlimited: Boolean(row.isUnlimited) })),
        createdBy: existing && existing.createdBy || input.openid || '', createdAt: existing && existing.createdAt || t,
        updatedBy: input.openid || '', updatedAt: t
      })
      return { batchId, revision }
    })
    return result.error ? failure(input, t, ERROR_CODES.ORDER_STATE_CONFLICT, result.error) : success(input, t, result)
  }

  async function getBatchDraft(input = {}) {
    const t = Number(now())
    const batch = await repository.getBatch(input.batchId)
    if (!batch || batch.status !== '草稿') return failure(input, t, ERROR_CODES.NOT_FOUND, '草稿不存在')
    return success(input, t, { batch })
  }

  async function publishBatch(input = {}) {
    const t = Number(now())
    if (!input.batchId) return failure(input, t, ERROR_CODES.INVALID_ARGUMENT, 'batchId必填')
    const result = await repository.runTransaction(async (tx) => {
      const batch = await tx.getBatch(input.batchId)
      if (!batch) return { error: '批次不存在' }
      if (batch.status === '接单中') return { batchId: batch._id, idempotent: true }
      if (batch.status !== '草稿') return { error: '只有草稿可以发布' }
      if (Number(input.revision) !== Number(batch.revision)) return { error: '草稿版本已变化，请刷新后发布' }
      if (t >= Number(batch.deadlineAt)) return { error: '已到22:00，不能发布当天销售批次' }
      if (await tx.findPublishedBatchBySaleDate(batch.saleDate, batch._id)) return { error: '同一销售日只能发布一个批次' }
      if (await tx.findAcceptingBatch(batch._id)) return { error: '当前已有接单中批次' }
      if (typeof tx.touchPublishLock === 'function') {
        await tx.touchPublishLock('batch-publish', { batchId: batch._id, saleDate: batch.saleDate, updatedAt: t })
      }

      const preparedStations = []
      for (const row of batch.draftStations || []) {
        const station = await tx.getStation(row.stationId)
        if (!station || station.status !== 'active') return { error: `站点${row.stationId}未启用` }
        if (row.arriveAt >= row.leaveAt) return { error: '站点取货窗口必须开始早于结束' }
        const images = (row.locationImages && row.locationImages.length ? row.locationImages : station.locationImages || []).slice(0, 3)
        if (!images.length) return { error: `站点${station.name || row.stationId}至少需要一张地点图片` }
        preparedStations.push({ row, station, images })
      }
      for (const row of batch.draftInventory || []) {
        const sku = await tx.getSku(row.skuId)
        if (!sku || sku.status !== '上架') return { error: `SKU${row.skuId}未上架` }
        if (!row.isUnlimited && Number(row.totalQty) < 0) return { error: 'SKU库存不能为负数' }
      }

      for (const item of preparedStations) {
        const batchStationId = id('bs', `${batch._id}:${item.row.stationId}`)
        await tx.createBatchStation(batchStationId, { batchId: batch._id, stationId: item.row.stationId, thresholdN: THRESHOLD, status: '拼团中', paidItemCount: 0, paidOrderCount: 0, manuallyConfirmed: false, createdAt: t, updatedAt: t })
        await tx.createDeliveryWindow(id('dw', batchStationId), { batchId: batch._id, batchStationId, pickupDate: batch.pickupDate, arriveAt: item.row.arriveAt, leaveAt: item.row.leaveAt, locationNote: item.row.locationNote || item.station.pickupNote || '', locationImages: item.images, createdBy: input.openid || '', createdAt: t, updatedAt: t })
      }
      for (const row of batch.draftInventory || []) {
        const total = row.isUnlimited ? 0 : Number(row.totalQty)
        await tx.createInventory(id('inv', `${batch._id}:${row.skuId}`), { batchId: batch._id, skuId: row.skuId, totalQty: total, availableQty: total, reservedQty: 0, soldQty: 0, refundedQty: 0, isUnlimited: Boolean(row.isUnlimited), status: '上架', createdAt: t, updatedAt: t })
      }
      await tx.saveBatch(batch._id, { status: '接单中', publishedAt: t, publishedBy: input.openid || '', updatedAt: t })
      await tx.saveOperationLog(id('op', `${batch._id}:publish`), { action: 'publishBatch', batchId: batch._id, operatorOpenid: input.openid || '', reason: '', createdAt: t })
      return { batchId: batch._id, deadlineAt: batch.deadlineAt, confirmAt: batch.confirmAt, pickupDate: batch.pickupDate }
    })
    return result.error ? failure(input, t, ERROR_CODES.ORDER_STATE_CONFLICT, result.error) : success(input, t, result)
  }

  async function manualConfirmDelivery(input = {}) {
    const t = Number(now())
    if (!String(input.reason || '').trim()) return failure(input, t, ERROR_CODES.INVALID_ARGUMENT, '确认原因必填')
    const result = await repository.runTransaction(async (tx) => {
      const station = await tx.getBatchStation(input.batchStationId)
      if (!station) return { error: '站点批次不存在' }
      const batch = await tx.getBatch(station.batchId)
      if (station.status === '已确认配送') return { batchStationId: station._id, status: station.status, idempotent: true }
      if (!batch || batch.status !== '已截单待配送确认' || t < Number(batch.deadlineAt) || t >= Number(batch.confirmAt)) return { error: '只能在截单后、取货日12:00前人工确认配送' }
      if (!MANUAL_CONFIRMABLE_STATION_STATUSES.includes(station.status)) return { error: '当前站点状态不可确认配送' }
      await tx.saveBatchStation(station._id, { status: '已确认配送', manuallyConfirmed: true, manualConfirmReason: String(input.reason).trim(), confirmedAt: t, confirmedBy: input.openid || '', updatedAt: t })
      const orders = await tx.listOrdersByStation(station._id, ['待配送确认'])
      for (const order of orders) await tx.saveOrder(order._id, { status: '待自提', deliveryConfirmedAt: t, updatedAt: t })
      await tx.saveOperationLog(id('op', `${station._id}:manual-confirm`), { action: 'manualConfirmDelivery', batchId: station.batchId, batchStationId: station._id, operatorOpenid: input.openid || '', reason: String(input.reason).trim(), createdAt: t })
      await tx.saveNotification(id('notice', `${station._id}:delivery-confirmed`), { type: 'deliveryConfirmed', batchStationId: station._id, status: '待发送', createdAt: t, updatedAt: t })
      return { batchStationId: station._id, status: '已确认配送', updatedOrders: orders.length }
    })
    return result.error ? failure(input, t, ERROR_CODES.ORDER_STATE_CONFLICT, result.error) : success(input, t, result)
  }

  async function closeBatchStation(input = {}) {
    const t = Number(now())
    if (!String(input.reason || '').trim()) return failure(input, t, ERROR_CODES.INVALID_ARGUMENT, '关闭原因必填')
    if (typeof systemRefundOrder !== 'function') return failure(input, t, ERROR_CODES.INTERNAL_ERROR, '系统退款服务不可用')
    const prepared = await repository.runTransaction(async (tx) => {
      const station = await tx.getBatchStation(input.batchStationId)
      if (!station) return { error: '站点批次不存在' }
      if (['已关闭', '已完成'].includes(station.status)) return { station, orderIds: [], idempotent: true, terminalStatus: station.status }
      if (station.status !== '关闭退款中') {
        await tx.saveBatchStation(station._id, { status: '关闭退款中', closeReason: String(input.reason).trim(), closedBy: input.openid || '', updatedAt: t })
      }
      const orders = await tx.listOrdersByStation(station._id, ORDER_REFUNDABLE)
      return { station, orderIds: orders.map((row) => row._id) }
    })
    if (prepared.error) return failure(input, t, ERROR_CODES.NOT_FOUND, prepared.error)
    if (prepared.terminalStatus) return success(input, t, { batchStationId: input.batchStationId, refunded: 0, status: prepared.terminalStatus, idempotent: true })
    let refunded = 0
    let incomplete = 0
    for (const orderId of prepared.orderIds) {
      const result = await systemRefundOrder({ system: true, orderId, reason: String(input.reason).trim(), requestId: `close-station-${input.batchStationId}-${orderId}` })
      if (isRefundSettled(result)) refunded += 1
      else incomplete += 1
    }
    if (incomplete > 0) return success(input, t, { batchStationId: input.batchStationId, refunded, incomplete, status: '关闭退款中' })
    await repository.runTransaction(async (tx) => {
      await tx.saveBatchStation(input.batchStationId, { status: '已关闭', closedAt: t, updatedAt: t })
      await tx.saveOperationLog(id('op', `${input.batchStationId}:close`), { action: 'closeBatchStation', batchStationId: input.batchStationId, operatorOpenid: input.openid || '', reason: String(input.reason).trim(), createdAt: t })
    })
    return success(input, t, { batchStationId: input.batchStationId, refunded, status: '已关闭' })
  }

  async function closeBatch(input = {}) {
    const t = Number(now())
    if (!String(input.reason || '').trim()) return failure(input, t, ERROR_CODES.INVALID_ARGUMENT, '关闭原因必填')
    const batch = await repository.getBatch(input.batchId)
    if (!batch) return failure(input, t, ERROR_CODES.NOT_FOUND, '批次不存在')
    const stations = await repository.listBatchStations(input.batchId)
    let refunded = 0
    let incomplete = 0
    for (const station of stations) {
      const result = await closeBatchStation({ ...input, batchStationId: station._id, requestId: `${input.requestId || 'close'}-${station._id}` })
      if (!result.ok) return result
      refunded += Number(result.refunded || 0)
      incomplete += Number(result.incomplete || 0)
    }
    const status = incomplete > 0 ? '关闭退款中' : '已结束'
    await repository.runTransaction(async (tx) => {
      await tx.saveBatch(input.batchId, { status, closeReason: String(input.reason).trim(), closedBy: input.openid || '', closedAt: status === '已结束' ? t : null, updatedAt: t })
      await tx.saveOperationLog(id('op', `${input.batchId}:close`), { action: 'closeBatch', batchId: input.batchId, operatorOpenid: input.openid || '', reason: String(input.reason).trim(), createdAt: t })
    })
    return success(input, t, { batchId: input.batchId, refunded, incomplete, status })
  }

  return { saveBatchDraft, getBatchDraft, publishBatch, manualConfirmDelivery, closeBatch, closeBatchStation }
}

module.exports = { createBatchActions, beijingTimestamp, addDate }
