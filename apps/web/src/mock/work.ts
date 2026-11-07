import type { ActivityEvent, ChangeRequest, Cost, FileDoc, Task, TaskStage, Priority, TimeRow } from '../api/types';

const BRIEF = 'Draw to the agreed scope and coordinate with the structural and services layouts before review.';
let k = 0;
const task = (
  project: string, phase: string, title: string, ownerId: string, reviewerId: string, due: string, stage: TaskStage, priority: Priority, extra: Partial<Task> = {},
): Task => ({
  id: `T${++k}`, project, phase, title, ownerId, reviewerId, due, stage, priority, brief: BRIEF, estimate: 12, logged: stage === 'Planned' || stage === 'Ready' ? 0 : 6.5,
  checklist: [{ label: 'Coordinated with structure', done: stage === 'In review' }, { label: 'Dimensions checked', done: stage === 'In review' }, { label: 'Issued for review', done: false }],
  dependencies: [], documents: [], thread: [], ...extra,
});
const C = 'Concept design'; const W = 'Working drawings'; const T = 'Tender'; const S = 'Schematic design'; const D = 'Design development';

/** PRJ-01 has 17 open tasks, PRJ-02 has 12, PRJ-03 has 4. Rohan Shetty (P04) owns the nine in My work. */
export const TASKS: Task[] = [
  task('PRJ-01', T, 'Tender drawing register', 'P08', 'P02', '2026-12-11', 'Planned', 'Low'),
  task('PRJ-01', W, 'Door hardware notes', 'P04', 'P02', '2026-11-27', 'Planned', 'Low'),
  task('PRJ-01', W, 'Finishes schedule', 'P05', 'P02', '2026-12-04', 'Planned', 'Medium'),
  task('PRJ-01', T, 'Tender BOQ review', 'P02', 'P01', '2026-12-14', 'Planned', 'Low'),
  task('PRJ-01', W, 'Staircase details', 'P04', 'P02', '2026-11-20', 'Planned', 'High'),
  task('PRJ-01', W, 'Terrace details review', 'P04', 'P02', '2026-11-07', 'Ready', 'Medium'),
  task('PRJ-01', W, 'Kitchen joinery details', 'P08', 'P02', '2026-11-24', 'Ready', 'Medium'),
  task('PRJ-01', W, 'External works layout', 'P05', 'P02', '2026-11-25', 'Ready', 'Medium'),
  task('PRJ-01', W, 'Services coordination set', 'P08', 'P02', '2026-11-26', 'Ready', 'High'),
  task('PRJ-01', C, 'Concept option B — courtyard', 'P04', 'P02', '2026-11-06', 'In progress', 'High', {
    brief: 'Develop the courtyard option the client asked for and note what it changes in hours.', estimate: 16, logged: 9.5,
    documents: [{ name: 'C-02 Concept option B, courtyard', version: 'v1' }],
    thread: [{ id: 'm1', author: 'Vikram Nair', text: 'Keep the courtyard clear of the structural grid if you can.', time: '11:05' }],
  }),
  task('PRJ-01', W, 'Stair section at grid C', 'P04', 'P02', '2026-11-06', 'In progress', 'High', {
    blocked: 'Awaiting structural input',
    dependencies: ['Structural consultant drawing set'],
    documents: [{ name: 'A-301 Staircase sections', version: 'v2' }],
    thread: [
      { id: 'm2', author: 'Vikram Nair', text: 'Check the landing level against the revised section.', time: '14:30' },
      { id: 'm3', author: 'Rohan Shetty', text: 'Updated in v2, waiting on structure to confirm.', time: '15:10' },
    ],
  }),
  task('PRJ-01', W, 'Roof section revision', 'P04', 'P02', '2026-11-04', 'In progress', 'High'),
  task('PRJ-01', W, 'Toilet details', 'P05', 'P02', '2026-11-13', 'In progress', 'Medium'),
  task('PRJ-01', W, 'Window schedule', 'P05', 'P02', '2026-11-17', 'In progress', 'Low'),
  task('PRJ-01', W, 'Ground floor plan rev C', 'P02', 'P01', '2026-11-09', 'In review', 'High', { documents: [{ name: 'A-101 Ground floor plan', version: 'v3' }] }),
  task('PRJ-01', W, 'Roof drainage plan', 'P08', 'P02', '2026-11-11', 'In review', 'Medium'),
  task('PRJ-01', W, 'Site plan rev B', 'P05', 'P02', '2026-11-12', 'In review', 'Low', { documents: [{ name: 'A-010 Site plan', version: 'v2' }] }),

  task('PRJ-02', S, 'Core layout markup', 'P04', 'P03', '2026-11-06', 'In review', 'Medium'),
  task('PRJ-02', S, 'Area statement', 'P04', 'P03', '2026-11-08', 'Ready', 'Low'),
  task('PRJ-02', S, 'Facade study', 'P04', 'P03', '2026-11-24', 'Planned', 'Medium'),
  task('PRJ-02', S, 'Typical floor plan', 'P06', 'P03', '2026-11-13', 'In progress', 'High'),
  task('PRJ-02', S, 'Basement ramp study', 'P06', 'P03', '2026-11-19', 'Ready', 'Medium'),
  task('PRJ-02', S, 'Fire egress diagram', 'P06', 'P03', '2026-11-11', 'In review', 'High'),
  task('PRJ-02', S, 'Lobby visualisation', 'P07', 'P03', '2026-11-17', 'In progress', 'Medium'),
  task('PRJ-02', S, 'Facade material boards', 'P07', 'P03', '2026-11-26', 'Planned', 'Low'),
  task('PRJ-02', S, 'Client presentation set', 'P07', 'P03', '2026-12-01', 'Planned', 'Medium'),
  task('PRJ-02', S, 'Schematic report', 'P03', 'P01', '2026-12-03', 'Planned', 'High'),
  task('PRJ-02', 'Working drawings', 'Consultant brief', 'P03', 'P01', '2026-12-07', 'Planned', 'Low'),
  task('PRJ-02', S, 'Parking count check', 'P06', 'P03', '2026-11-16', 'Ready', 'Low'),

  task('PRJ-03', D, 'Bar counter details', 'P02', 'P01', '2027-01-08', 'Planned', 'Medium'),
  task('PRJ-03', D, 'Lighting layout', 'P02', 'P01', '2027-01-08', 'Planned', 'Low'),
  task('PRJ-03', D, 'Heritage consent notes', 'P02', 'P01', '2027-01-15', 'Planned', 'High'),
  task('PRJ-03', D, 'Kitchen services brief', 'P02', 'P01', '2027-01-15', 'Planned', 'Medium'),
];

