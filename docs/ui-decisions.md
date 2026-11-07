# UI decisions

Choices made where the brief was ambiguous or could not be met as written. The calmer option wins.

1. **Added `--*-ink` and `--accent-text` tokens.** The brief's status colours fail AA as text on their own soft backgrounds (for example `--warn` on `--warn-soft` in light mode). Section 11 allows darkening ink, so chips and alerts use darker text tokens and the brief's colours stay for fills and rules. `docs/ui-contrast.md` has the full report.
2. **Placeholders use `--ink-2`, not `--ink-3`.** `--ink-3` fails 4.5:1. It remains for disabled text, which WCAG exempts.
3. **Danger button is soft.** `--danger` with white text is 4.38:1 in light mode, so it uses `--danger-soft`, `--danger-ink` and a `--danger` border.
4. **Active nav and tabs use `--ink-1` text** with an accent background or underline, because `--accent` text on `--accent-soft` falls short.
5. **Glass recipe shadows are tokens.** Section 12.3 bans colour literals outside `tokens.css`, so `glass.css` reads `--shadow-glass*`.
6. **White-row hover gets inset rules.** `--surface-raised` equals `--surface` in light mode, so hover alone would be invisible.
7. **Popovers and sheets may sit over solid surfaces.** Section 5.2 says glass sits on the plane, but section 7 requires glass calendars and sheets over forms and tables. Stacking still never exceeds two.
8. **Firm below 768 px** gets a bottom bar with Overview, Approvals and More, so those two stay usable as section 11 requires.
9. **Mock values the brief does not give** (Utilization 78%, Contribution ₹6,40,000, the PRJ-01 entitlement split, phase budgets other than Working drawings) are placeholders that add up to the brief's totals.
10. **Canvas mock data beyond the brief.** Pipeline opportunities, the Harbour Studio Offices proposal, task names, leave balances and integration modes are invented placeholders. Amounts are kept consistent across screens: ready to bill ₹4,86,000 is ₹80,000 from PRJ-01 plus ₹4,06,000 from PRJ-02, and the only outstanding invoice is INV-DEMO-0007.
11. **Reports and Project overview open as Vikram Nair (PM)** so the Restricted states show by default. The `viewAs` tweak switches to Asha Rao.
12. **`-webkit-backdrop-filter` must come before `backdrop-filter`.** The CSS minifier keeps only the last of the two, so the reverse order shipped no blur in Chromium. `tests/shell.spec.ts` asserts the computed blur.
13. **Stories set their starting URL with `parameters.route`.** The Storybook decorator already provides the router, and a second one crashes the story.
14. **Team bottom bar:** More opens a menu with Expenses, Leave and Profile, because the brief lists five tabs but six Team destinations plus Profile.
15. **Mock view-as:** the avatar menu switches viewer, and `?as=P04` sets the starting viewer for screenshots. Nothing is persisted, including the theme choice.
16. **Screen-reader names use visible text.** Controls build their name from their content rather than `aria-label` so the visible label is always part of the name (WCAG 2.5.3). Calendar days read "4 Nov 2026" for that reason, while displayed dates stay "04 Nov 2026".
17. **New design system components** the screens needed, each with stories and tests: AttentionList, ListStateBlock, Stepper and QueueRail. AvailabilityBar, ApprovalRow and PreviewPane come from the brief's inventory.
18. **`?demo=loading|empty|error|denied`** forces a list state on any built route, so section 12.3's "story or route for every state" is checkable.
19. **Person tabs live in `?tab=`.** Section 9 lists one route for the profile and route paths must not change, so tabs persist in the URL as a param.
20. **Rates tab:** absent for staff as the brief says. A PM sees the tab with RestrictedCell values, the calmer reading of "absent for staff viewers".
21. **Project avatars show the code's number** ("01"), with the full code as the accessible name, because initials of "PRJ-01" are meaningless.
22. **Below 1280 px, the approval preview opens in a sheet.** The 400 px pane does not fit beside the rail and list.
23. **Delegate opens a sheet, not a popover,** because a picker and calendar need their own popovers.
24. **Approving, returning and delegating only change the current view.** Nothing persists in this build, so a reload restores all 14 items.
25. **New design system components for U-11 to U-19,** each with stories and tests: KanbanBoard (the board variant in section 8), SubNav (Settings and Reports), SegmentedBar (ageing), WeekStrip (My leave), CompareColumns (budget revision, bill comparison), PeriodNav (planner and timesheet headers), Thread (review threads) and TaskRow (My day and My work, because a wide table does not read at 390 px). PlannerGrid, TimesheetGrid and DayTotalRing come from the brief's inventory. DataTable gained expandable rows, row tone, cell errors, an active row and tight padding.
26. **Extra words in the status map.** Section 10 has no entry for pipeline's New, the priorities, integration modes or "None". They were added to `status-colors.ts` inside the same five tones: New, Low, Not configured, CSV and None are neutral; Medium and MOCK are warn; Live is ok; High is danger. MOCK is warn because nothing real happens behind it.
27. **Fee methods and document versions use a neutral chip** without a status word, because they are labels rather than states.
28. **Keyboard equivalents for dragging.** Boards have a Move menu on each card. PlannerGrid uses Shift + arrow to move and + or − to change hours; the hint sits in the legend.
29. **Planner day zoom is read-only.** It splits a week's allocation evenly across Monday to Friday, so editing there would imply a precision the plan does not hold. Edits stay in week zoom.
30. **My schedule reuses PlannerGrid** with weeks as rows and days as columns, read-only, rather than a second calendar component.
31. **Resource planner rows repeat a person per project,** so Vikram Nair appears under PRJ-01 and under PRJ-03 (on hold). Capacity is still counted across all of a person's rows. A conflict shows only in the cell holding the allocation.
32. **Availability now reads the plan.** Person capacity and Workload use the same allocations, so the two screens cannot disagree. Only Divya Menon goes over capacity. Rohan Shetty's commitments are zero in the week of his leave so he stays within capacity.
33. **The submit dialog in Billing is a Sheet.** Section 3 says context stays visible and section 7 has no modal, so "submit dialog" takes the calmer existing component.
34. **Billing and Receivables are denied to people without finance access,** using the section 9.3 Permission denied overlay. Project Billing stays open to a PM with amounts Restricted, matching Overview. Entitlement bars stay visible, as they already are on Project Overview.
35. **Settings is denied to everyone but the principal and operations.** The brief does not say; this is the calmer reading of "Permissions".
36. **Approval item 14 changed.** It was "Hourly NTE, eligible only, ₹4,000" and contradicted approved DRAFT-0012, which already bills that ₹4,000. It is now a pending consultant recharge of ₹2,75,000 (the ₹2,50,000 bill plus 10% markup) on PRJ-01. Queue counts are unchanged.
37. **Project attention is fenced like firm attention.** The PRJ-02 NTE row showed amounts to a PM on Project Overview; it now says "Amounts Restricted". This was a leak from U-10, fixed in U-16.
38. **A returned line clears when its hours change.** Submit stays blocked until then, and an unclassified line needs a project and phase first. Arjun Das (`?as=P08`) was added to View as, because Rohan Shetty has "Returned 0" per the brief, so his own timesheet has no returned line to show.
39. **Empty states.** Every list's empty state now has one sentence and one primary action. Where no create action makes sense the action leads to the next useful screen. Three exceptions: the Overview attention list (nothing to do is good news), the approval preview pane and the NTE panel, which are not lists.
40. **Placeholder values to check with the firm.** Task names beyond the brief's, the second and third projects' phases, staffing hours, invoice history other than INV-DEMO-0007, report rows other than Nisha Kumar's flag, and leave balances are invented to fill the screens. They follow the brief's totals wherever it gives them.
