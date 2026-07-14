// ============================================================
// 泰斓 TAILAN 拼团自提 - M1 云函数入口
// PRD V1.6: 单一 api 云函数，按 action 路由。
// ============================================================
const cloud = require('wx-server-sdk')
const {
  beijingTime,
  beijingTimestamp
} = require('./domain')
const { createOrderActions } = require('./src/services/order-actions')
const { createBatchActions } = require('./src/services/batch-actions')
const { createLifecycleActions } = require('./src/services/lifecycle-actions')
const { createFulfillmentActions } = require('./src/services/fulfillment-actions')
const { createCatalogActions } = require('./src/services/catalog-actions')
const { createCartActions } = require('./src/services/cart-actions')
const { createProfileActions } = require('./src/services/profile-actions')
const { createRefundActions } = require('./src/services/refund-actions')
const { createOrderRepository } = require('./src/repositories/order-repository')
const { createBatchRepository } = require('./src/repositories/batch-repository')
const { createFulfillmentRepository } = require('./src/repositories/fulfillment-repository')
const { createCloudDbHelpers } = require('./src/repositories/cloud-db')
const { createShoppingRepository } = require('./src/repositories/shopping-repository')
const { createAdminCatalogRepository } = require('./src/repositories/admin-catalog-repository')
const { createAdminCatalogActions } = require('./src/services/admin-catalog-actions')
const { ERROR_CODES: V16_ERROR_CODES, failure: v16Failure } = require('./src/shared/response')
const { resolveEntryContext } = require('./src/shared/entry-context')
const { resolveMockPay, resolveDemoAdminAccess } = require('./src/shared/runtime-config')
const { createNotificationOutbox } = require('./src/services/notification-outbox')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const { transactionDoc } = createCloudDbHelpers({ db, command: _ })

// PRD 8：MOCK_PAY 由云函数环境变量控制，默认 true。禁止在代码里写死生产 false。
const MOCK_PAY = resolveMockPay(process.env)
const DEMO_OPEN_ADMIN = resolveDemoAdminAccess(process.env)

const cloudOrderRepository = createOrderRepository({ db, command: _ })
const v16OrderActions = createOrderActions({
  repository: cloudOrderRepository,
  now,
  mockPay: MOCK_PAY
})
const cloudBatchRepository = createBatchRepository({ db, command: _, now })
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
const v16FulfillmentActions = createFulfillmentActions({ repository: createFulfillmentRepository({ db, command: _ }), now })
const shoppingRepository = createShoppingRepository({ db, command: _ })
const catalogActions = createCatalogActions({ repository: shoppingRepository, now })
const cartActions = createCartActions({ repository: shoppingRepository, now })
const profileActions = createProfileActions({ repository: shoppingRepository, now })
const refundActions = createRefundActions({ repository: cloudOrderRepository, systemRefundOrder: v16OrderActions.systemRefundOrder, now })
const adminCatalogActions = createAdminCatalogActions({ repository: createAdminCatalogRepository({ db, command: _ }), now })

const COLLECTIONS = [
  'products', 'skus', 'stations', 'batches', 'batchStations', 'batchInventory',
  'orders', 'admins', 'users', 'refunds', 'verificationLogs', 'deliveryWindows', 'config',
  'placementLogs', 'contactLogs', 'operationLogs', 'notificationOutbox', 'paymentEvents', 'runtimeLocks',
  'carts', 'openGroupNudges', 'businessDays', 'refundRequests', 'categories'
]
let collectionsReadyPromise = null

