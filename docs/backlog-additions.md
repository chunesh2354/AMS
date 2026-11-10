# Backlog additions: F18 to F20

Proposed 08 Nov 2026 as an extension of the engineering specification (sections 8, 10 and 13), using its formats. Nothing here is built yet. Every item is **P1** and **Missing**, and ships schema, API, permissions, UI and tests together, like every other task in section 13.

These three were chosen because they are specific to architecture practice and general project tools handle them badly. Validate them with two or three studios before building, and drop any they would not use.

## Scope boundary

Section 2.3 puts "construction document control" out of scope. F18 stays inside that boundary: it records sheets, revisions and transmittals and **links** to files where they already live. It does not store or version drawing files, mark them up or read CAD/BIM. If a studio wants file storage, that remains a later decision.

## New glossary terms (section 4)

| Term | Meaning | Not to be confused with |
| --- | --- | --- |
| Drawing sheet | One numbered drawing in a project's register, such as A-101 | A file or a document link |
| Revision | An immutable version of a sheet with its own code, date and change note | A budget revision or a contract version |
| Transmittal | A record of which revisions were issued to whom, when and for what purpose | An email or a notification |
| Issue purpose | Why a revision was sent: firm-configured list, such as Information, Approval, Tender, Construction | A status |
| Authority submission | One application to a statutory body for one approval, with its queries and outcome | A phase or a task |
| Benchmark | A reference figure from the firm's own past projects, such as hours per unit of area for a phase | A target or a budget |

## New entities (section 8)

| Entity | Key fields | Relationships | Status enum |
| --- | --- | --- | --- |
| `DrawingSheet` | project\_id, phase\_id?, sheet\_no (unique per project), title, discipline (firm list), current\_revision\_id | Project; Revisions | Active/Withdrawn |
| `DrawingRevision` (immutable once Issued) | sheet\_id, revision\_code, revision\_date, change\_note, document\_link, prepared\_by, checked\_by, checked\_at | Sheet; TransmittalItems | Draft/Checked/Issued/Superseded |
| `Transmittal` (immutable once Issued) | project\_id, transmittal\_no (unique per project), issue\_purpose\_id, issued\_by, issued\_at, method, note | Items; Recipients | Draft/Issued |
| `TransmittalItem` | transmittal\_id, revision\_id, copies | — | — |
| `TransmittalRecipient` | transmittal\_id, contact\_id or vendor\_id, acknowledged\_at, acknowledged\_by | Contact, Vendor | — |
| `IssuePurpose` | key, name, requires\_checked (boolean), active | Firm | — |
| `AuthoritySubmission` | project\_id, phase\_id, authority\_name, approval\_type\_id, reference\_no, responsible\_id, submitted\_on, next\_action, next\_action\_date, granted\_on, valid\_until, evidence\_links\[\] | Project, Phase; Events | Not submitted/Submitted/Query raised/Approved/Rejected/Expired/Withdrawn |
| `AuthorityEvent` | submission\_id, kind (submitted/query/response/decision/note), at, summary, evidence\_link, due\_date? | Submission | — |
| `ApprovalType` | name, typical\_days? (firm-entered, optional), reminder\_days\_before\_expiry? | Firm | — |
| `Project` (new fields) | built\_up\_area numeric(12,2)?, area\_unit (firm setting), typology\_id?, scope\_kind (firm list, such as new build, interior, refit) | Typology | — |
| `Typology` | name, parent\_id?, active | Firm | — |
| `BenchmarkSnapshot` (read model) | as\_of, typology\_id, scope\_kind, phase\_template\_key, metric (hours\_per\_area, fee\_per\_area, duration\_weeks), p25, median, p75, sample\_size, excluded\_count, missing\[\] | — | — |

Constraints: `drawing_revision` unique (sheet\_id, revision\_code); trigger rejecting UPDATE of an Issued revision's code, date, link or note; `transmittal` trigger rejecting changes after Issued; `authority_submission.valid_until >= granted_on`; `project.built_up_area > 0` when present.

## New status words (section 10)

Reuse the existing tones: Superseded, Withdrawn, Not submitted are neutral; Checked, Submitted are info; **Query raised** (new) and Expired are warn; Issued, Approved, Acknowledged (new) are ok; Rejected is danger. Add the two new words to `status-colors.ts`.

