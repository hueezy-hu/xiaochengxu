// ============================================================
// 泰斓 TAILAN 拼团自提 - M1 云函数入口
// PRD V1.6: 单一 api 云函数，按 action 路由。
// ============================================================
const cloud = require('wx-server-sdk')
const {
  evaluatePaidOrder,
  applyRefundToSnapshots,
  buildVerifyCode,
  beijingTime,
  beijingTimestamp,
  canSelfCancelOrder,
  advanceBatchLifecycle
} = require('./domain')
const { createOrderActions } = require('./src/services/order-actions')
const { createBatchActions } = require('./src/services/batch-actions')
const { createLifecycleActions } = require('./src/services/lifecycle-actions')
const { createFulfillmentActions } = require('./src/services/fulfillment-actions')
const { ERROR_CODES: V16_ERROR_CODES, failure: v16Failure } = require('./src/shared/response')
const { resolveEntryContext } = require('./src/shared/entry-context')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

// PRD 8 / 目标补充：true 用于无商户号时跑通全流程；false 走 cloudPay。
const MOCK_PAY = true

const cloudOrderRepository = createCloudOrderRepository()
const v16OrderActions = createOrderActions({
  repository: cloudOrderRepository,
  now,
  mockPay: MOCK_PAY
})
const cloudBatchRepository = createCloudBatchRepository()
const v16BatchActions = createBatchActions({
  repository: cloudBatchRepository,
  now,
  systemRefundOrder: v16OrderActions.systemRefundOrder
})
const lifecycleOrderActions = {
  expirePendingOrders: (input = {}) => v16OrderActions.expirePendingOrders({ system: true, ...input }),
  systemRefundOrder: (input = {}) => v16OrderActions.systemRefundOrder({ system: true, ...input })
}
const v16LifecycleActions = createLifecycleActions({ repository: cloudBatchRepository, orderActions: lifecycleOrderActions, now })
const v16FulfillmentActions = createFulfillmentActions({ repository: createCloudFulfillmentRepository(), now })

const COLLECTIONS = [
  'products', 'skus', 'stations', 'batches', 'batchStations', 'batchInventory',
  'orders', 'admins', 'users', 'refunds', 'verificationLogs', 'deliveryWindows', 'config',
  'placementLogs', 'contactLogs', 'operationLogs', 'notificationOutbox', 'paymentEvents', 'runtimeLocks'
]
let collectionsReadyPromise = null

exports.main = async (event = {}, context = {}) => {
  const wxContext = cloud.getWXContext()
  const { openid, action, trustedSystemTrigger } = resolveEntryContext({ wxContext, event, context })

  try {
    switch (action) {
      case 'initDemo': return trustedSystemTrigger ? await initDemo(openid) : v16Failure(event, now(), V16_ERROR_CODES.FORBIDDEN, '仅受信内部任务可初始化演示数据')
      case 'getCatalogPage': return await getCatalogPage()
      case 'getProductDetail': return await getProductDetail(event)
      case 'getStationOptions': return await getStationOptions(event)
      case 'getGroupPage': return await getGroupPage(event, openid)
      case 'createOrder': return await invokeV16OrderAction('createOrder', event, openid)
      case 'payOrder': return await invokeV16OrderAction('payOrder', event, openid)
      case 'queryPaymentResult': return await invokeV16OrderAction('queryPaymentResult', event, openid)
      case 'cancelPendingOrder': return await invokeV16OrderAction('cancelPendingOrder', event, openid)
      case 'requestRefund': return await invokeV16OrderAction('requestRefund', event, openid)
      case 'lifecycleTick': return trustedSystemTrigger ? await runLifecycleTick(event) : v16Failure(event, now(), V16_ERROR_CODES.FORBIDDEN, '仅可信定时任务可执行生命周期处理')
      case 'payCallback': return v16Failure(event, now(), V16_ERROR_CODES.PAYMENT_UNKNOWN, '真实支付回调尚未启用')
      case 'myOrders': return await myOrders(openid)
      case 'getOrderDetail': return await getOrderDetail(event, openid)
      case 'checkAdmin': return await checkAdmin(openid)
      case 'getPickupNoticeConfig': return await getPickupNoticeConfig()
      case 'markPickupSubscribed': return await markPickupSubscribed(event, openid)
      case 'getUserProfile': return await getUserProfile(openid)
      case 'getMinePage': return await getMinePage(openid)
      case 'saveUserProfile': return await saveUserProfile(event, openid)
      case 'decodePhoneNumber': return await decodePhoneNumber(event, openid)
      case 'adminDashboard': return await adminOnly(openid, ['superAdmin', 'verifier'], (admin) => invokeV16FulfillmentAction('getWorkspace', event, admin))
      case 'getVerifierWorkspace': return await adminOnly(openid, ['superAdmin', 'verifier'], (admin) => invokeV16FulfillmentAction('getWorkspace', event, admin))
      case 'listProducts': return await adminOnly(openid, ['superAdmin'], () => listProducts())
      case 'saveProduct': return await adminOnly(openid, ['superAdmin'], () => saveProduct(event, openid))
      case 'saveSku': return await adminOnly(openid, ['superAdmin'], () => saveSku(event, openid))
      case 'listStations': return await adminOnly(openid, ['superAdmin'], () => listStations())
      case 'saveStation': return await adminOnly(openid, ['superAdmin'], () => saveStation(event, openid))
      case 'saveBatchDraft': return await adminOnly(openid, ['superAdmin'], () => invokeV16BatchAction('saveBatchDraft', event, openid))
      case 'getBatchDraft': return await adminOnly(openid, ['superAdmin'], () => invokeV16BatchAction('getBatchDraft', event, openid))
      case 'publishBatch': return await adminOnly(openid, ['superAdmin'], () => invokeV16BatchAction('publishBatch', event, openid))
      case 'manualConfirmDelivery': return await adminOnly(openid, ['superAdmin'], () => invokeV16BatchAction('manualConfirmDelivery', event, openid))
      case 'closeBatch': return await adminOnly(openid, ['superAdmin'], () => invokeV16BatchAction('closeBatch', event, openid))
      case 'closeBatchStation': return await adminOnly(openid, ['superAdmin'], () => invokeV16BatchAction('closeBatchStation', event, openid))
      case 'setDeliveryWindow': return await adminOnly(openid, ['superAdmin'], () => setDeliveryWindow(event, openid))
      case 'markArrived': return await adminOnly(openid, ['superAdmin', 'verifier'], (admin) => invokeV16FulfillmentAction('markArrived', event, admin))
      case 'prepList': return await adminOnly(openid, ['superAdmin', 'verifier'], (admin) => invokeV16FulfillmentAction('getPrepList', event, admin))
      case 'verifyOrder': return await adminOnly(openid, ['superAdmin', 'verifier'], (admin) => invokeV16FulfillmentAction('verifyOrder', event, admin))
      case 'assignVerifier': return await adminOnly(openid, ['superAdmin'], (admin) => invokeV16FulfillmentAction('assignVerifier', event, admin))
      case 'contactOrder': return await adminOnly(openid, ['superAdmin', 'verifier'], (admin) => invokeV16FulfillmentAction('contactOrder', event, admin))
      case 'placeOrderAtLocation': return await adminOnly(openid, ['superAdmin', 'verifier'], (admin) => invokeV16FulfillmentAction('placeOrderAtLocation', event, admin))
      case 'endPickupSession': return await adminOnly(openid, ['superAdmin', 'verifier'], (admin) => invokeV16FulfillmentAction('endPickupSession', event, admin))
      case 'retryRefunds': return await adminOnly(openid, ['superAdmin'], () => retryRefunds(event, openid))
      default: return fail('未知操作: ' + (action || '(empty)'))
    }
  } catch (err) {
    return fail(err.message || '服务器错误')
  }
}

