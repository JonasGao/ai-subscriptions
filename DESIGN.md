---
name: AI订阅管理工具
description: 单人自托管的 AI 订阅账本，克制、清楚、可信
colors:
  ledger-indigo: "#4f46e5"
  ledger-indigo-dark: "#818cf8"
  paper-white: "#ffffff"
  snow-white: "#fafafa"
  ink-black: "#18181b"
  muted-slate: "#71717a"
  muted-slate-dark: "#a1a1aa"
  card-surface: "color-mix(in srgb, var(--bg) 94%, var(--fg) 6%)"
  hairline: "color-mix(in srgb, var(--fg) 14%, transparent)"
  available-green: "#16a34a"
  available-green-dark: "#4ade80"
  pending-amber: "#d97706"
  pending-amber-dark: "#fbbf24"
  alert-red: "#dc2626"
  alert-red-dark: "#f87171"
  warning-amber: "#f59e0b"
  success-green: "#15803d"
typography:
  display:
    fontFamily: "sans-serif"
    fontSize: "1.75rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "sans-serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.2
  title:
    fontFamily: "sans-serif"
    fontSize: "1.05rem"
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: "sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.4
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "0.85rem"
    fontWeight: 400
rounded:
  chip: "0.3rem"
  control: "0.4rem"
  button: "0.45rem"
  tile: "0.5rem"
  panel: "0.6rem"
  card: "0.75rem"
  pill: "999px"
spacing:
  xs: "0.35rem"
  sm: "0.5rem"
  md: "0.75rem"
  lg: "1rem"
  xl: "1.25rem"
  page: "2rem"
components:
  button-primary:
    backgroundColor: "{colors.ledger-indigo}"
    textColor: "{colors.paper-white}"
    typography: "{typography.body}"
    rounded: "{rounded.button}"
    padding: "0.5rem 0.9rem"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink-black}"
    typography: "{typography.body}"
    rounded: "{rounded.button}"
    padding: "0.5rem 0.9rem"
  button-danger:
    backgroundColor: "{colors.alert-red}"
    textColor: "{colors.paper-white}"
    typography: "{typography.body}"
    rounded: "{rounded.button}"
    padding: "0.5rem 0.9rem"
  input-field:
    backgroundColor: "{colors.paper-white}"
    textColor: "{colors.ink-black}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0.5rem 0.6rem"
  card:
    backgroundColor: "{colors.card-surface}"
    textColor: "{colors.ink-black}"
    typography: "{typography.body}"
    rounded: "{rounded.card}"
    padding: "1rem"
  tag-chip:
    backgroundColor: "color-mix(in srgb, var(--accent) 14%, transparent)"
    textColor: "{colors.ink-black}"
    typography: "{typography.label}"
    rounded: "{rounded.chip}"
    padding: "0.15rem 0.5rem"
  status-pill:
    backgroundColor: "transparent"
    textColor: "{colors.ink-black}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0.15rem 0.55rem"
  nav-active:
    backgroundColor: "{colors.ledger-indigo}"
    textColor: "{colors.paper-white}"
    typography: "{typography.body}"
    padding: "0.45rem 0.9rem"
  dialog:
    backgroundColor: "{colors.paper-white}"
    textColor: "{colors.ink-black}"
    typography: "{typography.body}"
    rounded: "{rounded.card}"
    padding: "1.25rem 1.5rem"
    width: "min(38rem, 100%)"
---

# Design System: AI订阅管理工具

## Overview

**Creative North Star: "素页账本 / The Plain Ledger"**

这是一本收拾干净的账本，不是仪表盘。白纸或炭黑纸面上只有细到几乎看不见的分隔线，一点靛蓝用来标记「这里可以点、这里被选中、这里正在变化」。所有视觉决定服务于一个动作：把订阅、金额、状态和到期时间记下来，然后一眼查到。PRODUCT.md 确认的定位是个人订阅记账本，因此界面不制造戏剧性、不争夺注意力，也不假装自己是一个控制平台。

气质是**克制、清楚、可信**。信息密度不低——卡片里挤着字段、徽章、进度条和操作按钮——但密度靠对齐、留白节奏和字重差异来消化，而不是靠装饰。系统字体、四枚主题变量、几乎为零的阴影、没有宽度断点：整套实现刻意把「设计感」压到最低，让数据成为唯一的主角。

明确排除的方向：**仪表盘大屏、渐变与玻璃拟态、装饰性插画、拟物化**。这是用户确认的视觉反例，不是临时偏好；任何新界面都不应借「更现代」之名把它们带回来。

