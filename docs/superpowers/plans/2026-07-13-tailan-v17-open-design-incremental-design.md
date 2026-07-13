# 泰斓 V1.7 Open Design Incremental Design Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 使用 Open Design 辅助把 v3 单文件高保真原型增量升级为完整、可点击、符合 PRD V1.7 的 v4 原型。

**Architecture:** 保留 v3 为不可变视觉母版，先让 Open Design 在当前项目上下文中理解设计系统与规则，再由 Codex将页面统一整合到一个离线 HTML。状态变化在屏内完成，页面跳转使用锚点，验收脚本检查结构、旧规则、编号和链接。

**Tech Stack:** Open Design 0.14.2、Codex、HTML、CSS、原生 JavaScript、PowerShell、Node.js 24。

## Global Constraints

- 不修改 `设计稿v3-解包版.html`。
- 输出 `设计稿v4-V1.7.html`，UTF-8、单文件、离线可打开。
- 视觉 token、390×844 手机框、C 端明亮/商家端深色全部复用 v3。
- 业务规则以 `banlan-cake-prd-v1.7.md` 为准。
- 只做本次原型设计，不修改小程序业务代码。

---

### Task 1: 启动 Open Design 工作环境

**Files:**
- Read: `open-design/package.json`
- Read: `open-design/QUICKSTART.md`
- Read: `设计稿v3-解包版.html`
- Read: `banlan-cake-prd-v1.7.md`
- Read: `cloudfunctions/api/ACTIONS.md`

**Interfaces:**
- Consumes: Node.js 24、Open Design 源码目录。
- Produces: 可访问的 Open Design Studio，能够读取当前项目目录。

- [ ] **Step 1: 验证 Open Design 运行版本**

Run: `node --version; corepack pnpm --version`

Expected: Node 输出 `v24.x`，pnpm 输出 `10.33.2`。

- [ ] **Step 2: 安装 Open Design 依赖**

Run: `corepack pnpm install`

Expected: 安装成功并执行项目 postinstall，无未解决依赖错误。

- [ ] **Step 3: 启动 Open Design Web 工作台**

Run: `corepack pnpm tools-dev run web --daemon-port 17456 --web-port 17573`

Expected: daemon 和 web 启动，浏览地址为 `http://localhost:17573`。

### Task 2: 建立不可变基线和 v4 工作文件

**Files:**
- Read: `设计稿v3-解包版.html`
- Create: `设计稿v4-V1.7.html`
- Create: `scripts/tests/v17-design-prototype.test.js`

**Interfaces:**
- Consumes: v3 HTML 原文。
- Produces: v4 工作副本和可重复执行的结构验收测试。

- [ ] **Step 1: 写结构测试**

测试应读取 v3/v4，断言两个文件都存在；v4 包含 `id="home"`、`id="p1"` 至 `id="p15"`；不存在 `15分钟`、`6 位核销码`、`满5件成团`；包含 `3:00`、`手机尾号后 4 位`、`已拼 4/5 人`、`有人核销`、`无人放置`。

- [ ] **Step 2: 运行测试确认 v4 尚未满足要求**

Run: `node --test scripts/tests/v17-design-prototype.test.js`

Expected: FAIL，提示 v4 不存在或缺少 V1.7 页面。

- [ ] **Step 3: 从 v3 复制 v4 工作文件**

使用文件复制保持 v3 不变，随后所有改动只进入 v4。

- [ ] **Step 4: 记录 v3 SHA-256**

Run: `Get-FileHash -Algorithm SHA256 '设计稿v3-解包版.html'`

Expected: 保存哈希用于最终比对。

### Task 3: 用 Open Design 生成 C 端交易主线

**Files:**
- Modify: `设计稿v4-V1.7.html`

**Interfaces:**
- Consumes: v3 视觉契约、PRD V1.7、页面 0～8 需求。
- Produces: 首页到站点团页的可点击交易链路。

- [ ] **Step 1: 向 Open Design 提交增量设计提示**

提示中锁定 v3 token，要求生成/修改 0～8 屏，禁止覆盖原设计系统，新增购物车、结算和支付预占页。

- [ ] **Step 2: 整合 0～8 屏**

将 Open Design 输出整合进 v4，首页三态与支付三态通过原生 JavaScript 切换。

- [ ] **Step 3: 校验交易链路**

逐个检查 `#home → #p1 → #p2 → #p3/#p4 → #p5 → #p6 → #p7 → #p9 → #p10` 的实际目标，并按最终编号修正。

### Task 4: 用 Open Design 生成订单、个人中心和商家端

**Files:**
- Modify: `设计稿v4-V1.7.html`

**Interfaces:**
- Consumes: 页面 9～15 需求及 C/商家双主题。
- Produces: 订单、取货券、我的、工作台、商品、批次和核销页面。

- [ ] **Step 1: 生成订单与个人中心页面**

订单页覆盖待自提、已完成、已退款、已完成未取；取货券覆盖尾号、二维码、交付模式和照片；我的页按身份展示入口。

- [ ] **Step 2: 生成商家端页面**

工作台覆盖休息、催开团、配送确认/取消和退款申请；批次页覆盖 SKU、库存、站点与 10:00 软提醒；核销页覆盖扫码、尾号、重复预警、拍照和无人放置。

- [ ] **Step 3: 统一编号和导航**

顶部导航使用 0～15，新增页面标题带 `V1.7 新增`，所有商家入口指向正确锚点。

### Task 5: 验证和交付

**Files:**
- Verify: `设计稿v3-解包版.html`
- Verify: `设计稿v4-V1.7.html`
- Verify: `scripts/tests/v17-design-prototype.test.js`

**Interfaces:**
- Consumes: 完整 v4。
- Produces: 可交付的单文件原型和验证证据。

- [ ] **Step 1: 运行原型结构测试**

Run: `node --test scripts/tests/v17-design-prototype.test.js`

Expected: PASS。

- [ ] **Step 2: 扫描 HTML 和 JavaScript**

检查标签配对、空锚点、重复 ID、脚本语法和 NUL 字节。

- [ ] **Step 3: 浏览器视觉检查**

打开 v4，分别检查 390×844 桌面画布、首页三态、购物车结算、支付三态、取货券和商家核销页面，并保存全页截图证据。

- [ ] **Step 4: 执行项目要求的完整性测试**

Run: `node scripts/check-integrity.js`

Expected: integrity PASS。

Run: `node --test cloudfunctions/api/tests/*.test.js scripts/tests/*.test.js`

Expected: 全部测试 PASS；若现有测试存在与本次无关的基线失败，需单独标注。

- [ ] **Step 5: 对比 v3 哈希并交付**

再次计算 v3 SHA-256，必须与 Task 2 完全一致；交付 v4 文件及修改/新增页面清单。

