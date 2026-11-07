# UI progress

| Task | Code | Design canvas |
| --- | --- | --- |
| U-01 Scaffold | Done | Token sheet |
| U-02 Primitives | Done, axe passes | Design system sheet |
| U-03 Data display | Done, axe passes | Design system sheet |
| U-04 Shell | Done, **Review stop 1** | SideNav, TopBar, BottomTabBar, project header |
| U-05 to U-20 | Not started; every route renders a placeholder inside the real shell | All 28 screens, light and dark; Team screens also at 390 px; 5 shared overlays |

Design canvas: https://claude.ai/artifact/FZa2sjKqkXFMfsa2q6JsUg

## Section 12.3 acceptance checks so far

| Check | State |
| --- | --- |
| Body resolves to Geist Sans with tabular figures | Passing (`tests/shell.spec.ts`) |
| Zero contrast failures across all stories in both themes | Passing (`tests/a11y.spec.ts`, axe WCAG 2.1 A and AA in Chromium) |
| Glass falls back to `--surface` with no layout shift | Passing, via emulated `prefers-reduced-transparency` |
| Sheets open without animation under reduced motion | Passing |
| No colour literal outside `tokens.css` | Passing (ESLint and `scripts/check-colors.mjs`) |
| Planner and timesheet grids keyboard operable | Not built yet (U-13, U-19) |
| Every DataTable has all four list states | Component done and storied; per-screen check waits for the screens |
| Contribution RestrictedCell by viewer | View-as switch built; tile waits for U-10 |
| 28 screens screenshotted | Shell only so far, in `docs/ui-screens/` |
