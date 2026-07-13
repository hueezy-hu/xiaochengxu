# V1.7 本地验收问题修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复不依赖微信商户资料的七项已确认问题，并用自动化测试锁定行为。

**Architecture:** 保持微信原生小程序和单入口云函数结构，不接入真实支付、不改云端配置。前端时间计算抽成纯函数，后端继续在现有 service/repository 分层内做最小修改。

**Tech Stack:** 微信原生小程序 JS/WXML、Node.js `node:test`、微信云开发数据库仓储。

## Global Constraints

- PRD V1.7 是业务唯一真源。
- `MOCK_PAY` 继续默认 `true`。
- 不修改真实支付、退款回调、模板关键词和云端数据。
- 每项修复先写失败测试，确认 RED 后再写最小实现。
- 不改未跟踪的 `.claude/` 和 `open-design/`。

---

### Task 1: 前端预占状态、服务端时钟与取消反馈

**Files:**
- Create: `miniprogram/utils/payment-clock.js`
- Modify: `miniprogram/utils/status.js`
- Modify: `miniprogram/pages/checkout/checkout.js`
- Modify: `miniprogram/pages/payment/payment.js`
- Modify: `miniprogram/pages/paySuccess/paySuccess.js`
- Modify: `cloudfunctions/api/index.js`
- Test: `scripts/tests/v17-local-fixes.test.js`

**Interfaces:**
- `createServerOffset(serverNow, clientNow) -> number`
- `secondsUntil(expiresAt, offset, clientNow) -> number`
- `cancelFeedback(response) -> { ok, message }`

- [ ] 写测试：状态常量必须为“预占中”，服务端时钟偏移参与倒计时，取消失败不得提示库存已释放。
- [ ] 运行 `node --test scripts/tests/v17-local-fixes.test.js`，确认因缺少实现失败。
- [ ] 新增纯函数并让 checkout 传 `serverNow`；payment 使用偏移时钟并按 `res.ok` 分支。
- [ ] 统一 mine 统计和支付成功角标为“预占中”。
- [ ] 重跑该测试确认通过。

### Task 2: 订单快照和过期预占查询

**Files:**
- Modify: `cloudfunctions/api/src/services/order-actions.js`
- Modify: `cloudfunctions/api/src/repositories/order-repository.js`
- Test: `cloudfunctions/api/tests/v16-order-actions.test.js`

**Interfaces:**
- 订单 `items[]` 新增服务端 SKU 的 `productId` 快照。
- `repository.listPendingOrderIds(limit, expiredBefore)` 只返回已到期预占。

- [ ] 写测试：真实创建订单必须保存 `productId`；批量清理必须把当前服务端时间传入仓储。
- [ ] 运行目标测试确认失败。
- [ ] 在创建快照时写入 `sku.productId`，查询使用 `expiresAt <= expiredBefore`。
- [ ] 重跑目标测试确认通过。

### Task 3: 核销员多批次、多站授权合并

**Files:**
- Modify: `cloudfunctions/api/src/services/fulfillment-actions.js`
- Test: `cloudfunctions/api/tests/v16-fulfillment-actions.test.js`

**Interfaces:**
- `assignVerifier` 对相同批次合并站点，对不同批次追加 scope，保留已有授权。

- [ ] 写测试：连续两次授权后必须同时保留两个批次/多个站点。
- [ ] 运行目标测试确认失败。
- [ ] 实现 scope 合并和 `stationIds`/`batchIds` 去重派生。
- [ ] 重跑目标测试确认通过。

### Task 4: 两类订阅消息完整入队与可靠重试

**Files:**
- Modify: `cloudfunctions/api/src/services/lifecycle-actions.js`
- Modify: `cloudfunctions/api/src/services/fulfillment-actions.js`
- Modify: `cloudfunctions/api/src/services/notification-outbox.js`
- Modify: `cloudfunctions/api/index.js`
- Test: `cloudfunctions/api/tests/v16-batch-lifecycle.test.js`
- Test: `cloudfunctions/api/tests/v17-phase3-prep.test.js`

**Interfaces:**
- 12:00 成功配送写 `groupResult(groupSuccess=true)` 和 `pickupReminder`。
- 未成团退款完成写 `groupResult(groupSuccess=false)`。
- Outbox 重新处理 `发送失败`、`跳过-无模板`，并用 `sentOrderIds` 避免部分成功用户被重复发送。

- [ ] 写生命周期和 outbox 失败测试，确认缺少入队与重试行为。
- [ ] 运行两个目标测试确认失败。
- [ ] 补齐稳定通知 ID、可重试状态查询和逐订单发送进度。
- [ ] 删除不属于两模板的 `orderPlaced` outbox 写入。
- [ ] 重跑两个目标测试确认通过。

### Task 5: 文档同步与全量验证

**Files:**
- Modify: `cloudfunctions/api/ACTIONS.md`
- Modify: `README.md`
- Modify: `CLAUDE.md`

- [ ] 同步说明状态、时钟、通知重试、多站权限和订单快照修复事实，继续保留真实支付阻塞声明。
- [ ] 运行 `node scripts/check-integrity.js`。
- [ ] 运行 `node --test cloudfunctions/api/tests/*.test.js scripts/tests/*.test.js`。
- [ ] 对全部 JS 执行 `node --check`，解析全部 JSON，运行 `git diff --check`。
- [ ] 检查差异范围后按中文格式提交 Git。
