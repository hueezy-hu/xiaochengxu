# MOCK 模式测试指引（V1.6）

适用前提：`cloudfunctions/api/index.js` 中 `MOCK_PAY=true`。此模式不调用真实微信支付；不能用来证明正式支付已完成。

## 1. 安全与准备

1. 部署 `cloudfunctions/api`，在云函数环境变量配置 `SUPER_ADMIN_OPENID=<商家openid>`；该用户首次进入商家通道时安全初始化为`superAdmin`。
2. 普通用户不得调用 `initDemo` 或自行绑定管理员；演示数据只能由受信内部任务准备。
3. 清理小程序缓存后进入首页，首页只展示品牌内容和“去点单”。

## 2. 下单与15分钟预占

1. 点单 → 商品详情 → 选择站点。
2. 结算必须填写昵称和有效手机号。
3. 创建订单后检查：状态`待支付`，库存从`availableQty`转入`reservedQty`，站点件数不变。
4. MOCK支付后检查：订单`待配送确认`，预占转` soldQty`，站点累计件数增加。
5. 支付未完成时重复点击，只能重试原 `orderId`；不得重复创建订单。
6. 超过15分钟或到22:00后，订单变为`已超时`并释放预占。

## 3. 22:00与次日12:00

1. 把批次`deadlineAt`调整到当前时间前，触发受信`lifecycleTick`。
2. 预期22:00只停止接单，批次进入`已截单待配送确认`，不立即判断配送。
3. 把`confirmAt`调整到当前时间前再次触发：每站累计5件及以上进入`已确认配送`；不足5件进入关闭退款流程。
4. 22:00后、12:00前，超级管理员可填写原因执行`manualConfirmDelivery`。

## 4. 用户退款

1. 对`待配送确认`或`待自提`订单点击“申请整单退款”。
2. 预期MOCK立即进入`已退款`，共享库存回补，站点有效件数回退。
3. `已完成`和`已放置待自取`不得退款；系统不提供顺延和退款审核。
4. 退款后用户可以重新下单。

## 5. 现场履约

1. 核销员工作台只能看到被授权批次/站点及对应手机号。
2. `已确认配送`站点点击“我已到达”后进入`自提进行中`。
3. 普通核销员只能核销本站；超级管理员跨站必须二次确认并填写原因。
4. 迟到联系只能在自提窗口内操作，并写`contactLogs`。
5. 固定地点放置必须填写地点并上传现场图片，订单进入`已放置待自取`并写`placementLogs`。
6. 自提窗口结束且所有订单已核销或已放置后，才可结束本场，站点进入`已完成`。

## 6. 必跑本地检查

```bash
node cloudfunctions/api/tests/domain.test.js
node cloudfunctions/api/tests/v16-order-actions.test.js
node cloudfunctions/api/tests/v16-batch-lifecycle.test.js
node cloudfunctions/api/tests/v16-fulfillment-actions.test.js
node scripts/tests/v16-frontend-flow.test.js
node scripts/tests/v16-admin-flow.test.js
node scripts/check-integrity.js
```
