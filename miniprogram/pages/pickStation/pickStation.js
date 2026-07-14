const app = getApp()
const { formatPickupTime } = require('../../utils/pickup-time')
Page({
  data: { loading: true, stations: [], selectedId: '', batchId: '', items: [], summaryText: '' },
  onLoad(options = {}) { const items = wx.getStorageSync('checkoutItems') || []; this.setData({ batchId: options.batchId || '', items, summaryText: items.map((row) => `${row.name}×${row.quantity}`).join('、') }); this.load() },
  async load() {
    const res = await app.call('getStationOptions', { batchId: this.data.batchId })
    if (!res.ok) { this.setData({ loading: false }); wx.showModal({ title: '站点读取失败', content: res.msg || '请稍后重试', showCancel: false }); return }
    const stationById = {}; (res.stations || []).forEach((row) => { stationById[row._id] = row })
    const windowById = {}; (res.deliveryWindows || []).forEach((row) => { windowById[row.batchStationId] = row })
    const stations = (res.batchStations || []).map((bs) => {
      const station = stationById[bs.stationId] || {}; const window = windowById[bs._id] || {}
      const paid = Number(bs.paidUserCount || 0); const threshold = Number(bs.thresholdN || 5)
      return { ...bs, stationName: station.name || bs.stationName, line: station.line || '', exit: station.exit || '', verifyMode: bs.verifyMode || station.verifyMode || '有人核销', paid, threshold, percent: Math.min(100, Math.round(paid / threshold * 100)), leftText: paid >= threshold ? '已成团' : `还差 ${threshold - paid} 人`, pickupTimeText: formatPickupTime(window), locationNote: window.locationNote || station.pickupNote || '' }
    })
    this.setData({ loading: false, stations })
  },
  selectStation(e) { this.setData({ selectedId: e.currentTarget.dataset.id }) },
  next() { if (!this.data.selectedId || !this.data.items.length) return; wx.navigateTo({ url: '/pages/checkout/checkout?batchStationId=' + this.data.selectedId }) },
  goBack() { wx.navigateBack() }
})
