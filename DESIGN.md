---
name: AI订阅管理工具
description: 时刻表栏律 —— 单人自托管的 AI 订阅台账，把账单与三种额度重置读到同一条时间轴上
colors:
  ink: "#1B2A33"
  ink-dark: "#0E1416"
  paper: "#EFEDE4"
  paper-dark: "#141A1D"
  sheet: "#FBFAF4"
  sheet-dark: "#1E2529"
  rule: "#C9C7BC"
  rule-dark: "#465156"
  signal: "#B23A24"
  signal-dark: "#E4654B"
  mark: "#C2452D"
  teal: "#2E6E73"
  teal-dark: "#6FB8A8"
  amber: "#D9A441"
  muted: "#5D6A70"
  muted-dark: "#9AA6A9"
  on-ink: "#F2EFE6"
typography:
  display:
    fontFamily: "system-ui, -apple-system, Segoe UI, Noto Sans CJK SC, Microsoft YaHei, sans-serif"
    fontSize: "1.55rem"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.015em"
  title:
    fontFamily: "system-ui, -apple-system, Segoe UI, Noto Sans CJK SC, Microsoft YaHei, sans-serif"
    fontSize: "0.95rem"
    fontWeight: 700
    lineHeight: 1.3
  body:
    fontFamily: "system-ui, -apple-system, Segoe UI, Noto Sans CJK SC, Microsoft YaHei, sans-serif"
    fontSize: "0.85rem"
    fontWeight: 400
    lineHeight: 1.35
  label:
    fontFamily: "system-ui, -apple-system, Segoe UI, Noto Sans CJK SC, Microsoft YaHei, sans-serif"
    fontSize: "0.68rem"
    fontWeight: 600
    lineHeight: 1.3
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "0.68rem"
    fontWeight: 400
    lineHeight: 1.3
    fontFeature: "tabular-nums"
rounded:
  square: "0"
spacing:
  xs: "0.35rem"
  sm: "0.5rem"
  md: "0.75rem"
  lg: "1rem"
  xl: "1.25rem"
  page: "1.625rem"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.on-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.square}"
    padding: "7px 13px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.square}"
    padding: "7px 13px"
  button-danger:
    backgroundColor: "{colors.signal}"
    textColor: "{colors.sheet}"
    typography: "{typography.body}"
    rounded: "{rounded.square}"
    padding: "7px 13px"
  header-rail:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.on-ink}"
    rounded: "{rounded.square}"
    height: "73px"
  table-header:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.on-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.square}"
    padding: "6px 10px"
  sheet-row:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.square}"
    padding: "0"
  input-field:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.square}"
    padding: "0.5rem 0.6rem"
  dialog:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.square}"
    padding: "1.25rem 1.5rem"
    width: "min(38rem, 100%)"
---

# Design System: AI订阅管理工具

## Overview

**Creative North Star: "时刻表栏律 / Timetable Column Rhythm"**

这是一张被认真排过的班次表，不是一个后台。整宽深墨蓝页头压住纸白地面，1px 实线把屏切成栏与行；账单周期与 5 小时 / 周 / 月三种额度重置被压到同一条 30 天时间轴上，四条轨道对齐，朱红刻口标出即将发生的那一次。世界只贡献四件事——字、色、密度和一个签名动作；布局、导航与控件全部是标准 web 组件。

气质是**清楚、密、可信**。信息密度高：小字号、紧行距、等宽数字、交替行底，但每条信息都在它该在的栏里。没有圆角、没有渐变、没有玻璃、没有装饰插画；层级靠栏线、字重与色轨，不靠阴影。签名动作是一条**真实数据**驱动的四轨共轴（账单 / 5h / 周 / 月），填充长度是各周期已过比例，刻口是周期终点落在 30 天轴上的位置，末尾给出等宽 `YYYY-MM-DD HH:mm · 剩余 X`。

明确排除且已写进实现禁令：仪表盘大屏、渐变与玻璃拟态、装饰性插画、拟物化、踢眉/eyebrow、字距撑开的大写小标签、Unicode 字形充当图标、卡片网格 + 统计数字 + 筛选条这一类别默认，以及它可预测的反面——白底细线单强调色的「克制工具」。

