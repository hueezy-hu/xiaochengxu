const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { createCatalogActions } = require('../src/services/catalog-actions')
const { createCartActions } = require('../src/services/cart-actions')
const { createProfileActions } = require('../src/services/profile-actions')

function memoryRepository() {
  const state = {
    batch: null,
    business: null,
    nudges: {},
    skus: { sku1: { _id: 'sku1', productId: 'p1', name: '蝶糯桑卡雅', spec: '1个', price: 600, status: '上架' } },
    inventory: { sku1: { _id: 'inv1', batchId: 'b1', skuId: 'sku1', availableQty: 8, status: '上架' } },
    carts: {},
    profiles: {}
  }
  return {
    state,
    async getAcceptingBatch() { return state.batch },
    async getDailyBusiness() { return state.business },
    async countDailyNudges(date) { return Object.values(state.nudges).filter((row) => row.date === date).length },
    async getNudge(id) { return state.nudges[id] || null },
    async saveNudge(id, row) { if (!state.nudges[id]) state.nudges[id] = row; return state.nudges[id] },
    async getCurrentBatch() { return state.batch },
    async getSku(id) { return state.skus[id] || null },
    async getInventory(batchId, skuId) { const row = state.inventory[skuId]; return row && row.batchId === batchId ? row : null },
    async getCartItem(openid, skuId) { return state.carts[`${openid}:${skuId}`] || null },
    async saveCartItem(id, row) { state.carts[id] = row },
    async listCartItems(openid) { return Object.values(state.carts).filter((row) => row.userOpenid === openid) },
    async deleteCartItem(openid, skuId) { delete state.carts[`${openid}:${skuId}`] },
    async getProfile(openid) { return state.profiles[openid] || null },
    async saveProfile(openid, row) { state.profiles[openid] = row; return row }
  }
}

test('home status distinguishes accepting rest and unopened states', async () => {
  const repository = memoryRepository()
  const actions = createCatalogActions({ repository, now: () => Date.parse('2026-07-13T02:00:00Z') })

  let result = await actions.getHomeStatus({ openid: 'buyer-a' })
  assert.equal(result.businessStatus, '未开团')
  assert.equal(result.canNudge, true)

  repository.state.business = { status: '今日休息' }
  result = await actions.getHomeStatus({ openid: 'buyer-a' })
  assert.equal(result.businessStatus, '今日休息')
  assert.equal(result.canNudge, false)

  repository.state.batch = { _id: 'b1', status: '接单中', pickupDate: '2026-07-14', deadlineAt: Date.parse('2026-07-13T14:00:00Z') }
  result = await actions.getHomeStatus({ openid: 'buyer-a' })
  assert.equal(result.businessStatus, '开团中')
  assert.equal(result.canOrder, true)
})

test('nudge counts each openid once per Beijing date only when unopened', async () => {
  const repository = memoryRepository()
  const actions = createCatalogActions({ repository, now: () => Date.parse('2026-07-13T02:00:00Z') })

  const first = await actions.nudgeOpenGroup({ openid: 'buyer-a' })
  const duplicate = await actions.nudgeOpenGroup({ openid: 'buyer-a' })
  assert.equal(first.nudgeCount, 1)
  assert.equal(duplicate.nudgeCount, 1)
  assert.equal(duplicate.duplicate, true)

  repository.state.business = { status: '今日休息' }
  const closed = await actions.nudgeOpenGroup({ openid: 'buyer-b' })
  assert.equal(closed.ok, false)
})

test('cart persists by user and never changes inventory while adding or updating', async () => {
  const repository = memoryRepository()
  repository.state.batch = { _id: 'b1', status: '接单中', deadlineAt: 9999999999999 }
  const actions = createCartActions({ repository, now: () => 1000 })

  const added = await actions.addToCart({ openid: 'buyer-a', skuId: 'sku1', qty: 2 })
  await actions.updateCartItem({ openid: 'buyer-a', skuId: 'sku1', qty: 3, checked: false })
  assert.equal(added.ok, true)
  assert.equal(repository.state.inventory.sku1.availableQty, 8)
  assert.equal(repository.state.carts['buyer-a:sku1'].qty, 3)
  assert.equal(repository.state.carts['buyer-a:sku1'].checked, false)
})

test('cart marks old batch unavailable and reports current price changes', async () => {
  const repository = memoryRepository()
  repository.state.batch = { _id: 'b2', status: '接单中', deadlineAt: 9999999999999 }
  repository.state.skus.sku1.price = 500
  repository.state.carts['buyer-a:sku1'] = { _id: 'buyer-a:sku1', userOpenid: 'buyer-a', skuId: 'sku1', batchId: 'b1', qty: 2, checked: true, addedPrice: 600 }
  const actions = createCartActions({ repository, now: () => 1000 })

  const result = await actions.getCart({ openid: 'buyer-a' })
  assert.equal(result.items[0].valid, false)
  assert.equal(result.items[0].invalidReason, '非当前批次')
  assert.equal(result.items[0].priceChanged, true)
  assert.equal(result.selectedAmount, 0)
})

test('cart clears invalid rows and profile validates phone before saving', async () => {
  const repository = memoryRepository()
  repository.state.batch = { _id: 'b2', status: '接单中', deadlineAt: 9999999999999 }
  repository.state.carts['buyer-a:sku1'] = { _id: 'buyer-a:sku1', userOpenid: 'buyer-a', skuId: 'sku1', batchId: 'b1', qty: 1, checked: true, addedPrice: 600 }
  const cart = createCartActions({ repository, now: () => 1000 })
  const profile = createProfileActions({ repository, now: () => 1000 })

  const cleared = await cart.clearInvalidCart({ openid: 'buyer-a' })
  assert.equal(cleared.removed, 1)
  assert.equal(Object.keys(repository.state.carts).length, 0)

  const invalid = await profile.updateProfile({ openid: 'buyer-a', phone: '123' })
  const saved = await profile.updateProfile({ openid: 'buyer-a', nickName: '小斓', phone: '13800138000' })
  assert.equal(invalid.ok, false)
  assert.equal(saved.profile.phone, '13800138000')
})

test('index routes V1.7 home cart and profile actions through services', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '..', 'index.js'), 'utf8')
  for (const action of ['getHomeStatus', 'nudgeOpenGroup', 'addToCart', 'getCart', 'updateCartItem', 'removeCartItem', 'clearInvalidCart', 'updateProfile']) {
    assert.match(source, new RegExp(`case ['"]${action}['"]:`))
  }
  for (const collection of ['carts', 'openGroupNudges', 'businessDays']) assert.match(source, new RegExp(`['"]${collection}['"]`))
})
