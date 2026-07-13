# API Action 契约（V1.7 目标）

所有接口通过 `cloudfunctions/api/index.js` 的单一云函数入口调用。返回统一包含 `ok`、`requestId`、`serverNow`；失败包含 `code` 和 `msg`。

> 状态说明：本文件是 **V1.7 目标契约**，现有代码仍是 V1.5/V1.6 行为，**尚未按本契约实现**。改造完成前不得因本文件已更新而声称代码已完成。业务规则以 `banlan-cake-prd-v1.7.md` 为唯一真源。
>
> 购物车：选购暂存区，不占库存、不碰成团。加购只查是否可卖；发起支付才对勾选的多个 SKU 一次性预占 3 分钟。结算复用 `createOrder`（多 SKU `items` + 单站 `batchStationId`），一次结算一单、整单退、在该站仍只计 1 人成团；商品详情保留“立即购买”单 SKU 快捷路径。

## C端与交易

| action | 权限 | 关键入参 | 关键规则（V1.7） |
|---|---|---|---|
| `getHomeStatus` | 用户 | 无 | 返回首页营业状态：开团中 / 今日休息 / 未开团（商家在忙），及催开团累计人数。 |
| `getCatalogPage` / `getProductDetail` / `getStationOptions` | 用户 | 对应ID | 价格、库存和开放状态以服务端为准；非开团态商品返回售罄。站点选项含 `verifyMode` 与已拼人数。 |
| `nudgeOpenGroup` | 用户 | 无 | 非开团态“催开团”，按 openid 当日去重累计计数；仅计数、不推送。 |
| `addToCart` | 用户 | `skuId,qty` | 加入购物车，只查是否可卖、不预占；同 SKU 累加。 |
| `getCart` | 用户 | 无 | 返回当前用户购物车，标注失效条目（售罄/下架/非当前批次）与降价提示。 |
| `updateCartItem` | 用户 | `skuId,qty,checked?` | 修改数量或勾选状态。 |
| `removeCartItem` | 用户 | `skuId` | 删除条目。 |
| `clearInvalidCart` | 用户 | 无 | 一键清除失效条目。 |
| `createOrder` | 用户 | `clientRequestId,batchStationId,items,contactName,phone` | 发起支付即创建预占中订单；手机号和联系人必填、写入尾号后4位；支持单 SKU（立即购买）或多 SKU（购物车结算），同一事务一次性预占共享库存 **3 分钟**（`expiresAt=createdAt+3min`），任一 SKU 短缺则整单不预占；校验时间早于22:00。 |
| `payOrder` | 本人 | `orderId` | 当前 `MOCK_PAY=true`；支付成功预占转已售，累计站点 `paidItemCount`（件）与 `paidUserCount`（openid去重的人）；判断5人门槛；回调幂等；正式支付下单须设 `time_expire=3min`，并实现迟到成功兜底（重抢库存或自动退款）。 |
| `queryPaymentResult` | 本人 | `orderId` | 查询原订单；超过 3 分钟惰性释放预占；结果不明先查不重复建单。 |
| `cancelPendingOrder` | 本人 | `orderId` | 只取消预占中订单并立即释放预占。 |
| `requestRefund` | 本人 | `orderId,reason?` | **交付前**自助整单即时退款，不审核、不部分退、不顺延；预占中订单走取消而非退款。 |
| `applyRefundRequest` | 本人 | `orderId,reason?` | **交付后**（已核销 / 已放置）未取到时提交退款申请，进入商家人工待处理，不即时退款。 |
| `myOrders` / `getOrderDetail` | 本人 | `orderId?` | 返回 V1.7 订单、取货窗口、手机尾号取货凭证、二维码、交付现场照片和放置证明。 |
| `getGroupSharePage` | 用户 | `batchStationId,inviterOpenid?` | 分享落地页数据：该站已拼人数进度、取货窗口、简要规则、成团状态；记录邀请埋点。 |
| `getMine` | 用户 | 无 | 个人中心：头像昵称、手机号、订单入口，并返回当前身份（普通/超管/核销员）用于显示商家入口。 |
| `updateProfile` | 本人 | `nickName?,avatarUrl?,phone?` | 更新头像、昵称或存档手机号。 |

## 批次与生命周期

| action | 权限 | 关键入参 | 关键规则（V1.7） |
|---|---|---|---|
| `saveBatchDraft` | superAdmin | `batch` | 草稿只需选 SKU + 填库存 + 勾选启用站点；站点窗口/地点/图片/`verifyMode` 取站点池固定资料，门槛默认 5 人。 |
| `getBatchDraft` | superAdmin | `batchId` | 只读取草稿。 |
| `publishBatch` | superAdmin | `batchId,revision` | 手动发布；校验 SKU 库存、勾选站点的固定资料完整、唯一销售日和唯一接单批次；取货日 D+1、截单 D 日22:00。10:00 为软提醒不阻断。 |
| `addInventory` | superAdmin | `batchId,skuId,delta` | 发布后追加库存，仅上调，无副作用。 |
| `removeSku` | superAdmin | `batchId,skuId,refundPaid?` | 下架 SKU 停止新购（默认 b：已付订单照常履约）；`refundPaid=true` 时（c）对该 SKU 已付订单发起退款；需二次确认与日志。 |
| `setRestDay` | superAdmin | `on` | 切换“今日休息”态；开启后首页显示休息、点单售罄。 |
| `manualConfirmDelivery` | superAdmin | `batchStationId,reason` | 12:00 前确认不足 5 人仍配送，二次确认+原因+日志。 |
| `manualCancelDelivery` | superAdmin | `batchStationId,reason` | 已成团站塌方时，12:00 前手动取消配送，原路退全部剩余并通知；替代自动维持线。 |
| `closeBatchStation` | superAdmin | `batchStationId,reason` | 只关闭单站；退款未完成时保持 `关闭退款中`。 |
| `closeBatch` | superAdmin | `batchId,reason` | 整批关闭，与单站关闭分离。 |
| `resolveRefundRequest` | superAdmin | `orderId,decision,note?` | 处理交付后退款申请：`decision=refund` 人工退款，`decision=reject` 拒绝并说明。 |
| `lifecycleTick` | 可信定时器 | 无 | 每分钟：清理 **3 分钟**超时预占；22:00 截单并逐站按 5 人**锁定成团结果**（满5=已成团、不足5=未成团待处理）；次日 12:00 逐站执行配送确认或关闭退款。识别依赖 `event.Type==='Timer'`。 |