## New capabilities (section 5.2)

| Capability | principal | operations | pm | staff | finance |
| --- | --- | --- | --- | --- | --- |
| `drawings.manage` (sheets, revisions) | Y | N | S | S (projects they work on, Draft only) | N |
| `drawings.check` | Y | N | S | G | N |
| `drawings.issue` (transmittals) | Y | N | S | N | N |
| `authority.manage` | Y | Y | S | N | View |
| `benchmarks.hours.view` | Y | Y | Y | N | Y |
| `benchmarks.fee.view` | Y | N | G | N | Y |

`benchmarks.fee.view` is fenced like `margin.view`: fee-per-area figures pass through the serializer (section 5.3 rule 2), and a fee benchmark built from fewer than 3 projects is shown as restricted to anyone without the capability (rule 3, applied to projects instead of people).

## New rules

| # | Rule | Enforced in | Test |
| --- | --- | --- | --- |
| R25 | An issued revision or transmittal never changes; corrections are a new revision or a new transmittal | DB triggers; service checks | AT-21 |
| R26 | An issue purpose marked `requires_checked` accepts only Checked revisions, and issuing a superseded revision needs an explicit override reason (audited) | `transmittals.issue()` | AT-21 |
| R27 | An authority query, rejection or expiry raises an attention item and a notification; it never moves phase or task dates by itself | `authority` service emits events only | AT-22 |
| R28 | No authority names, approval types, timelines or fees are hard-coded; all are firm-entered (extends R24) | Seed and settings | AT-20 |
| R29 | Benchmarks use only projects marked Delivery complete or Archived with a recorded area; every benchmark shows its sample size and the projects excluded and why; missing area or hours is listed, never treated as zero (extends R22) | `reporting.benchmarks()` | AT-23 |
| R30 | A benchmark is shown beside a proposal estimate as reference only; it never fills a fee or a budget automatically | Proposal UI | AT-23 |

## Module specifications

### F18 · Drawing register and transmittals — P1

**Outcome:** the studio always knows the current revision of every sheet and exactly what was issued to whom, when, and why.

- **Roles:** PM and leads manage the register and issue transmittals; staff draft revisions on their projects; a checker (reviewer) marks revisions Checked.
- **Screens:** Project workspace → **Drawings** tab (new; route `/firm/projects/:id/drawings`), and Team → My work shows "revisions to check".
- **Fields:** see `DrawingSheet`, `DrawingRevision`, `Transmittal`.
- **States:** revision Draft→Checked→Issued→Superseded (superseded automatically when a newer revision of the same sheet is issued); transmittal Draft→Issued.
- **API:** `GET/POST /projects/:id/drawings`, `POST /drawings/:id/revisions`, `POST /revisions/:id/check`, `GET/POST /projects/:id/transmittals`, `POST /transmittals/:id/issue`, `POST /transmittals/:id/acknowledge`, `GET /projects/:id/drawings/register.csv`.
- **Rules:** R25, R26; a revision's document link is a URL to the firm's existing storage; issuing writes AuditEvent; a recipient sees nothing in the product until the client portal (F16) exists.
- **UI:** register `DataTable` grouped by discipline: sheet no. (mono), title, current revision chip, status, last issued for and date; revision history as `EffectiveDatedList`; transmittal sheet 640 picks revisions with a checkbox table, purpose `Select`, recipients `MultiSelect`, and warns inline when a revision is not Checked or is superseded.
- **Acceptance:** AC-F18-1 issuing A-101 rev C for Construction when rev C is Draft → 422 R26. AC-F18-2 issuing rev D marks rev C Superseded and leaves the earlier transmittal pointing at rev C. AC-F18-3 PUT on an issued transmittal → 409. AC-F18-4 the register export lists every sheet with its latest issued revision and purpose. AC-F18-5 staff cannot issue (403).
- **Depends on:** F06, F09, F17 audit.

### F19 · Statutory approvals tracker — P1

**Outcome:** every authority submission is visible with its next action, so approval delays are seen early instead of discovered late.

