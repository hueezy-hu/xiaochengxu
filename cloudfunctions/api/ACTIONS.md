# API Action 契约（V1.6）

所有接口通过 `cloudfunctions/api/index.js` 的单一云函数入口调用。V1.6 返回统一包含 `ok`、`requestId`、`serverNow`；失败包含 `code` 和 `msg`。

## C端与交易

| action | 权限 | 关键入参 | 关键规则 |
|---|---|---|---|
| `getCatalogPage` / `getProductDetail` / `getStationOptions` | 用户 | 对应ID | 价格、库存和开放状态以服务端为准。 |
| `createOrder` | 用户 | `clientRequestId,batchStationId,items,contactName,phone` | 手机号和联系人必填；仅单SKU；事务预占共享库存15分钟。 |
| `payOrder` | 本人 | `orderId` | 当前为 `MOCK_PAY=true`；支付成功后预占转已售并累计站点件数。 |
| `queryPaymentResult` | 本人 | `orderId` | 查询原订单；过期时惰性释放库存。 |
| `cancelPendingOrder` | 本人 | `orderId` | 只取消待支付订单并释放预占。 |
| `requestRefund` | 本人 | `orderId,reason?` | 完成交付前整单退款；不审核、不部分退款、不顺延。 |
| `myOrders` / `getOrderDetail` | 本人 | `orderId?` | 返回V1.6订单、取货窗口和放置证明。 |

## 批次与生命周期

| action | 权限 | 关键入参 | 关键规则 |
|---|---|---|---|
| `saveBatchDraft` | superAdmin | `batch` | 保存四步向导草稿；销售日D、取货日D+1、门槛固定5。 |
| `getBatchDraft` | superAdmin | `batchId` | 只读取草稿。 |
| `publishBatch` | superAdmin | `batchId,revision` | 手动发布；校验SKU库存、站点窗口/图片、唯一销售日和唯一接单批次。 |
| `manualConfirmDelivery` | superAdmin | `batchStationId,reason` | 22:00后、次日12:00前确认不足5件仍配送。 |
| `closeBatchStation` | superAdmin | `batchStationId,reason` | 只关闭单站；退款未完成时保持`关闭退款中`。 |
| `closeBatch` | superAdmin | `batchId,reason` | 整批关闭，与单站关闭分离。 |
| `lifecycleTick` | 可信定时器 | 无 | 每分钟：清理超时预占、22:00截单、次日12:00逐站确认或退款。 |

## 履约与权限

| action | 权限 | 关键入参 | 关键规则 |
|---|---|---|---|
| `getVerifierWorkspace` / `adminDashboard` | superAdmin/verifier | 无 | 核销员只返回授权批次/站点及其手机号。 |
| `prepList` | superAdmin/verifier | `batchStationId` | 仅授权站点，按SKU汇总。 |
| `assignVerifier` | superAdmin | `targetOpenid,batchId?,stationIds` | 维护批次/站点授权范围并留操作日志。 |
| `markArrived` | superAdmin/verifier | `batchStationId` | 仅`已确认配送`可进入`自提进行中`。 |
| `verifyOrder` | superAdmin/verifier | `batchStationId,code,method?` | 普通核销员禁止跨站；超级管理员跨站需二次确认和原因。 |
| `contactOrder` | superAdmin/verifier | `orderId,contactStatus,note?` | 仅自提窗口内、授权站点可查看手机号并记录联系。 |
| `placeOrderAtLocation` | superAdmin/verifier | `orderId,locationNote,images` | 地点和现场图片必填；进入`已放置待自取`并禁止退款。 |
| `endPickupSession` | superAdmin/verifier | `batchStationId` | 窗口结束且无未处理待自提订单时，站点进入`已完成`。 |

商品、SKU、站点和自提窗口管理仅限 `superAdmin`；站点支持默认地点图片，商品支持泰文名、分类、标签和图片。

## 明确禁用

公开路由已移除：`bindAdmin`、`cancelOrder`、`createBatch`、`manualFormGroup`、`manualCutoff`、`extendDeadline`、`closeGroupRefund`、`markNoShowOrders`、`markOrderPostponed`、`reviewRefund`、`closeExpired`、`expirePendingOrders`、`systemRefundOrder`。

`initDemo` 仅允许受信内部任务，普通用户不能借此初始化数据或绑定超级管理员。
首个超级管理员通过云函数环境变量 `SUPER_ADMIN_OPENID` 预置，只有openid精确匹配的用户在调用 `checkAdmin` 时会被初始化。

## 上线前未完成

- 当前仍是 `MOCK_PAY=true`；真实微信支付下单、支付回调、退款通知/查询和商户配置必须独立实现与联调。
- 订阅消息目前写入 `notificationOutbox`，正式发送器与失败重试需要云环境联调。