exports.main = async (event = {}, context = {}) => {
  const wxContext = cloud.getWXContext()
  const { openid, action, trustedSystemTrigger } = resolveEntryContext({ wxContext, event, context })

  try {
    switch (action) {
      case 'initDemo': return trustedSystemTrigger ? await initDemo(openid) : v16Failure(event, now(), V16_ERROR_CODES.FORBIDDEN, '仅受信内部任务可初始化演示数据')
      case 'getCatalogPage': return await getCatalogPage()
      case 'getHomeStatus': return await invokeUserAction(catalogActions, 'getHomeStatus', event, openid)
      case 'nudgeOpenGroup': return await invokeUserAction(catalogActions, 'nudgeOpenGroup', event, openid)
      case 'addToCart': return await invokeUserAction(cartActions, 'addToCart', event, openid)
      case 'getCart': return await invokeUserAction(cartActions, 'getCart', event, openid)
      case 'updateCartItem': return await invokeUserAction(cartActions, 'updateCartItem', event, openid)
      case 'removeCartItem': return await invokeUserAction(cartActions, 'removeCartItem', event, openid)
      case 'clearInvalidCart': return await invokeUserAction(cartActions, 'clearInvalidCart', event, openid)
      case 'updateProfile': return await invokeUserAction(profileActions, 'updateProfile', event, openid)
      case 'getProductDetail': return await getProductDetail(event)
      case 'getStationOptions': return await getStationOptions(event)
      case 'getGroupPage': return await getGroupPage(event, openid)
      case 'createOrder': return await invokeV16OrderAction('createOrder', event, openid)
      case 'payOrder': return await invokeV16OrderAction('payOrder', event, openid)
      case 'queryPaymentResult': return await invokeV16OrderAction('queryPaymentResult', event, openid)
      case 'cancelPendingOrder': return await invokeV16OrderAction('cancelPendingOrder', event, openid)
      case 'requestRefund': return await invokeV16OrderAction('requestRefund', event, openid)
      case 'applyRefundRequest': return await invokeUserAction(refundActions, 'applyRefundRequest', event, openid)
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
      case 'listProducts': return await adminOnly(openid, ['superAdmin'], () => invokeUserAction(adminCatalogActions, 'listProducts', event, openid))
      case 'saveProduct': return await adminOnly(openid, ['superAdmin'], () => invokeUserAction(adminCatalogActions, 'saveProduct', event, openid))
      case 'deleteProduct': return await adminOnly(openid, ['superAdmin'], () => invokeUserAction(adminCatalogActions, 'deleteProduct', event, openid))
      case 'saveSku': return await adminOnly(openid, ['superAdmin'], () => invokeUserAction(adminCatalogActions, 'saveSku', event, openid))
      case 'deleteSku': return await adminOnly(openid, ['superAdmin'], () => invokeUserAction(adminCatalogActions, 'deleteSku', event, openid))
      case 'listCategories': return await adminOnly(openid, ['superAdmin'], () => invokeUserAction(adminCatalogActions, 'listCategories', event, openid))
      case 'saveCategory': return await adminOnly(openid, ['superAdmin'], () => invokeUserAction(adminCatalogActions, 'saveCategory', event, openid))
      case 'deleteCategory': return await adminOnly(openid, ['superAdmin'], () => invokeUserAction(adminCatalogActions, 'deleteCategory', event, openid))
      case 'listStations': return await adminOnly(openid, ['superAdmin'], () => invokeUserAction(adminCatalogActions, 'listStations', event, openid))
      case 'saveStation': return await adminOnly(openid, ['superAdmin'], () => invokeUserAction(adminCatalogActions, 'saveStation', event, openid))
      case 'deleteStation': return await adminOnly(openid, ['superAdmin'], () => invokeUserAction(adminCatalogActions, 'deleteStation', event, openid))
      case 'saveBatchDraft': return await adminOnly(openid, ['superAdmin'], () => invokeV16BatchAction('saveBatchDraft', event, openid))
      case 'getBatchDraft': return await adminOnly(openid, ['superAdmin'], () => invokeV16BatchAction('getBatchDraft', event, openid))
      case 'publishBatch': return await adminOnly(openid, ['superAdmin'], () => invokeV16BatchAction('publishBatch', event, openid))
      case 'manualConfirmDelivery': return await adminOnly(openid, ['superAdmin'], () => invokeV16BatchAction('manualConfirmDelivery', event, openid))
      case 'closeBatch': return await adminOnly(openid, ['superAdmin'], () => invokeV16BatchAction('closeBatch', event, openid))
      case 'closeBatchStation': return await adminOnly(openid, ['superAdmin'], () => invokeV16BatchAction('closeBatchStation', event, openid))
      case 'appendInventory': return await adminOnly(openid, ['superAdmin'], () => invokeV16BatchAction('appendInventory', event, openid))
      case 'setTodayRest': return await adminOnly(openid, ['superAdmin'], () => invokeV16BatchAction('setTodayRest', event, openid))
      case 'resolveRefundRequest': return await adminOnly(openid, ['superAdmin'], () => invokeUserAction(refundActions, 'resolveRefundRequest', event, openid))
      case 'setDeliveryWindow': return await adminOnly(openid, ['superAdmin'], () => setDeliveryWindow(event, openid))
      case 'markArrived': return await adminOnly(openid, ['superAdmin', 'verifier'], (admin) => invokeV16FulfillmentAction('markArrived', event, admin))
      case 'prepList': return await adminOnly(openid, ['superAdmin', 'verifier'], (admin) => invokeV16FulfillmentAction('getPrepList', event, admin))
      case 'verifyOrder': return await adminOnly(openid, ['superAdmin', 'verifier'], (admin) => invokeV16FulfillmentAction('verifyOrder', event, admin))
      case 'assignVerifier': return await adminOnly(openid, ['superAdmin'], (admin) => invokeV16FulfillmentAction('assignVerifier', event, admin))
      case 'contactOrder': return await adminOnly(openid, ['superAdmin', 'verifier'], (admin) => invokeV16FulfillmentAction('contactOrder', event, admin))
      case 'placeOrderAtLocation': return await adminOnly(openid, ['superAdmin', 'verifier'], (admin) => invokeV16FulfillmentAction('placeOrderAtLocation', event, admin))
      case 'finishNoShow': return await adminOnly(openid, ['superAdmin', 'verifier'], (admin) => invokeV16FulfillmentAction('finishNoShow', event, admin))
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

async function invokeUserAction(actions, action, event, openid) {
  const input = { ...event, openid }
  try {
    await ensureCollections()
    return await actions[action](input)
  } catch (err) {
    return v16Failure(input, now(), V16_ERROR_CODES.INTERNAL_ERROR, err.message || '服务器错误')
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
  const lifecycle = await v16LifecycleActions.lifecycleTick({ system: true, requestId: event.requestId || `lifecycle-${now()}` })
  let notifications = { processed: 0, sent: 0, skipped: 0, failed: 0 }
  try {
    notifications = await processNotificationOutbox()
  } catch (err) {
    notifications = { processed: 0, sent: 0, skipped: 0, failed: 0, error: err.message || String(err) }
  }
  if (lifecycle && lifecycle.ok === false) return lifecycle
  return { ...lifecycle, notifications }
}

async function processNotificationOutbox() {
  const cfg = await getDoc('config', 'system')
  const outbox = createNotificationOutbox({
    listPending: async (limit) => {
      const active = (await db.collection('notificationOutbox').where({ status: _.in(['待发送', '发送失败']) }).limit(limit).get()).data || []
      const hasTemplate = Boolean(cfg && (cfg.groupResultTemplateId || cfg.pickupTemplateId))
      if (active.length >= limit || !hasTemplate) return active
      const skipped = (await db.collection('notificationOutbox').where({ status: '跳过-无模板' }).limit(limit - active.length).get()).data || []
      return [...active, ...skipped]
    },
    saveNotice: async (id, row) => {
      const data = { ...row }
      delete data._id
      await db.collection('notificationOutbox').doc(id).set({ data: { ...data } })
    },
    listOrdersForNotice: async (notice) => {
      if (notice.orderId) {
        const order = await getDoc('orders', notice.orderId)
        return order ? [order] : []
      }
      if (notice.batchStationId) {
        const res = await db.collection('orders').where({ batchStationId: notice.batchStationId }).limit(100).get()
        return res.data || []
      }
      return []
    },
    getStation: async (stationId) => (stationId ? getDoc('stations', stationId) : null),
    getConfig: async () => cfg || {},
    sendSubscribeMessage: async (payload) => {
      if (!cloud.openapi || !cloud.openapi.subscribeMessage || !cloud.openapi.subscribeMessage.send) {
        throw new Error('subscribeMessage API unavailable')
      }
      await cloud.openapi.subscribeMessage.send({
        touser: payload.touser,
        templateId: payload.templateId,
        page: payload.page,
        data: payload.data,
        miniprogramState: 'formal'
      })
    },
    now
  })
  return await outbox.processPendingNotifications()
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

function demoAdminActor(openid) {
  return {
    openid,
    role: 'superAdmin',
    status: 'active',
    stationIds: [],
    batchIds: [],
    authorizationScopes: [],
    demoAccess: true
  }
}

async function getEffectiveAdmin(openid) {
  const admin = await getAdmin(openid)
  if (admin) return admin
  return DEMO_OPEN_ADMIN ? demoAdminActor(openid) : null
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
  const admin = await getEffectiveAdmin(openid)
  if (!admin) return fail('你不是管理员')
  if (!roles.includes(admin.role)) return fail('当前角色无权执行该操作')
  return await fn(admin)
}

function assertText(value, label) {
  if (!value || typeof value !== 'string') throw new Error(label + '不能为空')
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
    paidUserCount: row.paidUserCount || 0,
    verifyMode: row.verifyMode || '有人核销',
    formedAt: row.formedAt || null
  }
}

// PRD V1.7：初始化按人/按件分离、双交付模式和同尾号预警演示数据。
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

  await setDoc('config', 'system', { brandName: '泰斓 TAILAN', groupResultTemplateId: '', pickupTemplateId: '', mockPay: MOCK_PAY, phoneOneTapEnabled: false, merchantPhone: '13800000000', createdAt: t, updatedAt: t })
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
    const categoryId = 'demo-category-' + (m.category === '糯香经典' ? 'classic' : m.category === '斑斓软糕' ? 'soft' : 'cool')
    await setDoc('categories', categoryId, { name: m.category, status: '启用', sort: i + 1, createdAt: t, updatedAt: t })
    await setDoc('products', P[i], { name: m.name, thaiName: m.thai, categoryId, category: m.category, description: m.desc, tags: m.tags, images: ['/assets/products/p0' + (i + 1) + '.jpg'], status: '上架', sort: i + 1, createdAt: t, updatedAt: t })
    await setDoc('skus', K[i], { productId: P[i], name: m.name, spec: m.spec, price: m.price, status: '上架', sort: 1, createdAt: t, updatedAt: t })
  }
  await setDoc('stations', stationA, { name: '布吉站', line: '3/14号线', exit: 'A口', pickupNote: '出站口直行20米，认准斑斓绿摊布', arriveAt: '18:30', leaveAt: '19:10', defaultLocationImages: ['/assets/hero.jpg'], locationImages: ['/assets/hero.jpg'], verifyMode: '有人核销', status: 'active', createdAt: t, updatedAt: t })
  await setDoc('stations', stationB, { name: '大学城站', line: '5号线', exit: 'A口', pickupNote: '出站天桥下，认准斑斓绿摊布', arriveAt: '19:45', leaveAt: '20:25', defaultLocationImages: ['/assets/hero.jpg'], locationImages: ['/assets/hero.jpg'], verifyMode: '无人放置', status: 'active', createdAt: t, updatedAt: t })
  await setDoc('batches', batchId, { name: '泰斓 TAILAN ' + dates.pickupDate + ' 自提批次', pickupDate: dates.pickupDate, status: '接单中', deadlineAt: dates.deadlineAt, createdBy: openid, closedAt: null, closedBy: '', closeReason: '', createdAt: t, updatedAt: t })
  await setDoc('batchStations', bsA, { batchId, stationId: stationA, stationName: '布吉站', leaderOpenid: 'demo-buyer-a', thresholdN: 5, verifyMode: '有人核销', status: '拼团中', paidOrderCount: 3, paidItemCount: 6, paidUserCount: 3, createdAt: t, updatedAt: t })
  await setDoc('batchStations', bsB, { batchId, stationId: stationB, stationName: '大学城站', leaderOpenid: 'demo-buyer-d', thresholdN: 5, verifyMode: '无人放置', status: '拼团中', paidOrderCount: 2, paidItemCount: 2, paidUserCount: 2, createdAt: t, updatedAt: t })
  await setDoc('deliveryWindows', 'dw-' + bsA, { batchId, batchStationId: bsA, pickupDate: dates.pickupDate, arriveAt: '18:30', leaveAt: '19:10', waitMinutes: 40, locationNote: '布吉站A口 出站直行20米 斑斓绿摊布', locationImages: ['/assets/hero.jpg'], arrivedAt: null, createdBy: openid, createdAt: t, updatedAt: t })
  await setDoc('deliveryWindows', 'dw-' + bsB, { batchId, batchStationId: bsB, pickupDate: dates.pickupDate, arriveAt: '19:45', leaveAt: '20:25', waitMinutes: 40, locationNote: '大学城站A口 天桥下 斑斓绿摊布', locationImages: ['/assets/hero.jpg'], arrivedAt: null, createdBy: openid, createdAt: t, updatedAt: t })
  for (let i = 0; i < MENU.length; i++) {
    const soldQty = i === 0 ? 8 : 0
    await setDoc('batchInventory', 'inv-' + batchId + '-' + K[i], { batchId, skuId: K[i], totalQty: MENU[i].qty, availableQty: MENU[i].qty - soldQty, reservedQty: 0, soldQty, refundedQty: 0, isUnlimited: false, status: '上架', createdAt: t, updatedAt: t })
  }
  const demoOrders = [
    { id: 'demo-order-a', batchStationId: bsA, stationId: stationA, stationName: '布吉站', verifyMode: '有人核销', userOpenid: 'demo-buyer-a', phone: '13800138000', phoneTail: '8000', quantity: 2, pickupQrToken: 'demo-qr-a-91f3d2' },
    { id: 'demo-order-b', batchStationId: bsA, stationId: stationA, stationName: '布吉站', verifyMode: '有人核销', userOpenid: 'demo-buyer-b', phone: '13900138000', phoneTail: '8000', quantity: 1, pickupQrToken: 'demo-qr-b-72ac49' },
    { id: 'demo-order-c', batchStationId: bsA, stationId: stationA, stationName: '布吉站', verifyMode: '有人核销', userOpenid: 'demo-buyer-c', phone: '13700131111', phoneTail: '1111', quantity: 3, pickupQrToken: 'demo-qr-c-5be821' },
    { id: 'demo-order-d', batchStationId: bsB, stationId: stationB, stationName: '大学城站', verifyMode: '无人放置', userOpenid: 'demo-buyer-d', phone: '13600132222', phoneTail: '2222', quantity: 1, pickupQrToken: 'demo-qr-d-48c127' },
    { id: 'demo-order-e', batchStationId: bsB, stationId: stationB, stationName: '大学城站', verifyMode: '无人放置', userOpenid: 'demo-buyer-e', phone: '13500133333', phoneTail: '3333', quantity: 1, pickupQrToken: 'demo-qr-e-6f4b95' }
  ]
  for (const row of demoOrders) await setDoc('orders', row.id, { batchId, batchStationId: row.batchStationId, stationId: row.stationId, stationName: row.stationName, verifyMode: row.verifyMode, userOpenid: row.userOpenid, contactName: row.userOpenid, items: [{ skuId: K[0], productId: P[0], name: '蝶糯桑卡雅', spec: '1个', quantity: row.quantity, unitPrice: 600, subtotal: row.quantity * 600 }], amount: row.quantity * 600, status: '待自提', phone: row.phone, phoneTail: row.phoneTail, pickupQrToken: row.pickupQrToken, paidAt: t, refundedAt: null, verifiedAt: null, createdAt: t, updatedAt: t })
  return ok({ msg: 'initDemo完成', collections: COLLECTIONS, demo: { batchId, pickupDate: dates.pickupDate, deadlineAt: dates.deadlineAt, batchStations: [bsA, bsB], duplicatePhoneTail: '8000' } })
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

// PRD 5.8：我的订单。
async function myOrders(openid) {
  const orders = (await db.collection('orders').where({ userOpenid: openid }).orderBy('createdAt', 'desc').limit(100).get()).data
  const stationIds = [...new Set(orders.map((o) => o.stationId).filter(Boolean))]
  const batchStationIds = [...new Set(orders.map((o) => o.batchStationId).filter(Boolean))]
  const [stationRows, batchStationRows, deliveryWindowRows] = await Promise.all([
    listDocsByIds('stations', stationIds),
    listDocsByIds('batchStations', batchStationIds),
    listDocsWhereIn('deliveryWindows', 'batchStationId', batchStationIds)
  ])
  const stationById = keyById(stationRows)
  const batchStationById = keyById(batchStationRows)
  const deliveryWindowByBatchStationId = {}
  for (const row of deliveryWindowRows) deliveryWindowByBatchStationId[row.batchStationId] = row
  for (const o of orders) {
    const station = stationById[o.stationId] || null
    const batchStation = batchStationById[o.batchStationId] || null
    o.stationName = station ? station.name : ''
    o.deliveryWindow = deliveryWindowByBatchStationId[o.batchStationId] || null
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

// PRD V1.7：支付成功页读取成团结果和取货提醒两条模板。
async function getPickupNoticeConfig() {
  const cfg = await getDoc('config', 'system')
  return ok({ groupResultTemplateId: cfg ? (cfg.groupResultTemplateId || '') : '', pickupTemplateId: cfg ? (cfg.pickupTemplateId || '') : '' })
}

async function buildMinePayload(openid) {
  await ensureCollections()
  const [userRows, cfg, ordersRes, admin] = await Promise.all([
    db.collection('users').where({ openid }).limit(1).get(),
    getDoc('config', 'system'),
    db.collection('orders').where({ userOpenid: openid }).limit(100).get(),
    getEffectiveAdmin(openid)
  ])
  const user = userRows.data[0] || null
  const orders = ordersRes.data
  const forming = orders.filter((order) => ['预占中', '待配送确认'].includes(order.status)).length
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
  const admin = await getEffectiveAdmin(openid) || await provisionConfiguredSuperAdmin(openid)
  return ok({ isAdmin: Boolean(admin), role: admin ? admin.role : 'user' })
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

// 用户在支付成功页选择两条模板后，把各自意愿写回订单。
async function markPickupSubscribed(event, openid) {
  assertText(event.orderId, 'orderId')
  const order = await getDoc('orders', event.orderId)
  if (!order || order.userOpenid !== openid) return fail('订单不存在或无权操作')
  await db.collection('orders').doc(order._id).update({ data: { subscribeGroupResult: event.subscribeGroupResult === true, subscribePickupNotice: event.subscribePickupNotice === true, updatedAt: now() } })
  return ok({ msg: '订阅选择已保存' })
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
