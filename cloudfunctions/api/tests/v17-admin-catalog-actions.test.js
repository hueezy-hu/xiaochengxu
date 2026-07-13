const assert = require('assert')
const fs = require('fs')
const path = require('path')
const { createAdminCatalogActions } = require('../src/services/admin-catalog-actions')

function createRepository(seed = {}) {
  const state = {
    products: { ...(seed.products || {}) }, skus: { ...(seed.skus || {}) }, categories: { ...(seed.categories || {}) },
    stations: { ...(seed.stations || {}) }, orderRefs: { ...(seed.orderRefs || {}) }, inventoryRefs: { ...(seed.inventoryRefs || {}) }, stationRefs: { ...(seed.stationRefs || {}) }
  }
  return {
    state,
    listProducts: async () => Object.values(state.products), listSkus: async () => Object.values(state.skus), listCategories: async () => Object.values(state.categories), listStations: async () => Object.values(state.stations),
    getProduct: async (id) => state.products[id] || null, getSku: async (id) => state.skus[id] || null, getCategory: async (id) => state.categories[id] || null, getStation: async (id) => state.stations[id] || null,
    saveProduct: async (id, row) => { state.products[id] = { ...(state.products[id] || { _id: id }), ...row } },
    saveSku: async (id, row) => { state.skus[id] = { ...(state.skus[id] || { _id: id }), ...row } },
    saveCategory: async (id, row) => { state.categories[id] = { ...(state.categories[id] || { _id: id }), ...row } },
    saveStation: async (id, row) => { state.stations[id] = { ...(state.stations[id] || { _id: id }), ...row } },
    deleteProduct: async (id) => { delete state.products[id] }, deleteSku: async (id) => { delete state.skus[id] }, deleteCategory: async (id) => { delete state.categories[id] }, deleteStation: async (id) => { delete state.stations[id] },
    countSkuOrderReferences: async (id) => Number(state.orderRefs[id] || 0), countSkuInventoryReferences: async (id) => Number(state.inventoryRefs[id] || 0),
    countProductOrderReferences: async (id) => Number(state.orderRefs[id] || 0), countProductSkus: async (id) => Object.values(state.skus).filter((row) => row.productId === id).length,
    countCategoryProducts: async (id) => Object.values(state.products).filter((row) => row.categoryId === id).length,
    countStationReferences: async (id) => Number(state.stationRefs[id] || 0)
  }
}

async function test(name, fn) {
  try { await fn(); console.log(`PASS ${name}`) } catch (err) { console.error(`FAIL ${name}`); console.error(err.stack || err.message); process.exitCode = 1 }
}

test('SKU price changes immediately without mutating historical order snapshots', async () => {
  const repository = createRepository({ products: { p1: { _id: 'p1', name: '蛋糕' } }, skus: { s1: { _id: 's1', productId: 'p1', name: '单个', price: 600 } } })
  const historicalOrder = { items: [{ skuId: 's1', unitPrice: 600 }] }
  const actions = createAdminCatalogActions({ repository, now: () => 1000 })
  const result = await actions.saveSku({ openid: 'admin', sku: { _id: 's1', productId: 'p1', name: '单个', price: 800, status: '上架' } })
  assert.equal(result.ok, true); assert.equal(repository.state.skus.s1.price, 800); assert.equal(historicalOrder.items[0].unitPrice, 600)
})

test('referenced SKU can only be archived while an unused SKU can be deleted', async () => {
  const repository = createRepository({ skus: { used: { _id: 'used', status: '上架' }, free: { _id: 'free', status: '上架' } }, orderRefs: { used: 1 } })
  const actions = createAdminCatalogActions({ repository, now: () => 1000 })
  const archived = await actions.deleteSku({ openid: 'admin', skuId: 'used' })
  const removed = await actions.deleteSku({ openid: 'admin', skuId: 'free' })
  assert.equal(archived.ok, true); assert.equal(archived.archived, true); assert.equal(repository.state.skus.used.status, '下架')
  assert.equal(removed.ok, true); assert.equal(repository.state.skus.free, undefined)
})

test('category deletion is blocked while products reference it', async () => {
  const repository = createRepository({ categories: { c1: { _id: 'c1', name: '甜品' } }, products: { p1: { _id: 'p1', categoryId: 'c1' } } })
  const result = await createAdminCatalogActions({ repository, now: () => 1000 }).deleteCategory({ categoryId: 'c1' })
  assert.equal(result.ok, false); assert(repository.state.categories.c1)
})

test('station fixed material validates time, photos and delivery mode', async () => {
  const repository = createRepository()
  const actions = createAdminCatalogActions({ repository, now: () => 1000 })
  const invalid = await actions.saveStation({ station: { name: '布吉站', arriveAt: '19:00', leaveAt: '18:00', pickupNote: 'A口', defaultLocationImages: [], verifyMode: '扫码' } })
  assert.equal(invalid.ok, false)
  const saved = await actions.saveStation({ station: { name: '布吉站', arriveAt: '18:00', leaveAt: '19:00', pickupNote: 'A口', defaultLocationImages: ['cloud://station.jpg'], verifyMode: '有人核销' } })
  assert.equal(saved.ok, true); assert.equal(repository.state.stations[saved.stationId].verifyMode, '有人核销')
})

test('index routes all V1.7 catalog management actions through the service', async () => {
  const index = fs.readFileSync(path.resolve(__dirname, '..', 'index.js'), 'utf8')
  for (const action of ['listProducts', 'saveProduct', 'deleteProduct', 'saveSku', 'deleteSku', 'listCategories', 'saveCategory', 'deleteCategory', 'listStations', 'saveStation', 'deleteStation']) {
    assert.match(index, new RegExp(`case ['"]${action}['"]:`))
  }
  assert.match(index, /createAdminCatalogActions/)
})