**Key Characteristics:**

- 单一靛蓝强调色 + 中性纸面，语义色只描述状态。
- 静止状态完全平铺；层级靠 `color-mix()` 的极淡叠加与 1px 发丝线，不靠投影。
- 系统字体、原生表单控件、手写内联 SVG 图标，零外部字体与图标依赖。
- 响应式由 `auto-fill/auto-fit minmax()` 与 flex 换行完成，没有断点。
- 浅色 / 深色是同一套结构换四枚变量，深色模式另配语义色的高对比版本。

## Colors

四个 CSS 自定义变量撑起整套界面，其余表面与描边都由 `color-mix(in srgb, var(--fg) N%, transparent)` 派生——项目没有中性色阶，也不需要。

### Primary

- **账本靛 / Ledger Indigo** (#4f46e5，深色模式 #818cf8)：唯一的品牌色。落在主按钮、激活的导航项、链接、聚焦轮廓、进度条填充、优先级序号与标签底纹上。它是标记笔，不是刷墙漆：从不铺满大面积背景。

### Neutral

- **纸白 / Paper White** (#ffffff)：浅色模式页面底色；同时是浅色模式下主按钮的文字色。
- **炭黑 / Charcoal** (#18181b)：深色模式页面底色，也是深色模式下主按钮的文字色；同时是浅色模式的正文墨色。一枚值承担三种角色，是这套系统「不新增令牌」习惯的典型例子。
- **雪白 / Snow White** (#fafafa)：深色模式正文色。
- **静默灰 / Muted Slate** (#71717a，深色模式 #a1a1aa)：字段名、提示、副文本、倒计时、未选中状态。只用于「次要但必须读得到」的信息。
- **卡片面 / Card Surface** (`color-mix(in srgb, var(--bg) 94%, var(--fg) 6%)`)：卡片、统计块、通知卡、阈值面板的极淡叠加，比纯底色只深一点点。
- **发丝线 / Hairline** (`color-mix(in srgb, var(--fg) 14%, transparent)`)：卡片与控件描边。实际按位置在 10%–22% 间浮动，14% 是卡片默认值。

### Functional Status Colors

- **可用绿 / Available Green** (#16a34a，深色 #4ade80)：活跃订阅、成功、正在使用。
- **待办琥珀 / Pending Amber** (#d97706，深色 #fbbf24)：暂停状态、警告、飞书权限提示。
- **警示红 / Alert Red** (#dc2626，深色 #f87171)：错误条、配额用尽、删除、逾期、过期。
- **进度琥珀 / Warning Amber** (#f59e0b) 与 **确认绿 / Success Green** (#15803d)：用量进度条的 70% 阈值色，以及徽章/开源标记/通知成功态的深色文字色。

### Named Rules

**The One Accent Rule.** 靛蓝是唯一的非中性色。一屏之内它只出现在可交互与已选中的地方；若某个元素不响应用户动作，它就不该是靛蓝色。

**The Semantic Color Rule.** 绿、琥珀、红只表达状态与告警，永不作为装饰配色。它们各自有独立的深色值（#4ade80 / #fbbf24 / #f87171），不能靠降低透明度在深色模式里凑合——对比度修正已经是既有实现的一部分。

**The Reset Time Rule.** 重置倒计时文字是唯一允许连续插值的颜色：从淡黄经橙到深红由 `getResetUrgencyColor()` 按剩余时间算出 `hsl()`，仅用于 weekly / monthly 窗口。用量进度条另有 70% / 90% 两档离散阈值，两套编码互不混用。

## Typography

**Display / Body Font:** 系统 `sans-serif`（无 `@font-face`、无 Google Fonts、无内置字体文件）
**Label/Mono Font:** `ui-monospace, SFMono-Regular, Menlo, monospace`，仅用于模型 ID、权限 code、飞书 ID

**Character:** 一套字体走到底。层级靠字号、字重与颜色分工，不靠字体对比。页面标题用轻微负字距收紧，金额和读数用等宽数字对齐——这是「可信」在排版上的落点。

### Hierarchy

- **Display** (700, 1.75rem, `-0.02em`, line-height 1.2)：页面主标题，如「订阅」「通知」。登录页用 `clamp(1.75rem, 4vw, 2.5rem)`。
- **Headline** (700, 1.5rem, line-height 1.2)：区块标题与统计大数字；统计值额外使用 `tabular-nums`。
- **Title** (600, 1.05rem, line-height 1.3)：卡片标题、对话框 h2 (1.2rem)、小节标题 (1.1–1.15rem)。
- **Body** (400, 0.875rem, line-height 1.5)：正文与按钮文字；卡片字段常用 0.85rem 的紧排变体。
- **Label** (500, 0.75rem, line-height 1.4)：字段名、徽章、提示、倒计时；范围 0.7–0.85rem。
- **Mono** (400, 0.85rem)：模型列表项与代码片段。

### Named Rules

**The System Stack Rule.** 不加载任何网页字体。中文与拉丁文字共用系统 sans-serif，等宽栈只服务机器可读的标识符。

**The Tabular Numbers Rule.** 金额、统计值、用量百分比、优先级序号、倒计时一律 `font-variant-numeric: tabular-nums`，避免数字跳动破坏账本的可信感。

## Layout

页面是单列纵向流：外层 `min-height: 100vh`，页头最大宽度 72rem 居中，内容区 `padding: 2rem 1.5rem 4rem`，纵向 `gap: 1.25rem`。没有侧边栏，没有宽度媒体查询——全站只有一个 `@media (prefers-color-scheme: dark)`。

响应式完全交给网格：`repeat(auto-fill, minmax(18rem, 1fr))`（订阅卡）、`minmax(16rem, 1fr)`（代理订阅卡）、`minmax(22rem, 1fr)`（工具卡）、`repeat(auto-fit, minmax(11rem, 1fr))`（统计卡）、`minmax(20rem, 1fr)`（通知卡）。窄屏时列数自然下降，配合 `flex-wrap` 的工具栏与筛选条，不需要断点。表单是两列 `repeat(2, minmax(0, 1fr))`，跨列字段用 `.form-field-wide { grid-column: 1 / -1 }`。

间距节奏以 rem 阶梯递进：控件内 0.35–0.5rem，卡片内 0.75–1rem，卡片之间 1rem，区块之间 1.25rem，页面四周 2rem。密度偏高但对齐严格：字段行统一 `display: flex; justify-content: space-between`，值右对齐。

**The Grid Wraps, It Doesn't Break Rule.** 不要为某个屏宽引入断点或另写一套布局；调整 `minmax()` 的最小列宽或让工具栏换行即可。

## Elevation & Depth

静止状态**完全没有阴影**。层级来自极淡的 tonal layering：卡片面是 6% 的墨色叠加，描边是 10%–22% 的发丝线，激活态是 12% 的靛蓝叠加。这是一个平铺的系统，不是抬起的卡片墙。

### Shadow Vocabulary

- **Dialog Lift** (`box-shadow: 0 20px 50px rgba(0, 0, 0, 0.25)`)：仅对话框使用，配合 `rgba(0,0,0,0.45)` 遮罩表明模态层级。
- **Drag Lift** (`box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15)`)：仅 `.priority-row-dragging` 使用，表示正在被拖动的行。

### Named Rules

**The Flat-By-Default Rule.** 阴影只出现在「浮层」与「拖拽中」这两种临时状态。任何常规卡片、统计块、导航或列表项都不加阴影；需要强调时提高描边浓度或叠加底色。

## Shapes

圆角是克制的、功能分层的：小元素 0.3–0.4rem，按钮与输入 0.4–0.45rem，卡片与对话框 0.75rem，中间态 0.5–0.65rem。描边统一 1px 发丝线；表单中的临时区域（重置计划新增、空状态、飞书提示框）改用 1px 虚线，把「尚未落定」和「已保存记录」区分开。

**100% 圆角（999px）**是这套系统最具辨识度的轮廓，专门保留给状态徽章、代理订阅标签、优先级徽章、用量进度条与筛选胶囊。它从不用于按钮与卡片。

**The Pill Is For Status Rule.** 999px 只给徽章、标签与进度条；按钮与卡片一律保持可感知的直角感（0.45rem / 0.75rem），避免整页变成一堆胶囊。

## Components

整体气质：**朴素、贴合原生、状态可读**。控件不追求触感反馈，只有焦点轮廓、悬停微调与危险色三档明确信号。

### Buttons

- **Shape:** 轻圆角（0.45rem），1px 同色描边，内边距 `0.5rem 0.9rem`（紧凑场景 0.35–0.45rem）。
- **Primary:** 靛蓝实底 + 白字；深色模式改用亮靛底 + 墨色字（等于 `--bg`），保证对比度。
- **Ghost:** 透明底 + 墨色字 + 发丝线描边。
- **Danger:** 警示红实底白字；通知页用描边式危险按钮（红字红框，深色换 #f87171）。
- **Hover / Focus:** 悬停仅 `filter: brightness(1.05)`；表单控件聚焦是 `outline: 2px solid var(--accent); outline-offset: 1px`。禁用态 `opacity: 0.55–0.6`。

### Chips

- **Style:** 靛蓝 14% 叠加底、0.3rem 圆角、0.8rem 文字；标签管理器内的可移除 chip 带一个无边框的 × 。
- **State:** 选中/高亮为靛蓝 16% 叠加；代理订阅标签与状态徽章改用 999px 胶囊。

### Cards / Containers

- **Corner Style:** 0.75rem（统计块 0.6rem，工具/场景/通知卡 0.5–0.65rem）。
- **Background:** 6% 墨色叠加的卡片面；代理订阅与订阅卡一致。
- **Shadow Strategy:** 无阴影，遵循 Flat-By-Default。
- **Border:** 12%–15% 发丝线。
- **Internal Padding:** 1rem（统计块 0.9rem 1rem，工具卡 0.65rem 0.85rem）。

### Inputs / Fields

- **Style:** `var(--bg)` 底、20% 发丝线描边、0.4–0.45rem 圆角、0.5rem 0.6rem 内边距、`font: inherit`。原生 `select` / `radio` / `dialog`（`div role="dialog"`）不做自定义重绘。
- **Focus:** 2px 靛蓝 outline + 1px offset；标签输入框容器用 `:focus-within` 得到同一轮廓。
- **Error / Disabled:** 错误文字与错误条用警示红（#dc2626，深色 #f87171）；禁用用透明度。

### Navigation

- **Style:** 分段控件——整组 1px 发丝线 + 0.45rem 圆角，项间 1px 竖线分隔，无下划线。
- **States:** 默认墨色字；悬停靛蓝 12% 叠加；激活项靛蓝实底白字（深色反转为墨色字）。
- **Mobile:** 页头 `flex-wrap`，导航组随工具区一起换行，不改为抽屉或底部标签栏。

### Dialogs

- **Shape:** 0.75rem 圆角，`width: min(38rem, 100%)`（通知对话框 44rem），`max-height: 90vh` 内滚。
- **Depth:** 唯一使用 Dialog Lift 阴影的组件，遮罩 `rgba(0,0,0,0.45)`。
- **Content:** h2 1.2rem，表单两列网格，底部操作区右对齐。

### Usage Progress（签名组件）

- **Shape:** 0.35rem 高的 999px 轨道，12% 墨色叠加底；填充同为全圆角。
- **Tiers:** 常态靛蓝；≥70% 转 #f59e0b；>90% 转 #dc2626。`transition: width 0.2s ease`。
- **Encoding:** 进度条只编码消耗比例；重置紧迫度由倒计时文字的黄→红色相插值单独编码（ADR-0013），两者不合并。

### Drag Rows（签名组件）

- **Style:** 靛蓝 10% 叠加底 + 20% 靛蓝描边（深色用 #818cf8 对应值），0.375rem 圆角；序号用靛蓝 tabular-nums。
- **State:** 拖拽中加 Drag Lift 阴影，行透明度降到 0.5；抓取手柄为 `cursor: grab` 的无边框按钮。

## Do's and Don'ts

### Do:

- **Do** 用 `color-mix(in srgb, var(--fg) N%, transparent)` 生成描边与叠加面，而不是新增硬编码中性色；N 落在 10%–22% 之间。
- **Do** 让浅色 / 深色共用同一套结构，只切换 `--bg` / `--fg` / `--muted` / `--accent` 四枚变量。
- **Do** 为语义色使用深色模式的独立高对比值（#4ade80 / #fbbf24 / #f87171）。
- **Do** 用 `auto-fill/auto-fit minmax()` 与 `flex-wrap` 解决窄屏，并给金额与读数加 `tabular-nums`。
- **Do** 保留原生 `select` / `radio` 与 `div role="dialog"`，图标继续使用手写内联 SVG。

### Don't:

- **Don't** 引入仪表盘大屏、渐变、玻璃拟态、装饰性插画或拟物化——这是已确认的视觉反例。
- **Don't** 给常规卡片、统计块或导航加阴影；只有对话框与拖拽行可以抬起。
- **Don't** 用绿 / 琥珀 / 红做装饰配色，也别在深色模式里靠透明度复用浅色语义值。
- **Don't** 引入第二枚品牌强调色、网页字体、图标库或宽度断点。
- **Don't** 把 999px 全圆角用在按钮与卡片上，也不要把重置紧迫度色与用量进度条阈值混为一谈。
