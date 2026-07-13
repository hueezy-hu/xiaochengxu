const { createCloudDbHelpers } = require('./cloud-db')

function createFulfillmentRepository({ db, command } = {}) {
  const { transactionDoc, queryAll, saveMerged, unwrapTransactionResult } = createCloudDbHelpers({ db, command })
  const listOrdersByStation = (batchStationId, statuses) => queryAll(db, 'orders', { batchStationId, status: command.in(statuses) })
  return {
    async listBatchStations() { return queryAll(db, 'batchStations') },
    async listOrdersByStation(batchStationId, statuses) { return listOrdersByStation(batchStationId, statuses) },
    async getStation(id) { try { return (await db.collection('stations').doc(id).get()).data || null } catch (err) { return null } },
    async getDeliveryWindowByStation(batchStationId) { return (await queryAll(db, 'deliveryWindows', { batchStationId }))[0] || null },
    async listPendingRefundRequests() { return queryAll(db, 'refundRequests', { status: '待处理' }) },
    async runTransaction(work) {
      const wrapped = await db.runTransaction(async (transaction) => {
        const tx = {
          async getBatchStation(id) { return transactionDoc(transaction, 'batchStations', id) },
          async getOrder(id) { return transactionDoc(transaction, 'orders', id) },
          async getDeliveryWindowByStation(batchStationId) { return (await queryAll(transaction, 'deliveryWindows', { batchStationId }))[0] || null },
          async findOrderByQrToken(pickupQrToken) { return (await queryAll(transaction, 'orders', { pickupQrToken }))[0] || null },
          async findOrdersByPhoneTail(batchStationId, phoneTail) { return queryAll(transaction, 'orders', { batchStationId, phoneTail }) },
          async findAdminByOpenid(openid) { return (await queryAll(transaction, 'admins', { openid }))[0] || null },
          async listOrdersByStation(batchStationId, statuses) { return queryAll(transaction, 'orders', { batchStationId, status: command.in(statuses) }) },
          async listBatchStations(batchId) { return queryAll(transaction, 'batchStations', { batchId }) },
          async saveOrder(id, patch) { await saveMerged(transaction, 'orders', id, patch) },
          async saveBatch(id, patch) { await saveMerged(transaction, 'batches', id, patch) },
          async saveBatchStation(id, patch) { await saveMerged(transaction, 'batchStations', id, patch) },
          async saveDeliveryWindow(id, patch) { await saveMerged(transaction, 'deliveryWindows', id, patch) },
          async saveAdmin(id, patch) { await saveMerged(transaction, 'admins', id, patch) },
          async saveVerificationLog(id, row) { await transaction.collection('verificationLogs').doc(id).set({ data: row }) },
          async saveContactLog(id, row) { await transaction.collection('contactLogs').doc(id).set({ data: row }) },
          async savePlacementLog(id, row) { await transaction.collection('placementLogs').doc(id).set({ data: row }) },
          async saveOperationLog(id, row) { await transaction.collection('operationLogs').doc(id).set({ data: row }) },
          async saveNotification(id, row) { await transaction.collection('notificationOutbox').doc(id).set({ data: row }) }
        }
        return work(tx)
      }, 3)
      return unwrapTransactionResult(wrapped)
    }
  }
}

module.exports = { createFulfillmentRepository }
