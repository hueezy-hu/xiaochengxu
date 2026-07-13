const { createCloudDbHelpers } = require('./cloud-db')

function createShoppingRepository({ db, command } = {}) {
  const { transactionDoc, queryAll } = createCloudDbHelpers({ db, command })
  const first = async (collection, where) => (await queryAll(db, collection, where))[0] || null
  return {
    async getAcceptingBatch() { return first('batches', { status: '接单中' }) },
    async getDailyBusiness(date) { return transactionDoc(db, 'businessDays', date) },
    async countDailyNudges(date) { return (await queryAll(db, 'openGroupNudges', { date })).length },
    async getNudge(id) { return transactionDoc(db, 'openGroupNudges', id) },
    async saveNudge(id, row) { const { _id, ...data } = row; await db.collection('openGroupNudges').doc(id).set({ data }); return row },
    async getCurrentBatch() { return first('batches', { status: '接单中' }) },
    async getSku(id) { return transactionDoc(db, 'skus', id) },
    async getInventory(batchId, skuId) { return first('batchInventory', { batchId, skuId }) },
    async getCartItem(openid, skuId) { return transactionDoc(db, 'carts', `${openid}:${skuId}`) },
    async saveCartItem(id, row) { const { _id, ...data } = row; await db.collection('carts').doc(id).set({ data }) },
    async listCartItems(openid) { return queryAll(db, 'carts', { userOpenid: openid }) },
    async deleteCartItem(openid, skuId) { try { await db.collection('carts').doc(`${openid}:${skuId}`).remove() } catch (err) { /* idempotent */ } },
    async getProfile(openid) { return first('users', { openid }) },
    async saveProfile(openid, row) {
      const existing = await first('users', { openid })
      const id = existing && existing._id || openid
      const { _id, ...data } = row
      await db.collection('users').doc(id).set({ data })
      return { _id: id, ...data }
    }
  }
}

module.exports = { createShoppingRepository }
