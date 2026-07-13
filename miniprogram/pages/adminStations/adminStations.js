const app = getApp()

const EMPTY = { _id: '', name: '', line: '', exit: '', pickupNote: '', locationImages: [], status: 'active' }

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
    if (st) this.setData({ form: { _id: st._id, name: st.name || '', line: st.line || '', exit: st.exit || '', pickupNote: st.pickupNote || '', locationImages: st.locationImages || [], status: st.status || 'active' }, editing: true })
  },

  newStation() { this.setData({ form: { ...EMPTY }, editing: true }) },

  onInput(e) {
    const key = e.currentTarget.dataset.key
    this.setData({ ['form.' + key]: e.detail.value })
  },

  toggleStatus() {
    this.setData({ 'form.status': this.data.form.status === 'active' ? 'disabled' : 'active' })
  },

  async addImage() {
    const images = this.data.form.locationImages || []; if (images.length >= 3) return
    const picked = await new Promise((resolve) => wx.chooseMedia({ count: 3 - images.length, mediaType: ['image'], success: resolve, fail: () => resolve(null) })); if (!picked) return
    const uploaded = []
    for (const file of picked.tempFiles) { const up = await wx.cloud.uploadFile({ cloudPath: `stations/${Date.now()}-${uploaded.length}.jpg`, filePath: file.tempFilePath }); uploaded.push(up.fileID) }
    this.setData({ 'form.locationImages': images.concat(uploaded) })
  },
  removeImage(e) { this.setData({ 'form.locationImages': this.data.form.locationImages.filter((_, index) => index !== Number(e.currentTarget.dataset.index)) }) },

  async save() {
    const f = this.data.form
    if (!f.name) { wx.showToast({ title: '站名必填', icon: 'none' }); return }
    const res = await app.call('saveStation', { station: f })
    wx.showToast({ title: res.ok ? '已保存' : (res.msg || '失败'), icon: res.ok ? 'success' : 'none' })
    if (res.ok) { this.setData({ editing: false, form: { ...EMPTY } }); this.load() }
  },

  cancelEdit() { this.setData({ editing: false, form: { ...EMPTY } }) },
  goBack() { wx.navigateBack() },
  onShareAppMessage() { return { title: '泰斓 TAILAN 站点管理', path: '/pages/mine/mine' } },
  onShareTimeline() { return { title: '泰斓 TAILAN · 地铁站拼团自提' } }
})
