# Zhipu Coding Plan Usage — CREDIT_LIMIT-Only Window Decoding

Zhipu's usage endpoint is an undocumented internal monitoring API whose `limits[]` rows encode the quota window in an opaque `(type, unit, number)` triple. The handler decodes only `CREDIT_LIMIT` rows — `unit=3,number=5 → fiveHour`, `unit=6,number=1 → weekly` — mapping their absolute fields directly into `UsageWindow`, and deliberately ignores the legacy `TOKENS_LIMIT` row name and the `TIME_LIMIT` (monthly MCP) row.

## Status

Accepted

## Context

`GET https://open.bigmodel.cn/api/monitor/usage/quota/limit` (bare API key in `Authorization`, no Bearer prefix) returns:

```json
{
  "code": 200,
  "msg": "Operation successful",
  "data": {
    "limits": [
      {
        "type": "CREDIT_LIMIT",
        "unit": 3,
        "number": 5,
        "usage": 12000,
        "currentValue": 0,
        "remaining": 12000,
        "percentage": 0
      },
      {
        "type": "CREDIT_LIMIT",
        "unit": 6,
        "number": 1,
        "usage": 60000,
        "currentValue": 0,
        "remaining": 60000,
        "percentage": 0,
        "nextResetTime": 1790302548999
      }
    ],
    "level": "pro"
  },
  "success": true
}
```

There are no official docs for this endpoint. Semantics were cross-verified against a real captured sample (`test-zhipu-usage.sh`) and the community implementation [opencode-glm-quota](https://github.com/guyinwonder168/opencode-glm-quota): `usage` = window limit, `currentValue` = used, `remaining` = remaining, `percentage` = derived, `nextResetTime` = epoch ms (may be absent on the 5-hour row), `data.level` = account tier.

Two other row shapes exist in the wild: `TOKENS_LIMIT` — the **old name** for the same 5h/weekly rows, renamed to `CREDIT_LIMIT` server-side in a breaking change that emptied quota displays in community tools that filtered on the old name — and `TIME_LIMIT`, a monthly MCP-usage row (different shape: percentage/currentValue/usage, no remaining/nextResetTime).

## Considered Options

1. **Decode `CREDIT_LIMIT` only** (chosen) — the user's CN account returns `CREDIT_LIMIT` rows today; scope stays minimal and every fixture is a replayed real sample.
2. **Accept both `TOKENS_LIMIT` and `CREDIT_LIMIT`** (community-tool compatibility) — rejected: no real sample shows the old name still being served, so the compat branch would be untestable speculation. If zhipu ever serves it again, the handler's zero-mapped-window error (below) fails loudly instead of silently.
3. **Map `TIME_LIMIT` → monthly** — rejected: the user does not track zhipu's monthly MCP usage; `monthly` stays `null`.

## Decision

- **Decode table**: among `type === "CREDIT_LIMIT"` rows, `unit===3 && number===5` → `fiveHour`, `unit===6 && number===1` → `weekly`. Everything else — `TOKENS_LIMIT`, `TIME_LIMIT`, unknown unit/number — is skipped with a `console.warn` (forward-compatible against shape drift).
- **Absolute mapping** (no ADR-0010 percent synthesis): `currentValue → used`, `usage → limit`, `remaining → remaining`, `nextResetTime → resetTime` (ms → ISO). `percentage` is ignored as a derived value.
- **Duplicate rows claiming the same bucket**: keep the row with the higher `usage` (limit) — same semantics as Alibaba Token Plan's `pickHigher` (primary vs add-on), re-implemented handler-locally.
- **Zero mapped windows** (`limits` non-empty but nothing decoded): throw `未识别到可用的配额窗口（CREDIT_LIMIT）` — the explicit signal that fires if zhipu renames row types again. Partial mapping (e.g. only the 5h row present) is not an error; missing buckets are `null`.
- **`data.level` → `membership.level`** via `toUpperCase()`; missing level → `membership: null`.
- **No startup migration**: unlike moonshot/alibaba in `migrateProviderPlans()`, existing zhipu subscriptions are not backfilled with `planId`. The single `coding-plan` plan is auto-assigned by `resolvePlanId` on next create/edit; untouched legacy subscriptions simply keep working without usage query until edited.
- Auto-exhaust (ADR-0007) is preserved unchanged: with absolute values, `used >= limit` holds exactly when the window is truly exhausted.

## Consequences

### Positive

- Minimal surface: one new handler file, one registry entry, one provider-registration edit. No shared code, no `UsageWindow` change, no migration.
- Every fixture is a real captured sample — no reconstructed shapes in tests.
- Loud failure on shape drift: a row-type rename turns queries into an explicit error rather than a silently blank card.

### Negative

- If zhipu rolls back to `TOKENS_LIMIT` (or introduces a new row name), zhipu usage queries fail until the handler is updated — an accepted trade for not carrying an untestable compat branch.
- Pre-plan zhipu subscriptions never gain usage query until they are edited once (no backfill).

### Neutral

- `TIME_LIMIT` rows are ignored, so `monthly` is always `null` for zhipu — the card simply shows no monthly block.
- The 5h row may lack `nextResetTime`; `resetTime: null` renders as "—" in the card.

## Related Decisions

- [ADR-0005: Provider Plans](0005-provider-plans.md) — zhipu declares a single plan `coding-plan`; credentials stay provider-level; single plan is implicitly selected.
- [ADR-0007: Usage-Driven Auto-Exhaust](0007-usage-driven-auto-exhaust.md) — the `used>=limit` threshold the absolute mapping preserves.
- [ADR-0010: Percent-Only Usage Window Synthesis](0010-percent-only-usage-window-synthesis.md) — deliberately **not** applied: zhipu exposes absolute values, so no `limit="100"` synthesis.
