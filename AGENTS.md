# AI Subscriptions Project

Next.js 14 App Router app for managing AI subscriptions with local JSON storage and NextAuth authentication.

## Commands

```bash
npm run dev      # Development server
npm run build    # Production build
npm run lint     # ESLint check
npm start        # Production server (port 3000)
```

**Note:** No test suite exists. `npm test` will fail.

## Architecture

- **Data storage**: `data/*.json` files (subscriptions.json, priorities.json, auth.json, tools.json)
  - Auto-created on first run
  - Gitignored (contains credentials and user data)
- **Auth**: NextAuth v5 (beta) with credentials provider
  - Default: `admin/admin123` (prompted to change on first login)
- **Path alias**: `@/*` maps to project root

## Key Files

| Path | Purpose |
|------|---------|
| `lib/db.ts` | Subscription CRUD + category management |
| `lib/tools.ts` | Tool management |
| `lib/priorities.ts` | Priority scene management |
| `lib/auth.ts` | NextAuth config + password change |
| `lib/types.ts` | All TypeScript types + default providers/categories |

## Deployment

Systemd service via Makefile:

```bash
make install    # Create user service
make start      # Start service
make stop       # Stop service
make status     # Check status
make logs       # View logs (journalctl)
make enable     # Enable on boot
```

Service runs on port 3000, uses Node v24.13.0 from NVM.

## Import Convention

Use `@/` alias for all imports from lib/components:

```typescript
import { Subscription } from '@/lib/types'
import { StatsCards } from '@/components/StatsCards'
```

## Data Model

- **Subscription**: recurring/one-time, billingCycle (monthly/yearly), status (active/paused/cancelled), balance (optional, for one-time)
- **Tool**: forms (CLI/TUI, GUI, Web), isOpenSource, order field for sorting
- **PriorityScene**: subscription/tool order arrays for drag-drop priority management

## RTK Token Optimization

Prefix shell commands with `rtk` to compress output (saves 60-90% tokens):

```bash
rtk git status
rtk git log -10
```

## Commit Per Phase

Commit after each completed development phase. Do not batch multiple phases into a single commit.

```bash
git status && git add <relevant-files> && git commit -m "<message>"
```