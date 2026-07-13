# CLAUDE.md / AGENTS.md — 泰斓 TAILAN 拼团自提小程序

> 本文件是所有 AI 编码代理（Claude / Codex 等）进入本项目的第一必读文件。
> 维护协议见文末。与代码冲突时，以代码实际行为为准并回来修正本文件。

## 1. 项目是什么

微信小程序「泰斓 TAILAN」：家庭烘焙泰式斑斓甜品，无门店，
模式为「今天拼·明天取」——用户先付款加入某地铁站的团，
站点凑满门槛后商家次日到站，用户在固定时间窗口凭手机尾号后 4 位自提。

- 产品需求：`banlan-cake-prd-v1.7.md`（业务唯一依据；v1.6 仅历史）
- 视觉基准：`设计稿v3-解包版.html`（UI 1:1 还原依据）
- 后端接口清单：`cloudfunctions/api/ACTIONS.md`

## 2. 技术方案（不经用户同意不得更换）

- 前端：微信小程序原生 WXML/WXSS/JS，禁用 uni-app/Taro，禁用 UI 组件库
- 后端：微信云开发（云函数 + 云数据库 + 云存储），单入口云函数
  `cloudfunctions/api/index.js` 按 event.action 路由；纯业务逻辑抽在
  `domain.js`（有单测 `tests/domain.test.js`，改 domain 必须同步改测试）
- 支付：`MOCK_PAY = resolveMockPay(process.env)`，**默认 true**。当前个人主体无商户号，
  点支付直接成功；`mockPay=false` 时 payOrder 拒绝冒充成功。payCallback 验签与 cloudPay
  下单尚未联调完成（仅有 helpers + 退款 retry 骨架）；办完执照后云端设 MOCK_PAY=false
  并补齐验签；真实下单 time_expire 必须对齐 3 分钟预占
- 手机号：`MANUAL_PHONE = true`。个人主体手动填写；非个人主体切
  getPhoneNumber 一键授权（与真实支付同一门槛）。尾号后 4 位兼作核销凭证
- 二维码：`miniprogram/libs/weapp-qrcode.js` 本地引入，禁止外网依赖
- 样式：所有色值走 `miniprogram/styles/tokens.wxss` CSS 变量，
  页面 WXSS 禁止裸写色值；商家端为深色主题（--c-admin-bg）
- tabBar 四项：首页 / 点单(catalog) / 我的订单 / 我的；
  订单角标用 wx.setTabBarBadge（index=2）

## 3. 核心业务规则速查（改这些必须先改 PRD）

- 日批次：商家确认 SKU 库存后手动发布；销售日 D 只能销售 D+1 取货批次，
  当天北京时间22:00停止新下单和支付，不自动开放后天取批次；一天一批、不做预约
- 发布：站点/窗口/地点/图片/核销模式为平时维护好的固定资料，发布时只
  选 SKU + 填库存 + 勾选启用站点；建议10:00前发布（软提醒，过点仍可发）
- 休息态：商家可点「今日休息」；未发布也未休息时首页显示「催开团」话术，
  用户可点催开团（仅计数、不推送）；非开团态点单页/商品一律售罄
- 成团门槛：默认每站5人（按该站不同付款用户openid去重累计，不按件/不按单）；
  22:00截单即锁定成团结果；库存与备料仍按件另算
- 配送确认：22:00满5人锁定成团；取货日12:00达到5人则配送、不足5人关站退款；
  超级管理员可在12:00前手动确认不足5人仍配送、也可对已成团站手动取消配送；
  成团后个别退款不散团，退到0人才自动取消；不设自动维持线
- 共享库存：batchInventory 按批次和 SKU 跨站点共享、先到先得；发起支付才预占
  库存3分钟，付款成功才转已售；真实支付用time_expire对齐 + payCallback幂等兜底
- 退款两段制：交付前用户自助整单即时退款（不审核）；交付后仅能申请、转商家
  人工个例处理；不部分退、不顺延；交付前全程可退、损失商家承担
- 核销：凭手机尾号后4位；扫二维码或输尾号双路径、手动为兜底；同场次尾号
  重复后台预警、命中多单人工区分；到点/放置必须拍照上传（用户可见）
