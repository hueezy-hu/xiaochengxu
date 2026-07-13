# 泰斓 V1.7.0 全量开发施工计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans task-by-task. Every behavior change follows RED → GREEN → REFACTOR and is committed independently.

**Goal:** 将现有 V1.6 代码完整升级为同一版本上线的 V1.7.0 内部正式验收版。

**Architecture:** 保持原生微信小程序与单入口云函数；`index.js` 仅负责鉴权和路由，业务规则集中在纯函数 `domain.js` 与可注入 repository 的 services。开发过程分模块提交，但任何模块都不得提前部署，全部通过后一次切换。

**Tech Stack:** 微信小程序原生 WXML/WXSS/CommonJS JS、微信云开发、`wx-server-sdk`、Node `node:test`。

## Global Constraints

- 业务唯一真源：`banlan-cake-prd-v1.7.md`；接口目标：`cloudfunctions/api/ACTIONS.md`；视觉唯一真源：`设计稿v4-V1.7.html`。
- 本版保持 `MOCK_PAY=true`、`MANUAL_PHONE=true`，不假装完成真实支付、真实退款或正式订阅发送。
- 预占 3 分钟；成团按站点不同付款 openid 去重满 5 人；库存与备料按件。
- 22:00 只截单并锁定人数；取货日 12:00 才确认配送或关站退款。
- 核销凭证为手机尾号后 4 位加随机二维码 token；交付照片为必填。
- 退款为交付前整单即时退款、交付后人工个例申请；不部分退、不顺延、不跨批次。
- 所有金额用整数分，时间戳用毫秒，北京时间转换只使用统一函数。
- 前端不传可信价格、金额、openid、权限或状态；后端每次重新校验。
- 页面颜色只从 `styles/tokens.wxss` 引用，不引入 UI 库。
- 最终保留 admins/users 和商家配置，清空并重建其他 V1.6 业务数据。

---

## Task 1: V1.7 常量、错误码与测试基线

**Files:**
- Create: `cloudfunctions/api/src/constants/v17.js`
- Modify: `cloudfunctions/api/src/shared/response.js`
- Modify: `cloudfunctions/api/tests/domain.test.js`
- Create: `cloudfunctions/api/tests/v17-*.test.js`

**Produces:** 唯一状态常量、180000ms 预占常量、V1.7 失败测试。旧 V1.6 测试逐项迁移，不能保留旧规则断言。

- [ ] 写 3 分钟预占、按 openid 去重、五件一人不成团、22:00 锁定、12:00 确认、尾号核销的失败测试。
- [ ] 运行测试并确认因 V1.7 能力缺失而失败。
- [ ] 新增常量和错误码，运行常量测试通过。
- [ ] 中文提交：`需求描述：建立泰斓V1.7状态与测试基线`。

## Task 2: 纯业务领域逻辑

**Files:** `domain.js`，以及 `src/domain/inventory.js`、`grouping.js`、`order-state.js`、`lifecycle.js`。

**Produces:** 多 SKU 原子预占/释放/付款/退款，人数去重和退款后重算，V1.7 订单 CAS，22:00/12:00 决策。保留现有 `domain.js` 导出签名作为兼容入口，但不保留旧行为。

- [ ] 每个纯函数先写一个最小失败测试。
- [ ] 实现后检查库存恒等式 `available+reserved+sold-refunded=total`。
- [ ] 覆盖同用户多单、退款一单仍计人、最后一单退款才减人。
- [ ] 中文提交：`需求描述：升级V1.7库存与成团领域逻辑`。

## Task 3: Repository 分层和入口瘦身

**Files:** `src/repositories/*.js`、`src/shared/validation.js`、`ids.js`、`index.js`。

**Produces:** order/batch/fulfillment repository；`index.js` 只装配、鉴权、路由和统一异常，不含库存加减、人数计算、价格计算或核销码生成；删除未路由的 V1.5/V1.6 死代码。

- [ ] 先写路由安全和 repository 契约失败测试。
- [ ] 迁移后运行全部安全回归。
- [ ] 中文提交：`需求描述：规范V1.7云函数分层`。

## Task 4: 首页、购物车和用户资料

**Files:** `catalog-actions.js`、`cart-actions.js`、`profile-actions.js`、对应 repositories/tests。

**Produces:** `getHomeStatus/nudgeOpenGroup`，购物车五 action，用户资料与身份接口。购物车不占库存；催开团按“北京时间日期+openid”稳定 ID 每日去重。

- [ ] 覆盖开团/休息/未开团三态和非开团售罄。
- [ ] 覆盖旧批次购物车失效、价格变化提示、清除失效。
- [ ] 中文提交：`需求描述：实现V1.7购物车和营业三态`。

## Task 5: 多 SKU 订单和支付

