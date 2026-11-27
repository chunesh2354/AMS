# UX button sweep (live mode)

Every screen, tab, sheet, menu and dialog of the live web app, clicked as principal (P01), PM (P02), staff (P04),
operations + finance (P10) and the platform admin, against a local API with the dev seed. Branch
`claude/ux-button-sweep-294c1d`. Nothing was deployed or pushed.

## How it was run

- API: `apps/api/src/dev/e2e.ts` (throwaway database, seeded, sign-in rate limit off) with `AMS_E2E_DB_PORT=54340` and
  `AMS_E2E_API_PORT=3100`. Web: `npm --prefix apps/web run dev:live -- --port 5180` with `AMS_API_TARGET=http://127.0.0.1:3100`.
- Windows note: from this worktree the path to `initdb.exe` is over 260 characters, so embedded Postgres failed to spawn
  (`ENOENT`). The API was started from a short drive (`subst S: <worktree>`); remove it with `subst S: /d`.
- Each control was checked by re-reading the page or the API response after the click, not only by the toast.
- A read-only code audit of every live handler (web handler and API route) ran alongside. Its candidates were checked in the
  browser and are in the table or under "Left".

## Summary

- Most controls work: the sheets and dialogs on every connected screen save and re-read correctly for each role.
- **Broken and fixed on this branch:** the Overview greeting, the studio date used as "today", Create project / Settings /
  Prepare invoices shown to roles that cannot use them, the Settings entry landing on "Not available yet", My work dropping a
  task after a status change, and Generate draft asking for the project again.
- **Broken and left for core-path** (the main session is changing those files): billing Submit to accounting, My time not
  refreshing after Log time, Request correction on a submitted week, and the Log time picker and timer flow.
- **"Not available yet" by design:** Pipeline, Reports, Expenses, project Costs / Changes / Files / Activity, settings Profile,
  Permissions, Work categories, Templates, Approval policies, Integrations and Imports, and profile Personal details and
  Working pattern.

## Fixed on this branch

