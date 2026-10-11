# AI Subscriptions

AI 订阅管理应用的统一语言：订阅、额度、重置周期的核心术语。

## Language

**重置时间对齐（Alignment）**:
用供应商 API 返回的重置时间覆写 schedule 的 `nextResetTime` 瞬时值，不触碰周期配置字段。见 ADR-0014。
_Avoid_: 同步、刷新

**重置时间校准（Calibration）**:
用供应商 API 返回的重置时间反推并持久化 schedule 的周期配置字段（weekly 的 `dayOfWeek`、monthly 的 `dayOfMonth`、两者的 `timeOfDay`)，同时覆写 `nextResetTime`。对齐的超集，见 ADR-0016。
_Avoid_: 反推、回写