function ok(data = {}) { return { ok: true, ...data } }
function fail(msg, extra = {}) { return { ok: false, msg, ...extra } }
function now() { return Date.now() }

async function invokeV16OrderAction(action, event, openid) {
  const input = { ...event, openid }
  try {
    return await v16OrderActions[action](input)
  } catch (err) {
    const t = now()
    return v16Failure(input, t, V16_ERROR_CODES.INTERNAL_ERROR, err.message || '服务器错误')
  }
}

async function invokeV16BatchAction(action, event, openid) {
  const input = { ...event, openid }
  try {
    await ensureCollections()
    return await v16BatchActions[action](input)
  } catch (err) {
    const t = now()
    return v16Failure(input, t, V16_ERROR_CODES.INTERNAL_ERROR, err.message || '服务器错误')
  }
}

async function runLifecycleTick(event = {}) {
  await ensureCollections()
  return await v16LifecycleActions.lifecycleTick({ system: true, requestId: event.requestId || `lifecycle-${now()}` })
}

async function invokeV16FulfillmentAction(action, event, actor) {
  const input = { ...event, actor }
  try {
    await ensureCollections()
    return await v16FulfillmentActions[action](input)
  } catch (err) {
    return v16Failure(input, now(), V16_ERROR_CODES.INTERNAL_ERROR, err.message || '服务器错误')
  }
}

function createCloudOrderRepository() {
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
          async getOrder(id) { return await transactionDoc(transaction, 'orders', id) },
          async getBatch(id) { return await transactionDoc(transaction, 'batches', id) },
          async getBatchStation(id) { return await transactionDoc(transaction, 'batchStations', id) },
          async getSku(id) { return await transactionDoc(transaction, 'skus', id) },
          async getInventory(batchId, skuId) {
            const rows = (await transaction.collection('batchInventory').where({ batchId, skuId }).limit(1).get()).data || []
            return rows[0] || null
          },
          async getRefund(id) { return await transactionDoc(transaction, 'refunds', id) },
          async createOrder(data, id) {
            await transaction.collection('orders').doc(id).set({ data })
            return id
          },
          async saveOrder(id, data) { await transaction.collection('orders').doc(id).update({ data }) },
          async saveBatchStation(id, data) { await transaction.collection('batchStations').doc(id).update({ data }) },
          async saveInventory(row) {
            const { _id, ...data } = row
            await transaction.collection('batchInventory').doc(_id).update({ data })
          },
          async saveRefund(id, data) { await transaction.collection('refunds').doc(id).set({ data }) }
        }
        return await work(tx)
      }, 3)
      return wrapped && Object.prototype.hasOwnProperty.call(wrapped, 'result') ? wrapped.result : wrapped
    }
  }
}

function createCloudBatchRepository() {
  function generatedId(prefix) { return `${prefix}-${now()}-${Math.random().toString(16).slice(2)}` }
  async function listBatchStations(batchId) {
    const rows = []
    const pageSize = 100
    for (let offset = 0; ; offset += pageSize) {
      const page = (await db.collection('batchStations').where({ batchId }).skip(offset).limit(pageSize).get()).data || []
      rows.push(...page)
      if (page.length < pageSize) return rows
    }
  }
  return {
    newId: generatedId,
    async getBatch(id) { return getDoc('batches', id) },
    async listBatchStations(batchId) { return listBatchStations(batchId) },
    async listDueBatches(status, field, timestamp) {
      return (await db.collection('batches').where({ status, [field]: _.lte(timestamp) }).get()).data || []
    },
    async runTransaction(work) {
      const wrapped = await db.runTransaction(async (transaction) => {
        const query = async (collection, where) => {
          const rows = []
          const pageSize = 100
          for (let offset = 0; ; offset += pageSize) {
            const page = (await transaction.collection(collection).where(where).skip(offset).limit(pageSize).get()).data || []
            rows.push(...page)
            if (page.length < pageSize) return rows
          }
        }
        const saveMerged = async (collection, docId, patch) => {
          const existing = await transactionDoc(transaction, collection, docId) || {}
          const { _id, ...data } = { ...existing, ...patch }
          await transaction.collection(collection).doc(docId).set({ data })
        }
        const tx = {
          async getBatch(id) { return transactionDoc(transaction, 'batches', id) },
          async getBatchStation(id) { return transactionDoc(transaction, 'batchStations', id) },
          async getStation(id) { return transactionDoc(transaction, 'stations', id) },
          async getSku(id) { return transactionDoc(transaction, 'skus', id) },
          async findPublishedBatchBySaleDate(saleDate, exceptId) {
            return (await query('batches', { saleDate })).find((row) => row._id !== exceptId && row.status !== '草稿') || null
          },
          async findAcceptingBatch(exceptId) {
            return (await query('batches', { status: '接单中' })).find((row) => row._id !== exceptId) || null
          },
          async listBatchStations(batchId) { return query('batchStations', { batchId }) },
          async listOrdersByBatch(batchId, statuses) { return query('orders', { batchId, status: _.in(statuses) }) },
          async listOrdersByStation(batchStationId, statuses) { return query('orders', { batchStationId, status: _.in(statuses) }) },
          async saveBatch(id, patch) { await saveMerged('batches', id, patch) },
          async saveBatchStation(id, patch) { await saveMerged('batchStations', id, patch) },
          async saveOrder(id, patch) { await saveMerged('orders', id, patch) },
          async createBatchStation(id, row) { await transaction.collection('batchStations').doc(id).set({ data: row }) },
          async createDeliveryWindow(id, row) { await transaction.collection('deliveryWindows').doc(id).set({ data: row }) },
          async createInventory(id, row) { await transaction.collection('batchInventory').doc(id).set({ data: row }) },
          async saveOperationLog(id, row) { await transaction.collection('operationLogs').doc(id).set({ data: row }) },
          async saveNotification(id, row) { await transaction.collection('notificationOutbox').doc(id).set({ data: row }) },
          async touchPublishLock(id, row) { await saveMerged('runtimeLocks', id, row) }
        }
        return work(tx)
      }, 3)
      return wrapped && Object.prototype.hasOwnProperty.call(wrapped, 'result') ? wrapped.result : wrapped
    }
  }
}

function createCloudFulfillmentRepository() {
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
  async function listOrdersByStation(batchStationId, statuses) {
    return queryAll(db, 'orders', { batchStationId, status: _.in(statuses) })
  }
  return {
    async listBatchStations() { return queryAll(db, 'batchStations') },
    async listOrdersByStation(batchStationId, statuses) { return listOrdersByStation(batchStationId, statuses) },
    async getStation(id) { return getDoc('stations', id) },
    async getDeliveryWindowByStation(batchStationId) { return (await queryAll(db, 'deliveryWindows', { batchStationId }))[0] || null },
    async runTransaction(work) {
      const wrapped = await db.runTransaction(async (transaction) => {
        const saveMerged = async (collection, docId, patch) => {
          const existing = await transactionDoc(transaction, collection, docId) || {}
          const { _id, ...data } = { ...existing, ...patch }
          await transaction.collection(collection).doc(docId).set({ data })
        }
        const tx = {
          async getBatchStation(id) { return transactionDoc(transaction, 'batchStations', id) },
          async getOrder(id) { return transactionDoc(transaction, 'orders', id) },
          async getDeliveryWindowByStation(batchStationId) {
            return (await queryAll(transaction, 'deliveryWindows', { batchStationId }))[0] || null
          },
          async findOrderByCode(code) { return (await queryAll(transaction, 'orders', { verifyCode: code }))[0] || null },
          async findAdminByOpenid(openid) { return (await queryAll(transaction, 'admins', { openid }))[0] || null },
          async listOrdersByStation(batchStationId, statuses) { return queryAll(transaction, 'orders', { batchStationId, status: _.in(statuses) }) },
          async listBatchStations(batchId) { return queryAll(transaction, 'batchStations', { batchId }) },
          async saveOrder(id, patch) { await saveMerged('orders', id, patch) },
          async saveBatch(id, patch) { await saveMerged('batches', id, patch) },
          async saveBatchStation(id, patch) { await saveMerged('batchStations', id, patch) },
          async saveDeliveryWindow(id, patch) { await saveMerged('deliveryWindows', id, patch) },
          async saveAdmin(id, patch) { await saveMerged('admins', id, patch) },
          async saveVerificationLog(id, row) { await transaction.collection('verificationLogs').doc(id).set({ data: row }) },
          async saveContactLog(id, row) { await transaction.collection('contactLogs').doc(id).set({ data: row }) },
          async savePlacementLog(id, row) { await transaction.collection('placementLogs').doc(id).set({ data: row }) },
          async saveOperationLog(id, row) { await transaction.collection('operationLogs').doc(id).set({ data: row }) },
          async saveNotification(id, row) { await transaction.collection('notificationOutbox').doc(id).set({ data: row }) }
        }
        return work(tx)
      }, 3)
      return wrapped && Object.prototype.hasOwnProperty.call(wrapped, 'result') ? wrapped.result : wrapped
    }
  }
}

