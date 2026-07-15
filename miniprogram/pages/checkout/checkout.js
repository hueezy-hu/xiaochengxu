const app = getApp()
const { createRequestId } = require('../../utils/request-id')
const { formatPickupTime } = require('../../utils/pickup-time')
Page({
  data: { items: [], batchStationId: '', stationName: '', pickupTimeText: '取货时间待确认', contactName: '', phone: '', amountText: '由服务器计算', submitting: false, clientRequestId: '' },
  onLoad(options = {}) { const user = app.getLocalProfile(); const items = wx.getStorageSync('checkoutItems') || []; const amount = items.reduce((sum, row) => sum + Number(row.price || 0) * Number(row.quantity || 0), 0); this.setData({ items: items.map((row) => ({ ...row, priceText: app.money(Number(row.price || 0) * Number(row.quantity || 0)) })), batchStationId: options.batchStationId || '', contactName: user.nickname || '', phone: user.phone || '', amountText: app.money(amount), clientRequestId: createRequestId('checkout') }); this.loadPickupContext() },
  async loadPickupContext() { if (!this.data.batchStationId) return; const res = await app.call('getGroupPage', { batchStationId: this.data.batchStationId }); if (!res.ok) return; this.setData({ stationName: (res.station && res.station.name) || '', pickupTimeText: formatPickupTime(res.deliveryWindow || {}) }) },
  onName(e) { this.setData({ contactName: e.detail.value }) }, onPhone(e) { this.setData({ phone: e.detail.value }) },
  async submit() {
    if (this.data.submitting) return
    const contactName = String(this.data.contactName || '').trim(); const phone = String(this.data.phone || '').trim()
    if (!contactName || !app.validPhone(phone) || !this.data.items.length) { wx.showToast({ title: '请完整填写联系人和手机号', icon: 'none' }); return }
    this.setData({ submitting: true })
    await app.saveUserProfile({ nickname: contactName, phone })
    const items = this.data.items.map((row) => ({ skuId: row.skuId, quantity: Number(row.quantity) }))
    const res = await app.call('createOrder', { batchStationId: this.data.batchStationId, items, contactName, phone, clientRequestId: this.data.clientRequestId })
    this.setData({ submitting: false })
    if (!res.ok) { wx.showModal({ title: '无法发起支付', content: res.msg || '请返回购物车检查商品', showCancel: false }); return }
    wx.redirectTo({ url: `/pages/payment/payment?orderId=${res.orderId}&batchStationId=${this.data.batchStationId}&expiresAt=${res.expiresAt || ''}&serverNow=${res.serverNow || ''}` })
  },
  goBack() { wx.navigateBack() }
})
