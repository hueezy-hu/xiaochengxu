const app = getApp()

const fallback = {
  product: { _id: 'demo-p1', name: '蝶糯桑卡雅', description: '蝶豆花糯米软糯清香，上层是斑斓椰香蛋奶层，一口有糯米香、椰香和斑斓香。', images: ['/assets/products/p01.jpg'], category: '糯香经典' },
  batch: { _id: '', name: '泰斓 TAILAN 明日自提批次' },
  skus: [
    { _id: 'demo-sku-p1', productId: 'demo-p1', name: '蝶糯桑卡雅', spec: '1个', price: 600 }
  ]
}

Page({
  data: {
    product: fallback.product,
    images: [],
    skus: [],
    selectedSkuId: '',
    selectedSku: null,
    qty: 1,
    batch: fallback.batch,
    totalText: '¥88',
    stockText: '本批库存以商品分类页为准'
  },

  onLoad(options) { this.options = options || {}; this.load() },

  async load() {
    const productId = this.options.productId || fallback.product._id
    const res = await app.call('getProductDetail', { productId })
    if (!res.ok) wx.showToast({ title: res.msg || '商品读取失败，请下拉重试', icon: 'none' })
    const product = res.ok ? (res.product || fallback.product) : fallback.product
    const inventoryBySku = {}
    ;((res.ok && res.inventory) || []).forEach((item) => { inventoryBySku[item.skuId] = item })
    const skus = ((res.ok && res.skus && res.skus.length ? res.skus : fallback.skus)).map((sku) => {
      const inv = inventoryBySku[sku._id] || {}
      const remain = inv.availableQty == null ? null : Number(inv.availableQty || 0)
      return { ...sku, displayPrice: app.money(sku.price), remain, stockText: remain == null ? '共享库存' : (remain <= 0 ? '已售罄' : '剩 ' + remain + ' 份') }
    })
    const selectedSkuId = this.options.skuId || (skus[0] && skus[0]._id)
    const images = product.images && product.images.length ? product.images : []
    this.setData({ product, images, skus, selectedSkuId, batch: res.ok ? (res.currentBatch || null) : null })
    this.updateTotal()
  },

  pickSku(e) { this.setData({ selectedSkuId: e.currentTarget.dataset.id }); this.updateTotal() },
  minus() { if (this.data.qty <= 1) return; this.setData({ qty: this.data.qty - 1 }); this.updateTotal() },
  plus() {
    const sku = this.data.selectedSku
    const cap = sku && sku.remain != null ? sku.remain : 99
    if (this.data.qty >= cap) { wx.showToast({ title: '本批库存只剩 ' + cap + ' 份啦', icon: 'none' }); return }
    this.setData({ qty: this.data.qty + 1 }); this.updateTotal()
  },
  updateTotal() {
    const sku = this.data.skus.find((item) => item._id === this.data.selectedSkuId) || this.data.skus[0]
    this.setData({ selectedSku: sku || null, totalText: app.money((sku ? sku.price : 0) * this.data.qty), stockText: sku ? sku.stockText : '请选择规格' })
  },
  goBack() { wx.navigateBack() },
  goPickStation() {
    const sku = this.data.selectedSku
    const batchId = this.data.batch && this.data.batch._id
    if (!sku) return
    if (!batchId) { wx.showToast({ title: '今晚批次准备中', icon: 'none' }); return }
    wx.navigateTo({ url: '/pages/pickStation/pickStation?batchId=' + batchId + '&skuId=' + sku._id + '&qty=' + this.data.qty + '&skuName=' + encodeURIComponent(sku.name + ' ' + (sku.spec || '')) })
  },
  onShareAppMessage() {
    return { title: '泰斓 TAILAN · ' + (this.data.product.name || '斑斓蛋糕') + '，今天拼明天取', imageUrl: (this.data.images && this.data.images[0]) || '/assets/hero.jpg', path: '/pages/product/product?productId=' + (this.data.product._id || '') }
  },
  onShareTimeline() { return { title: '泰斓 TAILAN · 地铁站拼团自提' } }
})