const row = (project: string, id: string, personId: string, phase: string, draft: number, submitted: number, approved: number, status: TimeRow['status'], note?: string): TimeRow =>
  ({ id, project, personId, phase, draft, submitted, approved, status, note });
export const PROJECT_TIME: TimeRow[] = [
  row('PRJ-01', 'tr1', 'P02', W, 8, 16, 62, 'Submitted'),
  row('PRJ-01', 'tr2', 'P04', C, 19.5, 0, 98.5, 'Draft'),
  row('PRJ-01', 'tr3', 'P04', W, 11, 0, 30, 'Draft'),
  row('PRJ-01', 'tr4', 'P05', W, 6, 24, 58, 'Submitted'),
  row('PRJ-01', 'tr5', 'P08', W, 4, 8, 20, 'Returned', 'Returned by Vikram Nair: wrong phase'),
  row('PRJ-01', 'tr6', 'P01', C, 0, 16, 0, 'Submitted'),
  row('PRJ-02', 'tr7', 'P03', S, 8, 24, 64, 'Submitted'),
  row('PRJ-02', 'tr8', 'P04', S, 4, 0, 18, 'Draft'),
  row('PRJ-02', 'tr9', 'P06', S, 8, 40, 72, 'Submitted'),
  row('PRJ-02', 'tr10', 'P07', S, 0, 32, 54, 'Submitted'),
  row('PRJ-03', 'tr11', 'P02', D, 0, 0, 10, 'Approved'),
];

