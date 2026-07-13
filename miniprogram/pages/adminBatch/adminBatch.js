const app = getApp()
function pad(value) { return String(value).padStart(2, '0') }
function dateText(offset) { const d = new Date(Date.now() + offset * 86400000); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
Page({
  data: { allowed: false, draftId: '', revision: 0, name: '泰斓 TAILAN 明日自提批次', saleDate: dateText(0), pickupDate: dateText(1), stations: [], skus: [], selectedStations: {}, selectedSkus: {}, inventoryDraft: {}, submitting: false, latePublishWarning: false },
  onShow() { this.guard().then((ok) => ok && !this.data.stations.length && this.load()) },
  async guard() { const res = await app.call('checkAdmin'); if (!res.ok || res.role !== 'superAdmin') { wx.navigateBack(); return false } this.setData({ allowed: true, latePublishWarning: new Date().getHours() >= 10 }); return true },
  async load() { const [stationRes, productRes] = await Promise.all([app.call('listStations'), app.call('listProducts')]); const stations = (stationRes.stations || []).filter((row) => row.status === 'active'); const skus = (productRes.skus || []).filter((row) => row.status === '上架'); const selectedStations = {}, selectedSkus = {}, inventoryDraft = {}; stations.forEach((row) => { selectedStations[row._id] = false }); skus.forEach((row) => { selectedSkus[row._id] = false; inventoryDraft[row._id] = 0 }); this.setData({ stations, skus, selectedStations, selectedSkus, inventoryDraft }) },
  goBack() { wx.navigateBack() }, onInput(e) { this.setData({ [e.currentTarget.dataset.key]: e.detail.value }) },
  toggleStation(e) { const id = e.currentTarget.dataset.id; this.setData({ [`selectedStations.${id}`]: !this.data.selectedStations[id] }) },
  toggleSku(e) { const id = e.currentTarget.dataset.id; this.setData({ [`selectedSkus.${id}`]: !this.data.selectedSkus[id] }) },
  onInventoryInput(e) { this.setData({ [`inventoryDraft.${e.currentTarget.dataset.id}`]: Number(e.detail.value || 0) }) },
  buildBatch() { return { _id: this.data.draftId || undefined, name: this.data.name, saleDate: this.data.saleDate, pickupDate: this.data.pickupDate, stationIds: this.data.stations.filter((row) => this.data.selectedStations[row._id]).map((row) => row._id), skuRows: this.data.skus.filter((row) => this.data.selectedSkus[row._id]).map((row) => ({ skuId: row._id, totalQty: Number(this.data.inventoryDraft[row._id] || 0) })) } },
  async saveDraft() { const res = await app.call('saveBatchDraft', { batch: this.buildBatch() }); if (res.ok) this.setData({ draftId: res.batchId, revision: res.revision }); wx.showToast({ title: res.ok ? '草稿已保存' : (res.msg || '保存失败'), icon: 'none' }); return res },
  async publish() { if (this.data.submitting) return; this.setData({ submitting: true }); const saved = await this.saveDraft(); if (!saved.ok) { this.setData({ submitting: false }); return } const res = await app.call('publishBatch', { batchId: saved.batchId, revision: saved.revision }); this.setData({ submitting: false }); wx.showModal({ title: res.ok ? '发布成功' : '发布失败', content: res.ok ? (res.latePublishWarning ? '已超过建议的 10:00 发布时间，请留意成团节奏。' : '批次已手动发布。') : (res.msg || '请检查库存和站点资料'), showCancel: false }); if (res.ok) setTimeout(() => wx.navigateBack(), 700) }
})
