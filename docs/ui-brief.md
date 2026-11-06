# UI Design Brief for Claude Code — Architecture Firm Management

Nov 6, 2026 · @SC

A self-contained brief for designing and building the front end only: a Geist, liquid-glass design system and every screen of the Firm and Team interfaces, rendered with mock data so the look can be reviewed before the backend exists.

## 1. Prompt for Claude Code (paste this first)

Save this document as `docs/ui-brief.md` in the repo, then paste the prompt below into Claude Code and let it run.

```text
You are the front-end designer and engineer for an architecture-firm practice-management product. The file docs/ui-brief.md is the complete UI brief and is authoritative; read it fully before starting and re-read the relevant section before each task.

SCOPE (UI only, no backend)
Build a React + TypeScript front end in apps/web with:
1. A design-system package at apps/web/src/ui: tokens, Geist typography, the liquid-glass surface recipe, and every component in brief section 7 with every listed variant and state, documented in Storybook (light and dark).
2. Every screen in brief section 9, for both the Firm (/firm/*) and Team (/me/*) interfaces, rendered with realistic mock data from apps/web/src/mock (the 10-person demo firm described in section 2). Screens must be navigable through the real app shell and router, not only Storybook.
3. A thin data layer (apps/web/src/api) with typed functions that currently return mock data, so the backend can replace them later without touching screens.

RULES
- Use only Geist Sans and Geist Mono. Use only the tokens in sections 5–6. Use only the components in section 7; if a screen needs something new, add it to the design system first and document it.
- Glass is for navigation, header, cards, sheets and popovers. Data tables, forms and planner/timesheet grids sit on solid surfaces. Never stack glass more than two deep. Never exceed 20px blur.
- Every list has loading, empty, error and permission-denied states. Every form has inline validation and a sticky footer. Every metric can show the incomplete-data ring. Every confidential value can render as a RestrictedCell (hatched + lock), never blank, never zero.
- Numbers: tabular figures everywhere, Geist Mono for hours, amounts, percentages and codes, en-IN grouping for INR (₹4,00,000).
- Status colours come from one file (section 10). No ad-hoc colours anywhere.
- Honour prefers-color-scheme, prefers-reduced-motion and prefers-reduced-transparency. Meet WCAG 2.1 AA, tested on glass against the darkest region of the background gradient.
- Keyboard: planner and timesheet grids are arrow-key navigable; all sheets trap focus and close on Escape.
- No placeholder lorem ipsum: mock data uses the names, projects, phases and numbers from section 2 and section 9.
- Do not build backend logic, auth or persistence. Do not change the route paths.

WORKING LOOP
Follow the task order in section 12 (U-01 to U-20). For each task: implement, add Storybook stories or a route, run lint/typecheck/tests/Storybook build, take a screenshot of each new screen in light and dark (Playwright), save to docs/ui-screens/, update docs/ui-progress.md, then continue to the next task. Stop and show me screenshots after U-04 (design system), U-10 (Firm shell + Overview + People) and U-20 (everything). If anything in the brief is ambiguous, choose the calmer, more restrained option and note it in docs/ui-decisions.md.

Start with U-01 now.
```

## 2. Product context the UI needs

The product connects people → projects → phases → assigned work → time and costs → approvals → billing → reporting for Indian architecture firms of 5–50 people; the UI has two interfaces over the same records and a demo firm of ten people to render.

### 2.1 Interfaces and who sees them

| Interface | Route tree | Users | Purpose |
| --- | --- | --- | --- |
| Firm | `/firm/*` | Principal, operations, project managers, finance | Run the practice: people, planning, approvals, billing, reports |
| Team | `/me/*` | Everyone, including staff architects and designers | Manage own work: tasks, schedule, time, expenses, leave |

A person with only the `staff` role never sees Firm navigation. A principal sees both and can switch via the sidebar.

### 2.2 Demo firm for mock data — "Studio Meridian (DEMO)"

| Ref | Name | Title | Roles | Used in screens |
| --- | --- | --- | --- | --- |
| P01 | Asha Rao | Principal | principal | Logged-in user for Firm screenshots |
| P02 | Vikram Nair | Project architect | pm | PM of PRJ-01, PRJ-03; approver of returned timesheet |
| P03 | Meera Iyer | Project architect | pm | PM of PRJ-02 |
| P04 | Rohan Shetty | Senior architect | staff | Logged-in user for Team screenshots |
| P05 | Divya Menon | Architect | staff | Approved leave causing a 2 h conflict |
| P06 | Karan Bhat | Architect | staff | Time on NTE component |
| P07 | Sneha Pillai | Designer | staff | Part time, 4 days |
| P08 | Arjun Das | Architect | staff | Returned timesheet line |
| P09 | Nisha Kumar | Intern | staff | Missing cost rate → incomplete indicator |
| P10 | Farah Khan | Operations | operations + finance | Billing preparer |

| Project | Client | Contract | Status | Shows |
| --- | --- | --- | --- | --- |
| PRJ-01 Lakeview Residence | Lakeview Trust | Fixed fee ₹24,00,000, 6 phases | Active | Fixed-fee claim ₹80,000; phase Working drawings 200 h budget / 170 h actual / 60 h ETC (overrun) |
| PRJ-02 Orchard Commercial Block | Orchard Developers | 6% of ₹8,00,00,000 + hourly NTE ₹1,00,000 | Active | NTE exception: eligible ₹4,000, excess ₹2,000 |
| PRJ-03 Heritage Cafe Refit | Heritage Hospitality | Fixed fee ₹6,00,000 | On hold | Hold banner, retained allocations |

