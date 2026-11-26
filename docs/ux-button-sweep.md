# UX button sweep (live mode)

Work in progress. Live web (`dev:live`) on 5180 against a local API on 3100 (throwaway seed via `src/dev/e2e.ts`, `AMS_E2E_DB_PORT=54340`).

## Findings log (raw, as found)

| Screen | Control | Role | Expected | Actual | Verdict |
|---|---|---|---|---|---|
| /login | Chooser cards (Studio principal, Team member, Platform admin) | anon | open sign-in page | open | works |
| /login/studio | Sign in, empty | anon | field errors | "Enter your work email." / "Enter your password." | works |
| /login/studio | Sign in, wrong password | anon | error | "That email and password don't match." | works |
| /login/studio | Show / Hide password | anon | toggles | toggles | works |
| /login/studio | Forgot password? | anon | help text | note to ask an admin | works |
| /login/studio | Sign in, P01 | P01 | lands on /firm/overview | lands | works |
| /firm/overview | Page title greeting | P01 | greeting by studio clock | always "Good afternoon" (00:54 IST showed afternoon) | broken |
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
| /firm/projects/:id/phases | "today is ..." caption and Gantt today line | P01 | studio date (27 Nov IST) | "today is 26 November 2026" (browser UTC date between 00:00 and 05:30 IST) | broken |
| /firm/projects/:id/phases | Row menu > Edit (Delivery 150 %, then ETC 40 / 70 %) | P01 | error, then PATCH + re-read | "Enter 0 to 100", then row shows 40 / 210 / +10 / 70 % | works |
| /firm/projects/:id/tasks | New task (empty, then title/phase/assignee) | P01 | error, POST, card appears | "Name the task", card in To do | works |
| /firm/projects/:id/tasks | Task sheet: Follow, Add sub-task, Log time on task, Status + note + Save | P01 | each saves | all save and re-read | works |
| /firm/projects/:id/tasks | Card Move menu > Blocked; Board/List switch | P01 | moves | moves, counts update | works |
| /firm/projects/:id/tasks | Team: Add to team (Karan), Remove | P01 | membership changes | added then removed (no confirm on Remove) | works |
| /firm/projects/:id/timeline | Week/Month/Quarter, forecast toggle, Expand/Collapse all, bar Move panel > End 1 day later > Save | P01 | saved and re-read | "Saved. 1 item moved." WD now ends 19 Dec | works |
| /firm/projects/:id/staffing | Prev/Next/This week, By phase/By person, Add allocation (empty save) | P01 | error | "Enter hours above 0 and at most 168" | works |

## Code audit candidates (to verify in the browser)

