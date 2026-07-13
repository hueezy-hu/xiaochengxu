const { stableId } = require('../shared/ids')
const { ERROR_CODES, success, failure } = require('../shared/response')

function text(value) { return String(value || '').trim() }
function validTime(value) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(text(value)) }

function createAdminCatalogActions({ repository, now = Date.now } = {}) {
  if (!repository) throw new Error('repository必填')
  const fail = (input, code, msg) => failure(input, Number(now()), code, msg)

  async function listProducts(input = {}) {
    const [products, skus, categories] = await Promise.all([repository.listProducts(), repository.listSkus(), repository.listCategories()])
    return success(input, Number(now()), { products, skus, categories })
  }

  async function saveProduct(input = {}) {
    const t = Number(now()); const product = input.product || {}
    if (!text(product.name)) return fail(input, ERROR_CODES.INVALID_ARGUMENT, '商品名必填')
    if (product.categoryId && !await repository.getCategory(product.categoryId)) return fail(input, ERROR_CODES.NOT_FOUND, '分类不存在')
    const productId = product._id || stableId('product', `${t}:${product.name}`)
    const existing = await repository.getProduct(productId)
    await repository.saveProduct(productId, { name: text(product.name), thaiName: text(product.thaiName), categoryId: text(product.categoryId), category: text(product.category), tags: Array.isArray(product.tags) ? product.tags.map(text).filter(Boolean) : [], description: text(product.description), images: Array.isArray(product.images) ? product.images.map(text).filter(Boolean).slice(0, 5) : [], status: product.status === '下架' ? '下架' : '上架', sort: Number(product.sort || 1), createdAt: existing && existing.createdAt || t, updatedAt: t, updatedBy: input.openid || '' })
    return success(input, t, { productId })
  }

  async function saveSku(input = {}) {
    const t = Number(now()); const sku = input.sku || {}; const price = Number(sku.price)
    if (!text(sku.productId) || !text(sku.name) || !Number.isInteger(price) || price < 0) return fail(input, ERROR_CODES.INVALID_ARGUMENT, 'productId、SKU名和整数分价格必填')
    if (!await repository.getProduct(sku.productId)) return fail(input, ERROR_CODES.NOT_FOUND, '商品不存在')
    const skuId = sku._id || stableId('sku', `${t}:${sku.productId}:${sku.name}`)
    const existing = await repository.getSku(skuId)
    await repository.saveSku(skuId, { productId: text(sku.productId), name: text(sku.name), spec: text(sku.spec), price, status: sku.status === '下架' ? '下架' : '上架', sort: Number(sku.sort || 1), createdAt: existing && existing.createdAt || t, updatedAt: t, updatedBy: input.openid || '' })
    return success(input, t, { skuId, priceEffectiveAt: t })
  }

  async function deleteSku(input = {}) {
    const t = Number(now()); const skuId = text(input.skuId); const sku = await repository.getSku(skuId)
    if (!sku) return failure(input, t, ERROR_CODES.NOT_FOUND, 'SKU不存在')
    const referenced = (await repository.countSkuOrderReferences(skuId)) > 0 || (await repository.countSkuInventoryReferences(skuId)) > 0
    if (referenced) {
      await repository.saveSku(skuId, { status: '下架', updatedAt: t, updatedBy: input.openid || '' })
      return success(input, t, { skuId, deleted: false, archived: true })
    }
    await repository.deleteSku(skuId)
    return success(input, t, { skuId, deleted: true, archived: false })
  }

  async function deleteProduct(input = {}) {
    const t = Number(now()); const productId = text(input.productId); const product = await repository.getProduct(productId)
    if (!product) return failure(input, t, ERROR_CODES.NOT_FOUND, '商品不存在')
    const referenced = (await repository.countProductOrderReferences(productId)) > 0 || (await repository.countProductSkus(productId)) > 0
    if (referenced) {
      await repository.saveProduct(productId, { status: '下架', updatedAt: t, updatedBy: input.openid || '' })
      return success(input, t, { productId, deleted: false, archived: true })
    }
    await repository.deleteProduct(productId)
    return success(input, t, { productId, deleted: true, archived: false })
  }

  async function listCategories(input = {}) { return success(input, Number(now()), { categories: await repository.listCategories() }) }

  async function saveCategory(input = {}) {
    const t = Number(now()); const category = input.category || {}
    if (!text(category.name)) return failure(input, t, ERROR_CODES.INVALID_ARGUMENT, '分类名必填')
    const categoryId = category._id || stableId('category', `${t}:${category.name}`)
    const existing = await repository.getCategory(categoryId)
    await repository.saveCategory(categoryId, { name: text(category.name), status: category.status === '停用' ? '停用' : '启用', sort: Number(category.sort || 1), createdAt: existing && existing.createdAt || t, updatedAt: t, updatedBy: input.openid || '' })
    return success(input, t, { categoryId })
  }

  async function deleteCategory(input = {}) {
    const t = Number(now()); const categoryId = text(input.categoryId)
    if (!await repository.getCategory(categoryId)) return failure(input, t, ERROR_CODES.NOT_FOUND, '分类不存在')
    if (await repository.countCategoryProducts(categoryId)) return failure(input, t, ERROR_CODES.ORDER_STATE_CONFLICT, '分类仍被商品引用，不可删除')
    await repository.deleteCategory(categoryId)
    return success(input, t, { categoryId, deleted: true })
  }

  async function listStations(input = {}) { return success(input, Number(now()), { stations: await repository.listStations() }) }

  async function saveStation(input = {}) {
    const t = Number(now()); const station = input.station || {}
    const images = Array.isArray(station.defaultLocationImages || station.locationImages) ? (station.defaultLocationImages || station.locationImages).map(text).filter(Boolean) : []
    if (!text(station.name) || !text(station.pickupNote) || !validTime(station.arriveAt) || !validTime(station.leaveAt) || station.arriveAt >= station.leaveAt || images.length < 1 || images.length > 3 || !['有人核销', '无人放置'].includes(station.verifyMode)) {
      return failure(input, t, ERROR_CODES.INVALID_ARGUMENT, '站点名、地点、有效窗口、1至3张图片和交付模式必填')
    }
    const stationId = station._id || stableId('station', `${t}:${station.name}`)
    const existing = await repository.getStation(stationId)
    await repository.saveStation(stationId, { name: text(station.name), line: text(station.line), exit: text(station.exit), pickupNote: text(station.pickupNote), arriveAt: station.arriveAt, leaveAt: station.leaveAt, defaultLocationImages: images, locationImages: images, verifyMode: station.verifyMode, status: station.status === 'inactive' ? 'inactive' : 'active', createdAt: existing && existing.createdAt || t, updatedAt: t, updatedBy: input.openid || '' })
    return success(input, t, { stationId })
  }

  async function deleteStation(input = {}) {
    const t = Number(now()); const stationId = text(input.stationId); const station = await repository.getStation(stationId)
    if (!station) return failure(input, t, ERROR_CODES.NOT_FOUND, '站点不存在')
    if (await repository.countStationReferences(stationId)) {
      await repository.saveStation(stationId, { status: 'inactive', updatedAt: t, updatedBy: input.openid || '' })
      return success(input, t, { stationId, deleted: false, archived: true })
    }
    await repository.deleteStation(stationId)
    return success(input, t, { stationId, deleted: true, archived: false })
  }

  return { listProducts, saveProduct, deleteProduct, saveSku, deleteSku, listCategories, saveCategory, deleteCategory, listStations, saveStation, deleteStation }
}

module.exports = { createAdminCatalogActions }
