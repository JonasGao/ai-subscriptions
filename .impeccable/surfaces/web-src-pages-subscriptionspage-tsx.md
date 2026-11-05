---
version: 1
slug: "web-src-pages-subscriptionspage-tsx"
primary_target: "web/src/pages/SubscriptionsPage.tsx"
related_targets:
  [
    "web/src/styles.css",
    "web/src/pages/LoginPage.tsx",
    "web/src/pages/ChangePasswordPage.tsx",
    "web/src/pages/ProxySubscriptionsPage.tsx",
    "web/src/pages/ToolsPage.tsx",
    "web/src/pages/ProvidersPage.tsx",
    "web/src/pages/NotificationsPage.tsx",
  ]
---

# Surface brief — 订阅台账（whole-site world replacement）

## Scope & visitor mode

Primary surface: `web/src/pages/SubscriptionsPage.tsx` (`/subscriptions`, also `/` redirect and `*` fallback).
Cross-surface reach: `/login`, `/change-password`, `/proxy-subscriptions`, `/tools`, `/providers`, `/notifications`, plus `web/src/styles.css`, shell, cards, dialogs and the reset-schedule / usage / priority modules.
Visitor mode: **Operate**. The world lends only type, palette, density and ONE signature move; layout, navigation and controls stay standard web components.

## Audience, job, action, content, constraints

单人自托管的使用者，在桌前打开自己部署的实例，核对「有哪些订阅、各花多少、下一次续费或额度重置是什么时候」。主要动作是按最近事件排序、筛选、增删改与实时查询。内容全部为真实订阅数据（截图为模拟数据，不得当真）。
必须保留：产品事实与中文文案、API 形状、582 条 parity 行为、原生 `div role="dialog"` / `select` / `radio`、手写内联 SVG、内联错误条、浅色/深色切换作为功能、资源上限、无外部字体/图标库/组件库。
失败模式：仪表盘大屏、渐变玻璃、装饰插画、拟物化；为好看牺牲扫描效率；多人协作 SaaS 气质。

## Chosen direction & memorable moment

用户指定 **「时刻表栏律」**（有序候选表第 1 项，IMPECCABLE'S PICK），优先于掷骰的指派方向。
Memorable moment：账单周期与 5h / 周 / 月三种额度重置被压到同一条 30 天时间轴上，四条轨道对齐，朱红刻口标出即将发生的那一次；像读班次一样读「下一次事件」。

## Unresolved decisions

无。用户已确认成功标准（完成度）、全部保留项与四条失败模式；不接受当前「素页账本」的任何视觉特征。

## Direction contract

**THESIS:** 整个站以「时刻表栏律」为唯一世界：账单周期与 5 小时 / 周 / 月三种额度重置共用一条 30 天时间轴，像读班次一样读下一次事件。拒绝的类别默认是卡片网格 + 统计数字 + 筛选工具条，也拒绝它可预测的反面——白底细线单强调色的「克制工具」。

**OWN-WORLD:** 深墨蓝 `#1B2A33` 页头与按钮、纸白 `#EFEDE4` 地面、`#FBFAF4` 表格面；朱红 `#C2452D` 只标 imminent 与告警，青 `#2E6E73`、琥珀 `#D9A441` 是数据轨色。1px 实线栏线、交替行底、直角无圆角、密排小字与等宽时间戳。去掉内容仍认得出：一张被认真排过的班次表。

**STORY:** 打开就知道「哪些订阅、各花多少、下一次什么时候发生」，并能按最近事件排序；所有控件仍是标准按钮、select、可排序表格与常规导航，世界不提供布局或控件。

**FIRST VIEWPORT:** 整宽深墨蓝页头（产品名 + 标准标签导航）→ 标题行 + 搜索 / 分类 / 状态筛选 + 添加按钮（右端）→ 30 天共轴刻度条 → 七列可排序表：序号 / 服务 / 金额 / 账单周期 / 状态 / 下次重置四轨 / 操作。末列四轨对齐并给出等宽 `YYYY-MM-DD HH:mm · 剩余 X`；顶部内联错误条显示一条「需核对」状态。密度 28–32px 行高、11–13px 标签、19px 金额数字。

**FORM:** 有序候选表第 1 项「时刻表栏律」（用户指定，优先于掷骰结果）；SEED REFERENCE `seed:089829df100f6e97`。

**FINISH:** unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
