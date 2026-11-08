# AMS: architecture firm practice management

A multi-tenant practice management system for architecture firms: projects, phases and fee components, time entry and approvals, billing drafts (fixed fee, percent claims, milestones, hourly and hourly with a not-to-exceed cap, recharges), handover to an accounting system, receivables, firm accounts, and a separate platform console for the operator.

## Status (honest)

This is a working core path, not a finished product.

- **Real data (live mode, Postgres):** projects list and detail, phases, project time, project billing, approvals, firm billing, receivables, My time, and Settings > Accounts. These are the routes in `CONNECTED_ROUTES` in `apps/web/src/api/live.ts`. The platform console (`/platform`) also runs on the database.
- **Sample data:** every other screen. In live mode they show the banner "Sample data. This screen is not connected to the database yet."
- **Mock mode** (the default for `npm run dev`, unit tests, Storybook and the screenshot suite) runs the whole UI on in-memory sample data with no API.
- The accounting integration is a mock adapter plus a CSV export/import adapter. Invitation emails are not sent: the API returns the invite link.

## Layout

| Path | What it is |
| --- | --- |
| `apps/api` | Fastify + `pg` API. `src/app.ts` (hooks, error handler), `src/auth/` (actor, `authorize`, redaction, sessions), `src/db/pool.ts` (`withFirm`), `src/http/`, `src/config/env.ts`, `src/modules/<area>/*.routes.ts`, `src/dev/*.ts` (embedded Postgres, migrate, seed, platform admin), `test/*.test.ts` against real Postgres |
| `apps/web` | React UI (Vite). `src/api/*` mock layer, `src/api/live.ts` + `src/api/live/*.ts` live layer, `tests/` Playwright (mock), `tests-live/` Playwright (live) |
| `packages/domain` | Pure rules: money in paise, capability levels, state machines, NTE split. Imported by relative path |
| `packages/db/migrations` | Versioned SQL migrations (`001_core_path.sql`, `002_accounts_platform.sql`, `003_platform_session_binding.sql`), applied in order by `apps/api/src/dev/db.ts` |
| `docs` | Product, engineering and design docs. Start at [docs/README.md](docs/README.md) |

## Prerequisites

- Node 22 (see `.nvmrc`).
- No Docker and no system Postgres: the API uses `embedded-postgres`, which downloads a Postgres binary through npm.

Dependencies are installed per app. There are no npm workspaces; the root `package.json` only delegates.

```sh
npm ci --prefix apps/api
npm ci --prefix apps/web
```

## Quick start

Live mode (real data):

```sh
npm run dev:api        # embedded Postgres on 54320 (data in apps/api/.pgdata), API on http://127.0.0.1:3000/api/v1
npm run dev:web:live   # Vite in live mode, proxies /api to 127.0.0.1:3000
```

Mock UI only (no API):

```sh
npm run dev:web
```

Reset the dev database: `npm --prefix apps/api run reset`. More detail in [docs/run-locally.md](docs/run-locally.md).

## Demo sign-ins (dev seed only)

These accounts exist only in the local dev and test databases created by `apps/api/src/dev`. They are never created in production (`seedPlatformAdmin` refuses when `NODE_ENV=production`). Do not reuse these passwords anywhere.

- Firm users: `p01@meridian.demo` to `p08@meridian.demo` (for example `p01@meridian.demo` is Asha Rao, principal; `p02@meridian.demo` is a PM; `p04@meridian.demo` is staff). Password: `meridian-demo-2026`. Sign in at `/login`.
- Platform admin: `admin@platform.demo`, password `platform-demo-2026`. Sign in at `/platform/login`; the console is at `/platform`. To create a real admin: `PLATFORM_ADMIN_PASSWORD=... npm --prefix apps/api run platform-admin -- <email> <name>`.

## Tests

```sh
npm run typecheck      # api and web
npm run lint           # web: eslint plus the colour-literal check
npm run test:api       # vitest against embedded Postgres on 54331
npm run test:web       # vitest unit and screen tests (mock mode)
npm run test:e2e       # Playwright, mock mode (needs `npm --prefix apps/web run build` and `build-storybook` first)
npm run test:e2e:live  # Playwright, live mode: throwaway Postgres on 54332, API on 3001, UI on 4273
npm run build          # web production build
```

CI runs the same steps: `.github/workflows/ci.yml`.

## Docs

See [docs/README.md](docs/README.md).