Other mock records: an employee expense (₹1,850 taxi, receipt), a structural consultant bill (₹2,50,000, 10% markup), one approved billing draft, one finalized invoice INV-DEMO-0007 ₹1,60,000 unpaid 40 days, and an approval inbox with 14 items across all types.

### 2.3 Vocabulary to use in labels

Person, project, phase, fee component, allocation (planned hours), task, time entry, timesheet, approval, expense, consultant bill, billing draft, invoice, settlement, withholding, entitlement, estimate to complete (ETC), delivery progress. "Restricted" is the only word for fenced confidential values.

## 3. Design principles

The interface should feel like a precision drafting instrument: calm, layered, translucent surfaces over a quiet gradient, set in Geist, with dense but legible data and no decoration that is not information.

1. **Glass over a plane, not glass everywhere.** One soft background plane and a small number of frosted panels above it: sidebar, top bar, summary cards, sheets, popovers. Data tables, forms and grids sit on solid surfaces.
2. **Grid first.** 8 px baseline, 12-column layout, 32 px page gutters on desktop. Card edges, table columns and headers align across screens.
3. **Hierarchy by weight and tone, not size.** Body 14 px; titles rarely above 22 px; weight 600 and tracking carry hierarchy. Secondary text uses `--ink-2`, never a smaller size alone.
4. **Numbers are first-class.** Tabular figures everywhere; Geist Mono for any value a reader compares; right-aligned numeric columns; units in headers, not cells.
5. **One status language.** Five semantic colours mean the same thing on every chip, dot, bar segment and planner cell.
6. **Context stays visible.** Create and edit happen in a right-hand glass sheet over the list, not in a modal.
7. **Confidential data is visibly fenced.** Restricted values render as a hatched cell with a lock glyph and a tooltip. Never blank, never zero.
8. **Incomplete data is a state.** A dotted amber ring on any metric with missing inputs, with a tooltip naming what is missing.
9. **Motion is physical and short.** 150–220 ms ease-out for sheets, row expansion and status changes. No ambient animation, no bouncing.
10. **Empty states lead somewhere.** Every empty list shows one sentence and one primary action.
11. **Architects will notice.** Optical alignment of icons to text, consistent 1 px rules, no mixed radii on one surface, no drop shadows on solid surfaces.

## 4. Typography — Geist