- **Roles:** PM owns submissions on their projects; operations may manage on behalf; principals see all.
- **Screens:** Project workspace → **Approvals (authority)** section on the Phases tab, plus a firm-wide list at `/firm/authority` (new) and attention items on Firm Overview.
- **Fields:** see `AuthoritySubmission`, `AuthorityEvent`, `ApprovalType`.
- **States:** Not submitted→Submitted→Query raised⇄Submitted→Approved|Rejected; Approved→Expired when `valid_until` passes; any open state→Withdrawn.
- **API:** `GET/POST /projects/:id/authority-submissions`, `POST /authority-submissions/:id/events`, `POST /authority-submissions/:id/{submit|record-query|respond|approve|reject|withdraw}`, `GET /authority-submissions?status&due_before`.
- **Rules:** R27, R28; tasks can reference a submission as their blocker, so "Blocked: awaiting fire NOC" links to the record instead of free text; reminders before `next_action_date` and before expiry follow the notification dedupe rule.
- **UI:** list with authority, approval type, phase, status chip, responsible avatar, next action and date (overdue in danger), days open (mono); detail sheet 640 with an `ActivityFeed` of events and evidence links.
- **Acceptance:** AC-F19-1 recording a query creates one attention item for the PM and leaves phase dates unchanged. AC-F19-2 an approval with `valid_until` in the past shows Expired and raises one reminder only. AC-F19-3 a task blocked by an open submission shows the submission's status. AC-F19-4 no approval type exists in a new firm until one is entered (R28).
- **Depends on:** F06, F09, F11 notifications.

### F20 · Project size and fee benchmarks — P1

**Outcome:** principals price a new proposal from the studio's own history: hours and fee per unit of area by building type and phase.

- **Roles:** hours benchmarks for principals, operations, PMs and finance; fee benchmarks for principals and finance (fenced).
- **Screens:** Project create and Overview get area, typology and scope fields; Reports → **Benchmarks** (new report key `benchmarks`); Proposal detail shows a reference panel beside the phases and fee tables.
- **Calculations:** hours per area = phase actual hours (approved plus imported opening hours) ÷ built-up area; fee per area = contracted fee for the phase ÷ area; percentiles over the eligible projects; durations from phase start and end.
- **API:** `PUT /projects/:id/profile` {built\_up\_area, typology\_id, scope\_kind}, `GET /reports/benchmarks?typology&scope&phase`, `GET /proposals/:id/benchmark-reference`.
- **Rules:** R29, R30, R22; area unit is a firm setting (sq ft or m²), never assumed; importing past projects (F01 import wizard) gains area and typology columns so history counts from day one.
- **UI:** report with definition panel (numerator, denominator, eligibility), a `MiniChart` bar per phase showing p25, median and p75, sample size and excluded projects with reasons; the proposal panel reads "Reference from 6 similar projects" and never fills a field.
- **Acceptance:** AC-F20-1 a project with no area is excluded and listed as excluded, not counted as zero. AC-F20-2 a PM without `benchmarks.fee.view` gets fee figures as restricted; a fee benchmark from two projects is restricted for them even if granted hours. AC-F20-3 proposal reference values never change the proposal's fee or budget fields. AC-F20-4 the report's figures reconcile to the underlying project records.
- **Depends on:** F06, F07, F15, F05.

## New acceptance tests (section 16)

| ID | Proves | Layer | Steps | Pass condition |
| --- | --- | --- | --- | --- |
| AT-21 | Drawing issue history is trustworthy | API + DB | Issue rev C for Construction unchecked; check and issue; issue rev D; try to edit the first transmittal | 422 then success; rev C Superseded; first transmittal unchanged; UPDATE rejected by trigger |
| AT-22 | Authority delays surface without moving the plan | API | Record a query on a fire NOC submission | One attention item and notification; phase and task dates unchanged |
| AT-23 | Benchmarks are honest | API | Report over five projects, one without area, as principal and as PM | Sample 4, one excluded with reason; PM sees hours but fee restricted; proposal fields unchanged |

## Build backlog (Increment 8, after the P0 increments)

Effort uses section 13's scale: S ≤ 1 day, M 2–3 days, L 4–6 days, XL > 6 days.