- 交付模式按站点配置：有人核销 / 无人放置（点「已放置」+ 照片即完成交付）；
  有人核销窗口结束未取→保持待取、挪货拍照、可延后自取、商家手动收尾、不退款
- 不限购；主打站点：布吉、大学城（站点池可管理，含 verifyMode 核销模式）
- 站点窗口：后台维护站点、取货日期、开始/结束时间、地点说明和最多3张图片
- 首页：首页只做品牌概念展示，保留「立即去拼」主入口；商品选择后再选站点
- 订阅消息2个模板：成团结果通知 + 自提提醒；支付成功时一次授权两个模板，
  回写 orders.subscribeGroupResult / subscribePickupNotice
- 登录：云开发 openid 即身份；头像昵称用 chooseAvatar/nickname 原生能力；
  手机号创建订单前强制填写（个人主体手动、非个人主体getPhoneNumber）、存档复用、
  不填不能参团

> 实现状态：以上 V1.7 规则已落入内部 `MOCK_PAY=true` 演示代码、接口契约和本地测试。
> 云端部署、真机冒烟、真实支付、退款对账与订阅模板真机发送验证仍未完成，不得声称正式上线。

## 4. 环境红线（有过三轮事故，最高优先级）

1. 写任何含中文的文件，禁止用代理内置文件写入工具，
   一律执行 Python 脚本：open(path,'w',encoding='utf-8',newline='\n')。
   Windows PowerShell 重定向会写出 UTF-16/截断文件——本项目曾因此
   三轮交付共 30+ 个损坏文件。
2. 每写完一个文件立即验证并粘贴真实输出：node --check（js）/
   json 解析（json）/ <view> 标签配对（wxml）/ 无 \x00 字节 +
   打印末尾 3 行证明完整。
3. 交付前跑全库扫描（js 全过 + damaged: 0 + 绑定交叉扫描 +
   tests 全 PASS），粘贴输出。声称"已验证"但不贴输出 = 任务失败。

## 5. 部署与测试标准流程

- 部署：开发者工具右键 cloudfunctions/api →
  「上传并部署：云端安装依赖（不上传 node_modules）」。
  报 Cannot find module = 选错了"所有文件"选项，重新部署。
- 重置演示数据：清空 batches/batchStations/batchInventory/
  deliveryWindows/orders/stations/products/skus 八个集合的记录
  （admins/users/config 不动）→ 云端测试跑 {"action":"initDemo"}。
  注意 initDemo 有安全锁：有数据时仅超级管理员可执行。
- 定时器：lifecycleTick 每分钟（config.json 随部署自动建），
  识别依赖 event.Type==='Timer'
- MOCK 模式测试路径见 `MOCK模式测试指引.md`

## 6. 已验证不可行 / 踩过的坑（新坑必须追加到这里）

- ✗ Codex 内置写文件工具写长中文文件 → 尾部截断 + UTF-16 混入（3次复现）
- ✗ db.doc(id).set() 的 data 里带 _id → -501007 报错（setDoc 已剥离）
- ✗ context.triggerName 识别定时器 → 微信实际传 event.TriggerName
- ✗ 云函数用本地时区判断22:00或12:00 → UTC 差 8 小时，必须 beijingTime
- ✗ navigateTo 跳 tab 页 → 运行时报错，必须 switchTab（且带不了参数）
- ✗ wx.getUserProfile → 已废弃，只能 chooseAvatar + nickname input
- ✗ 启动即强制登录弹窗 → 微信审核红线，必须可跳过、支付前再强制
- ✗ 云端测试(控制台)无用户 openid → 依赖身份的 action 会以
  anonymous 执行，别用它测 bindAdmin 等
- ✗ 部署选「所有文件」→ 云端无 wx-server-sdk 直接崩
- ✗ 多次 showToast 长文案 → 会被截断，长内容用 showModal/弹层

## 7. 禁改区

- domain.js 的既有导出函数签名（有测试与多处调用依赖）
- tokens.wxss 的变量名（全站引用）
- orders.items 的价格快照机制（改价不影响已付订单的根基）
- 本文件第 4 节

