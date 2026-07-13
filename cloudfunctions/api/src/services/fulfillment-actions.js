const crypto = require('crypto')
const { transitionV17Order } = require('../../domain')
const { beijingTimestamp } = require('./batch-actions')
const { ERROR_CODES, success, failure } = require('../shared/response')

function id(prefix, seed) {
  return `${prefix}-${crypto.createHash('sha256').update(String(seed)).digest('hex').slice(0, 24)}`
}

function isSuperAdmin(actor) { return Boolean(actor && actor.status === 'active' && actor.role === 'superAdmin') }
function isPickupActive(station) { return Boolean(station && ['已确认配送', '自提进行中'].includes(station.status)) }
function proofImages(input = {}) {
  const images = (input.images || (input.image ? [input.image] : [])).map(String).map((row) => row.trim()).filter(Boolean)
  return images.length >= 1 && images.length <= 3 ? images : null
}
function phoneTailOf(order = {}) { return String(order.phoneTail || String(order.phone || '').slice(-4)) }

function canAccessStation(actor, batchStation) {
  if (!actor || actor.status !== 'active' || !batchStation) return false
  if (actor.role === 'superAdmin') return true
  if (actor.role !== 'verifier') return false
  const scopes = Array.isArray(actor.authorizationScopes) ? actor.authorizationScopes : []
  if (scopes.length) {
    return scopes.some((scope) => (!scope.batchId || scope.batchId === batchStation.batchId) && (scope.stationIds || []).includes(batchStation.stationId))
  }
  const stationAllowed = (actor.stationIds || []).includes(batchStation.stationId)
  const batchAllowed = !(actor.batchIds || []).length || actor.batchIds.includes(batchStation.batchId)
  return stationAllowed && batchAllowed
}

function windowLeaveAt(window) {
  if (!window) return NaN
  if (Number.isFinite(Number(window.leaveAtTimestamp))) return Number(window.leaveAtTimestamp)
  return beijingTimestamp(window.pickupDate, window.leaveAt)
}

function windowArriveAt(window) {
  if (!window) return NaN
  if (Number.isFinite(Number(window.arriveAtTimestamp))) return Number(window.arriveAtTimestamp)
  return beijingTimestamp(window.pickupDate, window.arriveAt)
}