async function transactionDoc(transaction, collection, id) {
  if (!id) return null
  try { return (await transaction.collection(collection).doc(id).get()).data || null } catch (err) { return null }
}

function addDaysToBeijingDate(date, days) {
  return beijingTime(beijingTimestamp(date, '00:00') + days * 24 * 3600 * 1000).date
}

function currentSaleDates(base = now()) {
  const today = beijingTime(base).date
  let deadlineDate = today
  let deadlineAt = beijingTimestamp(deadlineDate, '22:00')
  if (deadlineAt <= base) {
    deadlineDate = addDaysToBeijingDate(today, 1)
    deadlineAt = beijingTimestamp(deadlineDate, '22:00')
  }
  return { pickupDate: addDaysToBeijingDate(deadlineDate, 1), deadlineAt }
}

async function ensureCollections() {
  if (!collectionsReadyPromise) {
    collectionsReadyPromise = (async () => {
      for (const name of COLLECTIONS) {
        try { await db.createCollection(name) } catch (err) { /* exists */ }
      }
    })()
  }
  return collectionsReadyPromise
}

async function setDoc(collection, id, data) {
  const { _id, ...rest } = data || {}
  await db.collection(collection).doc(id).set({ data: rest })
}

async function getDoc(collection, id) {
  if (!id) return null
  try { return (await db.collection(collection).doc(id).get()).data || null } catch (err) { return null }
}

async function listDocsWhereIn(collection, field, values, extraWhere = {}) {
  const uniqueValues = [...new Set((values || []).filter(Boolean))]
  if (!uniqueValues.length) return []
  const chunks = []
  for (let i = 0; i < uniqueValues.length; i += 20) chunks.push(uniqueValues.slice(i, i + 20))
  const pages = await Promise.all(chunks.map((chunk) => db.collection(collection).where({ ...extraWhere, [field]: _.in(chunk) }).get()))
  return pages.reduce((rows, page) => rows.concat(page.data || []), [])
}

async function listDocsByIds(collection, ids) {
  return await listDocsWhereIn(collection, '_id', ids)
}

function keyById(rows) {
  const map = {}
  for (const row of rows || []) map[row._id] = row
  return map
}

async function getAdmin(openid) {
  return (await db.collection('admins').where({ openid, status: 'active' }).limit(1).get()).data[0] || null
}

async function provisionConfiguredSuperAdmin(openid) {
  const configuredOpenid = String(process.env.SUPER_ADMIN_OPENID || '').trim()
  if (!configuredOpenid || configuredOpenid !== openid) return null
  const existing = await getAdmin(openid)
  if (existing) return existing
  await setDoc('admins', 'admin-bootstrap-' + openid.slice(-12), { openid, role: 'superAdmin', status: 'active', source: 'SUPER_ADMIN_OPENID', createdAt: now(), updatedAt: now() })
  return getAdmin(openid)
}

async function adminOnly(openid, roles, fn) {
  const admin = await getAdmin(openid)
  if (!admin) return fail('你不是管理员')
  if (!roles.includes(admin.role)) return fail('当前角色无权执行该操作')
  return await fn(admin)
}

function assertText(value, label) {
  if (!value || typeof value !== 'string') throw new Error(label + '不能为空')
}

function toQty(value) {
  const qty = Number(value)
  if (!Number.isInteger(qty) || qty <= 0) throw new Error('购买数量必须为正整数')
  return qty
}

function publicBatchStation(row) {
  return {
    _id: row._id,
    batchId: row.batchId,
    stationId: row.stationId,
    leaderOpenid: row.leaderOpenid || '',
    thresholdN: row.thresholdN,
    status: row.status,
    paidOrderCount: row.paidOrderCount || 0,
    paidItemCount: row.paidItemCount || 0,
    formedAt: row.formedAt || null
  }
}

async function generateVerifyCode(seed, demo) {
  if (demo) return '638274'
  for (let i = 0; i < 20; i += 1) {
    const code = buildVerifyCode({ seed: seed + '-' + i + '-' + Math.random() })
    const exists = (await db.collection('orders').where({ verifyCode: code }).limit(1).get()).data.length > 0
    if (!exists) return code
  }
  throw new Error('生成核销码失败，请重试')
}

