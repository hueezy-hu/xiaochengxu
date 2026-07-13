const app = getApp()
Page({
  data: { allowed: false, role: '', isSuperAdmin: false, stationCards: [], verifierOpenid: '', verifierBatchId: '', verifierStationIds: '', nudgeCount: 0, businessStatus: '未开团', pendingRefundRequests: [] },
  onShow() { this.guard().then((ok) => ok && this.load()) },
  async guard() { const res = await app.call('checkAdmin'); if (!res.ok || !res.isAdmin) { wx.switchTab({ url: '/pages/mine/mine' }); return false } this.setData({ allowed: true, role: res.role, isSuperAdmin: res.role === 'superAdmin' }); return true },
  async load() { const [res, home] = await Promise.all([app.call('getVerifierWorkspace'), app.call('getHomeStatus')]); if (!res.ok) return; this.setData({ nudgeCount: home.ok ? Number(home.nudgeCount || 0) : 0, businessStatus: home.ok ? home.businessStatus : '未开团', pendingRefundRequests: res.pendingRefundRequests || [], stationCards: (res.batchStations || []).map((row) => ({ ...row, name: row.stationName || row.stationId, pendingCount: (row.orders || []).filter((order) => order.status === '待自提').length, peopleProgress: `已拼 ${Number(row.paidUserCount || 0)}/${Number(row.thresholdN || 5)} 人` })) }) },
  goBack() { wx.switchTab({ url: '/pages/mine/mine' }) },
  goProducts() { wx.navigateTo({ url: '/pages/adminProducts/adminProducts' }) },
  goBatch() { wx.navigateTo({ url: '/pages/adminBatch/adminBatch' }) },
  goVerify() { wx.navigateTo({ url: '/pages/adminVerify/adminVerify' }) },
  goStations() { wx.navigateTo({ url: '/pages/adminStations/adminStations' }) },
  async manualConfirm(e) {
    const modal = await new Promise((resolve) => wx.showModal({ title: '确认不足5人仍配送', editable: true, placeholderText: '填写原因', success: resolve }))
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
  async toggleTodayRest() { const d = new Date(); const date = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; const res = await app.call('setTodayRest', { date, rest: this.data.businessStatus !== '今日休息' }); wx.showToast({ title: res.ok ? res.status : (res.msg || '操作失败'), icon: 'none' }); this.load() },
  async resolveRefund(e) { const decision = e.currentTarget.dataset.decision; const orderId = e.currentTarget.dataset.id; const note = decision === 'reject' ? '商家驳回交付后退款申请' : '商家同意交付后退款申请'; const res = await app.call('resolveRefundRequest', { orderId, decision, note }); wx.showToast({ title: res.ok ? '已处理' : (res.msg || '处理失败'), icon: 'none' }); this.load() },
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
