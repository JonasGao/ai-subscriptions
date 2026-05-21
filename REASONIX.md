# REASONIX.md — ai-subscriptions

## Stack

- **Next.js 14** (App Router, `next: ^14.2.35`) with TypeScript (`strict: true`)
- **Tailwind CSS 3** + `postcss` / `autoprefixer` — styling via utility classes
- **shadcn/ui** (Radix UI primitives) — `@radix-ui/react-dialog`, `select`, `label`, `slot`; components in `components/ui/`
- **next-auth v5 beta** (`^5.0.0-beta.31`) — login page at `/login`, auth config + middleware guard
- **Recharts** (`^2.12.7`) — pie chart on dashboard (`CategoryPieChart.tsx`)
- **@dnd-kit** (`core`, `sortable`, `utilities`) — drag-and-drop priority reordering
- **bcryptjs** — password hashing
- **lucide-react** — icon set

## Layout

| Path | What lives there |
|------|------------------|
| `app/` | Next.js App Router pages + API routes (`api/auth/`, `api/subscriptions/`, `api/categories/`, `api/providers/`, `api/priorities/`, `api/tools/`) |
| `components/` | React components (`SubscriptionCard`, `SubscriptionForm`, `StatsCards`, etc.) + `ui/` subdir for shadcn primitives |
| `lib/` | Business logic — `db.ts` (JSON file CRUD), `types.ts` (all interfaces), `auth.ts`/`auth.config.ts`, `utils.ts`, `tools.ts`, `priorities.ts` |
| `data/` | JSON persistence files — `subscriptions.json`, `categories.json` (in `priorities.json`), `tools.json` — **read/written by the app at runtime** |
| `types/` | Type augmentation (`next-auth.d.ts`) |
| `docs/superpowers/` | Planning docs (ignored during normal development) |

## Commands

| Script | Command |
|--------|---------|
| dev | `npm run dev` → `next dev` (port 3000) |
| build | `npm run build` → `next build` |
| start | `npm run start` → `next start` |
| lint | `npm run lint` → `next lint` (extends `next/core-web-vitals`) |
| service mgmt | `make install` / `make start` / `make stop` / `make logs` → systemd user service wrappers |

No test runner or typecheck script is currently configured.

## Conventions

- **Named exports** in components — each `.tsx` exports a named function, not `export default`
- **`"use client"` directives** on any component using hooks or browser APIs (`SubscriptionCard`, forms, drag-and-drop)
- **Path alias `@/`** maps to project root in `tsconfig.json` — imports like `@/lib/types`, `@/components/ui/card`
- **JSON file persistence** — `lib/db.ts` reads/writes `data/subscriptions.json` via `fs`. No database.
- **Types in one file** — all interfaces (`Subscription`, `Provider`, `Tool`, `PriorityScene`) centralised in `lib/types.ts`
- **Default data as exported consts** — `defaultCategories`, `defaultProviders` defined inline in `lib/types.ts`

## Watch out for

- **`data/` JSON files are not gitignored** — they contain runtime state. Editing them directly bypasses app validation. If you change the shape of interfaces in `lib/types.ts`, the JSON files may become desynchronised.
- **next-auth v5 beta** — API and config differ from v4. The `authorized` callback in `middleware.ts` redirects unauthenticated users to `/login`.
- **No test suite or typecheck command** — run `npx tsc --noEmit` manually if type-checking is needed.
- **Makefile-generated systemd service** — `make install` writes absolute paths into the unit file. Running `make install` from a different working directory produces a stale `WorkingDirectory`.