// PRD 12 / 目标补充：初始化全部集合，写入3站点、3SKU、7月8日批次、14/20与21/20、638274。
async function initDemo(openid) {
  await ensureCollections()
  // 安全锁：仅数据库为空（首次引导）或超级管理员可执行，防止线上数据被覆盖。
  const [hasBatch, hasProduct] = await Promise.all([
    db.collection('batches').limit(1).get().then((r) => r.data.length > 0).catch(() => false),
    db.collection('products').limit(1).get().then((r) => r.data.length > 0).catch(() => false)
  ])
  if (hasBatch || hasProduct) {
    const admin = await getAdmin(openid)
    if (!admin || admin.role !== 'superAdmin') return fail('已有正式数据，仅超级管理员可重置演示数据')
  }
  const t = now()
  const dates = currentSaleDates(t)
  const P = ['demo-p1', 'demo-p2', 'demo-p3', 'demo-p4', 'demo-p5']
  const K = ['demo-sku-p1', 'demo-sku-p2', 'demo-sku-p3', 'demo-sku-p4', 'demo-sku-p5']
  const batchId = 'demo-batch-tailan-current'
  const stationA = 'demo-station-buji'
  const stationB = 'demo-station-daxuecheng'
  const bsA = 'demo-bs-buji'
  const bsB = 'demo-bs-daxuecheng'

  await setDoc('config', 'system', { brandName: '泰斓 TAILAN', pickupTemplateId: '', mockPay: MOCK_PAY, phoneOneTapEnabled: false, merchantPhone: '13800000000', createdAt: t, updatedAt: t })
  // 用户资料由微信原生登录流写入；首个管理员由“商家通道”显式绑定。
  const MENU = [
    { name: '蝶糯桑卡雅', thai: 'ข้าวเหนียวอัญชันสังขยาใบเตย', category: '糯香经典', spec: '1个', price: 600, qty: 20,
      desc: '蝶豆花糯米软糯清香，上层是斑斓椰香蛋奶层，一口有糯米香、椰香和斑斓香。', tags: ['软糯', '椰香', '斑斓香', '经典泰式'] },
    { name: '香斓花糕', thai: 'ขนมเปียกปูนใบเตยรูปดอกไม้', category: '斑斓软糕', spec: '1盒', price: 1500, qty: 8,
      desc: '像泰国街边小摊会出现的斑斓软糕，淋上鲜椰奶，入口软糯、清香、很顺滑。', tags: ['软糯', '细腻', '鲜椰奶', '顺滑'] },
    { name: '椰丝洛冲', thai: 'ลอดช่องใบเตยกะทิสด', category: '清爽凉品', spec: '1盒', price: 1500, qty: 8,
      desc: '冰凉斑斓凉条配手抛新鲜椰丝，再蘸上椰奶，Q弹清爽，椰香很足。', tags: ['Q弹', '清爽', '手抛椰丝', '夏日感'] },
    { name: '叶盏西米糕', thai: 'ตะโก้สาคูในกระทงใบเตย', category: '斑斓软糕', spec: '1盒', price: 2600, qty: 5,
      desc: '手折斑斓叶盏装着西米底，上层是细腻椰汁糕，有西米颗粒感、椰香和淡淡叶香，很有仪式感。', tags: ['手折叶盏', '西米颗粒', '椰香', '聚会分享'] },
    { name: '斑斓椰肉团子', thai: 'ขนมต้มใบเตยไส้มะพร้าวอ่อน', category: '糯香经典', spec: '1盒', price: 1800, qty: 6,
      desc: '绿色糯米皮带着淡淡叶香，里面是清甜椰肉馅，一口软糯清香，带一点椰肉嚼感。', tags: ['软糯', '椰肉馅', '清甜', '耐吃'] }
  ]
  for (let i = 0; i < MENU.length; i++) {
    const m = MENU[i]
    await setDoc('products', P[i], { name: m.name, thaiName: m.thai, category: m.category, description: m.desc, tags: m.tags, images: ['/assets/products/p0' + (i + 1) + '.jpg'], status: '上架', sort: i + 1, createdAt: t, updatedAt: t })
    await setDoc('skus', K[i], { productId: P[i], name: m.name, spec: m.spec, price: m.price, status: '上架', sort: 1, createdAt: t, updatedAt: t })
  }
  await setDoc('stations', stationA, { name: '布吉站', line: '3/14号线', exit: 'A口', pickupNote: '出站口直行20米，认准斑斓绿摊布', status: 'active', createdAt: t, updatedAt: t })
  await setDoc('stations', stationB, { name: '大学城站', line: '5号线', exit: 'A口', pickupNote: '出站天桥下，认准斑斓绿摊布', status: 'active', createdAt: t, updatedAt: t })
  await setDoc('batches', batchId, { name: '泰斓 TAILAN ' + dates.pickupDate + ' 自提批次', pickupDate: dates.pickupDate, status: '接单中', deadlineAt: dates.deadlineAt, createdBy: openid, closedAt: null, closedBy: '', closeReason: '', createdAt: t, updatedAt: t })
  await setDoc('batchStations', bsA, { batchId, stationId: stationA, leaderOpenid: 'demo-leader-a', thresholdN: 5, status: '拼团中', paidOrderCount: 3, paidItemCount: 3, createdAt: t, updatedAt: t })
  await setDoc('batchStations', bsB, { batchId, stationId: stationB, leaderOpenid: '', thresholdN: 5, status: '拼团中', paidOrderCount: 0, paidItemCount: 0, createdAt: t, updatedAt: t })
  await setDoc('deliveryWindows', 'dw-' + bsA, { batchStationId: bsA, pickupDate: dates.pickupDate, arriveAt: '18:30', leaveAt: '19:10', waitMinutes: 40, locationNote: '布吉站A口 出站直行20米 斑斓绿摊布', locationImages: [], arrivedAt: null, createdBy: openid, createdAt: t, updatedAt: t })
  await setDoc('deliveryWindows', 'dw-' + bsB, { batchStationId: bsB, pickupDate: dates.pickupDate, arriveAt: '19:45', leaveAt: '20:25', waitMinutes: 40, locationNote: '大学城站A口 天桥下 斑斓绿摊布', locationImages: [], arrivedAt: null, createdBy: openid, createdAt: t, updatedAt: t })
  for (let i = 0; i < MENU.length; i++) {
    await setDoc('batchInventory', 'inv-' + batchId + '-' + K[i], { batchId, skuId: K[i], availableQty: MENU[i].qty, soldQty: 0, isUnlimited: false, status: '上架', createdAt: t, updatedAt: t })
  }
  await setDoc('orders', 'demo-order-638274', { batchId, batchStationId: bsA, stationId: stationA, userOpenid: 'demo-leader-b', items: [{ skuId: K[0], name: '蝶糯桑卡雅', spec: '1个', quantity: 2, unitPrice: 600, subtotal: 1200 }], amount: 1200, status: '待自提', phone: '13800000000', verifyCode: '638274', paidAt: t, refundedAt: null, verifiedAt: null, createdAt: t, updatedAt: t })
  return ok({ msg: 'initDemo完成', collections: COLLECTIONS, demo: { batchId, pickupDate: dates.pickupDate, deadlineAt: dates.deadlineAt, batchStations: [bsA, bsB], verifyCode: '638274' } })
}

// PRD 5.2 / 第五轮：首页和分类页共用聚合数据，首屏只调一次云函数。
async function getCatalogPage() {
  let productsRes, skusRes, batchesRes
  try {
    ;[productsRes, skusRes, batchesRes] = await Promise.all([
      db.collection('products').where({ status: '上架' }).orderBy('sort', 'asc').get(),
      db.collection('skus').where({ status: '上架' }).orderBy('sort', 'asc').get(),
      db.collection('batches').where({ status: '接单中' }).orderBy('deadlineAt', 'asc').limit(1).get()
    ])
  } catch (err) {
    // 集合被整个删除时查询会抛错：自动重建空集合并按"空目录"返回，
    // 让前端的自动初始化逻辑能够触发。
    await ensureCollections()
    return ok({ products: [], skus: [], currentBatch: null, batchStations: [], inventory: [], emptyReason: '无批次且无商品' })
  }
  const products = productsRes.data
  const skus = skusRes.data
  const batches = batchesRes.data
  const batch = batches[0] || null
  const [batchStations, inventory] = batch ? await Promise.all([
    db.collection('batchStations').where({ batchId: batch._id }).get().then((res) => res.data),
    db.collection('batchInventory').where({ batchId: batch._id }).get().then((res) => res.data)
  ]) : [[], []]
  const stationIds = [...new Set(batchStations.map((item) => item.stationId).filter(Boolean))]
  const batchStationIds = batchStations.map((item) => item._id)
  const [stations, deliveryWindows] = await Promise.all([
    listDocsByIds('stations', stationIds),
    listDocsWhereIn('deliveryWindows', 'batchStationId', batchStationIds)
  ])
  const isEmptyCatalog = !batch && products.length === 0
  const [stationRowsForNames, catalogWindows] = await Promise.all([
    listDocsByIds('stations', batchStations.map((x) => x.stationId)),
    listDocsWhereIn('deliveryWindows', 'batchStationId', batchStations.map((x) => x._id))
  ])
  const nameByIdForCatalog = keyById(stationRowsForNames)
  const windowByBsForCatalog = {}
  for (const win of catalogWindows) windowByBsForCatalog[win.batchStationId] = win
  const namedBatchStations = batchStations.map((x) => {
    const st = nameByIdForCatalog[x.stationId] || {}
    const win = windowByBsForCatalog[x._id] || {}
    return {
      ...publicBatchStation(x),
      stationName: st.name || '',
      line: st.line || '',
      exit: st.exit || '',
      windowText: (win.arriveAt && win.leaveAt) ? (win.arriveAt + '-' + win.leaveAt) : '',
      locationNote: win.locationNote || st.pickupNote || ''
    }
  })
  return ok({
    products,
    skus,
    currentBatch: batch,
    batchStations: namedBatchStations,
    inventory,
    stations,
    deliveryWindows,
    emptyReason: isEmptyCatalog ? '无批次且无商品' : ''
  })
}

