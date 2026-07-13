function createCloudDbHelpers({ db, command } = {}) {
  if (!db) throw new Error('db必填')

  async function transactionDoc(transaction, collection, id) {
    if (!id) return null
    try {
      return (await transaction.collection(collection).doc(id).get()).data || null
    } catch (err) {
      return null
    }
  }

  async function queryAll(source, collection, where = {}) {
    const rows = []
    const pageSize = 100
    for (let offset = 0; ; offset += pageSize) {
      const collectionRef = source.collection(collection)
      const queryRef = Object.keys(where).length ? collectionRef.where(where) : collectionRef
      const page = (await queryRef.skip(offset).limit(pageSize).get()).data || []
      rows.push(...page)
      if (page.length < pageSize) return rows
    }
  }

  async function saveMerged(transaction, collection, docId, patch) {
    const existing = await transactionDoc(transaction, collection, docId) || {}
    const { _id, ...data } = { ...existing, ...patch }
    await transaction.collection(collection).doc(docId).set({ data })
  }

  function unwrapTransactionResult(value) {
    return value && Object.prototype.hasOwnProperty.call(value, 'result') ? value.result : value
  }

  return { db, command, transactionDoc, queryAll, saveMerged, unwrapTransactionResult }
}

module.exports = { createCloudDbHelpers }