Install `geist` (Vercel's package) or `@fontsource/geist-sans` + `@fontsource/geist-mono`; set `font-feature-settings: "tnum" 1, "cv11" 1` on `html` so every number is tabular.

```css
:root {
  --font-sans: "Geist Sans", "Geist", system-ui, -apple-system, sans-serif;
  --font-mono: "Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
}
html { font-family: var(--font-sans); font-feature-settings: "tnum" 1, "cv11" 1; -webkit-font-smoothing: antialiased; }
```

| Token | Font | Size / line | Weight | Tracking | Use |
| --- | --- | --- | --- | --- | --- |
| `--text-display` | Sans | 28 / 34 px | 600 | −0.02em | Overview greeting, dashboard titles |
| `--text-h1` | Sans | 22 / 28 px | 600 | −0.015em | Screen titles in PageHeader |
| `--text-h2` | Sans | 17 / 24 px | 600 | −0.01em | Card and section titles |
| `--text-h3` | Sans | 14 / 20 px | 600 | 0 | Table group headers, sheet section titles |
| `--text-body` | Sans | 14 / 20 px | 400 | 0 | Default |
| `--text-body-sm` | Sans | 13 / 18 px | 400 | 0 | Table cells, dense lists |
| `--text-label` | Sans | 12 / 16 px | 500 | +0.04em, uppercase | Field labels, column headers, chip text |
| `--text-caption` | Sans | 12 / 16 px | 400 | 0 | Helper text, timestamps |
| `--text-numeric` | Mono | 13 / 18 px | 500 | 0 | Hours, amounts, percentages, codes in tables |
| `--text-kpi` | Mono | 24 / 28 px | 500 | −0.01em | KPI tile values |
| `--text-timer` | Mono | 15 / 20 px | 500 | 0 | Running timer digits |

Rules: never below 12 px; INR formatted `₹4,00,000` with `Intl.NumberFormat('en-IN')`; hours as `6.50 h`; percentages with no decimals unless under 10%; dates `06 Nov 2026`, times `14:30`.

## 5. Colour, surface and glass tokens

All colours are CSS custom properties on `:root`; dark mode overrides them under `@media (prefers-color-scheme: dark)` guarded by `:root:not([data-theme="light"])` and again under `:root[data-theme="dark"]`.

### 5.1 Tokens

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--bg-plane` | `radial-gradient(1200px 800px at 20% -10%, #e8eef7 0%, #f4f6f9 45%, #eef1f5 100%)` | `radial-gradient(1200px 800px at 20% -10%, #1b2230 0%, #0f141c 45%, #0b0f15 100%)` | Page background, fixed, never scrolls |
| `--bg-plane-accent` | `radial-gradient(600px 400px at 85% 110%, rgba(47,111,237,0.10), transparent 70%)` | `radial-gradient(600px 400px at 85% 110%, rgba(107,156,255,0.12), transparent 70%)` | Second, faint glow layered over the plane |
| `--glass-1` | `rgba(255,255,255,0.55)` | `rgba(24,30,40,0.55)` | Sidebar, top bar, cards |
| `--glass-2` | `rgba(255,255,255,0.72)` | `rgba(30,37,48,0.72)` | Sheets, popovers, command palette |
| `--glass-edge-in` | `rgba(255,255,255,0.65)` | `rgba(255,255,255,0.08)` | Inner top highlight |
| `--glass-edge-out` | `rgba(15,23,42,0.08)` | `rgba(0,0,0,0.5)` | Outer border |
| `--surface` | `#ffffff` | `#141a23` | Tables, forms, grids |
| `--surface-muted` | `#f3f5f8` | `#1b222c` | Zebra rows, input background |
| `--surface-raised` | `#ffffff` | `#1a212b` | Hover row, selected card |
| `--ink-1` | `#0f172a` | `#eef2f7` | Primary text |
| `--ink-2` | `#475569` | `#a7b1c0` | Secondary text |
| `--ink-3` | `#94a3b8` | `#6b7686` | Placeholder, disabled |
| `--line` | `rgba(15,23,42,0.08)` | `rgba(255,255,255,0.08)` | Dividers, table rules |
| `--line-strong` | `rgba(15,23,42,0.16)` | `rgba(255,255,255,0.16)` | Input borders |
| `--accent` | `#2f6fed` | `#6b9cff` | Primary buttons, focus ring, active nav, links |
| `--accent-ink` | `#ffffff` | `#0b0f15` | Text on accent |
| `--accent-soft` | `rgba(47,111,237,0.12)` | `rgba(107,156,255,0.18)` | Selected rows, active chips, today column |
| `--ok` / `--ok-soft` | `#1f9d63` / `rgba(31,157,99,0.14)` | `#3fcf8e` / `rgba(63,207,142,0.18)` | Approved, settled, done, on track |
| `--warn` / `--warn-soft` | `#d98a0b` / `rgba(217,138,11,0.14)` | `#f2b03d` / `rgba(242,176,61,0.18)` | Tentative, pending, returned, incomplete data |
| `--danger` / `--danger-soft` | `#d64545` / `rgba(214,69,69,0.14)` | `#ff7070` / `rgba(255,112,112,0.18)` | Rejected, overdue, conflict, overrun, blocked |
| `--info` / `--info-soft` | `#5b6cff` / `rgba(91,108,255,0.14)` | `#8f9bff` / `rgba(143,155,255,0.18)` | Submitted, in review, sent |
| `--neutral` / `--neutral-soft` | `#7c8797` / `rgba(124,135,151,0.14)` | `#8b95a5` / `rgba(139,149,165,0.18)` | Draft, planned, archived, on hold |
| `--restricted` | `repeating-linear-gradient(45deg, var(--line) 0 4px, transparent 4px 8px)` | same | Fenced confidential cells |

### 5.2 Glass recipe

```css
.glass {
  background: var(--glass-1);
  backdrop-filter: blur(18px) saturate(160%);
  -webkit-backdrop-filter: blur(18px) saturate(160%);
  border: 1px solid var(--glass-edge-out);
  box-shadow:
    inset 0 1px 0 var(--glass-edge-in),
    0 1px 2px rgba(15,23,42,0.04),
    0 12px 32px -12px rgba(15,23,42,0.18);
  border-radius: var(--radius-lg);
}
.glass--elevated {
  background: var(--glass-2);
  box-shadow: inset 0 1px 0 var(--glass-edge-in), 0 24px 64px -16px rgba(15,23,42,0.28);
}
.glass--bar { border-radius: 0; border-width: 0 0 1px 0; box-shadow: inset 0 1px 0 var(--glass-edge-in); }
@supports not (backdrop-filter: blur(1px)) { .glass, .glass--elevated { background: var(--surface); } }
@media (prefers-reduced-transparency: reduce) { .glass, .glass--elevated { background: var(--surface); backdrop-filter: none; } }
```

Rules: blur ≤ 20 px; glass never stacks more than two deep (sheet over sidebar is the maximum); glass panels sit on `--bg-plane`, never on another solid surface; text on glass must pass AA against the darkest gradient region; the page background is `position: fixed` so glass has something to refract while content scrolls.

## 6. Spacing, radius, elevation, motion

| Token | Value |
| --- | --- |
| Spacing scale | `--s-1` 4 · `--s-2` 8 · `--s-3` 12 · `--s-4` 16 · `--s-5` 20 · `--s-6` 24 · `--s-8` 32 · `--s-10` 40 · `--s-12` 48 · `--s-16` 64 px |
| `--radius-sm` / `-md` / `-lg` / `-xl` / `-pill` | 6 / 10 / 14 / 20 / 999 px (chips and timer pill use `-pill`) |
| Control heights | 36 px default; 32 px dense (inside tables); 40 px primary CTA; 28 px chip |
| Focus ring | `0 0 0 2px var(--surface), 0 0 0 4px var(--accent)`; visible on `:focus-visible` only |
| Page gutter | 32 px ≥1280; 24 px 1024–1279; 16 px below |
| Sidebar | 248 px expanded, 64 px collapsed; glass; sticky full height |
| Top bar | 56 px; glass bar |
| Right sheet | 480 px (forms), 640 px (detail/review); elevated glass; 24 px padding; sticky footer 64 px |
| Table row | 40 px comfortable, 32 px dense; header 36 px sticky |
| Card padding | 20 px; KPI tile 16 px |
| Elevation on solid surfaces | none; use `--line` borders only |
| Motion | `--ease: cubic-bezier(0.2, 0.8, 0.2, 1)`; `--dur-1` 150 ms (hover, chip), `--dur-2` 200 ms (sheet, popover), `--dur-3` 220 ms (row expand, status change) |
| Reduced motion | all transitions → 0 ms; sheets appear without slide |
| Icons | 16 px in tables and chips, 20 px in nav and buttons; stroke 1.5; one icon set only (Lucide) |

## 7. Component inventory

Build every component below in `apps/web/src/ui/<Component>/` with `index.tsx`, `<Component>.stories.tsx` and a test; nothing else may be used on a screen.

### 7.1 Shell and navigation

| Component | Props / variants | States | Notes |
| --- | --- | --- | --- |
| `AppShell` | `interface: 'firm' \| 'team'` | — | Fixed `--bg-plane` + `--bg-plane-accent`; glass `SideNav` left; glass `TopBar`; scrollable content with page gutter |
| `SideNav` | sections, items with icon/label/badge, `collapsed` | active, hover, badge count, collapsed tooltip | Sections: Work, People, Commercial, Insights, Settings (Firm); Home, Work, Schedule, Time, Expenses, Leave (Team). Interface switcher at bottom for multi-role users |
| `TopBar` | search trigger (⌘K), notifications, timer slot, avatar menu | timer idle/running | Breadcrumb lives in PageHeader, not here |
| `PageHeader` | title, breadcrumb, meta chips, primary action, secondary actions, `tabs[]`, period navigator slot | sticky, collapsed on scroll (meta hidden) | Title `--text-h1`; tab strip underline in `--accent` |
| `CommandPalette` | actions: navigate, create, log time, request leave, search people/projects | open, empty, loading | `.glass--elevated`, 640 px, fuzzy match, keyboard only |
| `BottomTabBar` (mobile Team) | Home, Work, Time, Schedule, More | active | Glass bar |

### 7.2 Data display

| Component | Props / variants | States | Notes |
| --- | --- | --- | --- |
| `DataTable` | columns (type: text/number/money/hours/date/status/person/restricted), `density`, sortable, column picker, sticky header, row selection, grouped rows, totals row, inline edit cells, row actions | loading skeleton (8 rows), empty, error, permission-denied | Solid `--surface`; zebra `--surface-muted`; numeric right-aligned mono; hover `--surface-raised`; selected `--accent-soft` |
| `FilterBar` | chips (select, multi, date range, search), saved views, clear all | active count | Writes to URL params; chips `--radius-pill` |
| `StatusChip` | `status` (from section 10), `size: sm\|md`, dot only | — | Soft background + ink colour from mapping; 28 px |
| `QueueCard` | count, label, severity (ok/warn/danger/neutral), trend, `restricted`, onClick | hover lift 1 px, restricted hatch | Glass; count in `--text-kpi` |
| `KpiTile` | value, unit, label, delta, `complete`, `missing[]`, `restricted` | incomplete ring, restricted | Glass; `IncompleteIndicator` wraps value |
| `BudgetBar` | baseline, revised, actual, forecast (hours); `showCost` | overrun hatch beyond budget in `--danger-soft` | Segments: actual solid `--accent`, ETC `--accent-soft`, overrun hatch; baseline tick |
| `EntitlementBar` | contracted, entitled, drafted, invoiced, collected | — | Five stacked segments neutral→ok, legend below, amounts in mono |
| `EffectiveDatedList` | versions\[\] with from/to, current index | current highlighted, future dashed, past muted | Vertical timeline with 1 px rail |
| `ActivityFeed` | events grouped by day; `sensitive` | redacted lock | Actor avatar 20 px, action, previous→new |
| `Avatar` / `AvatarGroup` | initials, size 20/28/36, `+n` | — | Two-letter initials on `--neutral-soft` |
| `RestrictedCell` | `reason` | — | `--restricted` hatch, lock icon 14 px, tooltip "Requires finance permission" |
| `IncompleteIndicator` | `missing[]` | — | Dotted 2 px `--warn` ring around value; tooltip lists missing inputs |
| `ConflictBanner` | kind: overallocated/unavailable/outside employment, hours over, reason field | inline | `--danger-soft` background, 1 px `--danger` left rule |
| `GanttStrip` | phases with start/end/status, today line | hover phase | Compact 24 px rows on solid surface; used above Phases table |
| `MiniChart` | bar, line, donut (ageing) | — | Only `--accent`, `--ok`, `--warn`, `--danger`, `--neutral` |

### 7.3 Input and forms

| Component | Props / variants | States |
| --- | --- | --- |
| `Sheet` | `size: 480\|640`, title, description, sticky footer with primary/secondary | open/close slide 200 ms; focus trap; Escape closes; unsaved-change confirm |
| `Form` | sections with `--text-h3` headers, 16 px field gap, two-column on 640 | — |
| `TextField`, `TextArea` | label (uppercase `--text-label`), helper, error, prefix/suffix, `dense` | default, focus, error, disabled, read-only |
| `NumberField`, `MoneyField` (₹ prefix, en-IN), `DurationField` (h:mm, mono), `PercentField` | same | same + mono value |
| `DateField`, `DateRangeField` | calendar popover (glass), min/max, holiday shading | same |
| `Select`, `Combobox`, `MultiSelect` | options with icon/chip, search, create option | same + open |
| `Segmented` | 2–4 options | active |
| `Toggle`, `Checkbox`, `Radio` | label, description | checked, indeterminate, disabled |
| `FileDrop` | accept, multiple, preview thumbnail | idle, dragover (`--accent-soft`), uploading progress, error |
| `PersonPicker`, `ProjectPhasePicker` | search, recent, avatar rows | open, empty |
| `Button` | `variant: primary\|secondary\|ghost\|danger`, `size`, icon, loading | hover, active, disabled, loading spinner |
| `IconButton` | tooltip required | same |

### 7.4 Planning and time

| Component | Props / variants | States |
| --- | --- | --- |
| `PlannerGrid` | rows (people grouped by team, unassigned demand pinned), columns (weeks; day zoom), `allocations[]`, `availability[]`, today marker, drag to move, resize to change hours, cell click → sheet | tentative card dashed outline; confirmed solid `--accent-soft` with `--accent` left rule; conflict cell `--danger-soft` with badge; leave/holiday cells hatched `--neutral-soft`; published badge on cards; virtualized |
| `AvailabilityBar` (inside planner cell) | scheduled, holiday, leave, commitments, allocated | — |
| `TimesheetGrid` | rows = project/phase/task lines + internal lines, columns = days, totals row/column, add-line row, keyboard navigation | locked (submitted) rows with lock glyph; returned rows `--warn-soft` with reason tooltip; unclassified rows `--danger-soft`; day total ring at column foot |
| `TimerPill` | idle / running (elapsed mono), context label | running pulse only on the dot, 1 px; warning tint after 10 h |
| `DayTotalRing` | hours vs scheduled | ok / over 12 h `--warn` |

### 7.5 Approval and feedback

| Component | Props / variants | States |
| --- | --- | --- |
| `ApprovalRow` | type icon, submitter, project, period, amount/hours, exception badge, age, approver, actions (approve/return/delegate) | exception rows `--warn` left rule and unselectable in batch; hover shows actions |
| `PreviewPane` | record summary, evidence thumbnails, history | loading, empty |
| `Toast` | success/warn/danger/info, action | auto-dismiss 4 s, pause on hover |
| `InlineAlert` | same variants, title, body, links | dismissible |
| `EmptyState` | icon, one sentence, primary action | — |
| `ErrorState` | message, retry | — |
| `PermissionDenied` | capability name, contact admin | — |
| `Skeleton` | text, table, card, planner | shimmer only if motion allowed |
| `Tooltip` | text, side | glass elevated, 8 px padding |
| `Popover` / `Menu` | items with icon, danger items | glass elevated |

## 8. Layout patterns

Every screen is one of seven patterns; a new screen must pick one rather than invent a layout.

| Pattern | Structure (top → bottom) | Column rules | Used by |
| --- | --- | --- | --- |
| **Shell** | Fixed plane → glass sidebar 248 px → glass top bar 56 px → content with 32 px gutter, max width 1440 px centred | Content uses 12 columns, 24 px gutters | All |
| **Queue dashboard** | PageHeader (display title + date) → 6 `QueueCard`s in one row (wrap to 3+3 under 1280) → two columns 7/5: attention list (solid) left, KPI tiles and `MiniChart`s right | Cards equal height | Firm Overview, My day |
| **List** | PageHeader with primary action → `FilterBar` → `DataTable` full width → row click opens `Sheet` or navigates | Table bleeds to gutter edge, 1 px top rule | People, Projects, Pipeline (list mode), Approvals, Billing, Receivables |
| **Workspace** | PageHeader with meta chips and tab strip → tab panel; Overview tab = KPI tile row (4–6 glass tiles) → `GanttStrip` or summary bar → two columns 8/4 (main table, attention list) | Tabs persist in URL | Project workspace, Person profile, Proposal detail |
| **Planner** | PageHeader with week navigator, zoom segmented, filters, Publish button → full-bleed `PlannerGrid` (no gutter) → selected cell opens `Sheet` 480 | Grid height fills viewport minus header | Resource planner, Project Staffing, My schedule |
| **Grid entry** | PageHeader with period navigator and Submit → `TimerPill` row → `TimesheetGrid` → footer: validation summary + totals | Grid full width | My time |
| **Wizard** | Left glass step rail 280 px (steps with done/current/upcoming) → right solid panel with one step's form → sticky footer Back / Save and continue → final Review step | Rail collapses to top stepper under 1024 | Firm setup, Import, Add person, Create project, Generate billing draft |
| **Settings** | Left glass sub-nav 240 px → right solid form sections with `--text-h3` headers and 32 px section gap | — | Firm settings, My profile |

Board variants (Pipeline Kanban, Tasks board) reuse the List pattern with a `Segmented` list/board toggle in the PageHeader; columns are 280 px glass cards on the plane with solid task cards inside.

## 9. Screen-by-screen specifications

28 screens, each with its route, pattern, regions, interactions, and the mock data it must show; screenshot each in light and dark at 1440 px (and 390 px for Team screens).

### 9.1 Firm interface

| Screen | Route | Pattern | Regions (top → bottom, left → right) | Interactions and states | Mock data to show |
| --- | --- | --- | --- | --- | --- |
| Overview | `/firm/overview` | Queue dashboard | "Good afternoon, Asha" + date; six `QueueCard`s: Missing time 3, Pending approvals 14, Overallocations 1, Overrun forecasts 1, Billing holds 1, Overdue invoices 1; left attention list sorted severity→age; right: Ready to bill ₹4,86,000 tile, receivables ageing donut | Card click navigates to filtered list; restricted tiles for non-finance | PRJ-01 overrun row; P05 conflict row; INV-DEMO-0007 overdue 40 d |
| People directory | `/firm/people` | List | Search; status `Segmented` Active/Invited/Pending/Deactivated; filter chips manager/office/skill/project/type; table: person (avatar+name+title), manager, office, type, status chips, projects (AvatarGroup), actions | Add person → wizard sheet 480; row → profile | 10 people; P09 shows Intern, no projects yet |
| Person profile | `/firm/people/:id` | Workspace | Header: avatar 36, name, title, manager, three status chips (invitation/employment/login); tabs Overview, Access, Projects, Capacity, Leave, Rates, Activity | Rates tab absent for staff viewers; Capacity shows `EffectiveDatedList` + 8 weekly `AvailabilityBar`s; Access shows permission sets + scoped grants + substitute | P05: 40 h scheduled, 8 holiday, 4 leave, 4 commitment, 26 allocated → conflict 2 h |
| Resource planner | `/firm/workload` | Planner | Week navigator (← This week →), zoom Week/Day, filters project/team/skill, Publish plan (3 changes); grid: Unassigned demand row pinned; people grouped PRJ teams; 8 week columns | Drag/resize; conflict cell reason prompt; tentative dashed; today marker | P05 week-3 conflict red; PRJ-03 retained allocations with hold badge; unassigned 5 h on PRJ-01 Concept |
| Pipeline | `/firm/pipeline` | List (board default) | Columns New / Qualified / Proposal / Won / Lost / On hold; cards: client, name, est. fee mono, owner avatar, next action date | Drag between stages; card → proposal | 6 opportunities; one Proposal-stage with next action overdue |
| Proposal detail | `/firm/proposals/:id` | Workspace | Header: client, version chip v3, state chip Accepted, Create project; sections Scope and exclusions, Phases table, Fee components table (method chip), Billing milestones, Terms, Versions timeline (right rail), Acceptance evidence card | Accepted = read-only with lock; Create project → 4-step wizard sheet | Fee components: fixed ₹6,00,000; one hourly NTE ₹1,00,000 |
| Projects list | `/firm/projects` | List | Filters PM/client/stage/status/risk; table: code, name, client, PM avatar, stage, status chip, risk dot, hours `BudgetBar` (mini), next milestone date | Row → workspace | PRJ-01 risk red, PRJ-02 ok, PRJ-03 On hold neutral |
| Project · Overview | `/firm/projects/:id` | Workspace | KPI tiles: Hours 820/1,100 (bar), Delivery 48%, Entitlement bar, Open tasks 17, Conflicts 1, Contribution (restricted for PM); `GanttStrip` of phases; attention list | Contribution hatched for P02, visible for P01 | PRJ-01 |
| Project · Phases | `/firm/projects/:id/phases` | Workspace tab | `GanttStrip`; table: phase, dates, owner, budget h, actual h, ETC h, forecast h, variance, delivery %, fee allocation, status | Edit → sheet; Budget revision → three-column compare Baseline/Revised/Forecast with `BudgetBar` | Working drawings: 200/170/60 → 230, +30 red |
| Project · Tasks | `/firm/projects/:id/tasks` | List (board toggle) | Board columns Planned/Ready/In progress/In review/Done; cards: title, owner avatar, due, priority dot, blocked badge | Task sheet 640: brief, checklist, dependencies, documents, time logged summary + Log time, review thread | 17 tasks; 1 Blocked ("Awaiting structural input") |
| Project · Staffing | `/firm/projects/:id/staffing` | Planner (project-scoped) | Same grid, rows grouped by phase | — | PRJ-01 phases |
| Project · Time | `/firm/projects/:id/time` | Workspace tab | Table person × phase: draft/submitted/approved hours; line approve/return actions for PM | Returned line `--warn-soft` | P08 returned line "wrong phase" |
| Project · Costs | `/firm/projects/:id/costs` | Workspace tab | Table: date, type icon, vendor/person, amount, allocation, approval chip, Payable chip, Recharge chip, markup | Duplicate `InlineAlert` on the second bill | ₹2,50,000 consultant bill (10% markup); ₹1,850 expense |
| Project · Billing | `/firm/projects/:id/billing` | Workspace tab | `EntitlementBar` per fee component; Ready-to-bill table; Drafts list; NTE exceptions panel (eligible / excess mono) | Generate draft → wizard | PRJ-02: eligible ₹4,000, excess ₹2,000 |
| Project · Changes | `/firm/projects/:id/changes` | List | Table: title, state chip, hours Δ, fee Δ, date Δ, authorization | Sheet with estimate form and evidence | One Awaiting authorization change |
| Project · Files / Activity | `/…/files`, `/…/activity` | List / Feed | Linked documents with version chip; `ActivityFeed` | Redacted rate change shows lock | — |
| Approval inbox | `/firm/approvals` | List with queue rail | Rail: All 14, Time 6, Leave 2, Expenses 2, Bills 1, Changes 1, Billing drafts 2; `ApprovalRow` table; right `PreviewPane` 400 px | Batch approve (exceptions excluded, counted in toast); Return opens inline reason; Delegate picker with date range | One exception row (over 12 h day) |
| Billing | `/firm/billing` | List with sub-tabs | Sub-tabs Ready to bill / Drafts / Exceptions / WIP / Accounting; draft detail = two-pane: lines table (source accordion) left, calculation basis panel right; submit dialog names adapter + MOCK badge | Accounting status chip with last success timestamp | Approved PRJ-02 draft; MOCK badge visible |
| Receivables | `/firm/receivables` | List | Ageing segmented bar (Current/30/60/90+) in glass header; table: invoice, client/project, issue, due, gross, cash, withholding, credits, outstanding, dispute chip, follow-up owner/date | Record settlement sheet with `Segmented` Cash/Withholding/Credit | INV-DEMO-0007 ₹1,60,000, 40 d, owner Farah |
| Reports | `/firm/reports/:key` | Workspace-like | Left report list (7); right: definition panel (numerator/denominator text), filters, `MiniChart`, table, completeness `IncompleteIndicator`, Export | Export disabled with tooltip when columns are fenced | Utilization with P09 incomplete; Contribution labelled "management estimate" |
| Settings | `/firm/settings/*` | Settings | Sub-nav Profile, Permissions, Calendars, Work categories, Templates, Approval policies, Integrations, Imports | Integrations card: Not configured / MOCK / CSV / Live; Imports wizard with preview table and inline red error cells | Accounting = MOCK |

### 9.2 Team interface (logged in as Rohan Shetty, P04)

| Screen | Route | Pattern | Regions | Interactions and states | Mock data |
| --- | --- | --- | --- | --- | --- |
| My day | `/me/home` | Queue dashboard | Greeting; cards: Due today 3, Blocked 1, Reviews requested 2, Missing time 2 days, Returned 0, Leave decisions 1; left: today's task list; right: this week's allocation mini bar + quick actions Log time / Start timer / Request leave | Quick actions open sheets | Task "Concept option B — courtyard" due today |
| My work | `/me/work` | List (board toggle) | Groups Overdue / Today / This week / Later; rows: title, project·phase, due, priority, reviewer avatar, status chip; inline Start / Block / Submit for review | Task sheet 640 | 9 tasks across PRJ-01, PRJ-02 |
| My schedule | `/me/schedule` | Planner (single person, day zoom) | 4 weeks; allocation cards with project·phase·hours; leave and holidays hatched; site visit markers | Read-only; card → task list | 20 h Concept design week 2 |
| My time | `/me/time` | Grid entry | Period navigator; `TimerPill` running 01:42 on PRJ-01 Concept; `TimesheetGrid` 5 lines × 7 days; day total rings; Submit with validation summary | Returned row amber; locked rows after submit; correction sheet | Week total 38.5 h; Thursday 12.5 h flagged |
| My expenses | `/me/expenses` | List | Cards: receipt thumbnail, amount mono, project, approval chip, reimbursement chip | New expense sheet with `FileDrop` first, allocation rows with remaining-to-allocate | ₹1,850 Finance approved, reimbursement Pending |
| My leave | `/me/leave` | List + calendar strip | Balance tiles (if configured); 12-week strip with leave/holidays; request table | Request sheet shows affected assignments before submit; cancel on approved | One Approved 2-day request |
| My profile | `/me/profile` | Settings | Work details, manager, working pattern (read-only), editable personal fields | — | P04 details |

### 9.3 Shared overlays

| Overlay | Trigger | Content |
| --- | --- | --- |
| Command palette | ⌘K / Ctrl K | Navigate, Create, Log time, Request leave, Search people and projects |
| Notifications | Bell | Grouped today/earlier; unread dot; mark all read |
| Log time sheet | Any "Log time" | Project·phase·task picker, duration (h:mm), note, date; Save / Save and start timer |
| Request leave sheet | Any "Request leave" | Type, dates, unit, computed hours, affected assignments list, handover note, private reason (lock icon) |
| Permission denied | Any fenced route | Capability name, "Ask Asha Rao (Principal)" |

## 10. Status colour mapping

One file, `apps/web/src/ui/status-colors.ts`, maps every status string to one of five semantic tones; `StatusChip`, planner cells, bar segments and dots all read from it.

| Tone | Token pair | Statuses |
| --- | --- | --- |
| neutral | `--neutral` / `--neutral-soft` | Draft, Planned, Not started, Not sent, Pending start, Archived, On hold, Superseded, Cancelled, Unsent, Not submitted, Not payable, Not eligible, Tentative-plan |
| info | `--info` / `--info-soft` | Submitted, In review, Internal review, Sent, Ready, In progress, Pending (accounting), Reserved, Qualified, Proposal, Awaiting authorization, Identified, Estimated, Cancellation requested |
| warn | `--warn` / `--warn-soft` | Returned, Tentative, Pending (approval), Part-paid, Uncertain, Scope approved, Partially approved, Expired, Suspended, Incomplete data, Delegated |
| ok | `--ok` / `--ok-soft` | Approved, Accepted, Active, Done, Finalized, Settled, Paid, Published, Won, Enabled, Recorded, Billed, Eligible, Delivery complete |
| danger | `--danger` / `--danger-soft` | Rejected, Blocked, Overdue, Disputed, Failed, Revoked, Ended, Lost, Declined, Overallocated, Overrun, Conflict, Excess |

Rules: a status never gets a colour outside these five; "On hold" is neutral (not warn) because it is a chosen state; "Delivery complete" is ok even when invoices are unpaid, because settlement has its own chip.

## 11. Accessibility, responsiveness and fallbacks

- **WCAG 2.1 AA.** Text on glass is tested against the darkest region of `--bg-plane` (light: `#e8eef7`; dark: `#0b0f15`). `--ink-2` on `--glass-1` must still pass 4.5:1; if not, darken `--ink-2` rather than thicken the glass.
- **Keyboard.** Every interactive element reachable by Tab; `PlannerGrid` and `TimesheetGrid` support arrow keys, Enter to edit, Escape to cancel; sheets trap focus and restore it on close; command palette fully keyboard driven.
- **Screen readers.** Grids expose `role="grid"` with row/column headers; status chips have `aria-label` with the status word; `RestrictedCell` announces "restricted, requires finance permission"; `IncompleteIndicator` announces the missing inputs.
- **Breakpoints.** ≥1280 full layout; 1024–1279 sidebar collapses to 64 px, gutters 24 px; 768–1023 sheets go full width, planner shows 4 weeks; <768 Team interface with `BottomTabBar`, Firm interface shows a "Best on a larger screen" banner but Approvals and Overview remain usable.
- **Reduced motion.** All transitions 0 ms; skeleton shimmer off; timer dot static.
- **Reduced transparency / no backdrop-filter.** Glass becomes `--surface` with the same borders; layout unchanged.
- **Dark mode.** Follows system by default; manual toggle in avatar menu writes `data-theme`.
- **Print.** Reports and invoice previews print on white with glass removed and tables un-zebra'd.

## 12. Build sequence for Claude Code

Twenty UI-only tasks, in order; each ships components or screens plus stories, a route where applicable, and screenshots, and Claude Code pauses for review after U-04, U-10 and U-20.

### 12.1 File layout

```text
apps/web/
  src/
    ui/                 design system (one folder per component: index.tsx, *.stories.tsx, *.test.tsx)
      tokens.css        sections 4–6, light + dark
      glass.css         section 5.2
      status-colors.ts  section 10
    layouts/            AppShell, QueueDashboard, ListLayout, WorkspaceLayout, PlannerLayout, GridEntryLayout, WizardLayout, SettingsLayout
    screens/
      firm/             overview, people, person, workload, pipeline, proposal, projects, project/{overview,phases,tasks,staffing,time,costs,billing,changes,files,activity}, approvals, billing, receivables, reports, settings
      me/               home, work, schedule, time, expenses, leave, profile
    mock/               studio-meridian.ts (people, projects, phases, allocations, tasks, time, costs, drafts, invoices, approvals)
    api/                typed functions returning mock data (replace later)
    router.tsx          /firm/* and /me/* trees
  .storybook/
docs/ui-screens/        screenshots light/dark per screen
docs/ui-progress.md     U-01…U-20 status
docs/ui-decisions.md
```

### 12.2 Tasks

| Task | Title | Deliverables | Done when |
| --- | --- | --- | --- |
| U-01 | Scaffold | Vite + React + TS, Router, Storybook, Playwright, Lucide, Geist installed; `tokens.css`, `glass.css` | Storybook shows a token sheet in light and dark |
| U-02 | Primitives | Button, IconButton, all form fields, Toggle/Checkbox/Radio, Segmented, Tooltip, Popover/Menu, Toast, InlineAlert, Skeleton, Avatar | Every state in stories; axe passes |
| U-03 | Data display | DataTable (all states), FilterBar, StatusChip, QueueCard, KpiTile, RestrictedCell, IncompleteIndicator, EmptyState, ErrorState, PermissionDenied, ActivityFeed, EffectiveDatedList, BudgetBar, EntitlementBar, GanttStrip, MiniChart | Stories with Studio Meridian mock rows |
| U-04 | Shell | AppShell, SideNav, TopBar, PageHeader, Sheet, CommandPalette, BottomTabBar; router with placeholder screens | **Review stop 1:** screenshots of shell light/dark, desktop/mobile |
| U-05 | Mock data | `studio-meridian.ts` with all section 2 and 9 records; `api/` functions | Type-checked; used by stories |
| U-06 | Firm Overview | Queue dashboard screen | Six cards, attention list, KPI tiles match section 9 |
| U-07 | People directory + Add person wizard | List + wizard sheet | Filters in URL; wizard four steps |
| U-08 | Person profile | Workspace with seven tabs; AvailabilityBar | P05 conflict numbers render; Rates tab absent for staff |
| U-09 | Approval inbox | Queue rail, ApprovalRow, PreviewPane, batch, return, delegate | Exception row excluded from batch |
| U-10 | Projects list + Project Overview | List; Workspace Overview with tiles and GanttStrip | **Review stop 2** |
| U-11 | Project Phases + budget compare | Phases tab; three-column compare sheet | Overrun hatch shows +30 h |
| U-12 | Project Tasks + task sheet | Board/list; 640 sheet | Blocked badge; review thread |
| U-13 | PlannerGrid + Resource planner + Project Staffing + My schedule | Virtualized grid; drag/resize; conflict prompt | Keyboard navigable; P05 conflict red |
| U-14 | Project Time, Costs, Changes, Files, Activity | Five tabs | Returned line, duplicate alert, redacted audit |
| U-15 | Pipeline + Proposal detail | Board; Workspace; Create project wizard | Accepted version locked |
| U-16 | Billing + Project Billing | Sub-tabs; draft two-pane; NTE panel; submit dialog with MOCK badge | Eligible ₹4,000 / excess ₹2,000 visible |
| U-17 | Receivables | Ageing bar; table; settlement sheet | Cash, withholding, credits, outstanding as four columns |
| U-18 | Reports + Settings | Report shell with definition panel; settings sub-nav; integrations card; import wizard | Export disabled tooltip; MOCK card |
| U-19 | Team: My day, My work, My time (TimesheetGrid, TimerPill), My expenses, My leave, My profile | Six screens; log-time and request-leave sheets | 390 px screenshots with BottomTabBar |
| U-20 | Polish pass | Alignment audit (8 px grid overlay), contrast report, reduced-motion/transparency check, dark-mode pass on every screen, consistent empty states | **Review stop 3:** all 28 screens light/dark in `docs/ui-screens/` |

### 12.3 Acceptance checks (run, not just written)

- [ ] Computed `font-family` on body resolves to Geist Sans; numbers use tabular figures (visual check on a table).
- [ ] Storybook accessibility addon reports zero contrast failures across all stories in both themes.
- [ ] With `backdrop-filter` disabled in DevTools, every glass panel falls back to `--surface` with no layout shift.
- [ ] With `prefers-reduced-motion`, sheets open without animation.
- [ ] `PlannerGrid` and `TimesheetGrid` are fully operable with the keyboard (Playwright test).
- [ ] No colour literal appears in any `screens/` file (lint rule: hex/rgb disallowed outside `tokens.css`).
- [ ] Every `DataTable` on every screen has a story or route for loading, empty, error and permission-denied.
- [ ] `RestrictedCell` appears on Contribution tile when viewing as P02; the tile shows a value when viewing as P01 (mock "view as" switch in TopBar avatar menu).
- [ ] All 28 screens have light and dark screenshots at 1440 px; Team screens also at 390 px.