| Commit | Fix | Test |
|---|---|---|
| a021b4d | My work: a task vanished from My tasks after any status change except Done (the assignee's UUID was compared with the viewer's ref code). | 640849a, `project/tasks-live.test.tsx` "keeps my task in the list after I move it to In progress" (fails without the fix) |
| 9c463c8 | Overview (live): greeting by the studio clock (it was always "Good afternoon"); the "Prepare invoices" page action and tile link need `billing.prepare` firm-wide (a PM landed on the finance permission page). | `overview.live.test.tsx`: greeting at 00:54 IST, link shown to a biller, hidden from a PM |
| f0b8500, 45ff99f | The studio's date instead of the browser's UTC date for "today" (wrong from 00:00 to 05:30 IST): Phases caption and Gantt today line, project overview Gantt, Add rate version default (a new rate applied from yesterday). | `project/live-tabs.test.tsx` "says today in the studio", `rates.test.tsx` "starts a new version on the studio date" |
| 73a121f | Create project (page action, empty state, `?new=1`, palette) needs `projects.create` (a PM or ops/finance got a sheet stuck on "Loading clients"). Settings links to `/firm/settings`, which opens Accounts in live mode (finance goes on to Rates), and is hidden from roles that cannot open any section. Palette "Add person" opens Settings, Accounts in live mode (People ignores `?add=1` there). | `src/live-permission-gates.test.tsx` |
| 1aae9ac | Generate billing draft preselects the project when only one has lines ready (from a project's Billing tab it asked for the project again). | `generate-draft-sheet.live.test.tsx` |
| 7d6b7a8, reverted in 3074114 | Billing Submit to accounting state mismatch. Reverted because the main session fixed the same lines on core-path. | n/a |

## Left, and why

| Item | Where | Why not fixed here |
|---|---|---|
| Submit to accounting always disabled for approved drafts (the web expects 'Not sent', the API sends 'Not submitted') | `screens/firm/billing.tsx`, `api/live/billing.ts` | Fixed on core-path by the main session. |
| Log time and the top-bar Stop timer do not refresh My time or the project Time tab until a reload | `screens/shared/log-time-sheet.tsx`, `screens/me/time.tsx` | `me/time.tsx` is being changed on core-path. Suggested fix: a time-changed event like leave's `announceLeaveChanged`, listened to by My time. |
| Request correction on a Submitted (not yet approved) week shows a raw "timeApproval: cannot amend from Submitted" | `screens/me/time.tsx` (`corrOptions` includes Submitted entries) | Same file, and the correction API route is being changed on core-path. Suggested fix: offer only Approved entries and explain when there are none. |
| The Log time picker lists projects the user is not on (principal, ops, finance); Save then says "You are not on this project's team" | `api/live/time.ts` `getPhaseOptions`, `log-time-sheet.tsx` | Part of the time flow being reworked on core-path; filter with `member_projects` / `led_projects` from `/me`. |
| Top-bar "Start timer" opens Log time (needs a duration); "Save and start timer" logs the duration and then starts a timer that logs again | `layouts/ShellLayout.tsx`, `log-time-sheet.tsx` | Same timer flow (core-path changed timer Stop). |
| Billing draft cutoff uses the UTC date | `api/live/billing.ts` `createDraft` | File owned by the core-path billing fix. |
| Phases row Edit shown to viewers without `projects.plan` (403 toast) | `project/phases.tsx` | Not reproduced in the browser (a PM cannot open a project they do not lead); kept as an audit note. |
| Approvals Delegate drops the start date (the API has only `until`) | `screens/firm/approvals.tsx` | Needs an API change. |
| New mock invoice date and "plan published" date shown a day early around midnight | API billing and schedule | API modules owned by the other session; display only. |
| Copy and display issues marked "confusing" in the table: KPI values clipped at 1024 px, invite expiry in US date format on Accounts, list "Risk" vs Health view, platform Forgot password copy, "expired" for a revoked reset link, Home vs My time scheduled hours | various | Low impact; listed for a polish pass. |

## Findings table

| Screen | Control | Role | Expected | Actual | Verdict |
|---|---|---|---|---|---|
| /login | Chooser cards (Studio principal, Team member, Platform admin) | anon | open sign-in page | open | works |
| /login/studio | Sign in, empty | anon | field errors | "Enter your work email." / "Enter your password." | works |
| /login/studio | Sign in, wrong password | anon | error | "That email and password don't match." | works |
| /login/studio | Show / Hide password | anon | toggles | toggles | works |
| /login/studio | Forgot password? | anon | help text | note to ask an admin | works |
| /login/studio | Sign in, P01 | P01 | lands on /firm/overview | lands | works |
| /firm/overview | Page title greeting | P01 | greeting by studio clock | always "Good afternoon" (00:54 IST showed afternoon) | broken -> fixed 9c463c8 |
| /firm/overview | KPI tiles at 1024 px | P01 | values fit | "₹4,86,000" / "₹1,60,000" clipped | confusing |
| Shell | Notifications bell | P01 | list from GET /notifications | "No notifications" (empty for P01, request ok) | works |
| Shell | Account menu > My profile | P01 | /me/profile | opens; Work details live, Personal details + Working pattern "Not available yet" | works / NAY by design |
| /me/profile | Password: empty submit, wrong current | P01 | errors | "Enter your current password", "Your current password is not correct" | works |
| Shell | Ctrl K palette, search "Rohan", Enter | P01 | open person | /firm/people/P04 | works |
| /firm/people/:id | Overview/Access/Projects/Capacity/Rates tabs | P01 | switch | all render live data | works |
| /firm/people/:id | Capacity > Change weekly hours (200 h, then 36 h) | P01 | error, then PUT + re-read | "Enter hours from 0 to 168", then 36 h from 27 Nov shown | works |
| /firm/people/:id | Manage in Accounts | P01 | /firm/settings/accounts | navigates | works |
| /firm/people | Status chips, sort, Manager filter, Columns, row menu > View profile, Clear all | P01 | filter/sort | all work, empty states have copy | works |
| /firm/projects | List / Timeline / Health views, timeline Month/Quarter/Year, PM filter, Expand, health sort | P01 | switch | all work | works |
| /firm/projects | List "Risk" vs Health view | P01 | same verdict | PRJ-02 "On track" in list but "Watch" in Health; PRJ-03 "On hold" vs "Watch" | confusing |
| /firm/projects | Stage, Next milestone columns | P01 | values | "Not set" for every seeded project | confusing (data) |
| /firm/projects | Create project 3-step sheet (empty submit, new client, template, fee, team) | P01 | errors, then POST /clients + /projects, open project | works, lands on /firm/projects/PRJ-04 | works |
| /firm/projects/:id | Log time (header) | P01 | sheet, prefilled with this project | sheet opens with Project and phase empty; empty save shows errors; save POSTs /time-entries, toast | works (not prefilled: confusing) |
| /firm/projects/:id/phases | "today is ..." caption and Gantt today line | P01 | studio date (27 Nov IST) | "today is 26 November 2026" (browser UTC date between 00:00 and 05:30 IST) | broken -> fixed f0b8500 |
| /firm/projects/:id/phases | Row menu > Edit (Delivery 150 %, then ETC 40 / 70 %) | P01 | error, then PATCH + re-read | "Enter 0 to 100", then row shows 40 / 210 / +10 / 70 % | works |
| /firm/projects/:id/tasks | New task (empty, then title/phase/assignee) | P01 | error, POST, card appears | "Name the task", card in To do | works |
| /firm/projects/:id/tasks | Task sheet: Follow, Add sub-task, Log time on task, Status + note + Save | P01 | each saves | all save and re-read | works |
| /firm/projects/:id/tasks | Card Move menu > Blocked; Board/List switch | P01 | moves | moves, counts update | works |
| /firm/projects/:id/tasks | Team: Add to team (Karan), Remove | P01 | membership changes | added then removed (no confirm on Remove) | works |
| /firm/projects/:id/timeline | Week/Month/Quarter, forecast toggle, Expand/Collapse all, bar Move panel > End 1 day later > Save | P01 | saved and re-read | "Saved. 1 item moved." WD now ends 19 Dec | works |
| /firm/projects/:id/staffing | Prev/Next/This week, By phase/By person, Add allocation (empty save) | P01 | error | "Enter hours above 0 and at most 168" | works |
| /firm/projects/:id/staffing | Add allocation 8 h > Save; Publish plan dialog > Publish | P01 | saved, published | "Publish plan (0 changes)", block shows Published | works |
| /firm/projects/:id/time | Person / Phase filters, Review in Approvals link | P01 | rows by state | Draft/Submitted/Returned rows incl. my 2.00 h draft | works |
| /firm/projects/:id/billing | Authorize WD 150 % then 50 % (two-step confirm) | P01 | error, then authorize | "Above 0% and at most 100%", then WD 50 %, ready line ₹3,60,000 | works |
| /firm/projects/:id/billing | Edit fees > Save fees | P01 | PUT, toast | "Fees saved. ₹24,00,000 across 6 phases." | works |
| /firm/projects/:id/billing | Generate draft | P01 | draft for this project | sheet asks to choose the project again (only PRJ-01 offered); Create draft makes DRAFT-0013 | confusing -> fixed 1aae9ac |
| /firm/projects/:id/costs, changes, files, activity | tabs | P01 | Not available yet | Not available yet | NAY by design |
| /firm/approvals | page | P01 | queue | empty, "Nothing is waiting for you" | works |
| /firm/workload | Heatmap, project filter, cell detail, Open in planner, block > Edit allocation 48 h | P01 | detail, reason on overbook | all work; over capacity asks "Reason to proceed" | works |
| /firm/calendar | Month/Week/List, Prev/Next/Today, layer toggles, event popover | P01 | switch | all work | works |
| /firm/billing | Ready/Drafts/Exceptions/WIP/Accounting tabs | P01 | lists | all render | works |
| /firm/billing | Drafts > Submit to accounting on an Approved draft (DRAFT-0012) | P01 | enabled, submits | always disabled; list showed "Not submitted" not "Approved" (web expected state 'Not sent', server uses 'Not submitted') | broken; fixed on core-path by the main session (7d6b7a8 here was reverted in 3074114 to avoid a conflict) |
| /firm/billing | DRAFT-0013 Send for review, PM confirm | P01 | state changes | In review, PM confirmed | works |
| /firm/receivables | Record settlement (₹2,00,000 > outstanding, then ₹60,000) | P01 | error, then saved | "more than the ₹1,60,000 outstanding", then cash ₹60,000 recorded, ageing updates | works |
| /firm/receivables | New mock invoice issue date | P01 | 27 Nov (studio) | 26 Nov 2026 (server side, UTC date) | confusing (API billing module, not changed here) |
| Side nav | Settings | P01 | a usable settings page | lands on /firm/settings/profile "Not available yet"; Accounts/Rates/Calendars/Approvals only reachable from the sub-nav | broken -> fixed 73a121f |
| /firm/settings/accounts | Add account (empty, then valid) > invite link dialog | P01 | errors, POST, link | works; expiry shown as "11/30/2026, 1:12:06 AM" (US format, rest of app uses 30 Nov 2026) | works (confusing date format) |
| /firm/settings/accounts | Row menu: Resend invite > Create new link; Change account type > Save | P01 | new link; type changes | works | works |
| /firm/settings/calendars | Add holiday (empty, then 30 Nov "Sweep day"), Remove > Remove holiday / Keep it | P01 | errors, POST, DELETE | works | works |
| /firm/settings/rates | Add rate version: "Applies from" default | P01 | today, 27 Nov | 26 Nov 2026 (UTC date); saved rate applies from yesterday | broken -> fixed f0b8500 |
| /firm/settings/rates | Add rate version (empty, then Sweep Tester ₹1,500) | P01 | errors, POST, row | works | works |
| /firm/settings/approvals | Fallback approver | P01 | shows Asha Rao | shows Asha Rao, Save disabled until changed | works |
| /firm/approvals | Billing draft row: Return (empty reason), Delegate sheet, Approve | P01 | error, sheet, approve | "A reason is required"; Delegate sheet opens; approved | works |
| Shell | Sign out | P01 | /login | /login | works |
| /accept-invite/:token | Mismatched passwords, then matching | anon | error, then signed in | "The passwords do not match", then /me/home as Sweep Tester | works |
| /firm/overview | "Prepare invoices" (page primary action) and tile links | P02 | open billing | Billing shows "You need the finance permission" | broken -> fixed 9c463c8 |
| /firm/overview | Greeting | P02 | studio clock | "Good afternoon" at 01:15 IST | broken -> fixed 9c463c8 |
| Side nav | Settings | P02 | hidden or usable | "You need the change firm settings permission" | broken -> fixed 73a121f |
| /firm/projects | Create project | P02 | hidden, or works | sheet opens with "You need projects.create for this." and "Loading clients" that never ends | broken -> fixed 73a121f |
| /firm/approvals | Row preview, select + "Approve 1 selected" | P02 | approved | "1 approved.", queue empty | works |
| /firm/projects/PRJ-02/phases | Project the PM does not lead | P02 | denied | "You need the view project phases permission"; header shows "PRJ-02 · PRJ-02" | works (header confusing) |
| /firm/projects/:id/billing | Edit fees > Save fees | P02 | saved | "Fees saved" | works |
| /login/team | Sign in P04 | anon | /me/home | /me/home | works |
| /me/home | page | P04 | live figures | "38.50 h of 39.20 h scheduled" while My time says "of 40.00 h" (weekly hours changed mid-week) | confusing |
| /me/time | Log time > Save | P04 | grid shows the new entry | POST ok, sheet closes, grid and total unchanged until a reload | broken |
| /me/time | Cell edit (double-click, 2.5, Enter) | P04 | PUT, re-read | 20.00 h total | works |
| /me/time | Start timer / Stop (page pill) | P04 | timer runs, entry added | starts on the first line without asking; stop adds 0.01 h and refreshes | works |
| /me/time | Submit week (with a 12.5 h day) | P04 | submitted, locked | Submitted, lines locked, exception note kept | works |
| /me/time | Request correction on a submitted (not approved) week | P04 | explains or sends | picker offers Submitted entries; Send shows raw "timeApproval: cannot amend from Submitted" | broken |
| /me/leave | Request leave (empty, then 1-2 Dec), Withdraw > confirm | P04 | errors, POST, cancel | works, balance 12 -> 10 days, then Cancelled | works |
| /me/work | Task status menu Blocked -> In progress | P04 | task stays in My tasks as In progress | toast "moved to In progress" but the task vanishes: "0 open, No open tasks" (assignee UUID compared with ref code) | broken -> fixed a021b4d, test 640849a |
| /me/schedule | page | P04 | published plan | renders; "published 26 Nov 2026" for a plan published 27 Nov IST (UTC date) | confusing |
| /me/expenses | page | P04 | Not available yet | Not available yet | NAY by design |
| /firm/projects | Create project | P10 | hidden, or works | "You need projects.create for this." + "Loading clients" forever | broken -> fixed 73a121f |
| Top bar | Start timer (idle) | P10 | starts a timer | opens the Log time sheet, which needs a duration | confusing |
| Log time sheet | Project picker offers PRJ-04 (P10 not on the team) | P10 | only loggable projects | Save -> "You are not on this project's team." | broken (picker lists projects the user cannot log on) |
| /platform/login | Sign in empty / wrong password / Forgot password? | anon | errors, help | errors work; Forgot password tells a platform admin to "Ask your studio admin or a principal" | confusing (copy) |
| /platform | Company row > detail; person menu: Reset password link, Disable sign-in (reason required), Enable sign-in | admin | dialogs, state changes | all work, recorded in Activity | works |
| /platform | Add company (empty, then valid), Suspend (reason) / Reactivate, owner New invite link, Add person in a company | admin | errors, then saved | all work | works |
| /platform | Sign out | admin | /platform/login | /platform/login | works |
| /reset-password/:token | Link created, then the person's sign-in disabled | anon | link refused | "This reset link has expired" (it was revoked by Disable sign-in, not expired) | confusing (copy) |
| 375 px | /me/home, work, schedule, leave, time; /firm/overview, approvals, projects, a project, people, billing, receivables; More menus | P04, P01 | no page overflow | the page never overflows; the timesheet grid, week strip, queue rail and tab bars scroll sideways inside their own box; two Start timer pills on My time | works |
| 375 px | More > Settings | P01 | a working section | /firm/settings/accounts (after 73a121f) | works |
| /firm as P02, after the fixes | Side nav, Projects, Overview | P02 | no dead ends | no Settings, Create project or Prepare invoices; greeting "Good morning" at 11:00 IST | works |

Console: no React errors seen. Network: only the expected 401s before sign-in and the 403s the table names; doubled GETs are React StrictMode in dev.
