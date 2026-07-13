const { createCloudDbHelpers } = require('./cloud-db')

function createAdminCatalogRepository({ db, command } = {}) {
  const { transactionDoc, queryAll, saveMerged } = createCloudDbHelpers({ db, command })
  const list = (collection, where = {}) => queryAll(db, collection, where)
  const save = (collection, id, row) => saveMerged(db, collection, id, row)
  const remove = async (collection, id) => { await db.collection(collection).doc(id).remove() }
  const allOrderItems = async () => (await list('orders')).flatMap((order) => order.items || [])
  return {
    listProducts: () => list('products'), listSkus: () => list('skus'), listCategories: () => list('categories'), listStations: () => list('stations'),
    getProduct: (id) => transactionDoc(db, 'products', id), getSku: (id) => transactionDoc(db, 'skus', id), getCategory: (id) => transactionDoc(db, 'categories', id), getStation: (id) => transactionDoc(db, 'stations', id),
    saveProduct: (id, row) => save('products', id, row), saveSku: (id, row) => save('skus', id, row), saveCategory: (id, row) => save('categories', id, row), saveStation: (id, row) => save('stations', id, row),
    deleteProduct: (id) => remove('products', id), deleteSku: (id) => remove('skus', id), deleteCategory: (id) => remove('categories', id), deleteStation: (id) => remove('stations', id),
    async countSkuOrderReferences(id) { return (await allOrderItems()).filter((item) => item.skuId === id).length },
    async countSkuInventoryReferences(id) { return (await list('batchInventory', { skuId: id })).length },
    async countProductOrderReferences(id) { return (await allOrderItems()).filter((item) => item.productId === id).length },
    async countProductSkus(id) { return (await list('skus', { productId: id })).length },
    async countCategoryProducts(id) { return (await list('products', { categoryId: id })).length },
    async countStationReferences(id) { return (await list('batchStations', { stationId: id })).length }
  }
}

module.exports = { createAdminCatalogRepository }