export const COSTS: Cost[] = [
  { id: 'c1', project: 'PRJ-01', date: '2026-10-12', type: 'Bill', who: 'Structural consultant', amount: 250000, allocation: W, approval: 'Approved', payable: 'Paid', recharge: 'Eligible', markup: 10 },
  { id: 'c2', project: 'PRJ-01', date: '2026-10-28', type: 'Bill', who: 'Structural consultant', amount: 250000, allocation: W, approval: 'Pending (approval)', payable: 'Not payable', recharge: 'Not eligible', markup: 10, duplicateOf: 'c1' },
  { id: 'c3', project: 'PRJ-01', date: '2026-11-03', type: 'Expense', who: 'Rohan Shetty, taxi', amount: 1850, allocation: C, approval: 'Approved', payable: 'Pending (accounting)', recharge: 'Not eligible', markup: null },
  { id: 'c4', project: 'PRJ-01', date: '2026-11-02', type: 'Expense', who: 'Arjun Das, drawing prints', amount: 1240, allocation: W, approval: 'Pending (approval)', payable: 'Not payable', recharge: 'Not eligible', markup: null },
  { id: 'c5', project: 'PRJ-02', date: '2026-11-04', type: 'Expense', who: 'Karan Bhat, site visit', amount: 920, allocation: S, approval: 'Pending (approval)', payable: 'Not payable', recharge: 'Not eligible', markup: null },
];

export const CHANGES: ChangeRequest[] = [
  { id: 'ch1', project: 'PRJ-01', title: 'Courtyard revision', state: 'Awaiting authorization', hours: 40, fee: 120000, days: 14, authorization: 'Lakeview Trust, requested 04 Nov 2026', phase: 'p1-concept', evidence: [{ name: 'Client email, courtyard option B', date: '2026-11-03' }] },
  { id: 'ch2', project: 'PRJ-02', title: 'Hourly NTE excess', state: 'Identified', hours: 1, fee: 2000, days: 0, authorization: 'Not requested yet', phase: 'p2-schematic', evidence: [] },
];

const doc = (project: string, name: string, version: string, phase: string, byId: string, updated: string): FileDoc => ({ id: name, project, name, version, phase, byId, updated });
export const FILES: FileDoc[] = [
  doc('PRJ-01', 'A-101 Ground floor plan', 'v3', W, 'P02', '2026-11-04'),
  doc('PRJ-01', 'A-301 Staircase sections', 'v2', W, 'P04', '2026-11-03'),
  doc('PRJ-01', 'A-010 Site plan', 'v2', W, 'P05', '2026-10-30'),
  doc('PRJ-01', 'C-02 Concept option B, courtyard', 'v1', C, 'P04', '2026-11-02'),
  doc('PRJ-01', 'S-01 Structural drawing set', 'v1', W, 'P02', '2026-10-12'),
  doc('PRJ-01', 'Signed fee agreement', 'v1', 'Project', 'P10', '2026-01-28'),
  doc('PRJ-02', 'Signed fee agreement', 'v1', 'Project', 'P10', '2026-02-20'),
  doc('PRJ-02', 'S-11 Typical floor plan', 'v4', S, 'P06', '2026-11-05'),
];

const ev = (id: string, day: string, actor: string, action: string, time: string, previous?: string, next?: string, sensitive?: boolean): ActivityEvent => ({ id, day, actor, action, time, previous, next, sensitive });
export const PROJECT_ACTIVITY: Record<string, ActivityEvent[]> = {
  'PRJ-01': [
    ev('e1', '06 Nov 2026', 'Vikram Nair', 'revised ETC on Working drawings', '14:30', '30 h', '60 h'),
    ev('e2', '06 Nov 2026', 'Farah Khan', 'changed a cost rate', '11:05', undefined, undefined, true),
    ev('e3', '06 Nov 2026', 'Rohan Shetty', 'logged 2.00 h on Concept design', '09:40'),
    ev('e4', '05 Nov 2026', 'Vikram Nair', 'returned a time entry from Arjun Das: wrong phase', '17:12'),
    ev('e5', '05 Nov 2026', 'Vikram Nair', 'moved Divya Menon in the week of 16 Nov', '10:20', '24 h', '26 h'),
    ev('e6', '04 Nov 2026', 'Vikram Nair', 'raised the change Courtyard revision', '16:02'),
    ev('e7', '04 Nov 2026', 'Farah Khan', 'drafted the fixed-fee claim', '12:15'),
  ],
  'PRJ-02': [
    ev('e8', '06 Nov 2026', 'Asha Rao', 'approved billing draft DRAFT-0012', '11:20'),
    ev('e9', '31 Oct 2026', 'Karan Bhat', 'reached the hourly NTE limit on site visits', '18:00'),
  ],
  'PRJ-03': [ev('e10', '20 Oct 2026', 'Asha Rao', 'put the project on hold', '10:00', 'Active', 'On hold')],
};
