const app = getApp()
Page({
  data: { loading: true, items: [], batch: null, selectedQty: 0, amountText: '¥0', allChecked: false },
  onShow() { this.load() },
  async load() {
    const res = await app.call('getCart')
    if (!res.ok) { wx.showModal({ title: '购物车读取失败', content: res.msg || '请稍后重试', showCancel: false }); this.setData({ loading: false }); return }
    const items = (res.items || []).map((item) => ({ ...item, priceText: app.money(item.currentPrice) }))
    const valid = items.filter((item) => item.valid)
    this.setData({ loading: false, items, batch: res.batch || null, selectedQty: res.selectedQty || 0, amountText: app.money(res.selectedAmount), allChecked: valid.length > 0 && valid.every((item) => item.checked) })
  },
  async toggle(e) { const item = this.data.items.find((row) => row.skuId === e.currentTarget.dataset.id); if (!item || !item.valid) return; await app.call('updateCartItem', { skuId: item.skuId, qty: item.qty, checked: !item.checked }); this.load() },
  async toggleAll() { const target = !this.data.allChecked; await Promise.all(this.data.items.filter((item) => item.valid).map((item) => app.call('updateCartItem', { skuId: item.skuId, qty: item.qty, checked: target }))); this.load() },
  async changeQty(e) { const qty = Number(e.currentTarget.dataset.qty); const skuId = e.currentTarget.dataset.id; if (qty < 1) return; await app.call('updateCartItem', { skuId, qty }); this.load() },
  async removeCartItem(e) { await app.call('removeCartItem', { skuId: e.currentTarget.dataset.id }); this.load() },
  async clearInvalidCart() { await app.call('clearInvalidCart'); this.load() },
  checkout() {
    const items = this.data.items.filter((item) => item.valid && item.checked).map((item) => ({ skuId: item.skuId, quantity: item.qty, name: item.sku.name, spec: item.sku.spec || '', price: item.currentPrice }))
    if (!items.length || !this.data.batch) return
    wx.setStorageSync('checkoutItems', items)
    wx.navigateTo({ url: '/pages/pickStation/pickStation?batchId=' + this.data.batch._id })
  },
  goBack() { wx.navigateBack() }
})
