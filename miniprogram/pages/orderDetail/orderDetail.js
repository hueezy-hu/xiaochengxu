const app = getApp()
const QRCode = require('../../libs/weapp-qrcode')
const { showsPickupTicket } = require('../../utils/status')
const { formatPickupTime } = require('../../utils/pickup-time')

function refundText(order) {
  if (!order) return ''
  if (order.status === '退款处理中' || order.refundStatus === '待退款') return '退款处理中'
  if (order.status === '已退款' || order.refundStatus === '已退款') return '已退款 ' + app.money(order.amount) + ' 原路退回'
  return ''
}

function phoneTailOf(order) {
  return String(order.phoneTail || String(order.phone || '').slice(-4))
}

function showContactPhoneTail(order, showPickupTicket) {
  if (!order || showPickupTicket || !phoneTailOf(order)) return false
  return !['已取消', '已超时', '退款处理中', '已退款'].includes(order.status)
}

Page({
  data: { loading: true, order: null, station: {}, deliveryWindow: {}, pickupTimeText: '取货时间待确认', locationImages: [], showPickupTicket: false, showContactPhoneTail: false, canSelfRefund: false, canApplyRefund: false, refundText: '' },
  onLoad(options) { this.options = options || {}; this.load() },
  async load() {
    const orderId = this.options.orderId || this.options.id
    if (!orderId) { this.setData({ loading: false }); return }
    const res = await app.call('getOrderDetail', { orderId })
    if (!res.ok) { wx.showToast({ title: res.msg || '订单不存在', icon: 'none' }); this.setData({ loading: false }); return }
    const order = { ...res.order, phoneTail: phoneTailOf(res.order), verifyMode: res.order.verifyMode || (res.batchStation && res.batchStation.verifyMode) || '有人核销', amountText: app.money(res.order.amount), firstItem: (res.order.items && res.order.items[0]) || {} }
    const deliveryWindow = res.deliveryWindow || {}
    const locationImages = order.deliveryImages || order.placementImages || deliveryWindow.locationImages || []
    const showPickupTicket = showsPickupTicket(order.status)
    this.setData({ loading: false, order, station: res.station || {}, deliveryWindow, pickupTimeText: formatPickupTime(deliveryWindow), locationImages, showPickupTicket, showContactPhoneTail: showContactPhoneTail(order, showPickupTicket), canSelfRefund: ['待配送确认', '待自提'].includes(order.status), canApplyRefund: ['已完成', '已放置待自取', '已完成未取'].includes(order.status), refundText: refundText(order) }, () => {
      if (showPickupTicket) this.drawQr()
    })
  },
  drawQr() {
    if (!this.data.order || !this.data.order.pickupQrToken) return
    try { const ctx = wx.createCanvasContext('ticketQr', this); new QRCode({ text: this.data.order.pickupQrToken, size: 220 }).draw(ctx) } catch (err) {}
  },
  async requestRefund() {
    const confirmed = await new Promise((resolve) => wx.showModal({ title: '确认整单退款？', content: '完成核销或固定地点放置后不能退款；不支持顺延。', success: (r) => resolve(r.confirm) }))
    if (!confirmed) return
    const res = await app.call('requestRefund', { orderId: this.data.order._id, reason: '用户申请退款' })
    wx.showToast({ title: res.ok ? '退款已提交' : (res.msg || '操作失败'), icon: 'none' })
    if (res.ok) this.load()
  },
  async applyRefundRequest() {
    const reason = await new Promise((resolve) => wx.showModal({ title: '申请退款', editable: true, placeholderText: '请说明交付后的退款原因', success: (r) => resolve(r.confirm ? String(r.content || '').trim() : '') }))
    if (!reason) return
    const res = await app.call('applyRefundRequest', { orderId: this.data.order._id, reason })
    wx.showToast({ title: res.ok ? '已提交人工处理' : (res.msg || '提交失败'), icon: 'none' })
    if (res.ok) this.load()
  },
  goBack() { wx.navigateBack() },
  onShareAppMessage() {
    const batchStationId = this.data.order && this.data.order.batchStationId
    return { title: '泰斓 TAILAN · 地铁站拼团自提', path: batchStationId ? `/pages/groupPage/groupPage?batchStationId=${encodeURIComponent(batchStationId)}` : '/pages/catalog/catalog' }
  },
  onShareTimeline() { return { title: '泰斓 TAILAN · 泰式斑斓甜品' } }
})
