const app = getApp()
const AVATAR_POOL = ['🍰', '🥥', '🍃', '😋', '🧋', '🌿']

Page({
  data: {
    loading: true,
    batchStation: null,
    station: {},
    isLeader: false,
    progressText: '',
    leftText: '',
    percent: 0,
    memberCount: 0,
    memberInitials: [],
    skus: [],
    invMap: {},
    canBuy: false
  },

  onLoad(options) {
    this.options = options || {}
    this.load()
  },

  async load() {
    const id = this.options.batchStationId
    if (!id) {
      wx.showToast({ title: '缺少团信息', icon: 'none' })
      this.setData({ loading: false })
      return
    }
    const [group, catalog] = await Promise.all([
      app.call('getGroupPage', { batchStationId: id }),
      app.call('getCatalogPage')
    ])
    if (!group.ok) {
      wx.showToast({ title: group.msg || '团不存在', icon: 'none' })
      this.setData({ loading: false })
      return
    }
    const bs = group.batchStation
    const paid = Number(bs.paidItemCount || 0)
    const threshold = Number(bs.thresholdN || 0)
    const left = Math.max(0, threshold - paid)
    const memberCount = Number(bs.paidOrderCount || 0)
    const invMap = {}
    if (catalog.ok) {
      for (const inv of catalog.inventory || []) invMap[inv.skuId] = inv
    }
    const skus = catalog.ok ? (catalog.skus || []).map((s) => {
      const inv = invMap[s._id] || {}
      const leftQty = inv.isUnlimited ? 999 : Number(inv.availableQty || 0)
      return {
        ...s,
        priceText: app.money(s.price),
        leftQty: leftQty,
        stockText: inv.isUnlimited ? '现做现烤' : (leftQty <= 0 ? '已售罄' : (leftQty <= 12 ? '仅剩 ' + leftQty + ' 份' : '剩 ' + leftQty + ' 份')),
        soldOut: !inv.isUnlimited && leftQty <= 0
      }
    }) : []
    this.setData({
      loading: false,
      batchStation: bs,
      station: group.station || {},
      isLeader: Boolean(group.isLeader),
      progressText: app.progressText(bs),
      leftText: left > 0 ? '还差 ' + left + ' 件达到配送门槛' : '已达到5件，取货日12:00确认配送',
      percent: threshold > 0 ? Math.min(100, Math.round((paid / threshold) * 100)) : 0,
      memberCount: memberCount,
      memberInitials: AVATAR_POOL.slice(0, Math.min(4, Math.max(memberCount, 0))),
      skus: skus,
      canBuy: ['拼团中', '已达门槛待确认'].includes(bs.status)
    })
  },

  goBuy(e) {
    const { productid, skuid } = e.currentTarget.dataset
    wx.switchTab({ url: '/pages/catalog/catalog' })
  },

  goHome() {
    wx.switchTab({ url: '/pages/home/home' })
  },

  onShareAppMessage() {
    const left = this.data.batchStation ? Math.max(0, Number(this.data.batchStation.thresholdN || 0) - Number(this.data.batchStation.paidItemCount || 0)) : 0
    const name = this.data.station.name || ''
    return {
      title: left > 0 ? name + ' 泰斓还差 ' + left + ' 件达到配送门槛' : name + ' 泰斓已达到5件，仍可继续下单',
      imageUrl: '/assets/hero.jpg', path: '/pages/catalog/catalog'
    }
  },
  oonShareTimeline() { return { title: '泰斓 TAILAN · 地铁站拼团自提' } }
})
