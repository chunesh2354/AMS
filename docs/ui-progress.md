# UI progress

| Task | Code | Design canvas |
| --- | --- | --- |
| U-01 Scaffold | Done | Token sheet |
| U-02 Primitives | Done | Design system sheet |
| U-03 Data display | Done | Design system sheet |
| U-04 Shell | Done | SideNav, TopBar, BottomTabBar, project header |
| U-05 Mock data | Done: `mock/studio-meridian.ts`, `api/`, used by stories | Yes |
| U-06 Firm Overview | Done | Yes |
| U-07 People and Add person wizard | Done | Yes |
| U-08 Person profile | Done, seven tabs, AvailabilityBar | Yes |
| U-09 Approval inbox | Done | Yes |
| U-10 Projects list and Project Overview | Done, Review stop 2 | Yes |
| U-11 Project Phases and budget compare | Done, three-column sheet, overrun hatch +30 h | Yes |
| U-12 Project Tasks and task sheet | Done, board and list, 640 sheet, blocked badge, review thread | Yes |
| U-13 PlannerGrid, Resource planner, Staffing, My schedule | Done, windowed rows, drag and resize, conflict prompt, keyboard | Yes |
| U-14 Project Time, Costs, Changes, Files, Activity | Done, returned line, duplicate alert, redacted audit | Yes |
| U-15 Pipeline, Proposal, Create project wizard | Done, accepted version locked | Yes |
| U-16 Billing and Project Billing | Done, sub-tabs, two-pane draft, NTE panel, MOCK submit | Yes |
| U-17 Receivables | Done, ageing bar, settlement sheet, four separate columns | Yes |
| U-18 Reports and Settings | Done, definition panel, Export tooltip, MOCK card, import wizard | Yes |
| U-19 Team screens | Done, TimesheetGrid, TimerPill, shared log-time and request-leave sheets, 390 px | Yes |
| U-20 Polish pass | Done, **Review stop 3** | The canvas is a separate artifact and was not changed in this pass |

Design canvas: https://claude.ai/artifact/FZa2sjKqkXFMfsa2q6JsUg

## Section 12.3 acceptance checks

| Check | State |
| --- | --- |
| Body resolves to Geist Sans with tabular figures | Passing (`tests/shell.spec.ts`) |
| Zero contrast failures across all stories in both themes | Passing (`tests/a11y.spec.ts`, axe WCAG 2.1 A and AA, Chromium only) |
| All routes, list states and sheets pass axe in both themes | Passing (`tests/routes-a11y.spec.ts`) |
| Glass falls back to `--surface` with no layout shift | Passing (`tests/shell.spec.ts`, `tests/audit.spec.ts`) |
| Sheets open without animation under reduced motion | Passing (`tests/grids.spec.ts`) |
| PlannerGrid and TimesheetGrid fully operable with the keyboard | Passing (`tests/grids.spec.ts`) |
| No colour literal outside `tokens.css` | Passing (ESLint and `scripts/check-colors.mjs`) |
| Every DataTable has a route for all four list states | Passing, through `?demo=loading|empty|error|denied` on every list route |
| Contribution is Restricted for P02 and a value for P01 | Passing (`projects.test.tsx`, `tests/grids.spec.ts`) |
| 28 screens in light and dark at 1440 px, Team at 390 px | Done, in `docs/ui-screens/` |

## U-20 audits

| Audit | Where |
| --- | --- |
| Alignment against the 8 px grid | `docs/ui-alignment.md`, overlay shots `docs/ui-screens/audit-grid-*.png` |
| Contrast | `docs/ui-contrast.md` |
| Empty states: one sentence, one action | `tests/audit.spec.ts` |
| Dark mode | Every screenshot read by eye in dark |
