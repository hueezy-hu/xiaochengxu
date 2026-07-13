const app = getApp()
const { createServerOffset, secondsUntil, cancelFeedback } = require('../../utils/payment-clock')
Page({
  data: { orderId: '', batchStationId: '', secondsLeft: 180, countdownText: '3:00', paying: false, expired: false, feedback: '' },
  onLoad(options = {}) { const clientNow = Date.now(); const serverNow = Number(options.serverNow || clientNow); this.serverOffset = createServerOffset(serverNow, clientNow); this.expiresAt = Number(options.expiresAt || serverNow + 180000); this.setData({ orderId: options.orderId || '', batchStationId: options.batchStationId || '' }); this.tick(); this.timer = setInterval(() => this.tick(), 1000) },
  tick() { const secondsLeft = secondsUntil(this.expiresAt, this.serverOffset); this.setData({ secondsLeft, countdownText: `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}` }); if (!secondsLeft && !this.data.expired) { this.setData({ expired: true, feedback: '预占已超时，请返回重新发起支付。' }); this.clearTimer() } },
  async pay() { if (this.data.paying || this.data.expired) return; this.setData({ paying: true }); const res = await app.call('payOrder', { orderId: this.data.orderId }); this.setData({ paying: false }); if (!res.ok) { this.setData({ feedback: res.msg || '支付取消或失败，请重新发起' }); return } this.clearTimer(); wx.redirectTo({ url: `/pages/paySuccess/paySuccess?orderId=${this.data.orderId}&batchStationId=${this.data.batchStationId}` }) },
  async cancel() { if (this._cancelling) return; this._cancelling = true; const res = await app.call('cancelPendingOrder', { orderId: this.data.orderId }); this._cancelling = false; const feedback = cancelFeedback(res); wx.showToast({ title: feedback.message, icon: 'none' }); if (!feedback.ok) return; this.clearTimer(); setTimeout(() => wx.navigateBack({ delta: 2 }), 300) },
  clearTimer() { if (this.timer) { clearInterval(this.timer); this.timer = null } },
  onUnload() { this.clearTimer() }
})
