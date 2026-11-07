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