async function getProductDetail(event) {
  assertText(event.productId, 'productId')
  const product = await getDoc('products', event.productId)
  if (!product || product.status !== '上架') return fail('商品不存在或已下架')
  const skus = (await db.collection('skus').where({ productId: event.productId, status: '上架' }).orderBy('sort', 'asc').get()).data
  const batches = (await db.collection('batches').where({ status: '接单中' }).orderBy('deadlineAt', 'asc').limit(1).get()).data
  const batch = batches[0] || null
  const inventory = batch && skus.length ? (await db.collection('batchInventory').where({ batchId: batch._id, skuId: _.in(skus.map((s) => s._id)) }).get()).data : []
  return ok({ product, skus, currentBatch: batch, inventory })
}

// PRD 5.4：选自提站点页展示开放站点进度。
async function getStationOptions(event) {
  assertText(event.batchId, 'batchId')
  const batchStations = (await db.collection('batchStations').where({ batchId: event.batchId, status: _.in(['拼团中', '已达门槛待确认']) }).get()).data
  const [stations, deliveryWindows] = await Promise.all([
    listDocsByIds('stations', batchStations.map((bs) => bs.stationId)),
    listDocsWhereIn('deliveryWindows', 'batchStationId', batchStations.map((item) => item._id))
  ])
  return ok({ batchStations: batchStations.map(publicBatchStation), stations, deliveryWindows })
}

// PRD 5.5：分享落地到站点团页 groupPage。
async function getGroupPage(event, openid) {
  assertText(event.batchStationId, 'batchStationId')
  const batchStation = await getDoc('batchStations', event.batchStationId)
  if (!batchStation) return fail('站点团不存在')
  const batch = await getDoc('batches', batchStation.batchId)
  const station = await getDoc('stations', batchStation.stationId)
  const deliveryWindow = (await db.collection('deliveryWindows').where({ batchStationId: batchStation._id }).limit(1).get()).data[0] || null
  const isLeader = Boolean(batchStation.leaderOpenid && batchStation.leaderOpenid === openid)
  return ok({ batch, batchStation: publicBatchStation(batchStation), station, deliveryWindow, isLeader, leaderText: isLeader ? '你发起的团' : '' })
}

// PRD 8.1 / 13.3：创建待支付订单，items 固化价格快照；待支付不占库存。
async function createOrder(event, openid) {
  assertText(event.batchStationId, 'batchStationId')
  if (!Array.isArray(event.items) || event.items.length === 0) throw new Error('请选择SKU')
  const batchStation = await getDoc('batchStations', event.batchStationId)
  if (!batchStation) return fail('站点团不存在')
  const batch = await getDoc('batches', batchStation.batchId)
  if (!batch || batch.status !== '接单中') return fail('批次未接单')
  if (Number(batch.deadlineAt || 0) <= now()) return fail('今晚批次已截单，明晚 22:00 前再来拼')
  if (!['拼团中', '已成团继续接单'].includes(batchStation.status)) return fail('站点不可下单')

  const normalizedItems = event.items.map((item) => ({ skuId: item.skuId, quantity: toQty(item.quantity) }))
  const skuIds = [...new Set(normalizedItems.map((item) => item.skuId).filter(Boolean))]
  const [skus, inventoryRows] = await Promise.all([
    listDocsByIds('skus', skuIds),
    skuIds.length ? db.collection('batchInventory').where({ batchId: batch._id, skuId: _.in(skuIds), status: '上架' }).get().then((res) => res.data) : Promise.resolve([])
  ])
  const skuById = keyById(skus)
  const inventoryBySkuId = {}
  for (const inventory of inventoryRows) inventoryBySkuId[inventory.skuId] = inventory
  const orderItems = []
  let amount = 0
  for (const item of normalizedItems) {
    const sku = skuById[item.skuId]
    if (!sku || sku.status !== '上架') return fail('SKU不存在或已下架')
    const inventory = inventoryBySkuId[sku._id]
    if (!inventory) return fail('SKU未加入本批次')
    const quantity = item.quantity
    const subtotal = Number(sku.price) * quantity
    amount += subtotal
    orderItems.push({ skuId: sku._id, name: sku.name, spec: sku.spec, quantity, unitPrice: sku.price, subtotal })
  }
  const verifyCode = await generateVerifyCode(openid + '-' + Date.now(), false)
  const res = await db.collection('orders').add({ data: { batchId: batch._id, batchStationId: batchStation._id, stationId: batchStation.stationId, userOpenid: openid, items: orderItems, amount, status: '待支付', phone: event.phone || '', verifyCode, paidAt: null, refundedAt: null, verifiedAt: null, subscribePickupNotice: Boolean(event.subscribePickupNotice), createdAt: now(), updatedAt: now() } })
  return ok({ orderId: res._id, amount, verifyCode })
}

// PRD 8.1 / 目标补充：MOCK_PAY=true 直接确认；false 返回 cloudPay 参数。
async function payOrder(event, openid) {
  assertText(event.orderId, 'orderId')
  const order = await getDoc('orders', event.orderId)
  if (!order || order.userOpenid !== openid) return fail('订单不存在或无权操作')
  if (order.status !== '待支付') return fail('订单状态不可支付')
  if (MOCK_PAY) return await confirmPaidOrder(order._id, { transactionId: 'mock-' + order._id })

  const outTradeNo = 'BL' + Date.now() + Math.floor(Math.random() * 1000)
  await db.collection('orders').doc(order._id).update({ data: { status: '支付中', outTradeNo, updatedAt: now() } })
  const payment = await cloud.cloudPay.unifiedOrder({ body: '泰斓 TAILAN 拼团自提', outTradeNo, spbillCreateIp: '127.0.0.1', totalFee: order.amount, envId: cloud.DYNAMIC_CURRENT_ENV, functionName: 'api' })
  return ok({ payment, outTradeNo })
}

// PRD 8.2：真实支付回调独立 action，幂等进入统一确认逻辑。
async function payCallback(event) {
  const outTradeNo = event.outTradeNo || event.out_trade_no
  const transactionId = event.transactionId || event.transaction_id || ''
  if (!outTradeNo) return fail('缺少outTradeNo')
  const order = (await db.collection('orders').where({ outTradeNo }).limit(1).get()).data[0]
  if (!order) return fail('订单不存在')
  return await confirmPaidOrder(order._id, { transactionId })
}

