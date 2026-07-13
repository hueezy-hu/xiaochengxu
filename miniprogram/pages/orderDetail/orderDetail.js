const app = getApp()
const QRCode = require('../../libs/weapp-qrcode')

function refundText(order) {
  if (!order) return ''
  if (order.status === '退款处理中' || order.refundStatus === '待退款') return '退款处理中'
  if (order.status === '已退款' || order.refundStatus === '已退款') return '已退款 ' + app.money(order.amount) + ' 原路退回'
  return ''
}

Page({
  data: { loading: true, order: null, station: {}, deliveryWindow: {}, locationImages: [], canRefund: false, refundText: '' },
  onLoad(options) { this.options = options || {}; this.load() },
  async load() {
    const orderId = this.options.orderId || this.options.id
    if (!orderId) { this.setData({ loading: false }); return }
    const res = await app.call('getOrderDetail', { orderId })
    if (!res.ok) { wx.showToast({ title: res.msg || '订单不存在', icon: 'none' }); this.setData({ loading: false }); return }
    const order = { ...res.order, amountText: app.money(res.order.amount), firstItem: (res.order.items && res.order.items[0]) || {} }
    const deliveryWindow = res.deliveryWindow || {}
    const locationImages = order.status === '已放置待自取' ? (order.placementImages || []) : (deliveryWindow.locationImages || [])
    this.setData({ loading: false, order, station: res.station || {}, deliveryWindow, locationImages, canRefund: ['待配送确认', '待自提'].includes(order.status), refundText: refundText(order) })
    this.drawQr()
  },
  drawQr() {
    if (!this.data.order || !this.data.order.verifyCode) return
    try { const ctx = wx.createCanvasContext('ticketQr', this); new QRCode({ text: this.data.order.verifyCode, size: 220 }).draw(ctx) } catch (err) {}
  },
  async requestRefund() {
    const confirmed = await new Promise((resolve) => wx.showModal({ title: '确认整单退款？', content: '完成核销或固定地点放置后不能退款；不支持顺延。', success: (r) => resolve(r.confirm) }))
    if (!confirmed) return
    const res = await app.call('requestRefund', { orderId: this.data.order._id, reason: '用户申请退款' })
    wx.showToast({ title: res.ok ? '退款已提交' : (res.msg || '操作失败'), icon: 'none' })
    if (res.ok) this.load()
  },
  goBack() { wx.navigateBack() },
  onShareAppMessage() { return { title: '泰斓 TAILAN · 去点单', path: '/pages/catalog/catalog' } },
  onShareTimeline() { return { title: '泰斓 TAILAN · 泰式斑斓甜品' } }
})
