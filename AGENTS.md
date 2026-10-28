# AI Subscriptions Project

Next.js 14 App Router app for managing AI subscriptions with local JSON storage and NextAuth authentication.

## Commands

```bash
npm run dev      # Development server
npm run build    # Production build
npm run lint     # ESLint check
npm start        # Production server (port 3000)
npm test         # Run vitest test suite (single run)
npm run test:watch  # Run vitest in watch mode
```

## Architecture

- **Data storage**: `data/*.json` files (subscriptions.json, priorities.json, auth.json, tools.json)
  - Auto-created on first run
  - Gitignored (contains credentials and user data)
- **Auth**: NextAuth v5 (beta) with credentials provider
  - Default: `admin/admin123` (prompted to change on first login)
- **Path alias**: `@/*` maps to project root

## Key Files

| Path                | Purpose                                             |
| ------------------- | --------------------------------------------------- |
| `lib/db.ts`         | Subscription CRUD + category management             |
| `lib/tools.ts`      | Tool management                                     |
| `lib/priorities.ts` | Priority scene management                           |
| `lib/auth.ts`       | NextAuth config + password change                   |
| `lib/types.ts`      | All TypeScript types + default providers/categories |

## Deployment

Docker on the local machine. Image is built locally from this repo; deployment lives in `~/docker/ai-subscriptions/` (compose file, `.env`, `data/` volume):

```bash
make deploy    # Build image + compose up
make image     # Build image only
make up/down/restart/status/logs
make uninstall # Remove container (image and ~/docker data kept)
```

Container runs non-root (user 1000:1000), limited to 1.0 CPU / 512M memory, port 3000, data at `~/docker/ai-subscriptions/data` mounted as `/data` (`DATA_DIR`).

## Import Convention

Use `@/` alias for all imports from lib/components:

```typescript
import { Subscription } from "@/lib/types";
import { StatsCards } from "@/components/StatsCards";
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
