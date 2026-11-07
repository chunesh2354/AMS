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
| U-10 Projects list and Project Overview | Done, **Review stop 2** | Yes |
| U-11 to U-20 | Not started; routes render a placeholder in the real shell | All designed |

Design canvas: https://claude.ai/artifact/FZa2sjKqkXFMfsa2q6JsUg

## Section 12.3 acceptance checks so far

| Check | State |
| --- | --- |
| Body resolves to Geist Sans with tabular figures | Passing (`tests/shell.spec.ts`) |
| Zero contrast failures across all stories in both themes | Passing (`tests/a11y.spec.ts`, axe WCAG 2.1 A and AA in Chromium) |
| Built routes and their list states pass axe in both themes | Passing (`tests/routes-a11y.spec.ts`) |
| Glass falls back to `--surface` with no layout shift | Passing, via emulated `prefers-reduced-transparency` |
| Sheets open without animation under reduced motion | Passing |
| No colour literal outside `tokens.css` | Passing (ESLint and `scripts/check-colors.mjs`) |
| Every DataTable has all four list states | Reachable on built routes through `?demo=loading|empty|error|denied` |
| Contribution is Restricted for P02 and a value for P01 | Passing (`src/screens/firm/projects.test.tsx`) |
| Planner and timesheet grids keyboard operable | Not built yet (U-13, U-19) |
| 28 screens screenshotted | 6 of 28 so far, in `docs/ui-screens/` |
