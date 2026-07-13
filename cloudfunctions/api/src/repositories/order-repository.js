const { createCloudDbHelpers } = require('./cloud-db')

function createOrderRepository({ db, command } = {}) {
  const { transactionDoc, unwrapTransactionResult } = createCloudDbHelpers({ db, command })
  return {
    async listPendingOrderIds(limit = 100) {
      const rows = (await db.collection('orders').where({ status: '预占中' }).limit(limit).get()).data || []
      return rows.map((row) => row._id)
    },
    async runTransaction(work) {
      const wrapped = await db.runTransaction(async (transaction) => {
        const tx = {
          async findOrderByClientRequestId(openid, clientRequestId) {
            const rows = (await transaction.collection('orders').where({ userOpenid: openid, clientRequestId }).limit(1).get()).data || []
            return rows[0] || null
          },
          async getOrder(id) { return transactionDoc(transaction, 'orders', id) },
          async getBatch(id) { return transactionDoc(transaction, 'batches', id) },
          async getBatchStation(id) { return transactionDoc(transaction, 'batchStations', id) },
          async getSku(id) { return transactionDoc(transaction, 'skus', id) },
          async getInventory(batchId, skuId) {
            const rows = (await transaction.collection('batchInventory').where({ batchId, skuId }).limit(1).get()).data || []
            return rows[0] || null
          },
          async getRefund(id) { return transactionDoc(transaction, 'refunds', id) },
          async getRefundRequest(id) { return transactionDoc(transaction, 'refundRequests', id) },
          async listOrdersByStation(batchStationId, statuses) {
            const rows = []
            for (let offset = 0; ; offset += 100) {
              const page = (await transaction.collection('orders').where({ batchStationId, status: command.in(statuses) }).skip(offset).limit(100).get()).data || []
              rows.push(...page)
              if (page.length < 100) return rows
            }
          },
          async createOrder(data, id) { await transaction.collection('orders').doc(id).set({ data }); return id },
          async saveOrder(id, data) { await transaction.collection('orders').doc(id).update({ data }) },
          async saveBatchStation(id, data) { await transaction.collection('batchStations').doc(id).update({ data }) },
          async saveInventory(row) { const { _id, ...data } = row; await transaction.collection('batchInventory').doc(_id).update({ data }) },
          async saveRefund(id, data) { await transaction.collection('refunds').doc(id).set({ data }) },
          async saveRefundRequest(id, data) { await transaction.collection('refundRequests').doc(id).set({ data }) }
        }
        return work(tx)
      }, 3)
      return unwrapTransactionResult(wrapped)
    }
  }
}

module.exports = { createOrderRepository }
