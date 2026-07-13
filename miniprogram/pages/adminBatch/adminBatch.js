const app = getApp()
function pad(value) { return String(value).padStart(2, '0') }
function dateText(offset) { const d = new Date(Date.now() + offset * 86400000); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }

Page({
  data: { allowed: false, step: 1, draftId: '', revision: 0, name: '泰斓 TAILAN 明日自提批次', saleDate: dateText(0), pickupDate: dateText(1), stations: [], skus: [], selectedStations: {}, selectedSkus: {}, stationWindows: {}, inventoryDraft: {}, submitting: false },
  onShow() { this.guard().then((ok) => ok && !this.data.stations.length && this.load()) },
  async guard() { const res = await app.call('checkAdmin'); if (!res.ok || res.role !== 'superAdmin') { wx.navigateBack(); return false } this.setData({ allowed: true }); return true },
  async load() {
    const [stationRes, productRes] = await Promise.all([app.call('listStations'), app.call('listProducts')])
    const stations = (stationRes.stations || []).filter((row) => row.status === 'active')
    const skus = (productRes.skus || []).filter((row) => row.status === '上架')
    const selectedStations = {}; const selectedSkus = {}; const stationWindows = {}; const inventoryDraft = {}
    stations.forEach((row) => { selectedStations[row._id] = false; stationWindows[row._id] = { arriveAt: '18:00', leaveAt: '19:00', locationNote: row.pickupNote || '', locationImages: row.locationImages || [] } })
    skus.forEach((row) => { selectedSkus[row._id] = false; inventoryDraft[row._id] = 0 })
    this.setData({ stations, skus, selectedStations, selectedSkus, stationWindows, inventoryDraft })
  },
  goBack() { wx.navigateBack() },
  onInput(e) { this.setData({ [e.currentTarget.dataset.key]: e.detail.value }) },
  next() { if (this.data.step < 4) this.setData({ step: this.data.step + 1 }) },
  prev() { if (this.data.step > 1) this.setData({ step: this.data.step - 1 }) },
  toggleStation(e) { const id = e.currentTarget.dataset.id; this.setData({ [`selectedStations.${id}`]: !this.data.selectedStations[id] }) },
  toggleSku(e) { const id = e.currentTarget.dataset.id; this.setData({ [`selectedSkus.${id}`]: !this.data.selectedSkus[id] }) },
  onWindowInput(e) { this.setData({ [`stationWindows.${e.currentTarget.dataset.id}.${e.currentTarget.dataset.key}`]: e.detail.value }) },
  onInventoryInput(e) { this.setData({ [`inventoryDraft.${e.currentTarget.dataset.id}`]: Number(e.detail.value || 0) }) },
  async addWindowImage(e) {
    const id = e.currentTarget.dataset.id; const current = this.data.stationWindows[id].locationImages || []
    if (current.length >= 3) return
    const picked = await new Promise((resolve) => wx.chooseMedia({ count: 3 - current.length, mediaType: ['image'], success: resolve, fail: () => resolve(null) }))
    if (!picked) return
    const uploaded = []
    for (const file of picked.tempFiles) { const up = await wx.cloud.uploadFile({ cloudPath: `pickup/${id}-${Date.now()}-${uploaded.length}.jpg`, filePath: file.tempFilePath }); uploaded.push(up.fileID) }
    this.setData({ [`stationWindows.${id}.locationImages`]: current.concat(uploaded) })
  },
  buildBatch() {
    return {
      _id: this.data.draftId || undefined, name: this.data.name, saleDate: this.data.saleDate, pickupDate: this.data.pickupDate,
      stations: this.data.stations.filter((row) => this.data.selectedStations[row._id]).map((row) => ({ stationId: row._id, ...this.data.stationWindows[row._id] })),
      inventory: this.data.skus.filter((row) => this.data.selectedSkus[row._id]).map((row) => ({ skuId: row._id, totalQty: Number(this.data.inventoryDraft[row._id] || 0), isUnlimited: false }))
    }
  },
  async saveDraft() {
    const res = await app.call('saveBatchDraft', { batch: this.buildBatch() })
    if (res.ok) this.setData({ draftId: res.batchId, revision: res.revision })
    wx.showToast({ title: res.ok ? '草稿已保存' : (res.msg || '保存失败'), icon: 'none' })
    return res
  },
  async publish() {
    if (this.data.submitting) return
    this.setData({ submitting: true })
    const saved = await this.saveDraft()
    if (!saved.ok) { this.setData({ submitting: false }); return }
    const res = await app.call('publishBatch', { batchId: saved.batchId, revision: saved.revision })
    this.setData({ submitting: false })
    wx.showToast({ title: res.ok ? '批次已手动发布' : (res.msg || '发布失败'), icon: res.ok ? 'success' : 'none' })
    if (res.ok) setTimeout(() => wx.navigateBack(), 700)
  }
})
