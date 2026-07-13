# Open Design 任务：提取泰斓 v3 设计系统

你正在 Open Design 项目“泰斓 V1.7 增量设计”中工作，当前目录就是项目根目录。

请先阅读并遵守 `AGENTS.md`、`CLAUDE.md`，再读取：

- `设计稿v3-解包版.html`
- `banlan-cake-prd-v1.7.md`
- `cloudfunctions/api/ACTIONS.md`
- `docs/superpowers/specs/2026-07-13-tailan-v17-open-design-incremental-design.md`

本轮只完成设计系统抽取，不修改 v3，不修改小程序源码，也不开始重画页面。

请从 v3 的真实 HTML/CSS 中提取并创建根目录文件 `TAILAN-DESIGN.md`，内容必须包含：

1. 精确色彩 token 及其使用场景。
2. 字体族、字号、字重、行高和文字颜色层级。
3. 390×844 手机框、横向画布、屏幕标题编号格式。
4. 卡片、内容块、胶囊按钮、状态标签、进度条、底部导航的组件规则。
5. C 端明亮主题和商家端深色主题的边界。
6. 从 v3 观察到的间距、阴影、圆角和图标风格。
7. 禁止事项：不得引入新审美、不得改变主色、不得把“人”和“份/个”混淆。
8. V1.7 增量页面如何复用现有组件，而不是另建新组件体系。

写完后检查文件无占位符、无与 v3 冲突的规则。最终回复只需要说明已创建 `TAILAN-DESIGN.md` 以及提取了哪些设计层级。