1. My time > Request correction on a Submitted (not Approved) entry: API only allows amend from Approved, 409 raw message.
2. Log time / Stop timer do not refresh My time grid or project Time tab (no change event like leave's).
3. Log time picker lists projects the user is not a member of: 403 NOT_PROJECT_MEMBER (principal/ops/finance).
4. "Save and start timer" POSTs an entry and then starts a timer: hours counted twice; with a timer running, 409 and a duplicate entry on retry.
5. My time pill Stop on TIMER_NEEDS_HOURS shows a toast only (shell pill opens the hours sheet).
6. Create project (button + palette) shown to roles without projects.create (default PM): sheet fails.
7. Settings nav lands on /firm/settings/profile = "Not available yet"; sub-nav lists 7 unavailable sections.
8. Phases row Edit shown to roles without projects.plan: 403 toast.
9. Palette "Add person" -> /firm/people?add=1, param ignored in live.
10. Approvals Delegate sends only `until`; start date dropped.
11. Billing Submit/Reconcile gated on billing.prepare, API needs accounting.finalize.
12. People "Add people from Settings, Accounts" and Overview "Prepare invoices" visible to PM -> PermissionDenied.
15. My time "Add line" lines vanish after a refresh triggered by typing in another line.
| /firm/projects/:id/staffing | Add allocation 8 h > Save; Publish plan dialog > Publish | P01 | saved, published | "Publish plan (0 changes)", block shows Published | works |
| /firm/projects/:id/time | Person / Phase filters, Review in Approvals link | P01 | rows by state | Draft/Submitted/Returned rows incl. my 2.00 h draft | works |
| /firm/projects/:id/billing | Authorize WD 150 % then 50 % (two-step confirm) | P01 | error, then authorize | "Above 0% and at most 100%", then WD 50 %, ready line ₹3,60,000 | works |
| /firm/projects/:id/billing | Edit fees > Save fees | P01 | PUT, toast | "Fees saved. ₹24,00,000 across 6 phases." | works |
| /firm/projects/:id/billing | Generate draft | P01 | draft for this project | sheet asks to choose the project again (only PRJ-01 offered); Create draft makes DRAFT-0013 | works (confusing: not preselected) |
| /firm/projects/:id/costs, changes, files, activity | tabs | P01 | Not available yet | Not available yet | NAY by design |
| /firm/approvals | page | P01 | queue | empty, "Nothing is waiting for you" | works |
| /firm/workload | Heatmap, project filter, cell detail, Open in planner, block > Edit allocation 48 h | P01 | detail, reason on overbook | all work; over capacity asks "Reason to proceed" | works |
| /firm/calendar | Month/Week/List, Prev/Next/Today, layer toggles, event popover | P01 | switch | all work | works |
| /firm/billing | Ready/Drafts/Exceptions/WIP/Accounting tabs | P01 | lists | all render | works |
| /firm/billing | Drafts > Submit to accounting on an Approved draft (DRAFT-0012) | P01 | enabled, submits | always disabled; list showed "Not submitted" not "Approved" (web expected state 'Not sent', server uses 'Not submitted') | broken -> fixed 7d6b7a8 |
| /firm/billing | DRAFT-0013 Send for review, PM confirm | P01 | state changes | In review, PM confirmed | works |
| /firm/receivables | Record settlement (₹2,00,000 > outstanding, then ₹60,000) | P01 | error, then saved | "more than the ₹1,60,000 outstanding", then cash ₹60,000 recorded, ageing updates | works |
| /firm/receivables | New mock invoice issue date | P01 | 27 Nov (studio) | 26 Nov 2026 (server side, UTC date) | confusing (API billing module, not changed here) |
| Side nav | Settings | P01 | a usable settings page | lands on /firm/settings/profile "Not available yet"; Accounts/Rates/Calendars/Approvals only reachable from the sub-nav | broken |
| /firm/settings/accounts | Add account (empty, then valid) > invite link dialog | P01 | errors, POST, link | works; expiry shown as "11/30/2026, 1:12:06 AM" (US format, rest of app uses 30 Nov 2026) | works (confusing date format) |
| /firm/settings/accounts | Row menu: Resend invite > Create new link; Change account type > Save | P01 | new link; type changes | works | works |
| /firm/settings/calendars | Add holiday (empty, then 30 Nov "Sweep day"), Remove > Remove holiday / Keep it | P01 | errors, POST, DELETE | works | works |
| /firm/settings/rates | Add rate version: "Applies from" default | P01 | today, 27 Nov | 26 Nov 2026 (UTC date); saved rate applies from yesterday | broken |
| /firm/settings/rates | Add rate version (empty, then Sweep Tester ₹1,500) | P01 | errors, POST, row | works | works |
| /firm/settings/approvals | Fallback approver | P01 | shows Asha Rao | shows Asha Rao, Save disabled until changed | works |
| /firm/approvals | Billing draft row: Return (empty reason), Delegate sheet, Approve | P01 | error, sheet, approve | "A reason is required"; Delegate sheet opens; approved | works |
| Shell | Sign out | P01 | /login | /login | works |
| /accept-invite/:token | Mismatched passwords, then matching | anon | error, then signed in | "The passwords do not match", then /me/home as Sweep Tester | works |
| /firm/overview | "Prepare invoices" (page primary action) and tile links | P02 | open billing | Billing shows "You need the finance permission" | broken (shown to a role that cannot use it) |
| /firm/overview | Greeting | P02 | studio clock | "Good afternoon" at 01:15 IST | broken (same as P01) |
| Side nav | Settings | P02 | hidden or usable | "You need the change firm settings permission" | broken (shown to a role that cannot use it) |
| /firm/projects | Create project | P02 | hidden, or works | sheet opens with "You need projects.create for this." and "Loading clients" that never ends | broken |
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
| /me/work | Task status menu Blocked -> In progress | P04 | task stays in My tasks as In progress | toast "moved to In progress" but the task vanishes: "0 open, No open tasks" (assignee UUID compared with ref code) | broken |
| /me/schedule | page | P04 | published plan | renders; "published 26 Nov 2026" for a plan published 27 Nov IST (UTC date) | confusing |
| /me/expenses | page | P04 | Not available yet | Not available yet | NAY by design |
| /firm/projects | Create project | P10 | hidden, or works | "You need projects.create for this." + "Loading clients" forever | broken (same as P02) |
| Top bar | Start timer (idle) | P10 | starts a timer | opens the Log time sheet, which needs a duration | confusing |
| Log time sheet | Project picker offers PRJ-04 (P10 not on the team) | P10 | only loggable projects | Save -> "You are not on this project's team." | broken (picker lists projects the user cannot log on) |

## Status when the session stopped (usage limit)

Fixed and committed:
- 7d6b7a8 Billing: Submit to accounting always disabled for approved drafts (state 'Not submitted' vs 'Not sent'). Test in `api/live/billing.test.ts`.
- My work: task vanished after a status change (assignee UUID compared with ref code). One-line fix in `screens/me/work-live.tsx` (`viewer.personId`); committed with this log, **no test yet**.

Broken, not fixed yet (smallest fix noted):
1. Overview greeting always "Good afternoon" (live): use `greetingFor(viewer.firm?.timezone)` in `screens/firm/overview.tsx` LiveOverviewScreen.
2. UTC "today" between 00:00 and 05:30 IST: `project/phases.tsx` and `project/overview.tsx` `todayIso`, `rates.tsx` `today()` (Add rate version default), `api/live/billing.ts` `createDraft` cutoff. Use `todayIn(viewer.firm?.timezone)` from `api/live/time.ts`.
3. Log time / Stop timer do not refresh My time or the project Time tab: add a time-changed event like leave's `announceLeaveChanged`, listen in `me/time.tsx`.
4. Request correction on a Submitted week: list only Approved entries in `corrOptions` (`me/time.tsx`), and explain when there are none.
5. Create project (button + palette) for roles without `projects.create` (PM, ops/finance): gate with `!isLive || can(viewer, 'projects.create')` in `projects.tsx` and `ShellLayout.tsx`.
6. Settings nav lands on "Not available yet" and is shown to PM: in live, route `/firm/settings` to the first live section and hide the item unless `canOpenSettings(viewer)`.
7. Overview "Prepare invoices" shown to PM: gate on `can(viewer, 'billing.prepare', { firmWide: true })`.
8. Log time picker lists projects the user is not on (principal/ops/finance).

Not yet walked: platform admin console (`/platform`), phone width (375 px) pass, P10 Calendars/Accounts as operations. Suites (typecheck, lint, full vitest) not run after the last change.