**Files:** `order-actions.js`、order repository、router/tests。

**Produces:** `createOrder/payOrder/queryPaymentResult/cancelPendingOrder`；服务端价格快照；随机 `pickupQrToken` 与 `phoneTail`；3 分钟倒计时以 `serverNow/expiresAt` 为准。

- [ ] 覆盖任一 SKU 不足整单零预占、两个站抢最后库存、重复 clientRequestId、重复付款、3分钟和22:00边界。
- [ ] 中文提交：`需求描述：实现V1.7多SKU三分钟支付预占`。

## Task 6: 批次、休息与生命周期

**Files:** `batch-actions.js`、`lifecycle-actions.js`、batch repository/tests。

**Produces:** 发布仅接收 `skuRows + stationIds`；站点固定资料复制；10:00 软提醒；追加库存、下架 SKU、今日休息；22:00 锁定、12:00 确认；手动确认/取消和关闭退款重试。

- [ ] 保证批次/站点/窗口/库存全有或全无。
- [ ] 终态不被重复任务或关闭操作改写。
- [ ] 中文提交：`需求描述：实现V1.7批次发布和双时点生命周期`。

## Task 7: 两段制退款

**Files:** `refund-actions.js`、order repository/tests、router。

**Produces:** 交付前即时退款、交付后申请、超管同意/拒绝、稳定退款单号、失败重试、退款/核销/放置 CAS 互斥。拒绝申请不创建 refunds 记录，只恢复原订单状态并保留处理记录。

- [ ] 覆盖退款后人数/件数、配送确认后跌至非零继续配送、跌至零自动关闭。
- [ ] 中文提交：`需求描述：实现V1.7交付前后两段制退款`。

## Task 8: 核销、照片和双交付

**Files:** `fulfillment-actions.js`、fulfillment repository/tests。

**Produces:** 扫随机 token、输尾号候选、尾号重复人工选择、有人核销照片前置、无人放置整场事务、未取照片收尾、多站权限和超管跨站二次确认。

- [ ] 照片 1-3 张，上传失败不改变订单。
- [ ] 结束本场前不得存在未处理待自提订单。
- [ ] 中文提交：`需求描述：实现V1.7尾号核销和双交付`。

## Task 9: 商品、SKU、分类和站点管理

**Files:** `admin-catalog-actions.js`、repositories/tests/router。

**Produces:** 改价即时生效；历史订单价格快照不变；有引用只能下架；分类引用保护；站点固定窗口/地点/图片/verifyMode 完整校验。

- [ ] 中文提交：`需求描述：补全V1.7菜单库与站点资料管理`。

## Task 10: C 端 16 屏

**Files:** 新增 `pages/cart`、`checkout`、`payment`；更新其余 C 端页面、`app.js/app.json`、前端 utils、tokens/common。

**Produces:** 首页→分类→详情→加购/立即购买→选站→结算→支付→成功→订单→取货券主线；无待支付列表；双订阅选择持久化；v4 视觉和交互。

- [ ] 页面定时器卸载清理、按钮防重复、长错误用 modal。
- [ ] 旧规则文案和页面裸色静态扫描为零。
- [ ] 中文提交：`需求描述：落地V1.7用户端16屏主流程`。

## Task 11: 商家端

**Files:** `adminHome/adminProducts/adminBatch/adminStations/adminVerify`。

**Produces:** 催开团计数、按人进度、待处理申请、手动确认/取消；简化批次发布；商品删除保护；站点资料；扫码/尾号/照片/无人放置/未取收尾。

- [ ] 中文提交：`需求描述：落地V1.7商家工作台与现场履约`。

## Task 12: 演示数据、文档与全量验收

**Files:** `initDemo`、`AGENTS.md`、`CLAUDE.md`、`README.md`、`ACTIONS.md`、测试与部署文档。

**Produces:** 布吉有人核销、大学城无人放置、同尾号预警、按人/按件分离的动态演示数据；所有文档反映真实完成状态，真实支付待办继续保留。

- [ ] `node scripts/check-integrity.js`
- [ ] `node --test cloudfunctions/api/tests/*.test.js scripts/tests/*.test.js`
- [ ] 全 JS `node --check`、JSON 解析、WXML 标签、UTF-8/NUL、action 交叉扫描。
- [ ] 微信开发者工具完整购买/退款/核销/放置/权限冒烟。
- [ ] 中文提交：`需求描述：完成泰斓V1.7全量验收与上线资料`。

## Release Gate

只有 Task 1-12 全部完成且测试 0 失败后：备份云数据库，保留 admins/users/config，清空其他业务集合，部署同一提交的 api，执行受信 initDemo，再上传同一提交的小程序并打 `v1.7.0-internal` 标签。任何核心冒烟失败立即恢复 V1.6，不做现场补丁式上线。
