const app = getApp()
const { createRequestId } = require('../../utils/request-id')

Page({
  data: {
    loading: true,
    stations: [],
    selectedId: '',
    skuId: '',
    qty: 1,
    batchId: '',
    paying: false,
    pendingOrderId: '',
    pendingBatchStationId: '',
    clientRequestId: '',
    user: { nickname: '', avatarFileId: '', phone: '' },
    phoneOneTapEnabled: false,
    showCheckoutAuth: false,
    checkoutNicknameDraft: '',
    checkoutPhoneDraft: '',
    checkoutAvatarFileId: ''
  },

  onLoad(options) {
    this.options = options || {}
    const qty = Number(options.qty || 1)
    this.setData({
      batchId: options.batchId || '', skuId: options.skuId || '', qty,
      skuName: decodeURIComponent(options.skuName || '已选商品'),
      totalText: '金额由服务器按当前售价计算',
      clientRequestId: createRequestId('checkout')
    })
    this.load()
  },

  async load() {
    const [stationsRes, profile] = await Promise.all([
      this.data.batchId ? app.call('getStationOptions', { batchId: this.data.batchId }) : Promise.resolve({ ok: false }),
      app.getUserProfile()
    ])
    const user = profile.user || { nickname: '', avatarFileId: '', phone: '' }
    this.setData({
      user,
      checkoutNicknameDraft: user.nickname || '',
      checkoutPhoneDraft: user.phone || '',
      checkoutAvatarFileId: user.avatarFileId || '',
      phoneOneTapEnabled: Boolean(profile.phoneOneTapEnabled)
    })
    if (!stationsRes.ok) { this.setData({ loading: false }); return }
    const stationById = {}
    ;(stationsRes.stations || []).forEach((s) => { stationById[s._id] = s })
    const windowByBs = {}
    ;(stationsRes.deliveryWindows || []).forEach((w) => { windowByBs[w.batchStationId] = w })
    const stations = (stationsRes.batchStations || []).map((bs) => {
      const st = stationById[bs.stationId] || {}
      const win = windowByBs[bs._id] || {}
      const threshold = Number(bs.thresholdN || 5)
      const paid = Number(bs.paidItemCount || 0)
      const percent = threshold > 0 ? Math.min(100, Math.round(paid / threshold * 100)) : 0
      const reached = paid >= threshold || bs.status === '已达门槛待确认'
      return {
        ...bs,
        stationName: st.name,
        line: st.line,
        exit: st.exit,
        percent,
        paid,
        threshold,
        windowText: (win.arriveAt && win.leaveAt) ? (win.arriveAt + '-' + win.leaveAt) : '窗口待确认',
        locationNote: win.locationNote || st.pickupNote || '取货点指引待补充',
        statusText: paid === 0 ? '等待第一单' : (reached ? '已达到配送门槛' : '累计中'),
        leftText: reached ? '取货日12:00确认配送' : '还差 ' + Math.max(0, threshold - paid) + ' 件达到门槛',
        isEmpty: paid === 0,
        formed: reached
      }
    })
    this.setData({ loading: false, stations })
  },

  goBack() { wx.navigateBack() },
  selectStation(e) {
    const selectedId = e.currentTarget.dataset.id
    if (this.data.pendingOrderId && selectedId !== this.data.pendingBatchStationId) {
      wx.showToast({ title: '已有待支付订单，不能切换站点', icon: 'none' })
      return
    }
    this.setData({ selectedId })
  },
  onCheckoutNickname(e) { this.setData({ checkoutNicknameDraft: e.detail.value }) },
  onCheckoutPhone(e) { this.setData({ checkoutPhoneDraft: e.detail.value }) },
  closeCheckoutAuth() { this.setData({ showCheckoutAuth: false }) },

  async onCheckoutAvatar(e) {
    const avatarUrl = e.detail.avatarUrl
    if (!avatarUrl) return
    wx.showLoading({ title: '上传头像' })
    try {
      const cloudPath = 'avatars/' + Date.now() + '-' + Math.floor(Math.random() * 1000) + '.png'
      const upload = await wx.cloud.uploadFile({ cloudPath, filePath: avatarUrl })
      this.setData({ checkoutAvatarFileId: upload.fileID })
    } catch (err) {
      wx.showToast({ title: '头像上传失败，可继续支付', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  async getPhoneNumber(e) {
    const code = e.detail && e.detail.code
    if (!code) { wx.showToast({ title: '未授权手机号', icon: 'none' }); return }
    const res = await app.call('decodePhoneNumber', { code })
    if (!res.ok) { wx.showToast({ title: res.msg || '手机号获取失败', icon: 'none' }); return }
    const user = res.user || {}
    wx.setStorageSync('userProfile', user)
    this.setData({ user, checkoutPhoneDraft: user.phone || '', checkoutNicknameDraft: user.nickname || this.data.checkoutNicknameDraft, checkoutAvatarFileId: user.avatarFileId || this.data.checkoutAvatarFileId })
  },

  needsCheckoutAuth() {
    const user = this.data.user || {}
    const nickname = String(user.nickname || this.data.checkoutNicknameDraft || '').trim()
    const phone = String(user.phone || this.data.checkoutPhoneDraft || '').trim()
    return !nickname || !app.validPhone(phone)
  },

  async submitCheckoutAuth() {
    const nickname = String(this.data.checkoutNicknameDraft || '').trim()
    const phone = String(this.data.checkoutPhoneDraft || '').trim()
    if (!nickname) { wx.showToast({ title: '请填写昵称', icon: 'none' }); return }
    if (!app.validPhone(phone)) { wx.showToast({ title: '请填写有效手机号', icon: 'none' }); return }
    const res = await app.saveUserProfile({ nickname, phone, avatarFileId: this.data.checkoutAvatarFileId || '' })
    this.setData({ user: res.user || { nickname, phone, avatarFileId: this.data.checkoutAvatarFileId }, showCheckoutAuth: false })
    this.pay()
  },

  async pay() {
    if (!this.data.selectedId || this.data.paying) return
    if (this.needsCheckoutAuth()) { this.setData({ showCheckoutAuth: true }); return }
    const phone = String((this.data.user && this.data.user.phone) || this.data.checkoutPhoneDraft || '').trim()
    const contactName = String((this.data.user && this.data.user.nickname) || this.data.checkoutNicknameDraft || '').trim()
    this.setData({ paying: true })
    let orderId = this.data.pendingOrderId
    if (!orderId) {
      const create = await app.call('createOrder', { batchStationId: this.data.selectedId, items: [{ skuId: this.data.skuId, quantity: this.data.qty }], phone, contactName, clientRequestId: this.data.clientRequestId })
      if (!create.ok) { this.setData({ paying: false }); wx.showToast({ title: create.msg || '下单失败', icon: 'none' }); return }
      orderId = create.orderId
      this.setData({ pendingOrderId: orderId, pendingBatchStationId: this.data.selectedId, totalText: app.money(create.amount) })
    }
    const pay = await app.call('payOrder', { orderId })
    this.setData({ paying: false })
    if (!pay.ok) {
      if (pay.code === 'ORDER_EXPIRED') this.setData({ pendingOrderId: '', pendingBatchStationId: '', clientRequestId: createRequestId('checkout') })
      wx.showToast({ title: pay.msg || '支付未完成，可重试原订单', icon: 'none' }); return
    }
    wx.redirectTo({ url: '/pages/paySuccess/paySuccess?orderId=' + orderId + '&batchStationId=' + (this.data.pendingBatchStationId || this.data.selectedId) })
  },

  onShareAppMessage() {
    return { title: '泰斓 TAILAN · 选个地铁站一起拼斑斓蛋糕', imageUrl: '/assets/hero.jpg', path: '/pages/catalog/catalog' }
  },
  onShareTimeline() { return { title: '泰斓 TAILAN · 地铁站拼团自提' } }
})
