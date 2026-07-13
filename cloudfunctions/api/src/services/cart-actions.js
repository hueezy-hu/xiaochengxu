const { ERROR_CODES, success, failure } = require('../shared/response')

function quantity(value) {
  const qty = Number(value)
  return Number.isInteger(qty) && qty > 0 ? qty : 0
}

function createCartActions({ repository, now = Date.now } = {}) {
  async function currentBatch(t) {
    const batch = await repository.getCurrentBatch(t)
    return batch && batch.status === '接单中' && Number(batch.deadlineAt || 0) > t ? batch : null
  }

  async function decorate(row, batch) {
    const sku = await repository.getSku(row.skuId)
    const inventory = batch ? await repository.getInventory(batch._id, row.skuId) : null
    let invalidReason = ''
    if (!batch || row.batchId !== batch._id) invalidReason = '非当前批次'
    else if (!sku || sku.status !== '上架') invalidReason = '商品已下架'
    else if (!inventory || inventory.status !== '上架' || Number(inventory.availableQty || 0) <= 0) invalidReason = '商品已售罄'
    const currentPrice = Number(sku && sku.price || 0)
    return {
      ...row,
      sku,
      currentPrice,
      priceChanged: Boolean(sku) && currentPrice !== Number(row.addedPrice || 0),
      valid: !invalidReason,
      invalidReason
    }
  }

  async function cartSnapshot(input, t) {
    const [batch, rows] = await Promise.all([currentBatch(t), repository.listCartItems(input.openid)])
    const items = await Promise.all(rows.map((row) => decorate(row, batch)))
    items.sort((a, b) => Number(b.valid) - Number(a.valid) || Number(a.createdAt || 0) - Number(b.createdAt || 0))
    const selected = items.filter((item) => item.valid && item.checked)
    return {
      batch,
      items,
      selectedQty: selected.reduce((sum, item) => sum + Number(item.qty || 0), 0),
      selectedAmount: selected.reduce((sum, item) => sum + Number(item.qty || 0) * item.currentPrice, 0)
    }
  }

  return {
    async addToCart(input = {}) {
      const t = now()
      const qty = quantity(input.qty)
      if (!input.openid || !input.skuId || !qty) return failure(input, t, ERROR_CODES.INVALID_ARGUMENT, 'skuId和正整数qty必填')
      const batch = await currentBatch(t)
      if (!batch) return failure(input, t, ERROR_CODES.BUSINESS_CLOSED, '当前未开团')
      const [sku, inventory, existing] = await Promise.all([
        repository.getSku(input.skuId),
        repository.getInventory(batch._id, input.skuId),
        repository.getCartItem(input.openid, input.skuId)
      ])
      if (!sku || sku.status !== '上架' || !inventory || inventory.status !== '上架' || Number(inventory.availableQty || 0) <= 0) {
        return failure(input, t, ERROR_CODES.SKU_UNAVAILABLE, '商品当前不可加购')
      }
      const id = `${input.openid}:${input.skuId}`
      const row = {
        ...(existing || {}),
        _id: id,
        userOpenid: input.openid,
        skuId: input.skuId,
        batchId: batch._id,
        qty: Number(existing && existing.qty || 0) + qty,
        checked: existing ? existing.checked !== false : true,
        addedPrice: Number(sku.price || 0),
        createdAt: existing && existing.createdAt || t,
        updatedAt: t
      }
      await repository.saveCartItem(id, row)
      return success(input, t, { item: row })
    },
    async getCart(input = {}) {
      const t = now()
      if (!input.openid) return failure(input, t, ERROR_CODES.FORBIDDEN, '需要登录后查看购物车')
      return success(input, t, await cartSnapshot(input, t))
    },
    async updateCartItem(input = {}) {
      const t = now()
      const qty = quantity(input.qty)
      if (!input.openid || !input.skuId || !qty) return failure(input, t, ERROR_CODES.INVALID_ARGUMENT, 'skuId和正整数qty必填')
      const existing = await repository.getCartItem(input.openid, input.skuId)
      if (!existing) return failure(input, t, ERROR_CODES.NOT_FOUND, '购物车条目不存在')
      const row = { ...existing, qty, checked: typeof input.checked === 'boolean' ? input.checked : existing.checked !== false, updatedAt: t }
      await repository.saveCartItem(existing._id, row)
      return success(input, t, { item: row })
    },
    async removeCartItem(input = {}) {
      const t = now()
      if (!input.openid || !input.skuId) return failure(input, t, ERROR_CODES.INVALID_ARGUMENT, 'skuId必填')
      await repository.deleteCartItem(input.openid, input.skuId)
      return success(input, t, { removed: 1 })
    },
    async clearInvalidCart(input = {}) {
      const t = now()
      const snapshot = await cartSnapshot(input, t)
      const invalid = snapshot.items.filter((item) => !item.valid)
      for (const item of invalid) await repository.deleteCartItem(input.openid, item.skuId)
      return success(input, t, { removed: invalid.length })
    }
  }
}

module.exports = { createCartActions }