async function confirmPaidOrder(orderId, payInfo = {}) {
  const transaction = await db.startTransaction()
  let shouldPushPickupNotice = false
  try {
    const t = now()
    const order = (await transaction.collection('orders').doc(orderId).get()).data
    if (!['待支付', '支付中'].includes(order.status)) {
      await transaction.rollback()
      return ok({ msg: '支付回调已处理', orderId, status: order.status, idempotent: true })
    }
    const batch = (await transaction.collection('batches').doc(order.batchId).get()).data
    const batchStation = (await transaction.collection('batchStations').doc(order.batchStationId).get()).data
    const deliveryWindow = (await transaction.collection('deliveryWindows').where({ batchStationId: order.batchStationId }).limit(1).get()).data[0] || null
    const inventoryBySkuId = {}
    const skuIds = [...new Set((order.items || []).map((item) => item.skuId).filter(Boolean))]
    const inventoryRows = skuIds.length ? (await transaction.collection('batchInventory').where({ batchId: order.batchId, skuId: _.in(skuIds) }).get()).data : []
    for (const inventory of inventoryRows) inventoryBySkuId[inventory.skuId] = inventory
    const decision = evaluatePaidOrder({ now: t, batch, batchStation, deliveryWindow, inventoryBySkuId, order })
    if (!decision.ok) {
      const refundFinal = { ...decision.refundPatch, ...(MOCK_PAY ? { status: '已退款', refundedAt: t } : {}) }
      await transaction.collection('orders').doc(orderId).update({ data: { ...refundFinal, transactionId: payInfo.transactionId || '', updatedAt: t } })
      await transaction.collection('refunds').add({ data: { orderId, refundNo: 'RF' + t + Math.floor(Math.random() * 1000), amount: order.amount, reason: decision.reason, status: MOCK_PAY ? '已退款' : '待退款', requestedAt: t, completedAt: MOCK_PAY ? t : null, retryCount: 0, createdAt: t, updatedAt: t } })
      await transaction.commit()
      return ok({ msg: '支付后自动退款', reason: decision.reason, orderId })
    }
    await transaction.collection('orders').doc(orderId).update({ data: { ...decision.orderPatch, transactionId: payInfo.transactionId || '', updatedAt: t } })
    await transaction.collection('batchStations').doc(order.batchStationId).update({ data: { ...decision.batchStationPatch, updatedAt: t } })
    for (const patch of decision.inventoryPatches) await transaction.collection('batchInventory').doc(patch._id).update({ data: { availableQty: patch.availableQty, soldQty: patch.soldQty, status: patch.status, updatedAt: t } })
    if (decision.triggeredGroupSuccess) {
      await transaction.collection('orders').where({ batchStationId: order.batchStationId, status: '待成团' }).update({ data: { status: deliveryWindow ? '待自提' : '已成团待截单', updatedAt: t } })
      shouldPushPickupNotice = Boolean(deliveryWindow)
    }
    if (decision.batchPatch) await transaction.collection('batches').doc(order.batchId).update({ data: { ...decision.batchPatch, updatedAt: t } })
    await transaction.commit()
    if (shouldPushPickupNotice) await pushPickupNoticeIfConfigured(order.batchStationId)
    return ok({ msg: '支付成功', orderId, formed: decision.triggeredGroupSuccess, autoCutoff: decision.shouldAutoCutoffBatch })
  } catch (err) {
    try { await transaction.rollback() } catch (rollbackErr) { /* ignore */ }
    throw err
  }
}

// PRD 5.8：我的订单。
async function myOrders(openid) {
  const orders = (await db.collection('orders').where({ userOpenid: openid }).orderBy('createdAt', 'desc').limit(100).get()).data
  const stationIds = [...new Set(orders.map((o) => o.stationId).filter(Boolean))]
  const batchStationIds = [...new Set(orders.map((o) => o.batchStationId).filter(Boolean))]
  const [stationRows, batchStationRows] = await Promise.all([
    listDocsByIds('stations', stationIds),
    listDocsByIds('batchStations', batchStationIds)
  ])
  const stationById = keyById(stationRows)
  const batchStationById = keyById(batchStationRows)
  for (const o of orders) {
    const station = stationById[o.stationId] || null
    const batchStation = batchStationById[o.batchStationId] || null
    o.stationName = station ? station.name : ''
    o.isLeader = Boolean(batchStation && batchStation.leaderOpenid && batchStation.leaderOpenid === openid)
  }
  return ok({ orders })
}

// PRD V1.6：C端订单详情只允许订单本人；核销员通过授权工作台读取。
async function getOrderDetail(event, openid) {
  assertText(event.orderId, 'orderId')
  const order = await getDoc('orders', event.orderId)
  if (!order || order.userOpenid !== openid) return fail('订单不存在或无权查看')
  const batchStation = await getDoc('batchStations', order.batchStationId)
  const station = await getDoc('stations', order.stationId)
  const deliveryWindow = (await db.collection('deliveryWindows').where({ batchStationId: order.batchStationId }).limit(1).get()).data[0] || null
  return ok({ order, batchStation, station, deliveryWindow })
}

// PRD 9.2 / 10：成团前退出，回退进度与库存。
async function cancelOrder(event, openid) {
  assertText(event.orderId, 'orderId')
  const order = await getDoc('orders', event.orderId)
  if (!order || order.userOpenid !== openid) return fail('订单不存在或无权操作')
  const batch = await getDoc('batches', order.batchId)
  const decision = canSelfCancelOrder({ order, batch, now: now() })
  if (!decision.ok) return fail(decision.reason)
  return await refundOrder(order._id, '用户取货日10点前自助退款', openid)
}

async function refundOrder(orderId, reason, operatorOpenid) {
  const transaction = await db.startTransaction()
  try {
    const order = (await transaction.collection('orders').doc(orderId).get()).data
    const batchStation = (await transaction.collection('batchStations').doc(order.batchStationId).get()).data
    const inventoryBySkuId = {}
    const skuIds = [...new Set((order.items || []).map((item) => item.skuId).filter(Boolean))]
    const inventoryRows = skuIds.length ? (await transaction.collection('batchInventory').where({ batchId: order.batchId, skuId: _.in(skuIds) }).get()).data : []
    for (const inventory of inventoryRows) inventoryBySkuId[inventory.skuId] = inventory
    const decision = applyRefundToSnapshots({ now: now(), order, batchStation, inventoryBySkuId })
    await transaction.collection('orders').doc(orderId).update({ data: { ...decision.orderPatch, refundReason: reason, updatedAt: now() } })
    await transaction.collection('batchStations').doc(order.batchStationId).update({ data: { ...decision.batchStationPatch, updatedAt: now() } })
    for (const patch of decision.inventoryPatches) await transaction.collection('batchInventory').doc(patch._id).update({ data: { availableQty: patch.availableQty, soldQty: patch.soldQty, status: patch.status, updatedAt: now() } })
    await transaction.collection('refunds').add({ data: { orderId, refundNo: 'RF' + Date.now() + Math.floor(Math.random() * 1000), amount: order.amount, reason, status: MOCK_PAY ? '已退款' : '待退款', requestedAt: now(), completedAt: MOCK_PAY ? now() : null, retryCount: 0, operatorOpenid, createdAt: now(), updatedAt: now() } })
    await transaction.commit()
    if (!MOCK_PAY) await cloud.cloudPay.refund({ outTradeNo: order.outTradeNo, outRefundNo: 'RF' + orderId, totalFee: order.amount, refundFee: order.amount })
    return ok({ msg: MOCK_PAY ? '已模拟退款' : '退款已提交', orderId })
  } catch (err) {
    try { await transaction.rollback() } catch (rollbackErr) { /* ignore */ }
    throw err
  }
}

// PRD 5.7：支付成功页读取唯一订阅模板ID，未配置时前端跳过不报错。
async function getPickupNoticeConfig() {
  const cfg = await getDoc('config', 'system')
  return ok({ pickupTemplateId: cfg ? (cfg.pickupTemplateId || '') : '' })
}

async function buildMinePayload(openid) {
  await ensureCollections()
  const [userRows, cfg, ordersRes, admin] = await Promise.all([
    db.collection('users').where({ openid }).limit(1).get(),
    getDoc('config', 'system'),
    db.collection('orders').where({ userOpenid: openid }).limit(100).get(),
    getAdmin(openid)
  ])
  const user = userRows.data[0] || null
  const orders = ordersRes.data
  const forming = orders.filter((order) => ['待支付', '待配送确认'].includes(order.status)).length
  const pickup = orders.filter((order) => ['待自提', '已放置待自取'].includes(order.status)).length
  return {
    user,
    phoneOneTapEnabled: Boolean(cfg && cfg.phoneOneTapEnabled),
    merchantPhone: (cfg && cfg.merchantPhone) || '',
    orderSummary: { forming, pickup, total: orders.length },
    isAdmin: Boolean(admin),
    role: admin ? admin.role : 'user'
  }
}