| Task | Feature | Title | Frontend | Backend | Data / migration | Permissions | Acceptance criteria | Depends on | Effort |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T-075 | F20 | Project profile fields and settings | Area, typology and scope on create and Overview; settings lists | `PUT /projects/:id/profile`; typology and scope settings | `typology`, project columns, firm `area_unit` | `projects.plan` | Area optional, positive, unit from settings | T-028, T-013 | S |
| T-076 | F20 | Import area and typology for past projects | Extends import wizard | Import mapping | `is_opening` reuse | `firm.settings.manage` | Imported projects count in benchmarks | T-075, T-039 | S |
| T-077 | F20 | Benchmarks report and fencing | Report with definition panel and percentile bars | `/reports/benchmarks`; project-count guard | `benchmark_snapshot` read model | `benchmarks.*` | AC-F20-1, AC-F20-2, AC-F20-4 | T-075, T-062 | M |
| T-078 | F20 | Proposal reference panel | Reference panel on Proposal detail | `/proposals/:id/benchmark-reference` | — | `benchmarks.*`, `pipeline.manage` | AC-F20-3 | T-077, T-026 | S |
| T-079 | F18 | Drawing sheets and revisions | Drawings tab register, revision sheet, check action | `/projects/:id/drawings`, `/revisions/*` | `drawing_sheet`, `drawing_revision`, issue trigger, `issue_purpose` | `drawings.manage`, `drawings.check` | AC-F18-5; R25 trigger | T-028, T-006 | L |
| T-080 | F18 | Transmittals and acknowledgement | Transmittal sheet 640, list, acknowledge | `/transmittals/*` | `transmittal`, items, recipients, immutability trigger | `drawings.issue` | AC-F18-1, AC-F18-2, AC-F18-3 | T-079 | L |
| T-081 | F18 | Register export and My work revisions to check | CSV export button; My work group | `register.csv` | — | `drawings.*` | AC-F18-4 | T-080, T-038 | S |
| T-082 | F19 | Authority submissions and events | Phases tab section, detail sheet 640 | `/authority-submissions/*` | `authority_submission`, `authority_event`, `approval_type` | `authority.manage` | AC-F19-4; state machine | T-030, T-007 | L |
| T-083 | F19 | Attention, reminders and task blockers | Overview attention rows; blocked task link | Events to notifications with dedupe; expiry job | `task.blocked_by_submission_id` | O | AC-F19-1, AC-F19-2, AC-F19-3 | T-082, T-011, T-038 | M |
| T-084 | F19 | Firm-wide authority list | `/firm/authority` list with filters | `GET /authority-submissions` | indexes | `authority.manage` | Filters persist in URL; overdue next actions first | T-082 | S |
| T-085 | — | Acceptance tests AT-21 to AT-23 | — | API and DB tests | — | — | Tests green in CI against the seed | T-078, T-081, T-084 | M |

Rough total: 25 to 40 engineer-days for one person, by the spec's own scale.

## Seed additions (section 15)

- PRJ-01 gets a built-up area and typology "Residential, private house"; PRJ-02 "Commercial, office"; PRJ-03 "Hospitality, interior refit".
- PRJ-01 register: A-101 rev C issued for Construction, rev D Draft; S-01 structural set linked as received from the consultant.
- PRJ-02: one fire NOC submission in Query raised with a response due in 3 days; one building approval Approved with validity ending in 30 days.
- Four imported past projects with areas and hours so the benchmark report has a sample, one of them with no area to show the exclusion.

## Decision log additions (section 17)

| ID | Decision | Reason | Alternatives | Status | Needs your confirmation? |
| --- | --- | --- | --- | --- | --- |
| DL-13 | Drawings are a register with links, not a file store | Keeps out of document control (section 2.3) and avoids storage cost | Store files in MinIO | Proposed | Yes |
| DL-14 | Authority names and approval types are firm-entered only | R24; they differ by city and state | Ship a starter list | Proposed | No |
| DL-15 | Fee benchmarks are fenced like margin and need three projects | A small sample can reveal one client's fee | Two projects | Proposed | No |

## Open questions

| ID | Question | Affects | Default if unanswered |
| --- | --- | --- | --- |
| OQ-8 | Do studios want consultants to acknowledge transmittals inside the product, or is a recorded acknowledgement enough until the client portal? | F18 recipients | Recorded by staff |
| OQ-9 | Which area measure do studios price on: built-up, carpet or saleable? | F20 | Built-up, labelled; one measure per firm |
| OQ-10 | Should an approaching authority expiry also notify the principal, or only the responsible person and PM? | F19 reminders | Responsible person and PM |
