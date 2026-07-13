const app = getApp()

const CACHE_KEY = 'tailanCatalogCache'
function money(cents) { return app.money(cents) }

Page({
  data: {
    loading: true,
    batch: null,
    batchText: '今天拼 · 明天取',
    categories: [],
    activeCategory: '',
    products: [],
    visibleProducts: []
  },

  onShow() {
    const hasCache = this.renderCache()
    this.load({ silent: hasCache })
  },

  renderCache() {
    const cached = wx.getStorageSync(CACHE_KEY)
    if (!cached || !cached.ok) return false
    this.applyCatalogData(cached)
    return true
  },

  async load({ silent = false } = {}) {
    if (!silent) this.setData({ loading: true })
    const res = await app.getCatalogPage()
    if (!res.ok) { wx.showToast({ title: res.msg || '读取失败', icon: 'none' }); this.setData({ loading: false }); return }
    wx.setStorageSync(CACHE_KEY, res)
    this.applyCatalogData(res)
  },

  applyCatalogData(res) {
    const skuByProduct = {}
    ;(res.skus || []).forEach((sku) => {
      if (!skuByProduct[sku.productId]) skuByProduct[sku.productId] = []
      skuByProduct[sku.productId].push(sku)
    })
    const inventoryBySku = {}
    ;(res.inventory || []).forEach((item) => { inventoryBySku[item.skuId] = item })
    const products = (res.products || []).map((product) => {
      const skus = skuByProduct[product._id] || []
      const firstSku = skus[0] || {}
      const remains = skus.map((sku) => {
        const inv = inventoryBySku[sku._id] || {}
        return inv.isUnlimited ? 999 : Number(inv.availableQty == null ? 0 : inv.availableQty)
      })
      const remain = remains.length ? remains.reduce((sum, item) => sum + item, 0) : 0
      const minPrice = skus.length ? Math.min(...skus.map((sku) => Number(sku.price || 0))) : 0
      return {
        ...product,
        skus,
        firstSkuId: firstSku._id || '',
        image: product.images && product.images[0] ? product.images[0] : '',
        category: product.category || '本周甜品',
        remain,
        priceText: money(minPrice) + '起',
        soldOut: remain <= 0
      }
    })
    const categories = [...new Set(products.map((item) => item.category).filter(Boolean))]
    const withStock = categories.find((c) => products.some((x) => x.category === c && !x.soldOut))
    const activeCategory = categories.includes(this.data.activeCategory) ? this.data.activeCategory : (withStock || categories[0] || '')
    this.setData({
      loading: false,
      batch: res.currentBatch || null,
      batchText: res.currentBatch ? ((res.currentBatch.pickupDate || '明天') + ' 自提 · ' + (res.currentBatch.status || '接单中')) : '今天拼 · 明天取',
      categories,
      activeCategory,
      products
    }, () => this.applyCategory())
  },

  applyCategory() {
    const visibleProducts = this.data.products.filter((item) => item.category === this.data.activeCategory)
    this.setData({ visibleProducts })
  },

  switchCategory(e) { this.setData({ activeCategory: e.currentTarget.dataset.category }, () => this.applyCategory()) },

  goBack() { wx.navigateBack() },

  goProduct(e) {
    const { productid, skuid } = e.currentTarget.dataset
    wx.navigateTo({ url: '/pages/product/product?productId=' + (productid || '') + (skuid ? '&skuId=' + skuid : '') })
  },

  onShareAppMessage() {
    return { title: '泰斓 TAILAN · 今天拼明天取，地铁站自提', imageUrl: '/assets/hero.jpg', path: '/pages/catalog/catalog' }
  },
  onShareTimeline() { return { title: '泰斓 TAILAN · 地铁站拼团自提' } }
})
