# Run locally

Node 22. No Docker. Install per app: `npm ci --prefix apps/api` and `npm ci --prefix apps/web`.

## API (real data)

```sh
npm --prefix apps/api run dev
```

- Starts embedded Postgres on port 54320 (override with `AMS_DB_PORT`), data in `apps/api/.pgdata`.
- Applies `packages/db/migrations/*.sql` in order (001 core path, 002 accounts and platform), seeds the demo firm and the demo platform admin.
- Serves the API on `http://127.0.0.1:3000/api/v1`.
- `npm --prefix apps/api run reset` resets the dev database.

## Web

- Live mode: `npm --prefix apps/web run dev:live` (proxies `/api` to `http://127.0.0.1:3000`, or `AMS_API_TARGET`).
- Mock mode: `npm --prefix apps/web run dev` (no API needed).

## Sign in (dev seed only)

Never created in production.

- Firm: `/login`, `p01@meridian.demo` (principal) to `p08@meridian.demo`, password `meridian-demo-2026`. Settings > Accounts is at `/firm/settings/accounts`; invitations return an `/accept-invite/<token>` link (no email is sent).
- Platform: `/platform/login`, `admin@platform.demo`, password `platform-demo-2026`. The console is at `/platform`.
- Real platform admin: `PLATFORM_ADMIN_PASSWORD=... npm --prefix apps/api run platform-admin -- <email> <name>`.

## Tests

- API: `npm --prefix apps/api test` (embedded Postgres on 54331 via `test/global-setup.ts`).
- Web unit: `npm --prefix apps/web test`.
- Web Playwright, mock: build first (`npm --prefix apps/web run build` and `build-storybook`), then `npm --prefix apps/web run test:e2e`.
- Web Playwright, live: `cd apps/web && npx playwright test -c playwright.live.config.ts` (throwaway Postgres on 54332, API on 3001, UI on 4273).
