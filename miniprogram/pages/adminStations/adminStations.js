const app = getApp()

const EMPTY = { _id: '', name: '', line: '', exit: '', pickupNote: '', arriveAt: '18:00', leaveAt: '19:00', verifyMode: '有人核销', defaultLocationImages: [], status: 'active' }

Page({
  data: { allowed: false, stations: [], form: { ...EMPTY }, editing: false },

  onShow() { this.guard().then((ok) => ok && this.load()) },

  async guard() {
    const res = await app.call('checkAdmin')
    if (!res.ok || res.role !== 'superAdmin') { wx.showToast({ title: '仅超级管理员可访问', icon: 'none' }); setTimeout(() => wx.navigateBack(), 500); return false }
    this.setData({ allowed: true })
    return true
  },

  async load() {
    const res = await app.call('listStations')
    if (res.ok) this.setData({ stations: res.stations || [] })
  },

  pickStation(e) {
    const st = this.data.stations.find((x) => x._id === e.currentTarget.dataset.id)
    if (st) this.setData({ form: { _id: st._id, name: st.name || '', line: st.line || '', exit: st.exit || '', pickupNote: st.pickupNote || '', arriveAt: st.arriveAt || '18:00', leaveAt: st.leaveAt || '19:00', verifyMode: st.verifyMode || '有人核销', defaultLocationImages: st.defaultLocationImages || st.locationImages || [], status: st.status || 'active' }, editing: true })
  },

  newStation() { this.setData({ form: { ...EMPTY }, editing: true }) },

  onInput(e) {
    const key = e.currentTarget.dataset.key
    this.setData({ ['form.' + key]: e.detail.value })
  },

  toggleStatus() {
    this.setData({ 'form.status': this.data.form.status === 'active' ? 'inactive' : 'active' })
  },
  toggleVerifyMode() { this.setData({ 'form.verifyMode': this.data.form.verifyMode === '有人核销' ? '无人放置' : '有人核销' }) },

  async addImage() {
    const images = this.data.form.defaultLocationImages || []; if (images.length >= 3) return
    const picked = await new Promise((resolve) => wx.chooseMedia({ count: 3 - images.length, mediaType: ['image'], success: resolve, fail: () => resolve(null) })); if (!picked) return
    const uploaded = []
    for (const file of picked.tempFiles) { const up = await wx.cloud.uploadFile({ cloudPath: `stations/${Date.now()}-${uploaded.length}.jpg`, filePath: file.tempFilePath }); uploaded.push(up.fileID) }
    this.setData({ 'form.defaultLocationImages': images.concat(uploaded) })
  },
  removeImage(e) { this.setData({ 'form.defaultLocationImages': this.data.form.defaultLocationImages.filter((_, index) => index !== Number(e.currentTarget.dataset.index)) }) },

  async save() {
    const f = this.data.form
    if (!f.name || !f.pickupNote || !f.defaultLocationImages.length) { wx.showToast({ title: '站名、地点和图片必填', icon: 'none' }); return }
    const res = await app.call('saveStation', { station: f })
    wx.showToast({ title: res.ok ? '已保存' : (res.msg || '失败'), icon: res.ok ? 'success' : 'none' })
    if (res.ok) { this.setData({ editing: false, form: { ...EMPTY } }); this.load() }
  },
  async deleteStation() { if (!this.data.form._id) return; const res = await app.call('deleteStation', { stationId: this.data.form._id }); wx.showModal({ title: res.ok ? '处理完成' : '处理失败', content: res.ok ? (res.archived ? '站点已有批次引用，已停用。' : '站点已删除。') : (res.msg || '操作失败'), showCancel: false }); if (res.ok) { this.cancelEdit(); this.load() } },

  cancelEdit() { this.setData({ editing: false, form: { ...EMPTY } }) },
  goBack() { wx.navigateBack() },
  onShareAppMessage() { return { title: '泰斓 TAILAN 站点管理', path: '/pages/mine/mine' } },
  onShareTimeline() { return { title: '泰斓 TAILAN · 地铁站拼团自提' } }
})