// 第三轮优化：用户资料、手机号配置与订单状态摘要。
async function getUserProfile(openid) {
  const payload = await buildMinePayload(openid)
  return ok(payload)
}

async function getMinePage(openid) {
  const payload = await buildMinePayload(openid)
  return ok({ ...payload, userProfile: payload.user })
}

async function saveUserProfile(event, openid) {
  await ensureCollections()
  const input = event.profile || {}
  const existing = (await db.collection('users').where({ openid }).limit(1).get()).data[0] || null
  const phone = input.phone == null ? (existing ? existing.phone || '' : '') : String(input.phone || '').trim()
  if (phone && !/^1\d{10}$/.test(phone)) return fail('请输入有效手机号')
  const id = existing ? existing._id : 'user-' + openid
  const t = now()
  await setDoc('users', id, {
    openid,
    nickname: String(input.nickname == null ? (existing ? existing.nickname || '' : '') : input.nickname).trim(),
    avatarFileId: input.avatarFileId == null ? (existing ? existing.avatarFileId || '' : '') : String(input.avatarFileId || ''),
    phone,
    createdAt: existing ? (existing.createdAt || t) : t,
    updatedAt: t
  })
  return await getUserProfile(openid)
}

async function decodePhoneNumber(event, openid) {
  assertText(event.code, '手机号授权code')
  let phone = ''
  if (cloud.getOpenData) {
    try {
      const opened = await cloud.getOpenData({ list: [event.code] })
      const first = opened && opened.list && opened.list[0]
      const data = first && (first.data || first)
      phone = data && (data.phoneNumber || data.purePhoneNumber || '')
    } catch (err) {
      phone = ''
    }
  }
  if (!phone && cloud.openapi && cloud.openapi.phonenumber && cloud.openapi.phonenumber.getPhoneNumber) {
    const res = await cloud.openapi.phonenumber.getPhoneNumber({ code: event.code })
    const data = res && (res.phone_info || res.phoneInfo || res)
    phone = data && (data.phoneNumber || data.purePhoneNumber || '')
  }
  if (!phone || !/^1\d{10}$/.test(String(phone))) return fail('手机号解析失败')
  return await saveUserProfile({ profile: { phone: String(phone) } }, openid)
}

// PRD 6.1 / 11：查询管理员角色，前端据此隐藏入口。
async function checkAdmin(openid) {
  await ensureCollections()
  const admin = await getAdmin(openid) || await provisionConfiguredSuperAdmin(openid)
  return ok({ isAdmin: Boolean(admin), role: admin ? admin.role : 'user' })
}

// PRD 7.1：商家工作台聚合。
async function adminDashboard() {
  const batches = (await db.collection('batches').orderBy('createdAt', 'desc').limit(20).get()).data
  const batchStations = (await db.collection('batchStations').orderBy('createdAt', 'desc').limit(100).get()).data
  const [stationRows, deliveryWindows] = await Promise.all([
    listDocsByIds('stations', batchStations.map((item) => item.stationId)),
    listDocsWhereIn('deliveryWindows', 'batchStationId', batchStations.map((item) => item._id))
  ])
  const stationById = keyById(stationRows)
  const windowByBatchStationId = {}
  for (const deliveryWindow of deliveryWindows) windowByBatchStationId[deliveryWindow.batchStationId] = deliveryWindow
  for (const item of batchStations) {
    const station = stationById[item.stationId] || null
    const deliveryWindow = windowByBatchStationId[item._id] || null
    item.stationName = station ? station.name : ''
    item.deliveryWindow = deliveryWindow
  }
  const refunds = (await db.collection('refunds').where({ status: _.in(['待审核', '待退款', '退款失败']) }).limit(50).get()).data
  const noShows = (await db.collection('orders').where({ status: '未取货待处理' }).limit(50).get()).data
  return ok({ batches, batchStations, pending: { refunds, noShows } })
}

// PRD 7.9：商品与SKU管理。
async function listProducts() {
  const products = (await db.collection('products').orderBy('sort', 'asc').get()).data
  const skus = (await db.collection('skus').orderBy('sort', 'asc').get()).data
  return ok({ products, skus })
}

// PRD 7.9：商品图片由前端wx.chooseImage + wx.cloud.uploadFile上传后传fileID。
async function saveProduct(event, openid) {
  const product = event.product || {}
  assertText(product.name, '商品名')
  const id = product._id || 'product-' + Date.now()
  await setDoc('products', id, { name: product.name, thaiName: product.thaiName || '', category: product.category || '本周甜品', tags: product.tags || [], description: product.description || '', images: product.images || [], status: product.status || '上架', sort: Number(product.sort || 1), updatedBy: openid, createdAt: product.createdAt || now(), updatedAt: now() })
  return ok({ productId: id })
}

// PRD 7.9 / 13.3：改价只影响新订单。
async function saveSku(event, openid) {
  const sku = event.sku || {}
  assertText(sku.productId, 'productId')
  assertText(sku.name, 'SKU名')
  const id = sku._id || 'sku-' + Date.now()
  await setDoc('skus', id, { productId: sku.productId, name: sku.name, spec: sku.spec || '', price: Number(sku.price || 0), status: sku.status || '上架', sort: Number(sku.sort || 1), updatedBy: openid, createdAt: sku.createdAt || now(), updatedAt: now() })
  return ok({ skuId: id })
}

// PRD 7.2：站点池管理。
async function listStations() {
  return ok({ stations: (await db.collection('stations').orderBy('createdAt', 'asc').get()).data })
}

// PRD 7.2：新增/编辑站点。
async function saveStation(event, openid) {
  const station = event.station || {}
  assertText(station.name, '站点名')
  const id = station._id || 'station-' + Date.now()
  await setDoc('stations', id, { name: station.name, line: station.line || '', exit: station.exit || '', pickupNote: station.pickupNote || '', locationImages: (station.locationImages || []).slice(0, 3), status: station.status || 'active', updatedBy: openid, createdAt: station.createdAt || now(), updatedAt: now() })
  return ok({ stationId: id })
}

// PRD 7.3 / 13.2：创建批次并自动生成站点团、共享库存。
async function createBatch(event, openid) {
  const input = event.batch || {}
  assertText(input.name, '批次名称')
  if (!Array.isArray(input.stations) || input.stations.length === 0) throw new Error('至少选择一个站点')
  if (!Array.isArray(input.inventory) || input.inventory.length === 0) throw new Error('至少选择一个SKU库存')
  const batchId = input._id || 'batch-' + Date.now()
  const pickupDate = input.pickupDate || currentSaleDates().pickupDate
  const deadlineAt = Number(input.deadlineAt || beijingTimestamp(addDaysToBeijingDate(pickupDate, -1), '22:00'))
  await setDoc('batches', batchId, { name: input.name, pickupDate, status: '接单中', deadlineAt, createdBy: openid, closedAt: null, closedBy: '', closeReason: '', createdAt: now(), updatedAt: now() })
  for (const station of input.stations) {
    const batchStationId = 'bs-' + batchId + '-' + station.stationId
    await setDoc('batchStations', batchStationId, { batchId, stationId: station.stationId, leaderOpenid: '', thresholdN: Number(station.thresholdN || 5), status: '拼团中', paidOrderCount: 0, paidItemCount: 0, createdAt: now(), updatedAt: now() })
    const window = station.window || {}
    await setDoc('deliveryWindows', 'dw-' + batchStationId, { batchStationId, pickupDate, arriveAt: window.arriveAt || '', leaveAt: window.leaveAt || '', waitMinutes: Number(window.waitMinutes || 0), locationNote: window.locationNote || '', locationImages: window.locationImages || [], arrivedAt: null, createdBy: openid, createdAt: now(), updatedAt: now() })
  }
  for (const inventory of input.inventory) await setDoc('batchInventory', 'inv-' + batchId + '-' + inventory.skuId, { batchId, skuId: inventory.skuId, availableQty: Number(inventory.availableQty || 0), soldQty: 0, isUnlimited: Boolean(inventory.isUnlimited), status: '上架', createdAt: now(), updatedAt: now() })
  return ok({ batchId })
}

