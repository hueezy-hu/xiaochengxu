const app = getApp()

Page({
  data: {
    loading: true,
    isAdmin: false,
    role: 'user',
    user: { nickname: '', avatarFileId: '', phone: '' },
    orderSummary: { forming: 0, pickup: 0, total: 0 }
  },

  onShow() { this.load() },

  async load() {
    const res = await app.call('getMinePage')
    if (!res.ok) { wx.showToast({ title: res.msg || '读取失败', icon: 'none' }); this.setData({ loading: false }); return }
    const user = res.userProfile || res.user || { nickname: '', avatarFileId: '', phone: '' }
    wx.setStorageSync('userProfile', user)
    this.setData({
      loading: false,
      user,
      orderSummary: res.orderSummary || { forming: 0, pickup: 0, total: 0 },
      isAdmin: Boolean(res.isAdmin),
      role: res.role || 'user'
    })
  },

  goOrders(e) {
    app.setOrdersFilter(e.currentTarget.dataset.status || 'all')
    wx.switchTab({ url: '/pages/orders/orders' })
  },

  goRules() { this.setData({ showRules: true }) },
  managePhone() { wx.showModal({ title: '手机号管理', content: this.data.user.phone ? `当前手机号：${this.data.user.phone}\n下次结算页可直接修改。` : '请在下次结算时填写手机号。', showCancel: false }) },
  closeRules() { this.setData({ showRules: false }) },
  goVerify() { wx.navigateTo({ url: '/pages/adminVerify/adminVerify' }) },
  goAdmin() { wx.navigateTo({ url: '/pages/adminHome/adminHome' }) },

  async openMerchantChannel() {
    if (this.data.isAdmin) { this.goAdmin(); return }
    wx.showModal({
      title: '暂无管理权限',
      content: '管理员与核销员权限只能由现有超级管理员配置。',
      showCancel: false
    })
  },

  onShareAppMessage() { return { title: '泰斓 TAILAN · 地铁站拼团自提', path: '/pages/home/home' } },
  onShareTimeline() { return { title: '泰斓 TAILAN · 地铁站拼团自提' } }
})
