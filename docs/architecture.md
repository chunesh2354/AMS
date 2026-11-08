# Architecture

How a request moves through the system, and the rules that hold everywhere. Facts here are taken from the code; the Engineering Specification is the authority on intended behaviour.

## Request flow (firm API)

1. **Cookie session.** Firm users sign in at `POST /api/v1/auth/login` and get an `ams_session` cookie (httpOnly, sameSite lax, path `/`). A `Bearer` token is also accepted. The `onRequest` hook in `apps/api/src/app.ts` hashes the token (`hashToken` in `src/auth/sessions.ts`, SHA-256) and looks it up with the `auth_find_session` SECURITY DEFINER function, which returns the person and firm.
2. **Actor and capabilities.** `loadActor` (`apps/api/src/auth/actor.ts`) builds the actor: permission sets map to capability levels (`capabilityMap` in `packages/domain`), direct grants widen them to `firm` or `scoped`, and the projects the person leads form the scope of a scoped capability.
3. **Service authorize.** Every operation calls `authorize(actor, capability, scope)` (`src/auth/authorize.ts`) in the service. A refusal is a 403 `FORBIDDEN_CAPABILITY` that names the capability.
4. **Transaction with `app.firm_id`.** `withFirm` (`src/db/pool.ts`) opens a transaction and runs `set_config('app.firm_id', <firm>, true)`, so the setting lives only for that transaction.
5. **RLS.** Migrations enable row-level security on every tenant table with a `firm_isolation` policy (`firm_id = current_setting('app.firm_id')`), and `firm_self` on `firm`. The API connects as `ams_app` (no superuser, no create role), so a missing firm setting returns no rows rather than another firm's rows.

## Redaction on every response

A `preSerialization` hook passes every JSON payload through `redact` (`src/auth/redaction.ts`). Fenced fields (`cost_rate`, `cost_amount`, `labour_cost` need `rates.cost.view`; `margin`, `contribution`, `estimated_revenue_share` need `margin.view`) are replaced by `{ "restricted": true }` unless the actor holds that capability at firm level. A fenced value is never shown as blank or zero.

## Money

Amounts are handled in integer paise in the domain and services (`toPaise`, `fromPaise` in `packages/domain/src/index.ts`) and sent to clients as decimal strings.

## State machines

`MACHINES` in `packages/domain/src/index.ts`, applied through `transition(machine, from, action)`, which throws `InvalidTransition`. They include time billing (`Unbilled -> Reserved -> Billed`, or released back to `Unbilled`), approval requests, draft approval (`Draft -> In review -> Approved | Rejected`), draft accounting (`Not submitted -> Pending -> Finalized | Failed | Uncertain`), integration jobs, and settlement (`Unpaid`, `Part-paid`, `Disputed`, `Settled`).

## Billing: source reservation and the NTE ledger

- A billing draft claims its sources (percent claims, authorised milestones, approved unbilled time, supplier bills) through `source_allocation`. The partial unique index `source_allocation_live (firm_id, source_type, source_id) where active` means a source can be on only one live draft; a second claim fails with 409 `CONFLICT`.
- Time entries on a draft move to `Reserved`; rejecting the draft releases them to `Unbilled`.
- Hourly NTE components keep a ledger (`nte_ledger`: `reserved`, `consumed`, `released`, `excess`). Consumed is `consumed + reserved - released`. `nteSplit` splits new value into eligible and excess against the cap; excess becomes an "Hourly NTE limit reached" exception instead of being billed. Rejecting a draft writes `released` rows for its reservations.

## Accounting adapter and Uncertain

- `apps/api/src/modules/integrations/adapters/accounting.ts` defines `AccountingAdapter`, with `MockAccountingAdapter` (can simulate failure and timeout) and `CsvExportImportAdapter` (reviewed export, then import of the final invoice). The firm's `accounting_adapter` column picks one (`adapterFor`).
- On submit, a timeout (`AdapterTimeout`) sets the integration job and the draft to `Uncertain`. An Uncertain submission can never be retried directly (409 `UNCERTAIN_RECONCILE_FIRST`); it must be reconciled first, which looks it up and moves it to `Finalized` or `Failed`, so nothing is sent twice.

## Platform console separation

- Separate login (`/platform/login`) and cookie (`ams_platform`, path `/api/v1/platform`); the firm session never authorises platform routes, and the firm `onRequest` hook skips the `/api/v1/platform/` prefix.
- Platform tables (`platform_admin`, `platform_session`, `platform_audit`) have RLS enabled and no grant to `ams_app`; every read and write goes through SECURITY DEFINER functions from migrations `002_accounts_platform.sql` and `003_platform_session_binding.sql`. Since 003 every platform action (`platform_list_firms`, `platform_create_firm`, `platform_set_firm_status`, `platform_audit_list`) takes the hash of the platform session token, not an admin id; see Security below. Actions that need a reason record it in the platform audit.
- The demo admin (`admin@platform.demo`) is seeded only for dev and tests; `seedPlatformAdmin` refuses in production.

## Security: platform functions bound to the platform session

Migration `003_platform_session_binding.sql` makes every platform function that performs or reads a platform action take the SHA-256 of the `ams_platform` cookie token and resolve the admin inside SQL (`platform_session_admin`: `platform_session` not revoked and not expired, joined to `platform_admin`); an invalid session raises errcode `28000` before anything is read or written, and the API turns that into a 401. The old admin-id and no-identity signatures, and `platform_find_admin` (which returned `password_hash`), are dropped. We chose this over a separate `ams_platform` database role because the API builds one pool from one connection string (`buildApp(connectionString)` in `apps/api/src/app.ts`, used by `src/dev/start.ts`, `src/dev/e2e.ts` and `test/helpers.ts`), and the session binding closes the reported path (acting as any admin by passing an id) without a second credential to provision. The cost is a small, stated residue on `ams_app`: argon2 verification runs in Node, so `platform_auth_lookup(email)` must return `(admin_id, password_hash)` and nothing else, and `platform_create_session(admin_id, token_hash, expires_at)` is the only function that accepts an admin id (it refuses an unknown admin and any session longer than 12 hours, and writes the `login` audit row). SQL running as `ams_app` that knows an admin's email can therefore still open a session, but it is capped at 12 hours and always leaves a `login` row in `platform_audit`. Moving those two functions, and the rest, to a separate login role used only by the platform module's pool is the follow-up that would remove that residue. Tests: `apps/api/test/platform.test.ts`, "platform functions are bound to a live platform session (migration 003)".

## Web: mock vs live

- Decided at build time: `isLive = import.meta.env.VITE_LIVE === '1'` (`apps/web/src/api/live.ts`). `vite --mode live` reads `VITE_LIVE=1` from the live env file.
- Mock is the default, so unit tests, Storybook and the screenshot suite run on sample data.
- In live mode, routes in `CONNECTED_ROUTES` call `/api/v1` (Vite proxies `/api` to `AMS_API_TARGET`, default `http://127.0.0.1:3000`); every other route shows the sample-data banner.
