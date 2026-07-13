# PRD附录B：页面流转与逻辑详解
> 本文按当前代码实际行为写，不按理想 PRD 补脑。
> 已通读 `CLAUDE.md`、`banlan-cake-prd-v1.5.md`（含附录A）、`miniprogram/` 和 `cloudfunctions/api/`。
> 目标读者是非技术创始人：看完要知道用户、商家、系统到底怎么转起来。
> 代码事实：`app.json` 实际注册 14 个页面，不是 13 个。
> 代码事实：云数据库实际是 12 个业务集合 + 1 个 `config` 配置集合。
> 代码事实：单入口云函数 `api` 实际暴露 41 个 action。
> 代码事实：支付当前是 `MOCK_PAY = true`，点“微信支付”后后端直接模拟支付成功。
> 代码事实：支付成功页强引导分享，但不是硬拦截；用户可以直接查看订单或继续购买。
> 代码事实：10:00 退款线不是定时任务，而是用户点退款时由 `cancelOrder` 实时判断。
> 代码事实：商家工作台的 `manualCutoff` 当前调用未定义的 `advanceBatchById`，按钮会失败；定时器 `closeExpired` 是可读到实现的。
## 0. 先用一句话讲清这个产品
泰斓 TAILAN 是一个“今天拼，明天到地铁站自提”的微信小程序。
买家先选甜品，再选地铁站，再付款。
付款后这单才计入该站点的拼团进度，也才扣共享库存。
一个站点满门槛就算成团，成团后还能继续卖，直到库存卖完或批次截单。
商家提前创建明天的批次，同时把每个站点的自提窗口和取货点说明填好。
用户取货日 10:00 前可以自助退款。
10:00 后，代码不让用户自助退，只能截图转让取货券，或走商家售后。
到自提现场，商家用 6 位核销码核销。
没来取的订单，商家结束本场后会转入“未取货待处理”。
---
## 1. 全站页面地图与跳转树
### 1.1 app.json 里实际注册的 14 个页面
1. `pages/home/home`：首页，tabBar 第 1 项。
2. `pages/orders/orders`：我的订单，tabBar 第 3 项。
3. `pages/mine/mine`：我的，tabBar 第 4 项。
4. `pages/catalog/catalog`：点单/商品分类，tabBar 第 2 项。
5. `pages/product/product`：商品详情页。
6. `pages/pickStation/pickStation`：选自提站点页。
7. `pages/paySuccess/paySuccess`：支付成功页。
8. `pages/groupPage/groupPage`：站点团分享落地页。
9. `pages/orderDetail/orderDetail`：订单详情/取货券页。
10. `pages/adminHome/adminHome`：商家工作台。
11. `pages/adminProducts/adminProducts`：商品管理页。
12. `pages/adminBatch/adminBatch`：创建批次页。
13. `pages/adminVerify/adminVerify`：现场核销页。
14. `pages/adminStations/adminStations`：站点池管理页。
### 1.2 tabBar 关系
- tabBar 第 0 位：`pages/home/home`，文案“首页”。
- tabBar 第 1 位：`pages/catalog/catalog`，文案“点单”。
- tabBar 第 2 位：`pages/orders/orders`，文案“我的订单”。
- tabBar 第 3 位：`pages/mine/mine`，文案“我的”。
- 订单角标由 `app.updateOrderBadge(count)` 设置，固定挂在 index=2，也就是“我的订单”。
- 角标数量来自 `myOrders` 或 `getMinePage` 后统计：`待成团`、`已成团待截单`、`待自提`。
- tab 页之间跳转必须用 `wx.switchTab`，代码里首页、团页、我的页都按这个规则写。
- 非 tab 页，例如商品详情、选站、支付成功、取货券、商家后台页，用 `wx.navigateTo` 或 `wx.navigateBack`。
### 1.3 全站跳转树
```text
小程序启动
└─ tabBar：首页 pages/home/home
   ├─ onShow -> app.getCatalogPage() -> action=getCatalogPage
   ├─ 如果云端无批次且无商品 -> action=initDemo -> 再 action=getCatalogPage
   ├─ 点“自提自取” -> switchTab -> pages/catalog/catalog
   ├─ 点“去拼这一批” -> switchTab -> pages/catalog/catalog
   ├─ 点任意站点卡 -> switchTab -> pages/catalog/catalog
   ├─ 点“我的订单” -> switchTab -> pages/orders/orders
   ├─ 点“联系我们” -> open-type=contact，不走云函数
   ├─ 点“规则说明” -> 打开 ruleSheet 半屏组件，不跳页面
   ├─ 首次欢迎弹层点“微信一键登录” -> action=saveUserProfile
   └─ 首次欢迎弹层点“先逛逛” -> 只写本地缓存，不跳页面
点单 tab：pages/catalog/catalog
├─ onShow -> app.getCatalogPage() -> action=getCatalogPage
├─ 点左侧品类 -> 本页切换 activeCategory，不跳页面
├─ 点商品卡 -> navigateTo -> pages/product/product?productId=<productId>&skuId=<skuId>
├─ 点“去拼团” -> navigateTo -> pages/product/product?productId=<productId>&skuId=<skuId>
└─ 分享 -> path=/pages/catalog/catalog
商品详情：pages/product/product
├─ onLoad(productId, skuId) -> action=getProductDetail(productId)
├─ 点返回 -> navigateBack
├─ 点规格 -> 本页 selectedSkuId 变化，不跳页面
├─ 点 -/+ -> 本页 qty 变化，不跳页面
├─ 点“选自提站点” -> navigateTo -> pages/pickStation/pickStation
│  └─ 参数：batchId=<currentBatch._id>&skuId=<sku._id>&qty=<qty>&skuName=<encodeURIComponent(name spec)>&price=<sku.price>
└─ 分享 -> path=/pages/product/product?productId=<productId>
选自提站点：pages/pickStation/pickStation
├─ onLoad(batchId, skuId, qty, skuName, price)
├─ 并发调用 action=getStationOptions(batchId) 与 action=getUserProfile
├─ 点返回 -> navigateBack
├─ 点站点卡 -> 本页 selectedId=<batchStationId>，不跳页面
├─ 点“微信支付”但昵称或手机号缺失 -> 打开支付前资料弹层
├─ 资料弹层点头像 -> wx.cloud.uploadFile 到 avatars/，不走 api action
├─ 资料弹层点“一键获取手机号” -> action=decodePhoneNumber(code)
├─ 资料弹层点“确认并支付” -> action=saveUserProfile -> 继续 pay()
└─ 点“微信支付”且资料齐全 -> action=createOrder -> action=payOrder -> navigateTo pages/paySuccess/paySuccess?orderId=<orderId>&batchStationId=<selectedId>
支付成功：pages/paySuccess/paySuccess
├─ onLoad(orderId, batchStationId)
├─ 并发调用 action=getOrderDetail(orderId)、action=getGroupPage(batchStationId)、action=getPickupNoticeConfig
├─ 再异步调用 action=myOrders，用于刷新订单角标
├─ 如果订单状态是 支付后退款中/已退款 -> 展示“本单已自动退款”，隐藏分享区
├─ 点“分享到微信群” -> open-type=share -> path=/pages/groupPage/groupPage?batchStationId=<batchStationId>
├─ 点“开启自提通知” -> wx.requestSubscribeMessage -> action=markPickupSubscribed(orderId)
├─ 点“查看订单”且有 order -> navigateTo -> pages/orderDetail/orderDetail?orderId=<orderId>
├─ 点“查看订单”但没有 order -> switchTab -> pages/orders/orders
└─ 点“继续购买”或退款卡“回首页看看” -> switchTab -> pages/home/home
站点团页：pages/groupPage/groupPage
├─ onLoad(batchStationId)
├─ 并发调用 action=getGroupPage(batchStationId) 与 action=getCatalogPage
├─ 点“去参团” -> switchTab -> pages/catalog/catalog
│  └─ 注意：按钮带 productid/skuid，但 goBuy 没使用参数，所以实际只回点单页
├─ 点“再喊几个人” -> open-type=share -> path=/pages/groupPage/groupPage?batchStationId=<batchStationId>
├─ 点“我也要买” -> switchTab -> pages/home/home
└─ 注意：代码写的是 oonShareTimeline，不是 onShareTimeline，所以朋友圈分享回调实际不会生效
我的订单 tab：pages/orders/orders
├─ onShow -> action=myOrders
├─ 如果从“我的”页跳入，先读本地 ordersFilter 决定默认筛选
├─ 点筛选 tab -> 本页过滤 all/待成团/待自提/已完成，不跳页面
├─ 点订单卡 -> navigateTo -> pages/orderDetail/orderDetail?orderId=<orderId>
├─ 点“喊人拼团” -> navigateTo -> pages/groupPage/groupPage?batchStationId=<batchStationId>
└─ 点“10点前可退” -> modal确认 -> action=cancelOrder(orderId) -> 本页 reload
取货券：pages/orderDetail/orderDetail
├─ onLoad(orderId 或 id) -> action=getOrderDetail(orderId)
├─ 点返回 -> navigateBack
├─ 点“联系商家” -> open-type=contact，不走 api action
├─ 点“取货日10点前自助退款” -> modal确认 -> action=cancelOrder(orderId) -> reload
└─ 点“申请售后” -> ActionSheet：商家违约退款/申请顺延/联系商家
   ├─ 商家违约退款 -> action=applyAfterSale(orderId,type=refund,reason)
   ├─ 申请顺延 -> action=applyAfterSale(orderId,type=postpone,reason)
   └─ 联系商家 -> showToast 提醒点微信客服
我的 tab：pages/mine/mine
├─ onShow -> action=getMinePage
├─ 点“待成团/待自提/全部订单” -> app.setOrdersFilter(status) -> switchTab pages/orders/orders
├─ 点“联系商家” -> open-type=contact
├─ 点“规则说明” -> ruleSheet 半屏组件，不跳页面
├─ 已是管理员时点“商家管理” -> navigateTo pages/adminHome/adminHome
├─ 已是管理员时点“现场核销” -> navigateTo pages/adminVerify/adminVerify
└─ 点底部“商家通道” -> 如果 isAdmin 直接 navigateTo adminHome；否则 action=bindAdmin -> 成功后 navigateTo adminHome
商家工作台：pages/adminHome/adminHome
├─ onShow -> action=checkAdmin；失败后 switchTab pages/mine/mine
├─ 成功后并发 action=adminDashboard 与 action=applyAfterSale(operation=listPending)
├─ 点返回 -> switchTab pages/mine/mine
├─ 点“开始核销” -> navigateTo pages/adminVerify/adminVerify
├─ 点“备料清单” -> navigateTo pages/adminVerify/adminVerify
├─ 点“我已到达” -> action=markArrived(deliveryWindowId=dw-<第一个站点团id>)
├─ 点“手动成团” -> action=manualFormGroup(batchStationId)
├─ 点“手动截单” -> action=manualCutoff(batchId)
│  └─ 注意：当前 action 内调用未定义 advanceBatchById，实际会失败
├─ 点“更多操作” -> ActionSheet
│  ├─ 修改自提窗口 -> 打开本页窗口表单 -> action=setDeliveryWindow(deliveryWindow)
│  ├─ 延长截止时间 -> action=extendDeadline(batchId, deadlineAt=现在+24小时)
│  └─ 关团退款 -> 二次确认 -> action=closeGroupRefund(batchStationId)
├─ 点“审核通过” -> action=reviewRefund(refundId, approve=true)
├─ 点“驳回” -> action=reviewRefund(refundId, approve=false)
├─ 点未取货“标记顺延” -> action=markOrderPostponed(orderId,note)
├─ 点未取货“退款” -> action=adminRefundOrder(orderId,reason=未取货商家退款)
├─ 点“重试退款” -> action=retryRefunds
├─ 点“商品管理” -> navigateTo pages/adminProducts/adminProducts
├─ 点“创建批次” -> navigateTo pages/adminBatch/adminBatch
├─ 点“现场核销” -> navigateTo pages/adminVerify/adminVerify
└─ 点“站点管理” -> navigateTo pages/adminStations/adminStations
商品管理：pages/adminProducts/adminProducts
├─ onShow -> action=checkAdmin，要求 role=superAdmin
├─ 成功后 action=listProducts
├─ 点商品卡 -> 本页载入商品表单，不跳页面
├─ 点“上传图片” -> wx.chooseMedia -> wx.cloud.uploadFile 到 products/
├─ 点“删除” -> 本页移除 imageFileIds，不走 action
├─ 点“保存商品” -> action=saveProduct(product)
├─ 点 SKU 行 -> 本页载入 SKU 表单，不跳页面
├─ 点“+新SKU” -> 本页清空 SKU 表单
├─ 点“保存上架” -> action=saveSku(sku,status=上架)
└─ 点“保存下架” -> action=saveSku(sku,status=下架)
创建批次：pages/adminBatch/adminBatch
├─ onShow -> action=checkAdmin，要求 role=superAdmin
├─ 成功后并发 action=listStations 与 action=listProducts
├─ 点返回 -> navigateBack
├─ 点站点行 -> 本页 toggleStation，不跳页面
├─ 点“+照片” -> wx.chooseMedia -> wx.cloud.uploadFile 到 pickup/
├─ 点照片“×” -> 本页移除 locationImages，不走 action
├─ 点 SKU 行 -> 本页 toggleSku，不跳页面
└─ 点“发布批次 · 各站开团” -> action=createBatch(batch) -> 成功后 navigateBack
现场核销：pages/adminVerify/adminVerify
├─ onShow -> action=checkAdmin，要求 isAdmin
├─ 成功后 action=adminDashboard，筛出状态为 待自提/已成团继续接单/拼团中 的站点团
├─ 选站点 picker -> 本页 batchStationId 改变 -> action=prepList(batchStationId)
├─ 点返回 -> navigateBack
├─ 输入 6 位码点“核销” -> action=verifyOrder(code,method=input)
├─ 点“扫码核销” -> wx.scanCode -> parseScanCode -> action=verifyOrder(code,method=scan)
├─ 点“我已到达” -> action=markArrived(deliveryWindowId=dw-<batchStationId>)
└─ 点“结束本场自提” -> modal确认 -> action=markNoShowOrders(batchStationId)
站点池管理：pages/adminStations/adminStations
├─ onShow -> action=checkAdmin，要求 role=superAdmin
├─ 成功后 action=listStations
├─ 点返回 -> navigateBack
├─ 点“+新增” -> 本页打开新增表单
├─ 点站点行 -> 本页打开编辑表单
├─ 点“切换” -> 本页 status 在 active/disabled 之间切换
├─ 点“保存” -> action=saveStation(station)
└─ 点“取消” -> 本页关闭表单
```
---
## 2. 三条核心动线逐步拆解
### 2.1 买家线：首页 -> 点单 -> 商品 -> 选站 -> 支付 -> 分享 -> 订单 -> 取货券
#### 买家线第 1 步：小明打开首页 `pages/home/home`
- 用户看到什么：泰斓 TAILAN 的 hero 图、品牌文案、“自提自取”入口、“今天拼 · 明天取”批次卡、布吉/大学城站点卡、规则说明。
- 用户点什么：可以点“自提自取”、站点卡、“去拼这一批”，也可以先看规则。
- 前端做什么：`home.onShow()` 先尝试读 `tailanHomeCache`，再调用 `app.getCatalogPage()`。
- 调哪个 action：`getCatalogPage`。
- 数据库读什么：`products`、`skus`、当前 `batches`、当前批次的 `batchStations`、`batchInventory`、`stations`、`deliveryWindows`。
- 数据库写什么：正常不写；如果没有批次且没有商品，并且本地没标记初始化过，会自动调用 `initDemo` 写演示数据。
- 页面如何反馈：有缓存先秒开；云端返回后刷新站点进度、门槛、窗口、库存与首页主图。
- 例子：小明打开首页，看到“布吉站已拼 3/5 份，还差 2 份成团”。
#### 买家线第 2 步：小明从首页进点单页 `pages/catalog/catalog`
- 用户看到什么：左边是分类，右边是商品卡；每个商品显示图、描述、剩余份数、起售价、“去拼团”。
- 用户点什么：点“自提自取”或站点卡后进入点单页。
- 前端做什么：`home.goCatalog()` 执行 `wx.switchTab({ url:'/pages/catalog/catalog' })`。
- 调哪个 action：进入 catalog 后 `catalog.onShow()` 再调用 `getCatalogPage`。
- 数据库读什么：仍是商品、SKU、当前批次、站点团、共享库存。
- 数据库写什么：不写。
- 页面如何反馈：按 `products.category` 生成分类；按 `batchInventory.availableQty` 算剩余份数。
- 例子：小明点“糯香经典”，看到“蝶糯桑卡雅 ¥6起，剩 20 份”。
#### 买家线第 3 步：小明进商品详情页 `pages/product/product`
- 用户看到什么：商品图片轮播、分类、库存、商品描述、规格、数量加减、底部合计和“选自提站点”。
- 用户点什么：点商品卡或“去拼团”。
- 前端做什么：`catalog.goProduct()` 执行 `navigateTo('/pages/product/product?productId=...&skuId=...')`。
- 调哪个 action：`getProductDetail(productId)`。
- 数据库读什么：`products` 当前商品、该商品的 `skus`、当前接单中的 `batches`、该批次里这些 SKU 的 `batchInventory`。
- 数据库写什么：不写。
- 页面如何反馈：展示当前 SKU 价格和库存；点 `+` 会检查本批库存上限，超过就 toast “本批库存只剩 X 份啦”。
- 例子：小明选“蝶糯桑卡雅 1个”，数量点到 2，底部合计变成 ¥12。
#### 买家线第 4 步：小明选站点 `pages/pickStation/pickStation`
- 用户看到什么：站点卡，每张卡有站名、线路、出口、已拼份数、还差几份、自提窗口、取货点说明。
- 用户点什么：点“选自提站点”，然后点“布吉站”。
- 前端做什么：`product.goPickStation()` 带上 `batchId`、`skuId`、`qty`、`skuName`、`price` 跳转。
- 调哪个 action：`getStationOptions(batchId)` 和 `getUserProfile` 并发调用。
- 数据库读什么：`batchStations`、`stations`、`deliveryWindows`、`users`、`config`、`orders`、`admins`。
- 数据库写什么：不写。
- 页面如何反馈：选中站点后底部按钮从“先选一个站”变成“微信支付”。
- 例子：小明点布吉站，底部显示“蝶糯桑卡雅 1个 × 2，¥12，微信支付”。
#### 买家线第 5 步：支付前补资料
- 用户看到什么：如果昵称或手机号缺失，底部弹层出现“完成微信登录后支付”。
- 用户点什么：填昵称、填手机号，或者有企业能力时点“一键获取手机号”。
- 前端做什么：`pickStation.needsCheckoutAuth()` 检查昵称和手机号；缺失就 `showCheckoutAuth=true`。
- 调哪个 action：手填后 `saveUserProfile`；一键手机号时 `decodePhoneNumber`。
- 数据库读什么：`users`、`config`。
- 数据库写什么：`users` 写入 `openid`、`nickname`、`avatarFileId`、`phone`。
- 页面如何反馈：资料保存成功后关闭弹层，自动继续 `pay()`。
- 例子：小明第一次下单，填写“小明”和 138 开头手机号，确认后继续支付。
#### 买家线第 6 步：创建订单 `createOrder`
- 用户看到什么：按钮显示“支付中...”。
- 用户点什么：点“微信支付”。
- 前端做什么：`pickStation.pay()` 先调用 `createOrder`。
- 调哪个 action：`createOrder({ batchStationId, items:[{skuId,quantity}], phone })`。
- 数据库读什么：`batchStations`、`batches`、`skus`、`batchInventory`。
- 数据库写什么：`orders` 新增一条 `status='待支付'` 的订单。
- 重要边界：创建订单不扣库存、不加进度；只是固化价格快照和 6 位核销码。
- 失败条件：批次不是 `接单中`、`deadlineAt` 已过、站点团状态不是 `拼团中/已成团继续接单`、SKU 下架、SKU 未加入本批次。
- 页面如何反馈：失败 toast；成功得到 `orderId` 后继续支付。
- 例子：小明布吉站买 2 份，`orders.items` 固化单价 600 分，`amount=1200`。
#### 买家线第 7 步：模拟支付成功 `payOrder`
- 用户看到什么：仍在“支付中...”，随后跳到支付成功页。
- 用户点什么：不用再点，前端自动继续。
- 前端做什么：`pickStation.pay()` 调 `payOrder({orderId})`。
- 调哪个 action：`payOrder`；当前 `MOCK_PAY=true`，所以直接进 `confirmPaidOrder`。
- 数据库读什么：事务内读 `orders`、`batches`、`batchStations`、`deliveryWindows`、`batchInventory`。
- 数据库写什么：事务内更新 `orders`、`batchStations`、`batchInventory`，必要时更新 `batches` 和新增 `refunds`。
- 成功路径：扣库存，加站点已付件数，加已付订单数，设置团长 openid，跨门槛时触发成团。
- 失败路径：如果支付回调时批次已截单、站点不可下单或库存不足，整单自动退款。
- 页面如何反馈：成功后 `navigateTo('/pages/paySuccess/paySuccess?orderId=...&batchStationId=...')`。
- 例子：布吉原来 3/5，小明买 2 份后变成 5/5，布吉站点团跨过门槛。
#### 买家线第 8 步：成团触发与订阅推送
- 用户看到什么：支付成功页显示“团开起来了，你是发起人！”或“支付成功！”。
- 用户点什么：可以点“分享到微信群”或“开启自提通知”。
- 前端做什么：`paySuccess.load()` 调 `getOrderDetail`、`getGroupPage`、`getPickupNoticeConfig`。
- 调哪个 action：`getOrderDetail`、`getGroupPage`、`getPickupNoticeConfig`，点订阅后 `markPickupSubscribed`。
- 数据库读什么：`orders`、`batchStations`、`stations`、`deliveryWindows`、`config`。
- 数据库写什么：点订阅后 `orders.subscribePickupNotice=true`。
- 成团推送实际发生点：不是 22:00 定时截单，而是 `confirmPaidOrder` 发现本次付款让站点跨过门槛时，调用 `pushPickupNoticeIfConfigured(batchStationId)`。
- 推送过滤条件：只给该站点 `status='待自提'` 且 `subscribePickupNotice=true` 的订单发。
- 页面如何反馈：订阅完成 toast “站点团成团时会提醒你”。
- 例子：小明买完让布吉站成团，之前同意订阅的布吉买家会收到自提通知。
#### 买家线第 9 步：分享不是硬门槛
- 用户看到什么：支付成功页把“分享到微信群”放在主卡片里，文案会说还差几份或已成团。
- 用户点什么：可以点分享，也可以点“查看订单”或“继续购买”。
- 前端做什么：分享按钮是 `open-type=share`，路径为 `pages/groupPage/groupPage?batchStationId=...`。
- 调哪个 action：分享动作本身不走云函数；被分享者打开团页才调 `getGroupPage`。
- 数据库读什么：无。
- 数据库写什么：无。
- 页面如何反馈：微信原生分享面板弹出。
- 例子：小明可以把布吉团发群里，但系统不会强制他必须发完才能看订单。
#### 买家线第 10 步：被分享者打开站点团页 `groupPage`
- 用户看到什么：站点名、进度条、还差几份、已参团人数、正在拼的 SKU 列表。
- 用户点什么：点“去参团”或“我也要买”。
- 前端做什么：`groupPage.load()` 并发调用 `getGroupPage` 和 `getCatalogPage`。
- 调哪个 action：`getGroupPage(batchStationId)`、`getCatalogPage`。
- 数据库读什么：站点团、批次、站点、窗口、商品、SKU、库存。
- 数据库写什么：不写。
- 页面如何反馈：可买时按钮显示“去参团”；售罄或暂停时显示“已售罄/暂停中”。
- 注意：`goBuy` 实际只 `switchTab` 到点单页，没有把团页按钮上的 productid/skuid 继续带下去。
#### 买家线第 11 步：看订单列表 `orders`
- 用户看到什么：全部、待成团、待自提、已完成四个筛选；每张订单有状态、核销码、商品、站点、退款提示。
- 用户点什么：点订单卡，或点“喊人拼团”，或点“10点前可退”。
- 前端做什么：`orders.onShow()` 调 `myOrders`，并刷新 tabBar 角标。
- 调哪个 action：`myOrders`；退款时 `cancelOrder`。
- 数据库读什么：`orders`，再关联 `stations` 和 `batchStations`。
- 数据库写什么：看列表不写；退款会写 `orders`、`batchStations`、`batchInventory`、`refunds`。
- 页面如何反馈：退款成功 toast “已提交退款”，然后重新加载订单。
#### 买家线第 12 步：看取货券 `orderDetail`
- 用户看到什么：站名、出口、凭码自提、大号 6 位核销码、二维码、商品数量金额、自提窗口、取货点指引、取货点照片。
- 用户点什么：点“联系商家”、点“取货日10点前自助退款”、点“申请售后”。
- 前端做什么：`orderDetail.load()` 调 `getOrderDetail`；二维码由本地 `weapp-qrcode.js` 画在 canvas。
- 调哪个 action：`getOrderDetail(orderId)`；退款时 `cancelOrder`；售后时 `applyAfterSale`。
- 数据库读什么：`orders`、`batchStations`、`stations`、`deliveryWindows`。
- 数据库写什么：看券不写；退款和售后会写。
- 页面如何反馈：退款/售后提交后 toast，并重新加载订单详情。
- 例子：小明把布吉站取货券截图给朋友，朋友到站报 6 位码也能取，因为核销只认码。
### 2.2 商家线：商家通道 -> 工作台 -> 创建批次 -> 核销 -> 结束自提 -> 售后
#### 商家线第 1 步：从“我的”页进入商家通道
- 用户看到什么：`pages/mine/mine` 底部有“商家通道”。
- 用户点什么：点“商家通道”。
- 前端做什么：如果 `isAdmin=true`，直接 `navigateTo(adminHome)`；否则调用 `bindAdmin`。
- 调哪个 action：`getMinePage`、`bindAdmin`。
- 数据库读什么：`admins`、`users`、`orders`、`config`。
- 数据库写什么：如果 `admins` 为空，`bindAdmin` 写入 `admins/admin-<openid>`，角色 `superAdmin`。
- 页面如何反馈：首个管理员绑定成功后进入商家工作台；已有管理员时弹窗显示 openid，可复制给现有超管。
#### 商家线第 2 步：进入商家工作台 `adminHome`
- 用户看到什么：今日自提、开始核销、我已到达、各站进度、待处理、商品/批次/核销/站点入口。
- 用户点什么：可以进入核销、创建批次、商品管理、站点管理，也可以手动成团、更多操作、处理售后。
- 前端做什么：`adminHome.guard()` 先查权限，`load()` 再拉工作台数据。
- 调哪个 action：`checkAdmin`、`adminDashboard`、`applyAfterSale(operation=listPending)`。
- 数据库读什么：`admins`、`batches`、`batchStations`、`stations`、`deliveryWindows`、`refunds`、`orders`。
- 数据库写什么：刚进入不写。
- 页面如何反馈：无权限 toast 后回“我的”；有权限显示角色和各站进度。
#### 商家线第 3 步：创建批次 `adminBatch`
- 用户看到什么：批次名称、取货日、截止时间戳、开放站点、每站窗口、取货点照片、门槛、共享库存。
- 用户点什么：点“创建批次”进入；填写窗口；勾选站点和 SKU；最后点“发布批次 · 各站开团”。
- 前端做什么：`adminBatch.guard()` 要求 `superAdmin`，`load()` 拉站点和商品。
- 调哪个 action：`checkAdmin`、`listStations`、`listProducts`、`createBatch`。
- 数据库读什么：`admins`、`stations`、`products`、`skus`。
- 数据库写什么：`createBatch` 写 `batches`、每个站点一条 `batchStations`、每个站点一条 `deliveryWindows`、每个 SKU 一条 `batchInventory`。
- 页面如何反馈：成功 toast “批次已发布，各站开团”，然后返回上一页。
- 代码事实：页面初始 `thresholdN` 是 4；如果商家不改，前端会把 4 发给后端。后端默认值是 5，但只有前端没传时才生效。
- 例子：老板创建 7月10日批次，开放布吉和大学城，布吉 18:30-19:10，大学城 19:45-20:25，每个 SKU 20 份共享库存。
#### 商家线第 4 步：手动成团与更多操作
- 用户看到什么：工作台每个站点团有进度条，“手动成团”和“更多操作”。
- 用户点什么：点“手动成团”。
- 前端做什么：`adminHome.action()` 读取 `data-action='manualFormGroup'` 和 `data-id=batchStationId`。
- 调哪个 action：`manualFormGroup(batchStationId)`。
- 数据库读什么：主要由云函数直接按 id 更新。
- 数据库写什么：`batchStations.status='已成团继续接单'`，`formedAt=now`，同站点 `orders.status='待成团'` 批量改为 `已成团待截单`。
- 页面如何反馈：toast “已手动成团”，然后工作台 reload。
- 注意：手动成团不会直接把这些订单改成 `待自提`，而是 `已成团待截单`。
#### 商家线第 5 步：修改窗口、延长截止、关团退款
- 用户看到什么：点“更多操作”后出现 ActionSheet：修改自提窗口、延长截止时间、关团退款。
- 用户点什么：选其中一个。
- 前端做什么：修改窗口打开本页弹层；延长截止直接把 deadlineAt 设为当前时间 + 24 小时；关团退款要二次确认。
- 调哪个 action：`setDeliveryWindow`、`extendDeadline`、`closeGroupRefund`。
- 数据库读什么：工作台已读过 `deliveryWindows`；操作时主要按 id 写。
- 数据库写什么：窗口写 `deliveryWindows`；延长写 `batches.deadlineAt`；关团退款写 `orders`、`batchStations`、`batchInventory`、`refunds`。
- 页面如何反馈：toast 后 reload。
- 例子：布吉站下雨临时换到 B 口，老板用“修改自提窗口”改 `locationNote`，买家取货券下次打开会看到新说明。
#### 商家线第 6 步：现场核销 `adminVerify`
- 用户看到什么：站点选择器、6 位码输入框、扫码核销、本场进度、备料清单、订单明细。
- 用户点什么：选站点，输入顾客报码，点“核销”；或点“扫码核销”。
- 前端做什么：`adminVerify.loadStations()` 从工作台数据筛出进行中的站点团，再 `prepList` 拉备料。
- 调哪个 action：`checkAdmin`、`adminDashboard`、`prepList`、`verifyOrder`。
- 数据库读什么：`admins`、`batchStations`、`orders`。
- 数据库写什么：核销成功时 `orders.status='已完成'`，写 `orders.verifiedAt`，并新增 `verificationLogs`。
- 页面如何反馈：toast “核销成功”，本场进度刷新。
- 二次核销：如果订单已经 `已完成`，`verifyOrder` 返回“该码已核销过”。
- 例子：小明到布吉站报码 638274，商家输入后订单变成已完成，日志记录核销人和方式。
#### 商家线第 7 步：结束本场自提
- 用户看到什么：现场核销页有“结束本场自提”。
- 用户点什么：点按钮，看到确认弹窗。
- 前端做什么：计算还有多少单未核销，提示将转入“未取货待处理”。
- 调哪个 action：`markNoShowOrders(batchStationId)`。
- 数据库读什么：不需要先读，直接按条件更新。
- 数据库写什么：把该站点 `orders.status='待自提'` 的订单批量改成 `未取货待处理`。
- 页面如何反馈：toast “已结束，转待处理 X 单”，然后重新拉 `prepList`。
- 例子：大学城站 10 单里核销了 8 单，结束本场后剩下 2 单进入待处理。
#### 商家线第 8 步：售后与未取货处理
- 用户看到什么：工作台“待处理”里有退款待审核数量、未取货待处理数量、重试退款按钮。
- 用户点什么：退款申请点“审核通过/驳回”；未取货订单点“标记顺延/退款”。
- 前端做什么：通过不同按钮调用不同 action。
- 调哪个 action：`reviewRefund`、`markOrderPostponed`、`adminRefundOrder`、`retryRefunds`。
- 数据库读什么：`refunds`、`orders`、必要时 `batchStations` 和 `batchInventory`。
- 数据库写什么：通过退款会走统一 `refundOrder`，写 `orders.status='已退款'`、回退 `batchStations` 件数和订单数、回补 `batchInventory`、新增或更新 `refunds`。
- 页面如何反馈：toast 后 reload。
- 代码事实：`reviewRefund` 的驳回分支只更新 `refunds.status='已驳回'`，没有同步更新 `orders.afterSaleStatus/refundStatus`；订单页可能仍显示审核中，后续应修。
### 2.3 系统线：22:00 定时截单 -> 成团推送 -> 10点退款窗口关闭
#### 系统线第 1 步：定时器如何触发
- 用户看到什么：用户无感知。
- 商家看到什么：下一次打开工作台时看到批次/站点状态变化。
- 前端做什么：没有前端参与。
- 调哪个 action：云函数入口检测 `event.Type==='Timer'`、`event.TriggerName` 或 `context.triggerName`，自动把 action 设成 `closeExpired`。
- 数据库读什么：`batches` 中 `status='接单中'` 且 `deadlineAt < now()` 的批次。
- 数据库写什么：后续步骤写。
- 频率：`cloudfunctions/api/config.json` 配的是每 10 分钟一次。
#### 系统线第 2 步：22:00 后批次推进
- 用户看到什么：如果还在首页或点单页，下一次刷新会看到批次状态变化或无可下单站点。
- 商家看到什么：批次变为已截单，未成团站点关闭，已成团站点待自提。
- 前端做什么：无。
- 调哪个 action：`closeExpired`。
- 数据库读什么：每个过期批次的 `batchStations`。
- 数据库写什么：`batches.status='已截单'`，`closedAt`、`closedBy`、`closeReason='截止时间到达'`。
- 判断规则：`advanceBatchLifecycle` 用 `formedAt`、站点状态、或 `paidItemCount >= thresholdN` 判断站点是否已成团。
#### 系统线第 3 步：未成团站点如何处理
- 用户看到什么：订单会变为已退款，列表显示“已退款 ¥X 原路退回”。
- 商家看到什么：站点团状态变成已关闭。
- 前端做什么：下次 `myOrders` 或 `adminDashboard` 读取后呈现。
- 调哪个 action：`closeExpired` 内部调用 `closeGroupRefund(batchStationId, reason='到期未成团')`。
- 数据库写什么：相关订单改 `已退款`；`batchStations` 回退件数与订单数后写 `已关闭`；`batchInventory` 回补；新增 `refunds`。
- 例子：大学城站只有 2/5，22:00 后这 2 单被统一退款，大学城站团关闭。
#### 系统线第 4 步：已成团站点如何处理
- 用户看到什么：取货券仍可用，订单应继续处于待自提类状态。
- 商家看到什么：站点团状态变成 `待自提`。
- 前端做什么：下次读取后显示为待自提/已成团。
- 调哪个 action：`closeExpired`。
- 数据库写什么：`batchStations.status='待自提'`。
- 代码事实：这一步只更新站点团 `batchStations`，没有批量更新 `orders`。
- 影响：如果某些订单之前停在 `已成团待截单`，定时截单不会把它们统一改成 `待自提`。
#### 系统线第 5 步：成团推送实际在哪里发生
- 用户看到什么：订阅过的买家会收到“自提通知”。
- 商家看到什么：无专门反馈。
- 前端做什么：买家在支付成功页点“开启自提通知”后，订单写入订阅意愿。
- 调哪个 action：`markPickupSubscribed` 写订阅意愿；真正发送由 `confirmPaidOrder` 调 `pushPickupNoticeIfConfigured`。
- 数据库读什么：`config.pickupTemplateId`、该站 `deliveryWindows`、该站 `orders`。
- 数据库写什么：发送本身不写；订阅时写 `orders.subscribePickupNotice=true`。
- 代码事实：22:00 `closeExpired` 没有调用推送；推送是在支付跨门槛成团的那一刻触发。
#### 系统线第 6 步：取货日 10:00 退款窗口如何关闭
- 用户看到什么：10:00 前点退款可以成功；10:00 后点退款会提示不可自助退款，可转卖或转让取货券。
- 商家看到什么：没有自动任务提醒。
- 前端做什么：订单页和取货券页仍显示“10点前可退”按钮，只是点了后以后端结果为准。
- 调哪个 action：`cancelOrder(orderId)`。
- 数据库读什么：`orders` 和对应 `batches.pickupDate`。
- 数据库写什么：10:00 前写退款相关集合；10:00 后不写，直接失败返回。
- 判断逻辑：`canSelfCancelOrder` 用 `beijingTimestamp(pickupDate,'10:00')` 生成北京时间截止点。
- 例子：小明 09:59 点退款，订单可退；10:01 点退款，返回“取货日10:00后不可自助退款”。
---
## 3. 订单状态机全图
### 3.1 批次状态 `batches.status`
- `接单中`
- 进入条件：`initDemo` 或 `createBatch` 创建批次时写入。
- 退出路径：`closeExpired` 到截止时间；库存售罄时 `evaluatePaidOrder` 返回 `batchPatch`；商家手动截单理论上走 `manualCutoff`。
- 谁触发：系统定时器、支付成功事务、商家按钮。
- 用户看到：首页/点单页显示当前批次可买。
- 商家看到：工作台当前批次进行中。
- `已截单`
- 进入条件：`closeExpired` 推进；或全部有限库存卖完；理论上手动截单。
- 退出路径：代码里没有恢复接单的路径，只能新建批次或延长仍接单的批次。
- 谁触发：系统定时器、支付成功事务。
- 用户看到：新订单会被 `createOrder` 拒绝或支付后自动退款。
- 商家看到：批次已经停止接单。
### 3.2 站点团状态 `batchStations.status`
- `拼团中`
- 进入条件：`initDemo` 或 `createBatch` 创建每个站点团。
- 退出路径：支付后件数达到门槛 -> `已成团继续接单`；截止仍未成团 -> `已关闭`；商家手动成团 -> `已成团继续接单`。
- 谁触发：买家付款、定时器、商家。
- 用户看到：站点卡显示“拼团中”“还差 X 份”。
- 商家看到：工作台显示 paidItemCount/thresholdN。
- `已成团继续接单`
- 进入条件：某笔 `payOrder` 让 `paidItemCount >= thresholdN`；或商家 `manualFormGroup`。
- 退出路径：22:00 定时截单后变 `待自提`；商家关团退款变 `已关闭`。
- 谁触发：买家付款、商家。
- 用户看到：站点卡显示“已成团 · 还能下单”。
- 商家看到：站点已成团但仍可继续卖。
- 设计重点：后续退款即使把件数退到门槛以下，也不自动退回“拼团中”。
- `待自提`
- 进入条件：`closeExpired` 对已成团站点推进；也可被 `isStationAccepting` 视为仍可下单状态。
- 退出路径：商家关团退款可改 `已关闭`；代码没有站点级完成状态。
- 谁触发：系统定时器或商家关团。
- 用户看到：订单/取货券进入取货表达。
- 商家看到：核销页优先选 `待自提` 站点。
- `已关闭`
- 进入条件：未成团到点关闭；商家关团退款；未成团退款后件数归零时退款逻辑也可能写已关闭。
- 退出路径：代码里没有重开路径。
- 谁触发：定时器、商家、退款事务。
- 用户看到：不能继续下单，相关订单多为已退款。
- 商家看到：站点团关闭。
### 3.3 订单状态 `orders.status`
- `待支付`
- 进入条件：`createOrder` 成功后新增订单。
- 退出路径：`payOrder` MOCK 直接确认；真实支付先转 `支付中`。
- 谁触发：买家点“微信支付”。
- 用户看到：通常很短暂，MOCK 模式几乎看不到。
- 商家看到：工作台不重点展示待支付订单。
- `支付中`
- 进入条件：`MOCK_PAY=false` 时 `payOrder` 调真实支付前写入。
- 退出路径：`payCallback` 进入 `confirmPaidOrder`。
- 谁触发：真实支付回调。
- 用户看到：可能停在支付流程中。
- 商家看到：不作为可核销订单。
- `待成团`
- 进入条件：支付成功后站点未达到门槛。
- 退出路径：下一笔付款跨门槛后改 `待自提` 或 `已成团待截单`；用户 10:00 前自助退改 `已退款`；未成团到点关团退款改 `已退款`。
- 谁触发：买家付款、其他买家付款、用户退款、定时器。
- 用户看到：订单列表“待成团”，按钮“喊人拼团”和“10点前可退”。
- 商家看到：工作台站点进度未满。
- `已成团待截单`
- 进入条件：支付成功跨门槛但没有窗口时；或商家 `manualFormGroup` 把待成团订单批量改过来。
- 退出路径：代码里没有清晰的订单级自动转 `待自提` 路径；用户仍可 10:00 前退款；售后允许。
- 谁触发：支付事务或商家手动成团。
- 用户看到：订单列表归在“待自提”筛选里，但按钮仍可“喊人拼团”和“10点前可退”。
- 商家看到：核销备料列表不会包含这个状态，因为 `prepList` 只查 `待自提/已完成/未取货待处理`。
- `待自提`
- 进入条件：支付后已成团且存在 `deliveryWindow`；或同站点跨门槛时把原 `待成团` 订单批量改为 `待自提`。
- 退出路径：核销 -> `已完成`；结束本场未核销 -> `未取货待处理`；10:00 前自助退款 -> `已退款`；售后退款通过 -> `已退款`。
- 谁触发：支付事务、商家核销、商家结束本场、用户退款、商家售后。
- 用户看到：取货券、核销码、自提窗口、取货点指引。
- 商家看到：核销页备料和订单明细。
- `已完成`
- 进入条件：`verifyOrder` 成功核销。
- 退出路径：普通商家直接退款 `adminRefundOrder` 禁止已完成；但用户售后退款申请通过 `reviewRefund` 仍会走 `refundOrder` 改成已退款。
- 谁触发：核销员或超级管理员。
- 用户看到：订单列表“已完成”，取货券仍可查看，也可申请售后。
- 商家看到：核销页本场进度 doneCount 增加。
- `未取货待处理`
- 进入条件：商家在核销页点“结束本场自提”，`markNoShowOrders` 批量修改未核销订单。
- 退出路径：商家可 `markOrderPostponed` 改 `已顺延`；或 `adminRefundOrder` 改 `已退款`；也可仍被 `verifyOrder` 核销成 `已完成`。
- 谁触发：商家。
- 用户看到：订单详情可申请售后；具体文案不算强提醒。
- 商家看到：工作台“未取货待处理”。
- `已顺延`
- 进入条件：商家在工作台未取货订单上点“标记顺延”。
- 退出路径：代码无跨批次迁移；仍可被商家退款。
- 谁触发：商家。
- 用户看到：订单详情 refundText 可能显示“顺延申请中”取决于 afterSaleStatus；单纯 `已顺延` 主要是状态。
- 商家看到：订单不再是未取货待处理。
- `已退款`
- 进入条件：用户自助退款、未成团关团退款、库存不足自动退款、商家关团退款、售后通过、未取货退款。
- 退出路径：代码里没有恢复路径。
- 谁触发：用户、系统、商家。
- 用户看到：订单列表显示“已退款 ¥X 原路退回”。
- 商家看到：退款记录在 `refunds`，订单终态。
- `支付后退款中`
- 进入条件：真实支付模式下，支付回调后发现批次不接单、站点不可下单或库存不足。
- 退出路径：真实退款成功后应由退款处理改终态；当前 `retryRefunds` 只更新 `refunds`，不更新 `orders`。
- 谁触发：真实支付回调。
- 用户看到：支付成功页按退款卡处理，显示“本单已自动退款”。
- 商家看到：`refunds` 有待退款或退款失败记录。
- 代码事实：MOCK 模式会直接写 `已退款`，所以本地测试通常不会停在这个状态。
### 3.4 售后/退款辅助状态
- `refunds.status='待审核'`：用户在取货券页申请商家违约退款后进入。
- `refunds.status='审核通过'`：商家工作台点审核通过，随后立即走 `refundOrder`。
- `refunds.status='已驳回'`：商家驳回后写入退款单。
- `refunds.status='待退款'`：真实支付模式下退款待调用微信退款。
- `refunds.status='退款失败'`：真实退款异常后进入，可点重试。
- `refunds.status='已退款'`：MOCK 或真实退款成功后的退款单终态。
- `orders.afterSaleStatus='退款审核中'`：用户提交商家违约退款申请后写入订单。
- `orders.afterSaleStatus='顺延申请中'`：用户申请顺延后写入订单。
- `orders.refundStatus='待审核/已驳回/已退款'`：部分售后路径会写，部分路径没有同步，展示以代码实际字段为准。
---
## 4. 数据模型讲解：12 个业务集合 + 1 个配置集合
### 4.1 主链先看清：batch -> batchStation -> order
```text
batches（一场明天自提的总批次）
└─ batchStations（这个批次下，每个地铁站各一条站点团）
   ├─ deliveryWindows（这个站点团的自提窗口和取货点照片）
   ├─ orders（买家在这个站点团下的订单）
   └─ batchInventory（不是挂在站点团下，而是挂在批次下的共享 SKU 库存）
```
- `batches` 回答“明天这一批什么时候截单、什么时候取”。
- `batchStations` 回答“布吉站/大学城站各自拼到几份了”。
- `orders` 回答“小明这笔订单买了什么，在哪个站取，核销码是什么”。
- `deliveryWindows` 回答“布吉站几点到几点、A口哪里等、有没有照片”。
- `batchInventory` 回答“这个批次每个 SKU 全站共享还剩几份”。
- 例子：小明在布吉站买 2 份，订单会指向同一个 `batchId` 和布吉的 `batchStationId`。
- 例子：小红在大学城买同一个 SKU，会扣同一个批次的 `batchInventory`，不是大学城单独库存。
### 4.2 `products`：商品 SPU
- 存什么：商品本体，比如“蝶糯桑卡雅”“香斓花糕”。
- 关键字段：`name` 商品名。
- 关键字段：`thaiName` 泰文名，演示数据有。
- 关键字段：`category` 分类，点单页左侧分类来自这里。
- 关键字段：`description` 商品描述。
- 关键字段：`tags` 标签，演示数据有，但当前页面展示不多。
- 关键字段：`images[]` 商品图片，点单页和详情页用第一张或轮播。
- 关键字段：`status`，`上架` 才会在 C 端读取。
- 关联：一个 `product` 有多个 `skus`。
### 4.3 `skus`：商品规格和价格
- 存什么：具体可售规格，比如“蝶糯桑卡雅 · 1个 · ¥6”。
- 关键字段：`productId`，指向 `products._id`。
- 关键字段：`name`、`spec`，订单快照会复制这两个字段。
- 关键字段：`price`，单位是分。
- 关键字段：`status`，`上架` 才能被选。
- 关联：`batchInventory.skuId` 指向 `skus._id`。
- 关联：`orders.items[].skuId` 指向下单时选择的 SKU。
- 设计重点：改价不影响已付订单，因为订单里有价格快照。
### 4.4 `stations`：站点池
- 存什么：商家可开团的地铁站。
- 关键字段：`name`，如布吉站、大学城站。
- 关键字段：`line`，如 3/14号线。
- 关键字段：`exit`，如 A口。
- 关键字段：`pickupNote`，默认取货点说明。
- 关键字段：`status`，`active` 才会在创建批次页默认可选。
- 关联：`batchStations.stationId` 指向 `stations._id`。
- 关联：`orders.stationId` 保存买家这单所在站点。
### 4.5 `batches`：日批次
- 存什么：一场“今天下单、明天自提”的总批次。
- 关键字段：`name`，批次名。
- 关键字段：`pickupDate`，取货日，格式 `YYYY-MM-DD`。
- 关键字段：`status`，主要是 `接单中`、`已截单`。
- 关键字段：`deadlineAt`，下单截止时间戳。
- 关键字段：`createdBy`，创建人 openid。
- 关键字段：`closedAt`、`closedBy`、`closeReason`，截单信息。
- 关联：一个 `batch` 有多个 `batchStations`。
- 关联：一个 `batch` 有多条 `batchInventory`。
- 关联：`orders.batchId` 指向它。
### 4.6 `batchStations`：每站拼团进度
- 存什么：一个批次下，一个站点的一场团。
- 关键字段：`batchId`，指向 `batches._id`。
- 关键字段：`stationId`，指向 `stations._id`。
- 关键字段：`leaderOpenid`，第一位付款用户会成为发起人。
- 关键字段：`thresholdN`，成团门槛份数。
- 关键字段：`status`，如 `拼团中`、`已成团继续接单`、`待自提`、`已关闭`。
- 关键字段：`paidOrderCount`，已付款订单数。
- 关键字段：`paidItemCount`，已付款商品件数，成团看这个。
- 关键字段：`formedAt`，成团时间。
- 关联：`orders.batchStationId` 指向它。
- 关联：`deliveryWindows.batchStationId` 指向它。
### 4.7 `batchInventory`：批次共享库存
- 存什么：某批次下每个 SKU 的共享库存。
- 关键字段：`batchId`，指向 `batches._id`。
- 关键字段：`skuId`，指向 `skus._id`。
- 关键字段：`availableQty`，当前可卖份数。
- 关键字段：`soldQty`，已售份数。
- 关键字段：`isUnlimited`，是否不限量。
- 关键字段：`status`，如 `上架`、`售罄`。
- 关联：支付成功事务按 `batchId + skuId` 扣减。
- 设计重点：布吉和大学城共用同一批库存，不拆站点库存。
### 4.8 `deliveryWindows`：自提窗口和地点
- 存什么：每个站点团的到达时间、离开时间、取货点说明和照片。
- 关键字段：`batchStationId`，指向 `batchStations._id`。
- 关键字段：`pickupDate`，取货日。
- 关键字段：`arriveAt`、`leaveAt`，窗口时间。
- 关键字段：`waitMinutes`，等待时长。
- 关键字段：`locationNote`，比如“布吉站A口 出站直行20米”。
- 关键字段：`locationImages[]`，取货点照片 fileID。
- 关键字段：`arrivedAt`、`arrivedBy`，商家到达记录。
- 关联：取货券、站点卡、成团推送都会读它。
### 4.9 `orders`：买家订单和取货券
- 存什么：每个买家的具体订单。
- 关键字段：`batchId`，指向批次。
- 关键字段：`batchStationId`，指向站点团。
- 关键字段：`stationId`，冗余保存站点，方便列表展示。
- 关键字段：`userOpenid`，买家身份。
- 关键字段：`items[]`，商品快照，含 `skuId/name/spec/quantity/unitPrice/subtotal`。
- 关键字段：`amount`，订单总金额，单位分。
- 关键字段：`status`，订单状态机核心。
- 关键字段：`phone`，取货联系手机号。
- 关键字段：`verifyCode`，6 位核销码，全局查重生成。
- 关键字段：`subscribePickupNotice`，是否订阅成团/自提通知。
- 关键字段：`paidAt/refundedAt/verifiedAt`，支付、退款、核销时间。
- 关键字段：`afterSaleType/afterSaleStatus/refundStatus`，售后辅助字段。
### 4.10 `users`：用户资料
- 存什么：微信 openid 对应的昵称、头像、手机号。
- 关键字段：`openid`，身份根。
- 关键字段：`nickname`，首页欢迎弹层或支付前资料弹层保存。
- 关键字段：`avatarFileId`，头像上传后的云存储 fileID。
- 关键字段：`phone`，下单时必须有。
- 关联：`orders.userOpenid` 与 `users.openid` 对应。
- 设计重点：首页不强制登录，支付前才强制补齐。
### 4.11 `admins`：管理员白名单
- 存什么：谁能进商家后台。
- 关键字段：`openid`，管理员身份。
- 关键字段：`role`，如 `superAdmin`、`verifier`。
- 关键字段：`name`、`phone`。
- 关键字段：`status='active'` 才有效。
- 关联：所有商家 action 都先查 `admins`。
- 设计重点：首个进入商家通道的人，在 `admins` 为空时可绑定成超级管理员。
### 4.12 `refunds`：退款和售后单
- 存什么：所有退款请求、退款处理状态、售后审核。
- 关键字段：`orderId`，指向订单。
- 关键字段：`refundNo`，退款单号。
- 关键字段：`userOpenid`，用户申请售后时会写。
- 关键字段：`amount`，退款金额。
- 关键字段：`status`，如 `待审核`、`待退款`、`退款失败`、`已退款`、`已驳回`。
- 关键字段：`reason`，退款原因。
- 关键字段：`source='afterSale'`，用户售后申请。
- 关键字段：`operatorOpenid`，商家或系统退款时记录操作者。
- 关键字段：`retryCount/lastError`，真实退款失败重试用。
- 关联：工作台待处理列表读取它。
### 4.13 `verificationLogs`：核销日志
- 存什么：每次成功核销的记录。
- 关键字段：`orderId`。
- 关键字段：`verifyCode`。
- 关键字段：`adminOpenid`，谁核销的。
- 关键字段：`verifyMethod`，`input` 或 `scan`。
- 关键字段：`verifiedAt`。
- 关联：`verifyOrder` 成功时写入。
- 设计重点：二次核销会被拒绝，日志只记录成功核销。
### 4.14 `config`：系统配置集合
- 存什么：不是业务主集合，但代码会创建和读取。
- 关键字段：固定 doc id 是 `system`。
- 关键字段：`brandName='泰斓 TAILAN'`。
- 关键字段：`pickupTemplateId`，订阅消息模板 id。
- 关键字段：`mockPay`，演示数据里写当前支付模式。
- 关键字段：`phoneOneTapEnabled`，是否开启一键手机号。
- 关键字段：`merchantPhone`，商家联系电话。
- 关联：`getUserProfile/getMinePage/getPickupNoticeConfig` 都会读它。
---
## 5. 每页速查卡
### 5.1 首页 `pages/home/home`
- 这页解决什么问题：让新用户明白泰斓是什么、今天有没有批次、哪些站点在拼、从哪里开始点单。
- 关键数据来源：`getCatalogPage`；必要时自动 `initDemo`。
- 主要集合：`products`、`skus`、`batches`、`batchStations`、`batchInventory`、`stations`、`deliveryWindows`。
- “自提自取”：`goCatalog`，`switchTab` 到 `catalog`。
- “我的订单”：`goOrders`，`switchTab` 到 `orders`。
- 站点卡：`goCatalog`，`switchTab` 到 `catalog`，不带站点参数。
- “规则说明”：打开 `ruleSheet`，不走云函数。
- 欢迎弹层“微信一键登录”：上传头像后 `saveUserProfile`。
- 欢迎弹层“先逛逛”：只写本地 `tailanWelcomeSeen`。
### 5.2 点单页 `pages/catalog/catalog`
- 这页解决什么问题：按分类展示可买商品，让用户进入商品详情。
- 关键数据来源：`getCatalogPage`。
- 主要集合：`products`、`skus`、`batchInventory`、`batches`。
- 左侧分类：本页切换，不走云函数。
- 商品卡：`navigateTo product?productId&skuId`。
- “去拼团”：同商品卡，`navigateTo product?productId&skuId`。
- 库存展示：把同商品所有 SKU 的 `batchInventory.availableQty` 加总。
- 售罄按钮：样式置灰，但点击仍会触发 `goProduct`，详情页再看库存。
- 代码事实：顶部固定写“满 5 份成团”，不是完全动态。
### 5.3 商品详情页 `pages/product/product`
- 这页解决什么问题：让用户看清商品、规格、数量和合计。
- 关键数据来源：`getProductDetail(productId)`。
- 主要集合：`products`、`skus`、`batches`、`batchInventory`。
- 规格行：本页切换 `selectedSkuId`。
- “-”：数量大于 1 才减少。
- “+”：不能超过当前 SKU 剩余库存。
- “选自提站点”：`navigateTo pickStation`，带 `batchId/skuId/qty/skuName/price`。
- 无当前批次时：toast “今晚批次准备中”。
- 分享：分享当前商品详情页。
### 5.4 选站点页 `pages/pickStation/pickStation`
- 这页解决什么问题：让用户选在哪个地铁站取货，并完成支付前身份资料。
- 关键数据来源：`getStationOptions(batchId)`、`getUserProfile`。
- 主要集合：`batchStations`、`stations`、`deliveryWindows`、`users`、`config`。
- 站点卡：本页选中 `batchStationId`。
- “微信支付”：先检查昵称和手机号。
- 缺资料：打开支付前弹层。
- “一键获取手机号”：`decodePhoneNumber(code)`。
- “确认并支付”：`saveUserProfile` 后继续支付。
- 真正下单：`createOrder`。
- 真正支付：`payOrder`。
- 成功跳转：`navigateTo paySuccess?orderId&batchStationId`。
### 5.5 支付成功页 `pages/paySuccess/paySuccess`
- 这页解决什么问题：告诉用户支付结果、站点进度、鼓励分享、允许订阅通知。
- 关键数据来源：`getOrderDetail`、`getGroupPage`、`getPickupNoticeConfig`、`myOrders`。
- 主要集合：`orders`、`batchStations`、`stations`、`deliveryWindows`、`config`。
- “分享到微信群”：微信原生分享，路径到 `groupPage?batchStationId`。
- “开启自提通知”：请求订阅后 `markPickupSubscribed(orderId)`。
- “查看订单”：有订单时 `navigateTo orderDetail?orderId`；没有时 `switchTab orders`。
- “继续购买”：`switchTab home`。
- 自动退款订单：显示退款卡，隐藏分享区。
- 代码事实：`copyShareText` 函数存在，但页面没有按钮调用它。
### 5.6 站点团页 `pages/groupPage/groupPage`
- 这页解决什么问题：承接微信群分享，让朋友看到某个站点团的进度并参团。
- 关键数据来源：`getGroupPage(batchStationId)`、`getCatalogPage`。
- 主要集合：`batchStations`、`batches`、`stations`、`deliveryWindows`、`products`、`skus`、`batchInventory`。
- “去参团”：`switchTab catalog`。
- “再喊几个人”：微信原生分享，继续分享本团。
- “我也要买”：`switchTab home`。
- 成团状态：按 `paidItemCount/thresholdN` 算进度。
- 可买状态：只有 `拼团中` 和 `已成团继续接单` 可买。
- 代码事实：朋友圈分享函数名拼成 `oonShareTimeline`，实际不生效。
### 5.7 我的订单页 `pages/orders/orders`
- 这页解决什么问题：让用户按状态看订单、喊人拼团、退款、进取货券。
- 关键数据来源：`myOrders`。
- 主要集合：`orders`、`stations`、`batchStations`。
- 状态 tab：本页过滤，不走云函数。
- 订单卡：`navigateTo orderDetail?orderId`。
- “喊人拼团”：`navigateTo groupPage?batchStationId`。
- “10点前可退”：确认后 `cancelOrder(orderId)`。
- 订单角标：统计待成团/已成团待截单/待自提。
- 退款成功：toast 后重新 `myOrders`。
### 5.8 取货券页 `pages/orderDetail/orderDetail`
- 这页解决什么问题：给用户到站取货所需的全部信息。
- 关键数据来源：`getOrderDetail(orderId)`。
- 主要集合：`orders`、`batchStations`、`stations`、`deliveryWindows`。
- “联系商家”：微信客服，不走云函数。
- “取货日10点前自助退款”：`cancelOrder(orderId)`。
- “申请售后”：ActionSheet 后 `applyAfterSale`。
- “商家违约退款”：`applyAfterSale(type=refund)`。
- “申请顺延”：`applyAfterSale(type=postpone)`。
- 二维码：本地 `weapp-qrcode.js` 按核销码绘制。
- 取货点照片：来自 `deliveryWindows.locationImages[]`。
### 5.9 我的页 `pages/mine/mine`
- 这页解决什么问题：用户身份、订单摘要、规则、客服和商家入口。
- 关键数据来源：`getMinePage`。
- 主要集合：`users`、`orders`、`config`、`admins`。
- 订单摘要三块：先写本地 `ordersFilter`，再 `switchTab orders`。
- “联系商家”：微信客服。
- “规则说明”：打开 `ruleSheet`。
- “商家管理”：管理员可见，`navigateTo adminHome`。
- “现场核销”：管理员可见，`navigateTo adminVerify`。
- “商家通道”：非管理员调用 `bindAdmin`，首个管理员可绑定成功。
### 5.10 商家工作台 `pages/adminHome/adminHome`
- 这页解决什么问题：商家看全局进度、处理站点团、进入各后台工具、处理售后。
- 关键数据来源：`checkAdmin`、`adminDashboard`、`applyAfterSale(operation=listPending)`。
- 主要集合：`admins`、`batches`、`batchStations`、`stations`、`deliveryWindows`、`refunds`、`orders`。
- “开始核销/备料清单”：`navigateTo adminVerify`。
- “我已到达”：`markArrived(dw-<第一个站点团id>)`。
- “手动成团”：`manualFormGroup(batchStationId)`。
- “手动截单”：`manualCutoff(batchId)`，当前会因后端函数缺失失败。
- “更多操作-修改窗口”：弹层后 `setDeliveryWindow`。
- “更多操作-延长截止”：`extendDeadline`。
- “更多操作-关团退款”：`closeGroupRefund`。
- 售后“审核通过/驳回”：`reviewRefund`。
- 未取货“标记顺延/退款”：`markOrderPostponed` / `adminRefundOrder`。
- “重试退款”：`retryRefunds`。
### 5.11 商品管理页 `pages/adminProducts/adminProducts`
- 这页解决什么问题：管理商品、图片、SKU、上下架和价格。
- 关键数据来源：`checkAdmin`、`listProducts`。
- 主要集合：`admins`、`products`、`skus`。
- 商品卡：选中并载入表单。
- “上传图片”：微信选择图片并上传云存储。
- “保存商品”：`saveProduct(product)`。
- SKU 行：选中并载入 SKU 表单。
- “+新SKU”：清空 SKU 表单。
- “保存上架/保存下架”：`saveSku(sku)`。
- 设计重点：改价只影响新订单，已付订单看 `orders.items` 快照。
### 5.12 创建批次页 `pages/adminBatch/adminBatch`
- 这页解决什么问题：发布明天的可售批次、站点窗口和共享库存。
- 关键数据来源：`checkAdmin`、`listStations`、`listProducts`。
- 主要集合：`admins`、`stations`、`products`、`skus`，提交后写 `batches/batchStations/deliveryWindows/batchInventory`。
- 站点勾选：本页状态变化。
- 时间窗口输入：本页 `stationWindows` 变化。
- “+照片”：上传到云存储 `pickup/`。
- SKU 勾选：本页状态变化。
- 库存输入：写入 `inventoryDraft`。
- “发布批次”：`createBatch(batch)`。
- 代码事实：初始门槛是 4，不是附录A里的 5。
### 5.13 现场核销页 `pages/adminVerify/adminVerify`
- 这页解决什么问题：现场按站点备料、核销、结束本场。
- 关键数据来源：`checkAdmin`、`adminDashboard`、`prepList`。
- 主要集合：`admins`、`batchStations`、`orders`、`verificationLogs`、`deliveryWindows`。
- 站点 picker：切换后 `prepList(batchStationId)`。
- “核销”：`verifyOrder(code,method=input)`。
- “扫码核销”：`wx.scanCode` 后 `verifyOrder(code,method=scan)`。
- “我已到达”：`markArrived(dw-<batchStationId>)`。
- “结束本场自提”：`markNoShowOrders(batchStationId)`。
- 备料清单：按订单 items 的商品名和规格汇总。
- 订单明细：显示核销码、金额、状态。
### 5.14 站点池管理页 `pages/adminStations/adminStations`
- 这页解决什么问题：维护可开团的地铁站池。
- 关键数据来源：`checkAdmin`、`listStations`。
- 主要集合：`admins`、`stations`。
- “+新增”：打开空表单。
- 点站点行：载入编辑表单。
- “切换”：active/disabled 切换。
- “保存”：`saveStation(station)`。
- “取消”：关闭表单。
- 设计重点：停用后创建批次页不应再选；已有订单不删除站点。
---
## 6. 为什么这么设计
### 6.1 为什么先付款
- 如果先占名额后付款，站点进度会被“口头报名”污染，商家不知道该备多少货。
- 先付款后计入 `paidItemCount`，可以让进度条代表真实需求。
- 小明在布吉站买 2 份，只有付款成功后布吉才从 3/5 变 5/5。
- 这对家庭烘焙尤其重要，因为备料和出摊都要提前决定，不能靠临时口头承诺。
- 代码也按这个逻辑写：`createOrder` 不扣库存，`payOrder` 成功才扣库存和加进度。
### 6.2 为什么共享库存
- 泰斓不是每个地铁站单独开仓，而是同一批甜品分配给多个站点。
- 共享库存让老板只需要判断“这批总共能做多少”，不用先猜布吉几份、大学城几份。
- 小明在布吉买掉 2 份，小红在大学城看到的同 SKU 剩余也会减少。
- 这样能减少某站卖不掉、某站不够卖的浪费。
- 代码用 `batchInventory(batchId, skuId)` 表示共享库存，不挂在 `batchStationId` 下。
### 6.3 为什么成团后不回退
- 成团是商家承诺会去这个站点的里程碑，不应该因为后续一两个人退款就反复变来变去。
- 如果状态回退，用户会看到“刚刚成团又没成团”，信任感会很差。
- 商家也无法根据一个反复摇摆的状态安排路线和备料。
- 所以代码里 `stationWasFormed` 一旦为真，退款只回退件数和库存，不自动把站点状态打回 `拼团中`。
- 是否关团交给商家用 `closeGroupRefund` 手动决定。
### 6.4 为什么取货日 10:00 后不可自助退
- 10:00 后商家通常已经备料、打包、安排路线，成本已经发生。
- 如果下午还能随便退，商家会承担大量临期损耗。
- 但用户临时来不了也不是完全没路：可以把取货券截图转让给别人。
- 代码用 `canSelfCancelOrder` 按北京时间判断，不依赖云函数机器本地时区。
- 10:00 不是单独定时器，而是每次点退款时实时拦截。
### 6.5 为什么自提窗口前置
- 以前如果成团后再排窗口，买家付款时不知道明天几点、哪里拿，决策成本高。
- 现在创建批次时就写 `deliveryWindows`，买家在选站和取货券里都能看到窗口。
- 成团通知也能直接带上取货点和时间，不用等商家后补。
- 商家当天只需要核销和处理异常，不用临时解释“到底在哪取”。
- 代码里 `createBatch` 会同步生成每个站点团的 `deliveryWindows`。
### 6.6 为什么支付成功后强引导分享但不硬拦截
- 拼团确实需要用户帮忙扩散，所以支付成功页把分享放在最显眼位置。
- 但强制分享会让用户觉得被绑架，也容易破坏微信审核体验。
- 当前代码的做法是“强提示、弱约束”：可以分享，也可以直接查看订单。
- 小明如果愿意，就把布吉团发群；如果不愿意，订单照样有效。
- 这符合交易确定性：付款后用户已经买到资格，不应该被分享动作卡住。
---
## 7. 创始人要特别知道的代码事实差异
- 页面数差异：需求里说 13 页，但 `app.json` 是 14 页，多了独立 `adminStations`。
- 集合数差异：业务集合可算 12 个，但代码还会创建 `config`，所以实际 13 个集合名。
- 门槛差异：首页和演示数据是 5；创建批次页初始 `thresholdN` 是 4，商家不改就会发 4。
- 手动截单差异：`manualCutoff` 当前调用未定义函数，按钮会失败；定时器截单有实现。
- 成团推送差异：推送发生在支付跨门槛那一刻，不发生在 22:00 截单动作里。
- 10点关闭差异：没有“10点自动关窗”任务，只有用户点退款时后端拒绝。
- 强分享差异：页面强引导分享，但没有强制分享才能继续。
- 团页跳转差异：站点团页“去参团”只回点单 tab，不会直达某个商品详情。
- 朋友圈分享差异：`groupPage` 写成 `oonShareTimeline`，不是微信识别的 `onShareTimeline`。
- 售后驳回差异：工作台 `reviewRefund` 驳回只改 `refunds`，没有同步订单售后字段。
- 订单待自提差异：`manualFormGroup` 把订单改成 `已成团待截单`，不是直接 `待自提`。
- 核销列表差异：`prepList` 只查 `待自提/已完成/未取货待处理`，不查 `已成团待截单`。
- 自动初始化差异：首页检测无批次无商品时会触发 `initDemo`，但只在本地没标记过时触发。
- 支付模式差异：现在个人主体无商户号，所以 `MOCK_PAY=true`；真实支付路径保留但未实测。