**Key Characteristics:**

- 整宽墨蓝页头与墨蓝按钮；纸白地、表格白面、1px 实线栏线、全直角。
- 朱红只标 imminent 与告警；青、琥珀是数据轨色；语义色在深色模式有独立高对比值。
- 系统 sans-serif 承担全部中文与拉丁文字，等宽栈只服务时刻、金额与测量值；`tabular-nums` 全站开启。
- 密度来自 0.68–0.85rem 的标签与正文、紧行距、无间隙的连续行；响应式靠 `auto-fill/auto-fit minmax()`、flex 换行与一处 720px 收窄。
- 浅色 / 深色共用同一套结构，只切换四枚主题变量与世界层变量；主题切换是功能，不是外观。

## Colors

四枚旧主题变量被换成一套有承诺的配色：墨蓝是壳与控件，纸白是地，表格白是面，朱红只做 imminent/告警，青与琥珀做数据轨。**不是灰屏加一枚强调色。**

### Primary

- **墨蓝 / Timetable Ink** (#1B2A33，深色 #0E1416)：整宽页头、主按钮、表头、可排序表头底色、进度填充与实线主分隔。它是壳与墨，不是点缀。

### Secondary

- **朱红 / Imminent Vermilion** (#B23A24，深色 #E4654B)：只用于告警文字、错误条、用尽状态、5h 轨与到期刻口。非文字的大面积标记用较亮的 #C2452D（`--tt-mark`）。文字对比：浅色纸上 5.08:1、表格白上 5.70:1；深色纸上 5.24:1。
- **青 / Cycle Teal** (#2E6E73，深色 #6FB8A8)：周轨、活跃/在册状态、成功提示。纸上 4.98:1。
- **琥珀 / Data Amber** (#D9A441)：月轨、激活导航块、暂停状态底色；是非文字数据带与实色块，不作为正文文字色。

### Neutral

- **纸白 / Rail Paper** (#EFEDE4)：页面地。
- **表格白 / Sheet** (#FBFAF4)：表格行、输入、对话框、卡片面。
- **栏线 / Rule** (#C9C7BC，深色 #465156)：1px 实线分隔、输入与控件描边。
- **静默灰 / Muted** (#5D6A70，深色 #9AA6A9)：字段名、提示、刻度、副文本。纸上 4.76:1。
- **墨上白 / On Ink** (#F2EFE6)：墨蓝壳上的文字，12.81:1。
- 深色地 (#141A1D)、深表面 (#1E2529) 与深墨 (#0E1416) 构成同一结构的夜间版。

### Named Rules

**The One Axis Rule.** 账单与三种额度重置必须画在同一条 30 天轴上；任何把某个周期拆成独立卡片的做法都破坏了这个产品唯一要证明的事。

**The Signal Rarity Rule.** 朱红只标 imminent 与告警。它出现得越少越有力；把它当品牌色铺开就退回通用后台。

**The Ink Is The Shell Rule.** 墨蓝承担整宽页头与主控件，不是只描一条边。承诺的配色必须占据整块区域，而不是散在中性地面上的几处点缀。

## Typography

**Display / Body Font:** `system-ui, -apple-system, "Segoe UI", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif`（无 `@font-face`、无外部字体请求）
**Label/Mono Font:** `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`，仅用于时刻、金额、编号与测量值

**Character:** 一套系统字体走到底，靠字号、字重与栏位建立层级；等宽栈只服务「读数」。全站 `tabular-nums`，数字不跳动。没有大写撑字距的小标签——那是被明确禁止的踢眉。

### Hierarchy

- **Display** (700, 1.55rem, `-0.015em`)：页面标题「订阅台账」。登录页 1.5rem。
- **Title** (700, 0.95rem)：卡片/行内的服务名、对话框标题 (1.2rem)。
- **Body** (400, 0.85rem，紧排变体 0.875rem)：正文、按钮、表单值。
- **Label** (600, 0.68–0.75rem)：表头、字段名、刻度、徽章、状态。
- **Mono** (400, 0.68–0.92rem)：`YYYY-MM-DD HH:mm · 剩余 X`、金额、序号、统计值。`tabular-nums`。

### Named Rules

**The System Stack Rule.** 不加载任何网页字体；中文与拉丁共用系统栈，等宽只服务测量。

**The No-Kicker Rule.** 标题上方或下方不放字距撑开的大写标签、编号或标语。标题自己承担重量。

**The Tabular Numbers Rule.** 所有金额、时刻、序号、统计值与倒计时一律等宽数字，避免账本读数跳动。

## Layout

单列纵向流：整宽墨蓝页头（产品名 + 标准标签导航，73px 高，4px 朱红下沿）→ 内容区 `padding: 22px 26px 48px`、纵向 `gap: 14px` → 标题行（搜索/分类/状态筛选 + 添加按钮在右端）→ 内联错误条 → 统计条 → 筛选条 → 七列表头 → 连续行。

七列固定语义：`52px / minmax(180px,1.6fr) / 96px / 90px / 88px / minmax(240px,34%) / 150px`，对应序号 / 服务 / 金额 / 账单周期 / 状态 / 下次重置四轨 / 操作。表头下方是 7 个真实日历刻度（每 5 天一个，覆盖 30 天），由当前日期计算，不是静态图。

响应式主要靠 `repeat(auto-fill/auto-fit, minmax())` 与 `flex-wrap`；仅有一处 `@media (max-width: 720px)` 把七列表头与四轨轴收起、统计条改两列、页头内边距收窄。没有其它宽度断点。窄屏无横向溢出（390px 实测 `scrollWidth === 390`）。

间距节奏：控件内 0.35–0.5rem，行内 0.75rem，区块之间 1rem–1.25rem，页面四周 1.625rem。密度高但对齐严格：字段行 `justify-content: space-between`，值右对齐，连续行之间无间隙。

**The Grid Wraps, It Doesn't Break Rule.** 不要为某个屏宽另写一套布局；调整 `minmax()` 最小列宽或让工具栏换行即可。

## Elevation & Depth

静止状态**没有阴影**。层级来自实线栏线、交替行底与墨蓝壳；这是平铺的印刷系统，不是抬起的卡片墙。

### Shadow Vocabulary

- **Dialog Lift** (`box-shadow: 0 20px 50px rgba(14, 20, 22, 0.28)`)：仅对话框，配合 `rgba(14,20,22,0.55)` 遮罩表明模态层级。带偏移与柔化。
- **Drag Lift** (`box-shadow: 0 4px 12px rgba(14, 20, 22, 0.18)`)：仅拖拽中的行。

### Named Rules

**The Flat-By-Default Rule.** 阴影只在「浮层」与「拖拽中」两种临时状态出现。常规行、统计条、导航、表头都不加阴影。

## Shapes

**全直角**。全站 77 处 `border-radius: 0`，没有例外——包括徽章、标签、输入、按钮、进度条、对话框与卡片。1px 实线是唯一的分隔语言；临时区域（重置计划新增、空状态、飞书提示框）改用 1px 虚线区分「尚未落定」与「已保存记录」。表单用原生 `select` / `radio`，对话框是 `div role="dialog"`。

**The No-Pill Rule.** 999px 全圆角属于被替换的旧世界，不在这个系统里；所有控件与容器保持可感知的直角。

## Components

整体气质：**朴素、贴合原生、状态可读**。控件不追求触感反馈，只有焦点轮廓、悬停微调与危险色三档明确信号。

### Buttons

- **Shape:** 直角、1px 同色描边、内边距 `7px 13px`、0.8rem/600。
- **Primary:** 墨蓝实底 + 墨上白字；悬停 `filter: brightness(1.14)`。
- **Ghost:** 透明底 + 正文色 + 栏线描边；深色模式有高特异性 rescue 规则保证标签可见。
- **Danger:** 朱红实底；深色模式文字保持白（由 `styles.test.ts` 固定的级联不变量）。
- **Focus:** 全站 `outline: 2px solid var(--tt-signal); outline-offset: 1px`。

### Table Header

- **Shape:** 墨蓝实底直角条，七列固定语义，列间 1px 半透明白线。
- **Ticks:** 等宽 7 个真实日历刻度（如 11-05 → 12-05），由 `now` 计算；窄屏隐藏。

### Timetable Axis（签名组件）

- **Data:** 四轨 `账单 / 5h / 周 / 月`，填充长度 = 各周期已过比例（`elapsedShare`），刻口 = 周期终点在 30 天轴上的位置（`axisPosition`），均由真实 `renewalDate` 与 `resetSchedules[].nextResetTime` 计算；无数据则轨道为空，绝不编造数字。
- **States:** 周/月倒计时复用 `getResetUrgencyColor()` 的黄→红连续插值；一次性订阅显示「无重置班次」。
- **Encoding:** 墨蓝=账单、朱红=5h、青=周、琥珀=月。这是图表，不是导航：无点击、无链接、无控件。
- **Placement:** 行内右列，`grid-row: 1`，不跨越多行，避免与可变内容重叠。

### Cards / Rows

- **Corner Style:** 直角。
- **Background:** 表格白；偶数行 12% 墨色叠加，悬停 18% 琥珀叠加。
- **Border:** 1px 栏线底边；无阴影。
- **Internal Padding:** 0（行内子块各自带内边距），保持密集阅读。

### Inputs / Fields

- **Style:** 表格白底、1px 栏线、直角、0.82rem、`font: inherit`。原生 `select` / `radio` 不重绘。
- **Focus:** 2px 朱红 outline + 1px offset；标签输入框容器 `:focus-within`。
- **Error / Disabled:** 错误条朱红描边透明底；禁用用 opacity。

### Navigation

- **Style:** 整宽墨蓝页头内的标准标签组，项间 1px 半透明白线，无下划线。
- **States:** 默认墨上白低透明字；悬停 10% 白叠加；激活项是**琥珀实底 + 墨蓝字**的实心块（不是彩色下划线）。
- **Mobile:** 页头 `flex-wrap`，导航组随工具区换行，不改抽屉或底部标签栏。

### Stats Strip

- **Style:** 一条被上下 1px 墨线夹住的连续统计条，四格等宽、栏线分隔、直角。
- **Content:** 标签与数值同一基线、0.72rem / 0.92rem 等宽数字；没有大数字 + 小标签 + 辅助统计的 hero-metric 堆叠。

### Icons

- **Style:** 手写内联 SVG（`CloseIcon` / `DragIcon`），一套描边/填充语言，12px；替代旧的 `×` 与 `⋮⋮` Unicode 字形。

### Browser Surfaces

`::selection` 琥珀底墨蓝字；caret 朱红；自定义滚动条用纸白轨 + 栏线拇指；全站 `tabular-nums`；焦点环统一。浏览器默认不再漏出系统外观。

## Do's and Don'ts

### Do:

- **Do** 用 `var(--tt-*)` 世界层变量生成壳、栏线与数据轨色，并用 `--signal` 承担所有文字级告警（≥4.5:1）。
- **Do** 让七列表头、真实日期刻度与四轨轴始终一起出现；四轨值必须来自真实订阅数据。
- **Do** 保持全直角、1px 实线、交替行底与系统字体；金额与时刻一律等宽数字。
- **Do** 保留原生 `select` / `radio` / `div role="dialog"` 与手写内联 SVG。
- **Do** 让浅色 / 深色共用同一结构，只切主题变量；为语义色使用深色独立值。

### Don't:

- **Don't** 引入圆角胶囊、渐变、玻璃、装饰插画、拟物化或仪表盘大屏。
- **Don't** 在标题上方/下方放字距撑开的大写踢眉、编号或标语；也别用 Unicode 字形当图标。
- **Don't** 把朱红当品牌色铺开，或把四轨轴做成导航、链接、可点控件。
- **Don't** 引入外部字体、图标库、组件库，或为某个屏宽另写一套布局。
- **Don't** 给常规行、统计条、导航或表头加阴影；只有对话框与拖拽行可以抬起。
