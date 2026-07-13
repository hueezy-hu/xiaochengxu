const app = getApp()
Page({
  data: { allowed: false, role: '', code: '', stationOptions: [], stationIndex: 0, batchStationId: '', prepSummary: [], orders: [], doneCount: 0, totalCount: 0, percent: 0 },
  onShow() { this.guard().then((ok) => ok && this.loadStations()) },
  async guard() { const res = await app.call('checkAdmin'); if (!res.ok || !res.isAdmin) { wx.navigateBack(); return false } this.setData({ allowed: true, role: res.role }); return true },
  async loadStations() {
    const res = await app.call('getVerifierWorkspace'); if (!res.ok) return
    const options = (res.batchStations || []).filter((row) => ['已确认配送', '自提进行中'].includes(row.status)).map((row) => ({ id: row._id, label: `${row.stationName || row.stationId} · ${row.status}` }))
    if (!options.length) { this.setData({ stationOptions: [], batchStationId: '', orders: [] }); return }
    this.setData({ stationOptions: options, stationIndex: 0, batchStationId: options[0].id }, () => this.loadPrep())
  },
  onStationChange(e) { const index = Number(e.detail.value); this.setData({ stationIndex: index, batchStationId: this.data.stationOptions[index].id }, () => this.loadPrep()) },
  async loadPrep() {
    const res = await app.call('prepList', { batchStationId: this.data.batchStationId }); if (!res.ok) return
    const orders = res.orders || []; const done = orders.filter((row) => ['已完成', '已放置待自取'].includes(row.status)).length
    this.setData({ prepSummary: res.summary || [], orders, doneCount: done, totalCount: orders.length, percent: orders.length ? Math.round(done / orders.length * 100) : 0 })
  },
  goBack() { wx.navigateBack() }, onCode(e) { this.setData({ code: e.detail.value }) },
  parseScanCode(value) { try { const parsed = JSON.parse(value); if (parsed.verifyCode) return String(parsed.verifyCode) } catch (err) {} const match = String(value || '').match(/\d{6}/); return match ? match[0] : '' },
  scanCode() { wx.scanCode({ success: (res) => { const code = this.parseScanCode(res.result); if (code) this.setData({ code }, () => this.verify('scan')) } }) },
  async verify(method) {
    if (this._verifying || this.data.code.length !== 6) return
    this._verifying = true
    let res = await app.call('verifyOrder', { batchStationId: this.data.batchStationId, code: this.data.code, method: typeof method === 'string' ? method : 'input' })
    if (!res.ok && this.data.role === 'superAdmin' && /跨站/.test(res.msg || '')) {
      const modal = await new Promise((resolve) => wx.showModal({ title: '异常跨站核销', editable: true, placeholderText: '确认后填写原因', success: resolve }))
      if (modal.confirm && modal.content.trim()) res = await app.call('verifyOrder', { batchStationId: this.data.batchStationId, code: this.data.code, method: typeof method === 'string' ? method : 'input', crossStationConfirmed: true, reason: modal.content.trim() })
    }
    this._verifying = false; wx.showToast({ title: res.ok ? '核销成功' : (res.msg || '核销失败'), icon: res.ok ? 'success' : 'none' }); if (res.ok) this.setData({ code: '' }); this.loadPrep()
  },
  async markArrived() { const res = await app.call('markArrived', { batchStationId: this.data.batchStationId }); wx.showToast({ title: res.ok ? '已开始自提' : (res.msg || '失败'), icon: 'none' }); this.loadStations() },
  async contact(e) {
    const modal = await new Promise((resolve) => wx.showModal({ title: '记录迟到联系', editable: true, placeholderText: '如：已接通，约定放A口', success: resolve }))
    if (!modal.confirm) return
    const res = await app.call('contactOrder', { orderId: e.currentTarget.dataset.id, contactStatus: '已联系', note: modal.content || '' }); wx.showToast({ title: res.ok ? '已记录' : (res.msg || '失败'), icon: 'none' })
  },
  async place(e) {
    const modal = await new Promise((resolve) => wx.showModal({ title: '固定地点放置', editable: true, placeholderText: '填写具体地点', success: resolve }))
    if (!modal.confirm || !modal.content.trim()) return
    const picked = await new Promise((resolve) => wx.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['camera', 'album'], success: resolve, fail: () => resolve(null) })); if (!picked) return
    const up = await wx.cloud.uploadFile({ cloudPath: `placement/${e.currentTarget.dataset.id}-${Date.now()}.jpg`, filePath: picked.tempFiles[0].tempFilePath })
    const res = await app.call('placeOrderAtLocation', { orderId: e.currentTarget.dataset.id, locationNote: modal.content.trim(), images: [up.fileID] }); wx.showToast({ title: res.ok ? '已放置并记录' : (res.msg || '失败'), icon: 'none' }); this.loadPrep()
  },
  async endPickup() {
    let res = await app.call('endPickupSession', { batchStationId: this.data.batchStationId })
    if (!res.ok && this.data.role === 'superAdmin' && /窗口结束前/.test(res.msg || '')) {
      const modal = await new Promise((resolve) => wx.showModal({ title: '异常提前结束', editable: true, placeholderText: '二次确认并填写原因', success: resolve }))
      if (modal.confirm && modal.content.trim()) res = await app.call('endPickupSession', { batchStationId: this.data.batchStationId, earlyEndConfirmed: true, reason: modal.content.trim() })
    }
    wx.showToast({ title: res.ok ? '本场已完成' : (res.msg || '仍有订单未处理'), icon: 'none' }); if (res.ok) this.loadStations()
  },
  onShareAppMessage() { return { title: '泰斓 TAILAN · 去点单', path: '/pages/catalog/catalog' } }
})