function createFulfillmentActions({ repository, now = Date.now } = {}) {
  if (!repository || typeof repository.runTransaction !== 'function') throw new Error('repository.runTransaction is required')

  async function getWorkspace(input = {}) {
    const t = Number(now())
    const stations = await repository.listBatchStations()
    const allowed = stations.filter((station) => canAccessStation(input.actor, station))
    const rows = []
    for (const station of allowed) {
      const orders = await repository.listOrdersByStation(station._id, ['待自提', '已完成', '已放置待自取', '已退款'])
      const physical = typeof repository.getStation === 'function' ? await repository.getStation(station.stationId) : null
      const deliveryWindow = typeof repository.getDeliveryWindowByStation === 'function' ? await repository.getDeliveryWindowByStation(station._id) : null
      const tailGroups = {}
      for (const order of orders.filter((row) => ['待自提', '已放置待自取'].includes(row.status))) {
        const tail = phoneTailOf(order)
        if (tail) (tailGroups[tail] ||= []).push(order._id)
      }
      const duplicateTailWarnings = Object.entries(tailGroups).filter(([, orderIds]) => orderIds.length > 1).map(([phoneTail, orderIds]) => ({ phoneTail, orderIds }))
      rows.push({ ...station, stationName: physical && physical.name || station.stationName || '', deliveryWindow, orders, duplicateTailWarnings })
    }
    const pendingRefundRequests = typeof repository.listPendingRefundRequests === 'function' ? await repository.listPendingRefundRequests() : []
    return success(input, t, { role: input.actor && input.actor.role, batchStations: rows, pendingRefundRequests })
  }

  async function getPrepList(input = {}) {
    const t = Number(now())
    const result = await repository.runTransaction(async (tx) => {
      const station = await tx.getBatchStation(input.batchStationId)
      if (!canAccessStation(input.actor, station)) return { error: [ERROR_CODES.FORBIDDEN, '无当前站点权限'] }
      const orders = await tx.listOrdersByStation(station._id, ['待自提', '已完成', '已放置待自取'])
      const totals = {}
      for (const order of orders) for (const item of order.items || []) {
        const key = `${item.name || ''} ${item.spec || ''}`.trim()
        totals[key] = (totals[key] || 0) + Number(item.quantity || 0)
      }
      return { batchStationId: station._id, summary: Object.entries(totals).map(([sku, count]) => ({ sku, count })), orders }
    })
    return result.error ? failure(input, t, result.error[0], result.error[1]) : success(input, t, result)
  }

  async function markArrived(input = {}) {
    const t = Number(now())
    const result = await repository.runTransaction(async (tx) => {
      const station = await tx.getBatchStation(input.batchStationId)
      if (!canAccessStation(input.actor, station)) return { error: [ERROR_CODES.FORBIDDEN, '无当前站点权限'] }
      if (station.status !== '已确认配送') return { error: [ERROR_CODES.ORDER_STATE_CONFLICT, '当前站点尚未进入可自提状态'] }
      const window = await tx.getDeliveryWindowByStation(station._id)
      if (!window) return { error: [ERROR_CODES.NOT_FOUND, '自提窗口不存在'] }
      await tx.saveDeliveryWindow(window._id, { arrivedAt: t, arrivedBy: input.actor.openid, updatedAt: t })
      await tx.saveBatchStation(station._id, { status: '自提进行中', arrivedAt: t, arrivedBy: input.actor.openid, updatedAt: t })
      await tx.saveOperationLog(id('op', `${station._id}:arrived`), { action: 'markArrived', batchId: station.batchId, batchStationId: station._id, operatorOpenid: input.actor.openid, createdAt: t })
      return { batchStationId: station._id, arrivedAt: t }
    })
    return result.error ? failure(input, t, result.error[0], result.error[1]) : success(input, t, result)
  }

  async function assignVerifier(input = {}) {
    const t = Number(now())
    if (!isSuperAdmin(input.actor)) return failure(input, t, ERROR_CODES.FORBIDDEN, '仅超级管理员可维护核销员权限')
    const stationIds = [...new Set((input.stationIds || []).map(String).filter(Boolean))]
    if (!String(input.targetOpenid || '').trim() || !stationIds.length) return failure(input, t, ERROR_CODES.INVALID_ARGUMENT, 'targetOpenid和stationIds必填')
    const result = await repository.runTransaction(async (tx) => {
      const targetOpenid = String(input.targetOpenid).trim()
      const existing = await tx.findAdminByOpenid(targetOpenid)
      const target = existing || { _id: id('admin', targetOpenid), openid: targetOpenid, createdAt: t }
      const scope = { batchId: String(input.batchId || ''), stationIds }
      await tx.saveAdmin(target._id, { openid: target.openid, role: 'verifier', status: 'active', stationIds, batchIds: scope.batchId ? [scope.batchId] : [], authorizationScopes: [scope], createdAt: target.createdAt || t, updatedBy: input.actor.openid, updatedAt: t })
      await tx.saveOperationLog(id('op', `${target._id}:assign:${t}`), { action: 'assignVerifier', targetOpenid: target.openid, scope, operatorOpenid: input.actor.openid, createdAt: t })
      return { targetOpenid: target.openid, authorizationScopes: [scope] }
    })
    return result.error ? failure(input, t, ERROR_CODES.NOT_FOUND, result.error) : success(input, t, result)
  }

  async function verifyOrder(input = {}) {
    const t = Number(now())
    const method = String(input.method || '').trim()
    const images = proofImages(input)
    if (!input.batchStationId || !['scan', 'tail', 'manual'].includes(method) || !images) return failure(input, t, ERROR_CODES.INVALID_ARGUMENT, 'batchStationId、核销方式和1至3张交付照片必填')
    const result = await repository.runTransaction(async (tx) => {
      const currentStation = await tx.getBatchStation(input.batchStationId)
      if (!canAccessStation(input.actor, currentStation)) return { error: [ERROR_CODES.FORBIDDEN, '无当前站点核销权限'] }
      if (currentStation.verifyMode !== '有人核销') return { error: [ERROR_CODES.ORDER_STATE_CONFLICT, '当前站点不是有人核销模式'] }
      if (!isPickupActive(currentStation)) return { error: [ERROR_CODES.ORDER_STATE_CONFLICT, '当前站点不在可核销状态'] }
      let order = null
      if (method === 'scan') {
        const qrToken = String(input.qrToken || '').trim()
        if (!qrToken) return { error: [ERROR_CODES.INVALID_ARGUMENT, 'qrToken必填'] }
        order = await tx.findOrderByQrToken(qrToken)
      } else if (method === 'tail') {
        const phoneTail = String(input.phoneTail || '').trim()
        if (!/^\d{4}$/.test(phoneTail)) return { error: [ERROR_CODES.INVALID_ARGUMENT, '手机尾号必须为4位数字'] }
        const candidates = (await tx.findOrdersByPhoneTail(currentStation._id, phoneTail)).filter((row) => ['待自提', '已放置待自取'].includes(row.status))
        if (candidates.length > 1) return { ambiguous: true, candidates: candidates.map((row) => ({ orderId: row._id, phoneTail: phoneTailOf(row), contactName: row.contactName || '', items: row.items || [] })) }
        order = candidates[0] || null
      } else {
        if (!input.orderId) return { error: [ERROR_CODES.INVALID_ARGUMENT, 'orderId必填'] }
        order = await tx.getOrder(input.orderId)
      }
      if (!order) return { error: [ERROR_CODES.NOT_FOUND, '未找到可核销订单'] }
      const orderStation = await tx.getBatchStation(order.batchStationId)
      const cross = order.batchStationId !== currentStation._id
      if (cross) {
        if (!isSuperAdmin(input.actor)) return { error: [ERROR_CODES.FORBIDDEN, '普通核销员不能跨站核销'] }
        if (input.crossStationConfirmed !== true || !String(input.reason || '').trim()) return { error: [ERROR_CODES.INVALID_ARGUMENT, '跨站核销必须二次确认并填写原因'] }
      } else if (!canAccessStation(input.actor, orderStation)) return { error: [ERROR_CODES.FORBIDDEN, '无订单所属站点权限'] }
      if (!isPickupActive(orderStation)) return { error: [ERROR_CODES.ORDER_STATE_CONFLICT, '订单所属站点不在可核销状态'] }
      const transition = transitionV17Order({ order, operation: 'verify', now: t })
      if (!transition.ok) return { error: [ERROR_CODES.ORDER_STATE_CONFLICT, transition.reason] }
      await tx.saveOrder(order._id, { ...transition.orderPatch, deliveryImages: images, verifiedBy: input.actor.openid, verifyMethod: method, updatedAt: t })
      await tx.saveVerificationLog(id('verify', `${order._id}:${t}`), { orderId: order._id, batchId: order.batchId, batchStationId: order.batchStationId, currentBatchStationId: currentStation._id, verifierOpenid: input.actor.openid, verifyMethod: method, deliveryImages: images, isCrossStation: cross, reason: cross ? String(input.reason).trim() : '', verifiedAt: t, createdAt: t })
      return { orderId: order._id, status: '已完成', isCrossStation: cross }
    })
    return result.error ? failure(input, t, result.error[0], result.error[1]) : success(input, t, result)
  }

  async function contactOrder(input = {}) {
    const t = Number(now())
    if (!input.orderId || !String(input.contactStatus || '').trim()) return failure(input, t, ERROR_CODES.INVALID_ARGUMENT, 'orderId和联系状态必填')
    const result = await repository.runTransaction(async (tx) => {
      const order = await tx.getOrder(input.orderId)
      const station = order && await tx.getBatchStation(order.batchStationId)
      if (!order || !canAccessStation(input.actor, station)) return { error: [ERROR_CODES.FORBIDDEN, '订单不存在或无站点权限'] }
      if (!isPickupActive(station)) return { error: [ERROR_CODES.ORDER_STATE_CONFLICT, '当前站点不在自提状态'] }
      if (order.status !== '待自提') return { error: [ERROR_CODES.ORDER_STATE_CONFLICT, '当前订单无需迟到联系'] }
      const window = await tx.getDeliveryWindowByStation(station._id)
      const arriveAt = windowArriveAt(window)
      const leaveAt = windowLeaveAt(window)
      if (!window || !Number.isFinite(arriveAt) || !Number.isFinite(leaveAt) || t < arriveAt || t > leaveAt) return { error: [ERROR_CODES.ORDER_STATE_CONFLICT, '只能在自提窗口内记录迟到联系'] }
      const status = String(input.contactStatus).trim()
      const note = String(input.note || '').trim()
      await tx.saveOrder(order._id, { latestContactStatus: status, latestContactNote: note, latestContactAt: t, updatedAt: t })
      await tx.saveContactLog(id('contact', `${order._id}:${t}`), { orderId: order._id, batchId: order.batchId, batchStationId: order.batchStationId, contactStatus: status, note, operatorOpenid: input.actor.openid, contactedAt: t, createdAt: t })
      return { orderId: order._id, phone: order.phone, contactStatus: status }
    })
    return result.error ? failure(input, t, result.error[0], result.error[1]) : success(input, t, result)
  }

  async function placeOrderAtLocation(input = {}) {
    const t = Number(now())
    const images = proofImages(input)
    const locationNote = String(input.locationNote || '').trim()
    const orderIds = [...new Set((input.orderIds || (input.orderId ? [input.orderId] : [])).map(String).filter(Boolean))]
    if (!input.batchStationId || !orderIds.length || !locationNote || !images) return failure(input, t, ERROR_CODES.INVALID_ARGUMENT, '站点、订单、固定地点说明和1至3张现场照片必填')
    const result = await repository.runTransaction(async (tx) => {
      const station = await tx.getBatchStation(input.batchStationId)
      if (!canAccessStation(input.actor, station)) return { error: [ERROR_CODES.FORBIDDEN, '站点不存在或无站点权限'] }
      if (station.verifyMode !== '无人放置') return { error: [ERROR_CODES.ORDER_STATE_CONFLICT, '当前站点不是无人放置模式'] }
      if (!isPickupActive(station)) return { error: [ERROR_CODES.ORDER_STATE_CONFLICT, '当前站点不在自提状态'] }
      const rows = []
      for (const orderId of orderIds) {
        const order = await tx.getOrder(orderId)
        if (!order || order.batchStationId !== station._id) return { error: [ERROR_CODES.INVALID_ARGUMENT, '订单不属于当前站点'] }
        const transition = transitionV17Order({ order, operation: 'place', now: t })
        if (!transition.ok) return { error: [ERROR_CODES.ORDER_STATE_CONFLICT, transition.reason] }
        rows.push({ order, transition })
      }
      for (const { order, transition } of rows) {
        await tx.saveOrder(order._id, { ...transition.orderPatch, deliveryImages: images, placementLocationNote: locationNote, placementImages: images, placedBy: input.actor.openid, updatedAt: t })
        await tx.saveNotification(id('notice', `${order._id}:placed`), { type: 'orderPlaced', orderId: order._id, status: '待发送', createdAt: t, updatedAt: t })
      }
      await tx.savePlacementLog(id('placement', `${station._id}:${t}`), { orderIds, batchId: station.batchId, batchStationId: station._id, locationNote, images, operatorOpenid: input.actor.openid, placedAt: t, createdAt: t })
      return { orderIds, status: '已放置待自取', placedAt: t }
    })
    return result.error ? failure(input, t, result.error[0], result.error[1]) : success(input, t, result)
  }

  async function finishNoShow(input = {}) {
    const t = Number(now())
    const images = proofImages(input)
    const orderIds = [...new Set((input.orderIds || []).map(String).filter(Boolean))]
    if (!input.batchStationId || !orderIds.length || !images) return failure(input, t, ERROR_CODES.INVALID_ARGUMENT, '站点、订单和1至3张交付照片必填')
    const result = await repository.runTransaction(async (tx) => {
      const station = await tx.getBatchStation(input.batchStationId)
      if (!canAccessStation(input.actor, station)) return { error: [ERROR_CODES.FORBIDDEN, '站点不存在或无站点权限'] }
      if (station.verifyMode !== '有人核销') return { error: [ERROR_CODES.ORDER_STATE_CONFLICT, '仅有人核销站点可处理未取订单'] }
      const window = await tx.getDeliveryWindowByStation(station._id)
      if (!window || !Number.isFinite(windowLeaveAt(window)) || t < windowLeaveAt(window)) return { error: [ERROR_CODES.ORDER_STATE_CONFLICT, '自提窗口结束后才能处理未取订单'] }
      const orders = []
      for (const orderId of orderIds) {
        const order = await tx.getOrder(orderId)
        if (!order || order.batchStationId !== station._id || order.status !== '待自提') return { error: [ERROR_CODES.ORDER_STATE_CONFLICT, '存在非本站待自提订单'] }
        orders.push(order)
      }
      for (const order of orders) await tx.saveOrder(order._id, { status: '已完成未取', completedAt: t, noShowAt: t, deliveryImages: images, completedBy: input.actor.openid, updatedAt: t })
      await tx.saveOperationLog(id('op', `${station._id}:no-show:${t}`), { action: 'finishNoShow', batchId: station.batchId, batchStationId: station._id, orderIds, images, operatorOpenid: input.actor.openid, createdAt: t })
      return { batchStationId: station._id, orderIds, status: '已完成未取' }
    })
    return result.error ? failure(input, t, result.error[0], result.error[1]) : success(input, t, result)
  }

  async function endPickupSession(input = {}) {
    const t = Number(now())
    if (!input.batchStationId) return failure(input, t, ERROR_CODES.INVALID_ARGUMENT, 'batchStationId必填')
    const result = await repository.runTransaction(async (tx) => {
      const station = await tx.getBatchStation(input.batchStationId)
      if (!canAccessStation(input.actor, station)) return { error: [ERROR_CODES.FORBIDDEN, '无当前站点权限'] }
      if (station.status === '已完成') return { batchStationId: station._id, status: station.status, idempotent: true }
      if (!isPickupActive(station)) return { error: [ERROR_CODES.ORDER_STATE_CONFLICT, '当前站点不可结束自提'] }
      const window = await tx.getDeliveryWindowByStation(station._id)
      if (!window || !Number.isFinite(windowLeaveAt(window))) return { error: [ERROR_CODES.NOT_FOUND, '自提窗口不存在或时间无效'] }
      if (t < windowLeaveAt(window) && !(isSuperAdmin(input.actor) && input.earlyEndConfirmed === true && String(input.reason || '').trim())) {
        return { error: [ERROR_CODES.ORDER_STATE_CONFLICT, '自提窗口结束前不能结束本场'] }
      }
      const pending = await tx.listOrdersByStation(station._id, ['待自提'])
      if (pending.length) return { error: [ERROR_CODES.ORDER_STATE_CONFLICT, '仍有待自提订单未处理'], pendingCount: pending.length }
      await tx.saveBatchStation(station._id, { status: '已完成', pickupEndedAt: t, pickupEndedBy: input.actor.openid, pickupEndReason: String(input.reason || '').trim(), updatedAt: t })
      if (typeof tx.listBatchStations === 'function' && typeof tx.saveBatch === 'function') {
        const batchStations = await tx.listBatchStations(station.batchId)
        const allTerminal = batchStations.every((row) => row._id === station._id || ['已完成', '已关闭'].includes(row.status))
        if (allTerminal) await tx.saveBatch(station.batchId, { status: '已结束', endedAt: t, updatedAt: t })
      }
      await tx.saveOperationLog(id('op', `${station._id}:pickup-end`), { action: 'endPickupSession', batchId: station.batchId, batchStationId: station._id, operatorOpenid: input.actor.openid, reason: String(input.reason || '').trim(), createdAt: t })
      return { batchStationId: station._id, status: '已完成' }
    })
    if (result.error) return failure(input, t, result.error[0], result.error[1], result.pendingCount ? { pendingCount: result.pendingCount } : {})
    return success(input, t, result)
  }

  return { getWorkspace, getPrepList, markArrived, assignVerifier, verifyOrder, contactOrder, placeOrderAtLocation, finishNoShow, endPickupSession }
}

module.exports = { createFulfillmentActions, canAccessStation }
