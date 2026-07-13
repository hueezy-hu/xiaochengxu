const crypto = require('crypto')

const PENDING = '待发送'
const SENT = '已发送'
const SKIPPED_NO_TEMPLATE = '跳过-无模板'
const SKIPPED_NO_AUTH = '跳过-未授权'
const SKIPPED_NO_TARGET = '跳过-无目标'
const FAILED = '发送失败'

function noticeId(seed) {
  return 'notice-' + crypto.createHash('sha256').update(String(seed)).digest('hex').slice(0, 24)
}

function templateIdForType(type, config = {}) {
  if (type === 'deliveryConfirmed' || type === 'groupResult') return String(config.groupResultTemplateId || '').trim()
  if (type === 'pickupReminder' || type === 'pickupNotice') return String(config.pickupTemplateId || '').trim()
  return ''
}

function authFlagForType(type, order = {}) {
  if (type === 'deliveryConfirmed' || type === 'groupResult') return order.subscribeGroupResult === true
  if (type === 'pickupReminder' || type === 'pickupNotice') return order.subscribePickupNotice === true
  return false
}

function buildSubscribePayload(notice, order, station, templateId) {
  const stationName = (station && station.name) || order.stationName || '取货站'
  const windowText = (order.pickupWindowText || station && station.windowText || '取货窗口').toString()
  if (notice.type === 'deliveryConfirmed' || notice.type === 'groupResult') {
    const success = notice.groupSuccess !== false
    return {
      touser: order.userOpenid,
      templateId,
      page: 'pages/orderDetail/orderDetail?orderId=' + order._id,
      data: {
        thing1: { value: success ? '成团成功' : '未成团已退款' },
        thing2: { value: stationName.slice(0, 20) },
        time3: { value: windowText.slice(0, 20) },
        thing4: { value: success ? '请凭手机尾号到站自取' : '款项将原路退回' }
      }
    }
  }
  return {
    touser: order.userOpenid,
    templateId,
    page: 'pages/orderDetail/orderDetail?orderId=' + order._id,
    data: {
      thing1: { value: '订单可取' },
      thing2: { value: stationName.slice(0, 20) },
      time3: { value: windowText.slice(0, 20) },
      thing4: { value: '请凭手机尾号后4位取货' }
    }
  }
}

function createNotificationOutbox({
  listPending,
  saveNotice,
  listOrdersForNotice,
  getStation,
  getConfig,
  sendSubscribeMessage,
  now = Date.now,
  limit = 20
} = {}) {
  if (typeof listPending !== 'function') throw new Error('listPending is required')
  if (typeof saveNotice !== 'function') throw new Error('saveNotice is required')
  if (typeof listOrdersForNotice !== 'function') throw new Error('listOrdersForNotice is required')
  if (typeof getConfig !== 'function') throw new Error('getConfig is required')
  if (typeof sendSubscribeMessage !== 'function') throw new Error('sendSubscribeMessage is required')

  async function processPendingNotifications(input = {}) {
    const t = Number(now())
    const config = (await getConfig()) || {}
    const pending = await listPending(Number(input.limit || limit))
    let sent = 0
    let skipped = 0
    let failed = 0
    for (const notice of pending || []) {
      if (!notice || !notice._id) continue
      if (notice.status && notice.status !== PENDING) continue
      const templateId = templateIdForType(notice.type, config)
      if (!templateId) {
        await saveNotice(notice._id, {
          ...notice,
          status: SKIPPED_NO_TEMPLATE,
          lastError: '模板ID未配置',
          processedAt: t,
          updatedAt: t
        })
        skipped += 1
        continue
      }
      const orders = await listOrdersForNotice(notice)
      if (!orders || !orders.length) {
        await saveNotice(notice._id, {
          ...notice,
          status: SKIPPED_NO_TARGET,
          lastError: '没有可发送订单',
          processedAt: t,
          updatedAt: t
        })
        skipped += 1
        continue
      }
      let noticeSent = 0
      let noticeSkipped = 0
      let noticeFailed = 0
      const errors = []
      for (const order of orders) {
        if (!authFlagForType(notice.type, order)) {
          noticeSkipped += 1
          continue
        }
        const station = typeof getStation === 'function'
          ? await getStation(order.stationId || notice.stationId)
          : null
        const payload = buildSubscribePayload(notice, order, station, templateId)
        try {
          await sendSubscribeMessage(payload)
          noticeSent += 1
        } catch (err) {
          noticeFailed += 1
          errors.push((err && err.message) || String(err))
        }
      }
      let status = SENT
      if (noticeSent === 0 && noticeFailed === 0) status = SKIPPED_NO_AUTH
      else if (noticeSent === 0 && noticeFailed > 0) status = FAILED
      // Partial success still marks SENT so authorized users are not re-spammed; failures are logged.
      await saveNotice(notice._id, {
        ...notice,
        status,
        templateId,
        sentCount: noticeSent,
        skippedCount: noticeSkipped,
        failedCount: noticeFailed,
        lastError: errors[0] || '',
        retryCount: Number(notice.retryCount || 0) + (noticeFailed > 0 ? 1 : 0),
        processedAt: t,
        updatedAt: t
      })
      sent += noticeSent
      skipped += noticeSkipped
      failed += noticeFailed
    }
    return { ok: true, processed: (pending || []).length, sent, skipped, failed, serverNow: t }
  }

  return {
    processPendingNotifications,
    templateIdForType,
    authFlagForType,
    buildSubscribePayload,
    noticeId,
    STATUSES: { PENDING, SENT, SKIPPED_NO_TEMPLATE, SKIPPED_NO_AUTH, SKIPPED_NO_TARGET, FAILED }
  }
}

module.exports = {
  createNotificationOutbox,
  noticeId,
  templateIdForType,
  authFlagForType,
  buildSubscribePayload,
  STATUSES: { PENDING, SENT, SKIPPED_NO_TEMPLATE, SKIPPED_NO_AUTH, SKIPPED_NO_TARGET, FAILED }
}
