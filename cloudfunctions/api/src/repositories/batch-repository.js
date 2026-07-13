const { createCloudDbHelpers } = require('./cloud-db')

function createBatchRepository({ db, command, now = Date.now, random = Math.random } = {}) {
  const { transactionDoc, queryAll, saveMerged, unwrapTransactionResult } = createCloudDbHelpers({ db, command })
  return {
    newId(prefix) { return `${prefix}-${now()}-${random().toString(16).slice(2)}` },
    async getBatch(id) { try { return (await db.collection('batches').doc(id).get()).data || null } catch (err) { return null } },
    async listBatchStations(batchId) { return queryAll(db, 'batchStations', { batchId }) },
    async listDueBatches(status, field, timestamp) {
      return (await db.collection('batches').where({ status, [field]: command.lte(timestamp) }).get()).data || []
    },
    async runTransaction(work) {
      const wrapped = await db.runTransaction(async (transaction) => {
        const query = (collection, where) => queryAll(transaction, collection, where)
        const tx = {
          async getBatch(id) { return transactionDoc(transaction, 'batches', id) },
          async getBatchStation(id) { return transactionDoc(transaction, 'batchStations', id) },
          async getStation(id) { return transactionDoc(transaction, 'stations', id) },
          async getSku(id) { return transactionDoc(transaction, 'skus', id) },
          async findPublishedBatchBySaleDate(saleDate, exceptId) { return (await query('batches', { saleDate })).find((row) => row._id !== exceptId && row.status !== '草稿') || null },
          async findAcceptingBatch(exceptId) { return (await query('batches', { status: '接单中' })).find((row) => row._id !== exceptId) || null },
          async listBatchStations(batchId) { return query('batchStations', { batchId }) },
          async listOrdersByBatch(batchId, statuses) { return query('orders', { batchId, status: command.in(statuses) }) },
          async listOrdersByStation(batchStationId, statuses) { return query('orders', { batchStationId, status: command.in(statuses) }) },
          async saveBatch(id, patch) { await saveMerged(transaction, 'batches', id, patch) },
          async saveBatchStation(id, patch) { await saveMerged(transaction, 'batchStations', id, patch) },
          async saveOrder(id, patch) { await saveMerged(transaction, 'orders', id, patch) },
          async createBatchStation(id, row) { await transaction.collection('batchStations').doc(id).set({ data: row }) },
          async createDeliveryWindow(id, row) { await transaction.collection('deliveryWindows').doc(id).set({ data: row }) },
          async createInventory(id, row) { await transaction.collection('batchInventory').doc(id).set({ data: row }) },
          async saveOperationLog(id, row) { await transaction.collection('operationLogs').doc(id).set({ data: row }) },
          async saveNotification(id, row) { await transaction.collection('notificationOutbox').doc(id).set({ data: row }) },
          async touchPublishLock(id, row) { await saveMerged(transaction, 'runtimeLocks', id, row) }
        }
        return work(tx)
      }, 3)
      return unwrapTransactionResult(wrapped)
    }
  }
}

module.exports = { createBatchRepository }
