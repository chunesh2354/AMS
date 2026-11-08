# Engineering decisions

Decisions taken in the code, with where they live. The Engineering Specification is the authority on intended behaviour; this file records how the code does it.

## Mock build by default, live build by mode

- The web app decides at build time: `isLive = import.meta.env.VITE_LIVE === '1'` (`apps/web/src/api/live.ts`). `apps/web/.env.live` sets `VITE_LIVE=1`, so `vite --mode live` (`npm run dev:live`, `npm run build:live`, output `dist-live`) is the live build.
- The default build runs on sample data, so unit tests, Storybook and the Playwright mock suites (`apps/web/tests`, `playwright.config.ts`) need no API. In the live build only the routes in `CONNECTED_ROUTES` call `/api/v1`; every other route shows the sample-data banner. The live suite is `apps/web/tests-live/core-path.spec.ts` with `playwright.live.config.ts`.

## npm with `--prefix` scripts, not workspaces

- Dependencies are installed per app (`npm ci --prefix apps/api`, `npm ci --prefix apps/web`). The root `package.json` has no workspaces; its scripts only delegate (`npm --prefix apps/api run dev`, `npm --prefix apps/web test`, and so on).
- `packages/domain` (`@ams/domain`) is imported by relative path rather than installed as a workspace package.

## Embedded Postgres for local runs and tests

- No Docker and no system Postgres are needed: `embedded-postgres` downloads a Postgres binary through npm.
- `npm run dev:api` starts it on port 54320 (`AMS_DB_PORT` overrides; data in `apps/api/.pgdata`) through `startDevDb` in `apps/api/src/dev/db.ts`, which migrates and seeds. The API test suite starts its own, non-persistent instance on 54331 (`apps/api/test/global-setup.ts`) and copies a seeded template database per test file. The live Playwright suite uses 54332 through `apps/api/src/dev/e2e.ts`.
- Migrations in `packages/db/migrations` are applied once each, in filename order, and recorded in `schema_migration`. An applied migration is never edited; a change is a new numbered file.

## Default fee component when a phase has several

- A time entry may name its `fee_component_id`. When it does not, `resolveFeeComponent` (`apps/api/src/modules/time/time.routes.ts`) uses the phase's only component; when the phase has several, it picks the first that is not `hourly` or `hourly_nte`, and falls back to the first one.

## Accounting: mock finalizes on submit, CSV waits for import-final

- `adapterFor` (`apps/api/src/modules/integrations/adapters/accounting.ts`) picks the firm's adapter from its `accounting_adapter` column: `csv` gives `CsvExportImportAdapter`, anything else `MockAccountingAdapter`.
- The mock adapter returns the finalized invoice from `submitDraft`, so the draft goes straight to `Finalized`. It can simulate a failure or a timeout; a timeout leaves the draft `Uncertain`, which must be reconciled before any retry.
- The CSV adapter's `submitDraft` returns nothing: the draft goes to `Pending`, and `POST /billing/drafts/:id/import-final` (allowed only from `Pending`) records the final invoice afterwards.

## PM billing visibility follows the capability matrix

- `MATRIX` in `packages/domain/src/index.ts` gives the `pm` permission set `billing.prepare` at `S` (scoped), `billing.approve` and `accounting.finalize` at `N`, and `receivables.manage` at `S`. A scoped capability covers the projects the person leads (`ledProjects` in `apps/api/src/auth/actor.ts`) and any scoped grants.
- So a PM sees billing only for their own projects (`scopeOf` in `apps/api/src/modules/billing/billing.routes.ts`), cannot prepare a draft (that needs firm-wide `billing.prepare`), and confirms entitlement on their projects' drafts through `POST /billing/drafts/:id/pm-confirm`. Finance and principals see billing firm-wide; staff are refused.

## Platform functions are bound to the platform session

- Every platform action is a SECURITY DEFINER function that takes the hash of the `ams_platform` session token and resolves the admin in SQL; an invalid, revoked or expired session raises errcode `28000` and changes nothing (`packages/db/migrations/003_platform_session_binding.sql`).
- Only `platform_auth_lookup(email)` returns a password hash (with the admin id, nothing else), and only `platform_create_session` accepts an admin id. Why this approach rather than a separate database role, and the residual risk, are in [architecture.md](architecture.md), "Security: platform functions bound to the platform session".