// PRD 7.6：商家手动成团。
async function manualFormGroup(event, openid) {
  assertText(event.batchStationId, 'batchStationId')
  await db.collection('batchStations').doc(event.batchStationId).update({ data: { status: '已成团继续接单', formedAt: now(), manualFormedBy: openid, updatedAt: now() } })
  await db.collection('orders').where({ batchStationId: event.batchStationId, status: '待成团' }).update({ data: { status: '已成团待截单', updatedAt: now() } })
  return ok({ msg: '已手动成团' })
}

// PRD 7.5 / 13.5：手动截单，迟到支付回调自动退款。
async function manualCutoff(event, openid) {
  assertText(event.batchId, 'batchId')
  return await advanceBatchById(event.batchId, openid, true)
}

// PRD 7.6 / 9.1：关团退款。
async function closeGroupRefund(event, openid, defaultReason) {
  assertText(event.batchStationId, 'batchStationId')
  const reason = event.reason || defaultReason
  const orders = (await db.collection('orders').where({ batchStationId: event.batchStationId, status: _.in(['待成团', '已成团待截单', '待自提']) }).get()).data
  for (const order of orders) await refundOrder(order._id, reason, openid)
  await db.collection('batchStations').doc(event.batchStationId).update({ data: { status: '已关闭', closeReason: reason, closedAt: now(), updatedAt: now() } })
  return ok({ msg: '已关团退款', refunded: orders.length })
}

// PRD 7.6：延长截止时间。
async function extendDeadline(event, openid) {
  assertText(event.batchId, 'batchId')
  await db.collection('batches').doc(event.batchId).update({ data: { deadlineAt: Number(event.deadlineAt), extendedBy: openid, updatedAt: now() } })
  return ok({ msg: '已延长截止时间' })
}

// PRD 5.7 / 7.7：修改自提窗口，不触发订阅消息。
async function setDeliveryWindow(event, openid) {
  const input = event.deliveryWindow || {}
  assertText(input.batchStationId, 'batchStationId')
  assertText(input.pickupDate, 'pickupDate')
  assertText(input.arriveAt, 'arriveAt')
  assertText(input.leaveAt, 'leaveAt')
  if (!/^\d{2}:\d{2}$/.test(input.arriveAt) || !/^\d{2}:\d{2}$/.test(input.leaveAt) || input.arriveAt >= input.leaveAt) return fail('自提窗口必须开始早于结束')
  const locationImages = Array.isArray(input.locationImages) ? input.locationImages.filter(Boolean) : []
  if (locationImages.length > 3) return fail('自提地点图片最多3张')
  const batchStation = await getDoc('batchStations', input.batchStationId)
  if (!batchStation) return fail('站点批次不存在')
  if (['关闭退款中', '已关闭', '已完成'].includes(batchStation.status)) return fail('当前站点状态不可修改自提窗口')
  const batch = await getDoc('batches', batchStation.batchId)
  if (!batch) return fail('批次不存在')
  if (input.pickupDate !== batch.pickupDate) return fail('自提日期必须与批次取货日一致')
  const existing = (await db.collection('deliveryWindows').where({ batchStationId: input.batchStationId }).limit(1).get()).data[0] || null
  const id = existing ? existing._id : 'dw-' + input.batchStationId
  await setDoc('deliveryWindows', id, { batchId: batch._id, batchStationId: input.batchStationId, pickupDate: input.pickupDate, arriveAt: input.arriveAt, leaveAt: input.leaveAt, waitMinutes: Number(input.waitMinutes || 0), locationNote: input.locationNote || '', locationImages, arrivedAt: existing && existing.arrivedAt || null, updatedBy: openid, createdAt: existing && existing.createdAt || now(), updatedAt: now() })
  return ok({ deliveryWindowId: id, msg: '自提窗口已修改' })
}

// 用户在支付成功页点"允许"后，把订阅意愿写回订单（推送按此过滤）。
async function markPickupSubscribed(event, openid) {
  assertText(event.orderId, 'orderId')
  const order = await getDoc('orders', event.orderId)
  if (!order || order.userOpenid !== openid) return fail('订单不存在或无权操作')
  await db.collection('orders').doc(order._id).update({ data: { subscribePickupNotice: true, updatedAt: now() } })
  return ok({ msg: '已开启自提通知' })
}

async function pushPickupNoticeIfConfigured(batchStationId) {
  const cfg = await getDoc('config', 'system')
  if (!cfg || !cfg.pickupTemplateId) return { skipped: true }
  const deliveryWindow = (await db.collection('deliveryWindows').where({ batchStationId }).limit(1).get()).data[0] || null
  const orders = (await db.collection('orders').where({ batchStationId, status: '待自提', subscribePickupNotice: true }).get()).data
  let sent = 0
  for (const order of orders) {
    try {
      await cloud.openapi.subscribeMessage.send({
      touser: order.userOpenid,
      templateId: cfg.pickupTemplateId,
      page: 'pages/orderDetail/orderDetail?orderId=' + order._id,
      data: {
        thing1: { value: (deliveryWindow && deliveryWindow.locationNote) || '自提点' },
        time2: { value: deliveryWindow ? (deliveryWindow.pickupDate + ' ' + deliveryWindow.arriveAt + '-' + deliveryWindow.leaveAt) : '自提窗口见取货券' },
        thing3: { value: '请携带核销码取货' }
      }
      })
      sent++
    } catch (err) { /* 单个用户未订阅或超额，跳过 */ }
  }
  return { sent }
}

// PRD 7.7：商家标记我已到达。
async function markArrived(event, openid) {
  assertText(event.deliveryWindowId, 'deliveryWindowId')
  await db.collection('deliveryWindows').doc(event.deliveryWindowId).update({ data: { arrivedAt: now(), arrivedBy: openid, updatedAt: now() } })
  return ok({ msg: '已标记到达' })
}

// PRD 10：退款重试，失败单可反复触发。
async function retryRefunds(event, openid) {
  const rows = (await db.collection('refunds').where({ status: _.in(['待退款', '退款失败']) }).limit(20).get()).data
  let done = 0
  for (const refund of rows) {
    try {
      if (!MOCK_PAY) {
        const order = await getDoc('orders', refund.orderId)
        await cloud.cloudPay.refund({ outTradeNo: order.outTradeNo, outRefundNo: refund.refundNo, totalFee: refund.amount, refundFee: refund.amount })
      }
      await completeRefundRecord(refund._id, refund.orderId)
      done++
    } catch (err) {
      await db.collection('refunds').doc(refund._id).update({ data: { status: '退款失败', retryCount: _.inc(1), lastError: err.message, updatedAt: now() } })
    }
  }
  return ok({ msg: '重试完成', done, total: rows.length })
}

async function completeRefundRecord(refundId, orderId) {
  await db.runTransaction(async (transaction) => {
    const refund = await transactionDoc(transaction, 'refunds', refundId)
    const order = await transactionDoc(transaction, 'orders', orderId)
    if (!refund || !order || refund.status === '已退款') return
    const t = now()
    await transaction.collection('refunds').doc(refundId).update({ data: { status: '已退款', completedAt: t, lastError: '', updatedAt: t } })
    if (order.status === '退款处理中' || ['待退款', '退款失败'].includes(order.refundStatus)) {
      await transaction.collection('orders').doc(orderId).update({ data: { status: '已退款', refundStatus: '已退款', refundedAt: t, updatedAt: t } })
    }
  }, 3)
}