## 履约与权限

| action | 权限 | 关键入参 | 关键规则（V1.7） |
|---|---|---|---|
| `getVerifierWorkspace` / `adminDashboard` | superAdmin/verifier | 无 | 核销员只返回被授权站点（支持多站）及其手机号；dashboard 含待处理退款申请、催开团计数、尾号重复预警。 |
| `prepList` | superAdmin/verifier | `batchStationId` | 仅授权站点，按 SKU 汇总件数。 |
| `assignVerifier` | superAdmin | `targetOpenid,stationIds` | 为普通管理员分配一个或多个授权站点并留操作日志；能力固定为核销+拍照+查看。 |
| `getPhoneTailAlerts` | superAdmin/verifier | `batchStationId` | 返回该场次相同手机尾号后 4 位的冲突提醒，供核销时人工区分。 |
| `markArrived` | superAdmin/verifier | `batchStationId` | 仅 `已确认配送` 可进入 `自提进行中`。 |
| `uploadDeliveryPhoto` | superAdmin/verifier | `batchStationId,images` | 到自取点/核销点必做的交付拍照上传；写入场次交付现场照片，用户可见。 |
| `verifyOrder` | superAdmin/verifier | `batchStationId,method,qrToken?,phoneTail?` | 凭手机尾号或扫二维码核销；`method` 取 `scan`/`tail`/`manual`；输尾号命中多单时返回候选列表由人工选定；普通核销员禁止跨站；超级管理员跨站需二次确认和原因。 |
| `contactOrder` | superAdmin/verifier | `orderId,contactStatus,note?` | 仅自提窗口内、授权站点可查看手机号并记录联系。 |
| `placeOrderAtLocation` | superAdmin/verifier | `batchStationId,orderIds?,locationNote,images` | 无人放置：地点和现场图片必填；点“已放置”使订单进入 `已放置待自取`、视为交付完成、禁止自助退款。 |
| `finishNoShow` | superAdmin/verifier | `batchStationId,orderIds` | 有人核销窗口结束仍未取的订单：挪货拍照后收尾为 `已完成未取`，不退款。 |
| `endPickupSession` | superAdmin/verifier | `batchStationId` | 窗口结束且无未处理待自提订单（已核销/已放置/已收尾）时，站点进入 `已完成`。 |

## 商家资料管理（菜单库与站点池，仅 superAdmin）

| action | 关键入参 | 关键规则（V1.7） |
|---|---|---|
| `saveProduct` | `product` | 新增/编辑商品（名、泰文名、分类、描述、标签、图片、排序）。 |
| `setProductStatus` | `productId,status` | 上/下架商品；下架不进入批次可选款，但不影响历史订单。 |
| `deleteProduct` | `productId` | 无订单引用才可删，有引用只能下架。 |
| `saveSku` | `productId,sku` | 新增/编辑 SKU（规格、单价、库存基准、排序）；改价即时生效、无审核。 |
| `deleteSku` | `skuId` | 菜单库 SKU 删除；有引用只能下架（区别于批次内 `removeSku`）。 |
| `saveCategory` / `deleteCategory` | `category` / `categoryId` | 维护商品分类。 |
| `saveStation` / `setStationStatus` | `station` / `stationId,status` | 维护站点池固定资料，含 `verifyMode`、默认窗口与地点图片。 |

商品、SKU、站点、分类和自提窗口管理仅限 `superAdmin`；站点支持默认地点图片，商品支持泰文名、分类、标签和图片。

## 明确禁用

公开路由已移除：`bindAdmin`、`cancelOrder`、`createBatch`、`manualFormGroup`、`manualCutoff`、`extendDeadline`、`closeGroupRefund`、`markNoShowOrders`、`markOrderPostponed`、`reviewRefund`、`closeExpired`、`expirePendingOrders`、`systemRefundOrder`。

`verifyOrder` 不再使用 6 位自取码，凭证改为手机尾号后 4 位加二维码。

`initDemo` 仅允许受信内部任务，普通用户不能借此初始化数据或绑定超级管理员。
首个超级管理员通过云函数环境变量 `SUPER_ADMIN_OPENID` 预置，只有 openid 精确匹配的用户在调用 `checkAdmin` 时会被初始化。

## 上线前未完成

- 当前仍是 `MOCK_PAY=true`；真实微信支付下单（含 `time_expire=3min`）、支付回调、迟到成功兜底、退款通知/查询和商户配置必须独立实现与联调。
- 手机号当前 `MANUAL_PHONE=true` 手动填写；非个人主体后切换 `getPhoneNumber` 一键授权。
- 订阅消息需申请 **2 个模板**（成团结果、自提提醒），支付成功时一次授权；目前写入 `notificationOutbox`，正式发送器与失败重试需要云环境联调。
