const app = getApp()
Page({
  data: { allowed: false, products: [], skus: [], productSkus: [], productName: '', productThaiName: '', productCategory: '', productTags: '', productDesc: '', productStatus: '上架', skuId: '', skuName: '', skuSpec: '', skuPrice: '', productId: '', imageFileIds: [] },
  onShow() { this.guard().then((ok) => ok && this.load()) },
  async guard() { const res = await app.call('checkAdmin'); if (!res.ok || res.role !== 'superAdmin') { wx.showToast({ title: '仅超级管理员可访问', icon: 'none' }); setTimeout(() => wx.navigateBack(), 500); return false } this.setData({ allowed: true }); return true },
  async load() {
    const res = await app.call('listProducts')
    if (!res.ok) return
    const products = res.products || []
    const skus = res.skus || []
    this.setData({ products, skus })
    if (!this.data.productId && products[0]) this.selectProductById(products[0]._id)
    else this.refreshProductSkus()
  },

  refreshProductSkus() {
    this.setData({ productSkus: this.data.skus.filter((k) => k.productId === this.data.productId) })
  },

  selectProductById(id) {
    const item = this.data.products.find((x) => x._id === id)
    if (!item) return
    this.setData({
      productId: item._id,
      productName: item.name || '',
      productThaiName: item.thaiName || '', productCategory: item.category || '', productTags: (item.tags || []).join('、'),
      productDesc: item.description || '',
      productStatus: item.status || '上架',
      imageFileIds: item.images || [],
      skuId: '', skuName: '', skuSpec: '', skuPrice: ''
    }, () => this.refreshProductSkus())
  },

  pickProduct(e) { this.selectProductById(e.currentTarget.dataset.id) },

  newProduct() {
    this.setData({ productId: '', productName: '', productThaiName: '', productCategory: '', productTags: '', productDesc: '', productStatus: '上架', imageFileIds: [], productSkus: [], skuId: '', skuName: '', skuSpec: '', skuPrice: '' })
  },

  toggleProductStatus() {
    this.setData({ productStatus: this.data.productStatus === '上架' ? '下架' : '上架' })
  },

  pickSku(e) {
    const item = this.data.skus.find((x) => x._id === e.currentTarget.dataset.id)
    if (!item) return
    this.setData({ skuId: item._id, skuName: item.name || '', skuSpec: item.spec || '', skuPrice: String(item.price || '') })
  },

  newSku() { this.setData({ skuId: '', skuName: this.data.productName, skuSpec: '', skuPrice: '' }) },

  goBack() { wx.navigateBack() },
  onInput(e) { this.setData({ [e.currentTarget.dataset.key]: e.detail.value }) },
  async chooseImage() {
    const choose = await new Promise((resolve) => wx.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['album', 'camera'], success: resolve, fail: () => resolve(null) }))
    const file = choose && choose.tempFiles && choose.tempFiles[0]
    if (!file || !file.tempFilePath) return
    wx.showLoading({ title: '上传图片' })
    try {
      const ext = (file.tempFilePath.split('.').pop() || 'jpg').split('?')[0]
      const cloudPath = 'products/' + Date.now() + '-' + Math.floor(Math.random() * 1000) + '.' + ext
      const upload = await wx.cloud.uploadFile({ cloudPath, filePath: file.tempFilePath })
      this.setData({ imageFileIds: this.data.imageFileIds.concat(upload.fileID) })
    } finally { wx.hideLoading() }
  },
  removeImage(e) {
    const index = Number(e.currentTarget.dataset.index)
    const next = this.data.imageFileIds.filter((_, i) => i !== index)
    this.setData({ imageFileIds: next })
  },
  async saveProduct() {
    const product = { name: this.data.productName, thaiName: this.data.productThaiName, category: this.data.productCategory, tags: this.data.productTags.split(/[、,，]/).map((value) => value.trim()).filter(Boolean), description: this.data.productDesc, images: this.data.imageFileIds, status: this.data.productStatus, sort: 1 }
    if (this.data.productId) product._id = this.data.productId
    const res = await app.call('saveProduct', { product })
    wx.showToast({ title: res.ok ? '商品已保存' : res.msg, icon: res.ok ? 'success' : 'none' })
    if (res.ok) { this.setData({ productId: res.productId }); this.load() }
  },
  async saveSku(e) {
    if (!this.data.productId) { wx.showToast({ title: '先保存商品再加SKU', icon: 'none' }); return }
    if (!this.data.skuName || !Number(this.data.skuPrice)) { wx.showToast({ title: 'SKU名和价格必填', icon: 'none' }); return }
    const status = e.currentTarget.dataset.status || '上架'
    const sku = { productId: this.data.productId, name: this.data.skuName, spec: this.data.skuSpec, price: Number(this.data.skuPrice), status, sort: 1 }
    if (this.data.skuId) sku._id = this.data.skuId
    const res = await app.call('saveSku', { sku })
    wx.showToast({ title: res.ok ? 'SKU已保存' : res.msg, icon: res.ok ? 'success' : 'none' })
    if (res.ok) { this.setData({ skuId: '' }); this.load() }
  },
  onShareAppMessage() { return { title: '泰斓 TAILAN 商品管理', path: '/pages/mine/mine' } },
  onShareTimeline() { return { title: '泰斓 TAILAN · 地铁站拼团自提' } }
})
