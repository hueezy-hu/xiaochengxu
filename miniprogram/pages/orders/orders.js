const app = getApp()
const CACHE_KEY = 'tailanOrdersCache'
const TABS = [
  { key: 'all', name: '全部', statuses: null },
  { key: '处理中', name: '处理中', statuses: ['待支付', '待配送确认', '退款处理中'] },
  { key: '待自提', name: '待自提', statuses: ['待自提', '已放置待自取'] },
  { key: '已完成', name: '已完成', statuses: ['已完成', '已退款', '已取消', '已超时'] }
]

function refundText(order) {
  if (order.status === '退款处理中' || order.refundStatus === '待退款') return '退款处理中'
  if (order.status === '已退款' || order.refundStatus === '已退款') return '已退款 ' + app.money(order.amount) + ' 原路退回'
  return ''
}

Page({
  data: { loading: true, tabs: TABS, active: 'all', orders: [], shownOrders: [] },
  onShow() {
    const active = app.takeOrdersFilter()
    this.setData({ active: active || this.data.active })
    const hasCache = this.renderCache()
    this.load({ silent: hasCache })
  },
  renderCache() {
    const cached = wx.getStorageSync(CACHE_KEY)
    if (!cached || !Array.isArray(cached.orders)) return false
    this.renderOrders(cached.orders)
    return true
  },
  async load({ silent = false } = {}) {
    if (!silent) this.setData({ loading: true })
    const res = await app.call('myOrders')
    if (!res.ok) { wx.showToast({ title: res.msg || '加载失败', icon: 'none' }); this.setData({ loading: false }); return }
    wx.setStorageSync(CACHE_KEY, { orders: res.orders || [], cachedAt: Date.now() })
    this.renderOrders(res.orders || [])
  },
  renderOrders(rawOrders) {
    const orders = (rawOrders || []).map((o) => ({ ...o, firstItem: (o.items && o.items[0]) || {}, amountText: app.money(o.amount), refundText: refundText(o), canCancelPending: o.status === '待支付', canRefund: ['待配送确认', '待自提'].includes(o.status) }))
    const badge = orders.filter((o) => ['待支付', '待配送确认', '待自提'].includes(o.status)).length
    app.updateOrderBadge(badge)
    this.setData({ loading: false, orders }, () => this.applyFilter())
  },
  applyFilter() {
    const tab = TABS.find((item) => item.key === this.data.active) || TABS[0]
    const shown = tab.statuses ? this.data.orders.filter((o) => tab.statuses.includes(o.status)) : this.data.orders
    this.setData({ shownOrders: shown })
  },
  switchTab(e) { this.setData({ active: e.currentTarget.dataset.key }, () => this.applyFilter()) },
  goGroup(e) {
    const bsid = e.currentTarget.dataset.bsid
    if (bsid) wx.navigateTo({ url: '/pages/groupPage/groupPage?batchStationId=' + bsid })
  },

  goDetail(e) { wx.navigateTo({ url: '/pages/orderDetail/orderDetail?orderId=' + e.currentTarget.dataset.id }) },
  async cancelPending(e) {
    if (this._cancelling) return
    const id = e.currentTarget.dataset.id
    const confirmed = await new Promise((resolve) => wx.showModal({ title: '取消待支付订单？', content: '取消后会立即释放15分钟库存预占。', success: (r) => resolve(r.confirm) }))
    if (!confirmed) return
    this._cancelling = true
    const res = await app.call('cancelPendingOrder', { orderId: id })
    this._cancelling = false
    wx.showToast({ title: res.ok ? '待支付订单已取消' : (res.msg || '操作失败'), icon: 'none' })
    this.load()
  },
  async requestRefund(e) {
    if (this._cancelling) return
    const id = e.currentTarget.dataset.id
    const confirmed = await new Promise((resolve) => wx.showModal({ title: '确认整单退款？', content: '完成交付前可退款，退款后库存与站点件数会同步回退。', success: (r) => resolve(r.confirm) }))
    if (!confirmed) return
    this._cancelling = true
    const res = await app.call('requestRefund', { orderId: id, reason: '用户申请退款' })
    this._cancelling = false
    wx.showToast({ title: res.ok ? '退款已提交' : (res.msg || '操作失败'), icon: 'none' })
    this.load()
  },
  onShareAppMessage() { return { title: '泰斓 TAILAN · 我的订单', path: '/pages/home/home' } },
  onShareTimeline() { return { title: '泰斓 TAILAN · 地铁站拼团自提' } }
})
