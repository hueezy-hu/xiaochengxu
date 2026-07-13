const api = require('./utils/api')

App({
  onLaunch() {
    if (!wx.cloud) {
      console.error('请使用基础库 3.0.0 以上版本')
      return
    }
    wx.cloud.init({ env: wx.cloud.DYNAMIC_CURRENT_ENV, traceUser: true })
  },

  call(action, data = {}) {
    return api.call(action, data)
  },

  async getCatalogPage() {
    return await this.call('getCatalogPage')
  },

  money(cents) {
    return '¥' + (Number(cents || 0) / 100).toFixed(0)
  },

  progressText(batchStation) {
    if (!batchStation) return '已拼 0/5 人'
    return '已拼 ' + (batchStation.paidUserCount || 0) + '/' + (batchStation.thresholdN || 5) + ' 人'
  },

  validPhone(phone) {
    return /^1\d{10}$/.test(String(phone || '').trim())
  },

  getLocalProfile() {
    return wx.getStorageSync('userProfile') || { nickname: '', avatarFileId: '', phone: '' }
  },

  async getUserProfile() {
    const local = this.getLocalProfile()
    const res = await this.call('getUserProfile')
    if (res.ok) {
      const user = res.user || local
      wx.setStorageSync('userProfile', user)
      return {
        ok: true,
        user,
        phoneOneTapEnabled: Boolean(res.phoneOneTapEnabled),
        merchantPhone: res.merchantPhone || '',
        orderSummary: res.orderSummary || { forming: 0, pickup: 0, total: 0 },
        isAdmin: Boolean(res.isAdmin),
        role: res.role || 'user'
      }
    }
    return { ok: true, user: local, phoneOneTapEnabled: false, merchantPhone: '', orderSummary: { forming: 0, pickup: 0, total: 0 }, isAdmin: false, role: 'user', localOnly: true }
  },

  async saveUserProfile(patch = {}) {
    const local = { ...this.getLocalProfile(), ...patch }
    wx.setStorageSync('userProfile', local)
    const res = await this.call('saveUserProfile', { profile: patch })
    if (!res.ok) return { ok: true, localOnly: true, msg: res.msg || '' }
    if (res.user) wx.setStorageSync('userProfile', res.user)
    return { ok: true, user: res.user || local, msg: res.msg || '已保存' }
  },

  updateOrderBadge(count) {
    const n = Number(count || 0)
    try {
      if (n > 0) wx.setTabBarBadge({ index: 2, text: n > 99 ? '99+' : String(n) })
      else wx.removeTabBarBadge({ index: 2 })
    } catch (err) { /* 非tab上下文调用时忽略 */ }
  },

  takeOrdersFilter() {
    const v = wx.getStorageSync('ordersFilter') || ''
    if (v) wx.removeStorageSync('ordersFilter')
    return v
  },

  setOrdersFilter(v) {
    wx.setStorageSync('ordersFilter', v)
  }
})
