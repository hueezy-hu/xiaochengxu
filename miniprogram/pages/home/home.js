const app = getApp()
const WELCOME_KEY = 'tailanWelcomeSeen'

Page({
  data: { heroImage: '/assets/hero.jpg', showWelcome: false, welcomeNickname: '', welcomeAvatarFileId: '', businessStatus: '未开团', canNudge: true, nudgeCount: 0, nudging: false },

  onShow() { this.maybeShowWelcome(); this.loadBusinessStatus() },
  async loadBusinessStatus() {
    const res = await app.call('getHomeStatus')
    if (res.ok) this.setData({ businessStatus: res.businessStatus, canNudge: Boolean(res.canNudge), nudgeCount: Number(res.nudgeCount || 0) })
  },
  async nudgeOpenGroup() {
    if (this.data.nudging || !this.data.canNudge) return
    this.setData({ nudging: true })
    const res = await app.call('nudgeOpenGroup')
    this.setData({ nudging: false })
    if (res.ok) this.setData({ nudgeCount: Number(res.nudgeCount || 0) })
    wx.showToast({ title: res.ok ? (res.duplicate ? '今天已经催过啦' : '已帮你催开团') : (res.msg || '暂时无法催开团'), icon: 'none' })
  },
  maybeShowWelcome() {
    if (wx.getStorageSync(WELCOME_KEY)) return
    const user = app.getLocalProfile()
    if (user && user.nickname) { wx.setStorageSync(WELCOME_KEY, true); return }
    this.setData({ showWelcome: true })
  },
  onWelcomeNickname(e) { this.setData({ welcomeNickname: e.detail.value }) },
  async onWelcomeAvatar(e) {
    if (!e.detail.avatarUrl) return
    try {
      const upload = await wx.cloud.uploadFile({ cloudPath: `avatars/${Date.now()}.png`, filePath: e.detail.avatarUrl })
      this.setData({ welcomeAvatarFileId: upload.fileID })
    } catch (err) { wx.showToast({ title: '头像上传失败，可稍后再试', icon: 'none' }) }
  },
  async submitWelcome() {
    const nickname = String(this.data.welcomeNickname || '').trim()
    if (!nickname) { wx.showToast({ title: '填个昵称吧', icon: 'none' }); return }
    await app.saveUserProfile({ nickname, avatarFileId: this.data.welcomeAvatarFileId })
    wx.setStorageSync(WELCOME_KEY, true); this.setData({ showWelcome: false })
  },
  skipWelcome() { wx.setStorageSync(WELCOME_KEY, true); this.setData({ showWelcome: false }) },
  goCatalog() { wx.switchTab({ url: '/pages/catalog/catalog' }) },
  onShareAppMessage() { return { title: '泰斓 TAILAN · 泰式斑斓甜品', imageUrl: '/assets/hero.jpg', path: '/pages/home/home' } },
  onShareTimeline() { return { title: '泰斓 TAILAN · 泰式斑斓甜品' } }
})