## 8. 待办与展望（做完要移进第 9 节）

- 真实支付接入（等个体户执照 + 商户号）：云端 MOCK_PAY→false、
  cloudPay 下单、payCallback 验签、迟到成功兜底、退款真实化与对账
- 上线前：申请2个订阅模板并填 config
  （成团结果 / 自提提醒）；非个人主体切 getPhoneNumber（MANUAL_PHONE→false）
- 在微信开发者工具和真机完成购买、退款、尾号核销、扫码核销、无人放置和权限冒烟
- 同版部署前备份数据库并执行迁移方案（见 docs/）
- V2：取货券 canvas 海报生成、团长激励、周期购、自定义凸起 tabBar

## 9. 变更日志（每轮交付追加一行，格式：日期 | 改了什么 | 动了哪些文件）

- 2026-07-14 | 修复本地验收问题：统一预占状态、服务端时钟倒计时、取消反馈、商品引用快照、过期预占筛选、多站授权、两类通知入队及逐订单重试 | miniprogram、order/fulfillment/lifecycle/notification services、repositories、tests、docs
- 2026-07-13 | 第三阶段本地准备：MOCK_PAY 环境开关（默认 true）、payment-helpers（time_expire/回调分类）、notificationOutbox 发送器骨架与单测；产出审计/迁移/冒烟文档；不部署不改云数据 | runtime-config、payment-helpers、notification-outbox、index.js、tests、docs/
- 2026-07-13 | 完成 V1.7 内部演示版全栈改造：3分钟多SKU预占、按人成团、双时点生命周期、两段制退款、尾号/二维码核销、照片交付、双交付模式、营业三态、菜单库与商家端；同步契约与上线验收 | cloudfunctions/api、miniprogram、README.md、ACTIONS.md、V1.7-上线验收.md、tests
- 2026-07-13 | Open Design 提取 v3 设计系统并增量产出 V1.7 版 16 屏高保真可交互设计稿，补齐购物车/结算/3分钟预占及商家端交付流程 | 设计稿v4-V1.7.html、TAILAN-DESIGN.md、docs/open-design、scripts/tests/v17-design-prototype.test.js
- 2026-07-13 | 需求对齐产出 PRD V1.7（3分钟预占/5人成团按人/22:00锁定/尾号核销+重复预警/双交付模式+拍照/两段制退款/发布只选SKU+勾站/10点软截止+休息态+催开团/权限多站/2订阅模板/手机号双逻辑）；同步修 CLAUDE.md，ACTIONS.md 待重修 | banlan-cake-prd-v1.7.md、CLAUDE.md
- 2026-07-12 | V1.6落地：日批次/5件门槛/交付前退款/品牌泰斓 | 全站
- 2026-07-06 | 真实菜单5产品+图片进包 | initDemo、assets/products
- 2026-07-07 | tabBar四项+订单角标+取货点传图+站点管理页+售后修复 | 多处
- 2026-07-07 | 夜审：核销参数错配/定时器识别/订阅回写/未取货死路等6严重bug | 见晨报
- 2026-07-07 | initDemo安全锁+防抖+分享配图+规则半屏弹层+窗口编辑表单 | 多处
- 2026-07-09 | 真机修复轮：截止校验/MOCK退款终态/取货券精简/商家端浅色化/PRD附录A | 多处
- 2026-07-07 | 站点换布吉/大学城、门槛5、首页站点独立卡、选站页补支付栏 | home/pickStation/initDemo
- 2026-07-11 | 同步 PRD V1.6 目标规则并标注代码待改造 | PRD/AGENTS/CLAUDE/README/ACTIONS

## 维护协议（对所有代理生效）

1. 每轮交付结束，在第 9 节追加一行变更日志。
2. 新增技术决策 → 写进第 2/3 节对应位置；推翻旧决策 → 修改原文
   并在第 6 节记录为什么推翻。
3. 踩到新坑 → 立即追加到第 6 节，一行一个，以 ✗ 开头。
4. 完成第 8 节待办 → 移到第 9 节日志。
5. 本文件本身也适用第 4 节写入铁律。
