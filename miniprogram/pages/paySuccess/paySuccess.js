const app = getApp()
const { formatPickupTime } = require('../../utils/pickup-time')

function buildProgress(batchStation) {
  if (!batchStation) return { paid: 0, threshold: 0, leftCount: 0, percent: 0 }
  const paid = Number(batchStation.paidUserCount || 0)
  const threshold = Number(batchStation.thresholdN || 0)
  const leftCount = Math.max(0, threshold - paid)
  const percent = threshold > 0 ? Math.min(100, Math.round((paid / threshold) * 100)) : 0
  return { paid, threshold, leftCount, percent }
}

function buildShareLine(isLeader, stationName, leftCount) {
  const progressPart = leftCount > 0 ? '还差 ' + leftCount + ' 人成团' : '已满5人成团，取货日12:00确认配送'
  if (isLeader) {
    return '我在 ' + stationName + ' 下单了泰斓斑斓甜品，' + progressPart + '。今晚下单，明天到站取～'
  }
  return '我在 ' + stationName + ' 下单了泰斓斑斓甜品，' + progressPart + '。今晚下单，明天到站取～'
}

Page({
  data: {
    loading: true,
    order: null,
    refunded: false,
    station: {},
    batchStation: null,
    isLeader: false,
    successTitle: '支付成功！',
    progressText: '',
    leftText: '',
    leftCount: 0,
    percent: 0,
    shareLine: '',
    groupResultTemplateId: '',
    pickupTemplateId: '',
    pickupTimeText: '取货时间待确认'
  },

  onLoad(options) {
    this.options = options || {}
    this.load()
  },

  async load() {
    const [detail, group, config] = await Promise.all([
      this.options.orderId ? app.call('getOrderDetail', { orderId: this.options.orderId }) : Promise.resolve({ ok: false }),
      this.options.batchStationId ? app.call('getGroupPage', { batchStationId: this.options.batchStationId }) : Promise.resolve({ ok: false }),
      app.call('getPickupNoticeConfig')
    ])
    const batchStation = group.ok ? group.batchStation : null
    const station = group.ok ? (group.station || {}) : {}
    const isLeader = Boolean(group.ok && group.isLeader)
    const progress = buildProgress(batchStation)
    const stationName = station.name || '站点'
    this.setData({
      loading: false,
      order: detail.ok ? detail.order : null,
      refunded: Boolean(detail.ok && detail.order && ['支付后退款中', '已退款'].includes(detail.order.status)),
      station: station,
      pickupTimeText: formatPickupTime(group.ok ? (group.deliveryWindow || {}) : {}),
      batchStation: batchStation,
      isLeader: isLeader,
      successTitle: isLeader ? '团开起来了，你是发起人！' : '支付成功！',
      progressText: app.progressText(batchStation),
      leftText: progress.leftCount > 0 ? '还差 ' + progress.leftCount + ' 人成团' : '已满5人，等待取货日12:00最终确认',
      leftCount: progress.leftCount,
      percent: progress.percent,
      shareLine: buildShareLine(isLeader, stationName, progress.leftCount),
      groupResultTemplateId: config.ok ? (config.groupResultTemplateId || '') : '',
      pickupTemplateId: config.ok ? (config.pickupTemplateId || '') : ''
    })
    app.call('myOrders').then((r) => {
      if (r.ok) app.updateOrderBadge((r.orders || []).filter((o) => ['预占中', '待配送确认', '待自提'].includes(o.status)).length)
    })
  },

  copyShareText() {
    wx.setClipboardData({
      data: this.data.shareLine,
      success: () => wx.showToast({ title: '已复制，去群里粘贴吧', icon: 'none' })
    })
  },

  subscribe() {
    const tmplIds = [this.data.groupResultTemplateId, this.data.pickupTemplateId].filter(Boolean)
    if (!tmplIds.length) {
      wx.showToast({ title: '商家暂未配置通知模板', icon: 'none' })
      return
    }
    wx.requestSubscribeMessage({
      tmplIds,
      success: (res) => {
        if (this.options.orderId) app.call('markPickupSubscribed', { orderId: this.options.orderId, subscribeGroupResult: res[this.data.groupResultTemplateId] === 'accept', subscribePickupNotice: res[this.data.pickupTemplateId] === 'accept' })
      },
      complete: () => wx.showToast({ title: '订阅选择已保存', icon: 'none' })
    })
  },

  goOrder() {
    if (this.data.order) {
      wx.navigateTo({ url: '/pages/orderDetail/orderDetail?orderId=' + this.data.order._id })
    } else {
      wx.switchTab({ url: '/pages/orders/orders' })
    }
  },

  goHome() {
    wx.switchTab({ url: '/pages/home/home' })
  },

  onShareAppMessage() {
    const batchStationId = this.options.batchStationId || (this.data.batchStation && this.data.batchStation._id)
    return {
      title: this.data.shareLine || '泰斓 TAILAN · 地铁站拼团自提',
      imageUrl: '/assets/hero.jpg',
      path: batchStationId ? `/pages/groupPage/groupPage?batchStationId=${encodeURIComponent(batchStationId)}` : '/pages/catalog/catalog'
    }
  },
    onShareTimeline() { return { title: '泰斓 TAILAN · 地铁站拼团自提' } }
})
