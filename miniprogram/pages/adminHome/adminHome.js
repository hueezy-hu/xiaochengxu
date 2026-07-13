const app = getApp()
Page({
  data: { allowed: false, role: '', isSuperAdmin: false, stationCards: [], verifierOpenid: '', verifierBatchId: '', verifierStationIds: '' },
  onShow() { this.guard().then((ok) => ok && this.load()) },
  async guard() { const res = await app.call('checkAdmin'); if (!res.ok || !res.isAdmin) { wx.switchTab({ url: '/pages/mine/mine' }); return false } this.setData({ allowed: true, role: res.role, isSuperAdmin: res.role === 'superAdmin' }); return true },
  async load() { const res = await app.call('getVerifierWorkspace'); if (!res.ok) return; this.setData({ stationCards: (res.batchStations || []).map((row) => ({ ...row, name: row.stationName || row.stationId, pendingCount: (row.orders || []).filter((order) => order.status === '待自提').length })) }) },
  goBack() { wx.switchTab({ url: '/pages/mine/mine' }) },
  goProducts() { wx.navigateTo({ url: '/pages/adminProducts/adminProducts' }) },
  goBatch() { wx.navigateTo({ url: '/pages/adminBatch/adminBatch' }) },
  goVerify() { wx.navigateTo({ url: '/pages/adminVerify/adminVerify' }) },
  goStations() { wx.navigateTo({ url: '/pages/adminStations/adminStations' }) },
  async manualConfirm(e) {
    const modal = await new Promise((resolve) => wx.showModal({ title: '确认不足5件仍配送', editable: true, placeholderText: '填写原因', success: resolve }))
    if (!modal.confirm || !modal.content.trim()) return
    const res = await app.call('manualConfirmDelivery', { batchStationId: e.currentTarget.dataset.id, reason: modal.content.trim() })
    wx.showToast({ title: res.ok ? '已确认配送' : (res.msg || '操作失败'), icon: 'none' }); this.load()
  },
  async closeStation(e) {
    const modal = await new Promise((resolve) => wx.showModal({ title: '关闭这个站点并退款', editable: true, placeholderText: '填写关闭原因', success: resolve }))
    if (!modal.confirm || !modal.content.trim()) return
    const res = await app.call('closeBatchStation', { batchStationId: e.currentTarget.dataset.id, reason: modal.content.trim() })
    wx.showToast({ title: res.ok ? res.status : (res.msg || '操作失败'), icon: 'none' }); this.load()
  },
  async closeBatch(e) {
    const modal = await new Promise((resolve) => wx.showModal({ title: '关闭整个批次并退款', editable: true, placeholderText: '填写整批关闭原因', success: resolve }))
    if (!modal.confirm || !modal.content.trim()) return
    const res = await app.call('closeBatch', { batchId: e.currentTarget.dataset.id, reason: modal.content.trim() })
    wx.showToast({ title: res.ok ? res.status : (res.msg || '操作失败'), icon: 'none' }); this.load()
  },
  onAuthInput(e) { this.setData({ [e.currentTarget.dataset.key]: e.detail.value }) },
  async assignVerifier() {
    const stationIds = this.data.verifierStationIds.split(/[,，]/).map((value) => value.trim()).filter(Boolean)
    const res = await app.call('assignVerifier', { targetOpenid: this.data.verifierOpenid.trim(), batchId: this.data.verifierBatchId.trim(), stationIds })
    wx.showToast({ title: res.ok ? '授权已保存' : (res.msg || '授权失败'), icon: 'none' })
  }
})
