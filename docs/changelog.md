# Changelog

## 08 Nov 2026

### Core path on real data

- Fastify and Postgres API with row-level security for login, permissions, time, approvals, billing drafts with the NTE ledger and the mock accounting adapter, and receivables (migration `001_core_path.sql`), with acceptance tests against a real database.
- Web screens for time, approvals, projects, billing and receivables read live data in the live build (`vite --mode live`); the default build stays on sample data.

### Accounts and the platform panel

- Firm accounts: roles, invitations (72-hour, single-use tokens stored as hashes) and deactivation (migration `002_accounts_platform.sql`).
- Platform console with its own login and `ams_platform` cookie: list companies (counts only), create a company with an invite for its first principal, suspend and reactivate with a reason, and a platform audit. A suspended firm has no logins and no sessions.

### Restructure

- The API is split into `src/config`, `src/http`, `src/auth`, `src/db`, `src/audit` and `src/modules/<area>`, replacing `src/core.ts`. Shared rules live in `packages/domain` (`@ams/domain`).
- Root README, delegating root scripts, a CI workflow, the docs index and the architecture notes.

### Security fixes

- Two findings from review in the accounts flow, fixed with regression tests in `apps/api/test/accounts.test.ts` (commit `178e942`).
- Platform functions bound to the platform session (migration `003_platform_session_binding.sql`). Before, the platform SECURITY DEFINER functions trusted a caller-supplied admin id (or no identity) and `platform_find_admin` returned `password_hash` to `ams_app`. Now every platform action takes the session token hash and resolves the admin in SQL, refusing an unknown, revoked or expired session with errcode `28000`; the old signatures are dropped; only `platform_auth_lookup` returns a password hash, and only `platform_create_session` takes an admin id. Eight new tests in `apps/api/test/platform.test.ts`; the API suite is 109 of 109.
