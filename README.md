# 泰斓 TAILAN 拼团自提小程序

这是一个微信小程序云开发项目，目标业务规则以 `banlan-cake-prd-v1.6.md` 为准：今天拼、明天取，每站累计5件成团，订单完成交付前支持整单退款。

> V1.6 的 MOCK 交易、批次生命周期、C端主路径、商家/核销主路径已实现并有本地测试；真实微信支付与云端真机联调仍未完成。

## 核心规则
- 批次按取货日组织，`batches.pickupDate` 为取货日期。
- 批次由超级管理员确认库存后手动发布；销售日只能发布次日取货批次。
- 北京时间22:00停止新下单和支付，不自动销售后天取批次。
- 成团进度按站点所有 SKU 的已付款商品总件数计算，默认门槛 `thresholdN=5`。
- 待支付订单预占共享库存15分钟，支付成功后才计入成团。
- 取货日12:00逐站确认配送；不足5件退款，手动确认配送的站点除外。
- 12:00确认配送后即使退款跌破5件仍配送；有效订单归零时可以取消配送。
- 完成交付前支持用户整单退款；不支持部分退款和顺延。
- 后台维护站点、取货时间、地点说明和图片；首页只保留品牌展示与“立即去拼”。
- 用户创建订单前必须手动填写手机号。

## 主要入口
- C 端首页：`miniprogram/pages/home`
- 商品分类：`miniprogram/pages/catalog`
- 商品详情：`miniprogram/pages/product`
- 选站点：`miniprogram/pages/pickStation`
- 取货券：`miniprogram/pages/orderDetail`
- 云函数入口：`cloudfunctions/api/index.js`
- 业务纯函数：`cloudfunctions/api/domain.js`

## 首个超级管理员

在云函数环境变量中配置 `SUPER_ADMIN_OPENID=<商家微信openid>`。该用户首次调用 `checkAdmin` 时才会被安全初始化为 `superAdmin`；未匹配该环境变量的普通用户不能自绑定管理员。

## 本地验证
核心命令：

```bash
node cloudfunctions/api/tests/domain.test.js
node cloudfunctions/api/tests/v16-order-actions.test.js
node cloudfunctions/api/tests/v16-batch-lifecycle.test.js
node cloudfunctions/api/tests/v16-fulfillment-actions.test.js
node scripts/tests/v16-frontend-flow.test.js
node scripts/tests/v16-admin-flow.test.js
node scripts/check-integrity.js
```

完整交付验证见《验收方法.md》。
