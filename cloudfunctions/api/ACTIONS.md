# API Action 契约（V1.7 当前实现）

所有 action 由 `cloudfunctions/api/index.js` 路由。服务层成功返回 `ok=true,requestId,serverNow`；失败返回 `ok=false,code,msg`。业务规则以 `banlan-cake-prd-v1.7.md` 为唯一真源。

## 用户与交易

| action | 关键入参 | 当前规则 |
|---|---|---|
| `getHomeStatus` | 无 | 返回开团中/今日休息/未开团、是否可催、催开团人数。 |
| `nudgeOpenGroup` | 无 | 未开团时按 openid + 北京日期去重计数。 |
| `getCatalogPage` / `getProductDetail` / `getStationOptions` / `getGroupPage` | 对应 ID | 服务端价格、库存、按人进度、站点交付模式和窗口。 |
| `addToCart` / `getCart` / `updateCartItem` / `removeCartItem` / `clearInvalidCart` | `skuId,qty,checked?` | 服务端购物车；加购不预占；标记下架、售罄、跨批次失效和价格变化。 |
| `createOrder` | `clientRequestId,batchStationId,items,contactName,phone` | 服务端重算多 SKU 金额；原子预占 3 分钟；存 `phoneTail` 和随机 `pickupQrToken`。 |
| `payOrder` / `queryPaymentResult` | `orderId` | 本人操作；MOCK 支付确认；超时释放；同一 openid 在同站只计 1 人。 |
| `cancelPendingOrder` | `orderId` | 取消隐藏预占并释放库存；用户端没有待支付订单列表。 |
| `requestRefund` | `orderId,reason?` | 交付前自助整单退款。 |
| `applyRefundRequest` | `orderId,reason` | 交付后进入人工退款申请。 |
| `myOrders` / `getOrderDetail` | `orderId?` | 返回订单、尾号凭证、随机二维码 token、交付模式与现场照片。 |
| `getUserProfile` / `getMinePage` / `saveUserProfile` / `updateProfile` | profile | 头像昵称、手机号、身份和订单摘要。 |
| `getPickupNoticeConfig` / `markPickupSubscribed` | `orderId` + 两个选择 | 成团结果和取货提醒两条模板分别回写。 |

## 批次与生命周期

| action | 权限 | 当前规则 |
|---|---|---|
| `saveBatchDraft` / `getBatchDraft` | superAdmin | 草稿只含基础信息、`stationIds`、`skuRows`。 |
| `publishBatch` | superAdmin | 从站点池复制窗口/地点/图片/`verifyMode`；10:00 仅软提醒；手动发布。 |
| `appendInventory` | superAdmin | 发布后仅追加正库存。 |
| `setTodayRest` | superAdmin | 无接单中批次时切换今日休息/未开团。 |
| `manualConfirmDelivery` | superAdmin | 截单后至 12:00 前，可有理由确认不足 5 人配送。 |
| `closeBatchStation` / `closeBatch` | superAdmin | 手动取消单站或整批；退款未完成保持处理中。 |
| `lifecycleTick` | 可信 Timer | 每分钟清理 3 分钟预占；22:00 锁定人数；取货日 12:00 确认或关闭退款。 |

## 履约与退款处理

| action | 权限 | 关键规则 |
|---|---|---|
| `getVerifierWorkspace` / `adminDashboard` | superAdmin/verifier | 只返回授权站；含按人进度、尾号重复预警和待处理退款。 |
| `prepList` / `markArrived` / `contactOrder` | superAdmin/verifier | 按 SKU 备料；到达与联系受站点权限和窗口约束。 |
| `verifyOrder` | superAdmin/verifier | `method=scan/tail/manual`；传 `qrToken`、`phoneTail` 或 `orderId`；必须有 `images` 1–3 张；尾号多单返回 candidates。 |
| `placeOrderAtLocation` | superAdmin/verifier | 仅无人放置站；传 `batchStationId,orderIds,locationNote,images`，整场事务。 |
| `finishNoShow` | superAdmin/verifier | 仅有人核销站；传 `batchStationId,orderIds,images`，收尾为已完成未取。 |
| `endPickupSession` | superAdmin/verifier | 必须没有未处理待自提订单；提前结束仅超管二次确认。 |
| `assignVerifier` | superAdmin | 维护批次/多站授权范围。 |
| `resolveRefundRequest` | superAdmin | `orderId,decision=refund/reject,note?`。 |

## 菜单库与站点池

仅 superAdmin：`listProducts`、`saveProduct`、`deleteProduct`、`saveSku`、`deleteSku`、`listCategories`、`saveCategory`、`deleteCategory`、`listStations`、`saveStation`、`deleteStation`。

有订单、库存或批次引用时执行下架/停用而非物理删除；分类被商品引用时拒绝删除。站点固定资料必须包含名称、地点、有效窗口、1–3 张图片和 `有人核销/无人放置` 模式。

## 受信内部与明确禁用

- `initDemo` 仅可信内部任务可调用；普通 event 不能伪造系统身份。
- `lifecycleTick` 仅微信 Timer 触发。
- 不公开 `expirePendingOrders`、`systemRefundOrder` 等内部动作。
- 已禁用旧规则 action：`bindAdmin`、`createBatch`、`manualFormGroup`、`manualCutoff`、`extendDeadline`、`markNoShowOrders`、`markOrderPostponed`、`reviewRefund`。

## 正式上线前置

当前 `MOCK_PAY=true`。真实支付、回调验签、`time_expire=3min`、迟到成功兜底、真实退款/对账、两条订阅消息发送器及真机联调尚未完成，不得将内部演示版描述为已正式上线。
