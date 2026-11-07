import type { ActivityEvent, Approval, AttentionItem, LeaveRequest, NotificationGroupData, Person, Project, QueueSummary, WeekAvailability } from '../api/types';
import { ALLOCATIONS, LEAVE_WEEKS, PLAN_WEEKS } from './plan';

/** The demo firm from section 2 of the brief. "Today" for every screen is 06 Nov 2026. */
export const TODAY = '2026-11-06';
export const FIRM_NAME = 'Studio Meridian (DEMO)';

const person = (
  id: string, name: string, title: string, roles: Person['roles'], managerId: string | null, projects: string[],
  extra: Partial<Person> = {},
): Person => ({
  id, name, title, roles, managerId, projects,
  office: 'Bengaluru', type: 'Full time', hoursPerWeek: 40, daysPerWeek: 5, skills: ['Revit'],
  invitation: 'Accepted', employment: 'Active', login: 'Enabled', costRate: 640, billRate: 1600,
  ...extra,
});

export const PEOPLE: Person[] = [
  person('P01', 'Asha Rao', 'Principal', ['principal'], null, ['PRJ-01', 'PRJ-02', 'PRJ-03'], { skills: ['Concept design', 'Client management'], costRate: 2400, billRate: 6000 }),
  person('P02', 'Vikram Nair', 'Project architect', ['pm'], 'P01', ['PRJ-01', 'PRJ-03'], { skills: ['Revit', 'Site supervision'], costRate: 1200, billRate: 3000 }),
  person('P03', 'Meera Iyer', 'Project architect', ['pm'], 'P01', ['PRJ-02'], { skills: ['Revit', 'Detailing'], costRate: 1200, billRate: 3000 }),
  person('P04', 'Rohan Shetty', 'Senior architect', ['staff'], 'P02', ['PRJ-01', 'PRJ-02'], { skills: ['Revit', 'Rhino'], costRate: 900, billRate: 2200 }),
  person('P05', 'Divya Menon', 'Architect', ['staff'], 'P02', ['PRJ-01'], { skills: ['Revit', 'Detailing'] }),
  person('P06', 'Karan Bhat', 'Architect', ['staff'], 'P03', ['PRJ-02'], { skills: ['Revit', 'Site supervision'], billRate: 2000 }),
  person('P07', 'Sneha Pillai', 'Designer', ['staff'], 'P03', ['PRJ-02'], { type: 'Part time', hoursPerWeek: 32, daysPerWeek: 4, skills: ['Visualisation', 'Rhino'], missingTime: true }),
  person('P08', 'Arjun Das', 'Architect', ['staff'], 'P02', ['PRJ-01'], { skills: ['Revit', 'Detailing'], missingTime: true }),
  person('P09', 'Nisha Kumar', 'Intern', ['staff'], 'P03', [], { type: 'Intern', skills: ['Rhino'], missingTime: true, costRate: null, billRate: null }),
  person('P10', 'Farah Khan', 'Operations', ['operations', 'finance'], 'P01', ['PRJ-01', 'PRJ-02', 'PRJ-03'], { skills: ['Billing', 'Accounting'], costRate: 800, billRate: null }),
];

const week = (w: string, allocated: number, commitments = 4, holiday = 0, leave = 0, scheduled = 40): WeekAvailability => ({ week: w, scheduled, holiday, leave, commitments, allocated });

/** Weekly capacity for the next eight weeks. Week of 16 Nov for P05 carries the brief's 2 h conflict. */
export const AVAILABILITY: Record<string, WeekAvailability[]> = {
  P05: [
    week('02 Nov', 24), week('09 Nov', 24), week('16 Nov', 26, 4, 8, 4), week('23 Nov', 24),
    week('30 Nov', 16), week('07 Dec', 16), week('14 Dec', 8), week('21 Dec', 0, 4, 8),
  ],
};

/** Everyone but P05: two hours of commitments, holidays in the weeks of 16 Nov and 21 Dec, allocations from the plan. */
export const weekAvailability = (p: Person, i: number): WeekAvailability => {
  const w = PLAN_WEEKS[i];
  const allocated = ALLOCATIONS.filter((a) => a.personId === p.id && a.week === i).reduce((s, a) => s + a.hours, 0);
  const leave = LEAVE_WEEKS[p.id]?.[i] ?? 0;
  return week(w, allocated, leave ? 0 : 2, w === '16 Nov' || w === '21 Dec' ? 8 : 0, leave, p.hoursPerWeek);
};
export const defaultAvailability = (p: Person): WeekAvailability[] => PLAN_WEEKS.slice(0, 8).map((_, i) => weekAvailability(p, i));

export const WORKING_PATTERNS: Record<string, { from: string; to: string | null; label: string; detail?: string }[]> = {
  P05: [
    { from: '2025-04-01', to: '2026-03-31', label: '5 days, 40 h', detail: 'Joined as Architect' },
    { from: '2026-04-01', to: '2026-12-31', label: '5 days, 40 h', detail: 'Current working pattern' },
    { from: '2027-01-01', to: null, label: '5 days, 40 h', detail: 'Bengaluru holiday calendar 2027' },
  ],
};

export const LEAVE: LeaveRequest[] = [
  { id: 'L1', personId: 'P05', type: 'Earned leave', dates: '18 Nov 2026', hours: 4, status: 'Approved' },
  { id: 'L2', personId: 'P04', type: 'Earned leave', dates: '16 to 17 Nov 2026', hours: 16, status: 'Approved' },
];

export const PERSON_ACTIVITY: Record<string, ActivityEvent[]> = {
  P05: [
    { id: 'a1', day: '05 Nov 2026', actor: 'Vikram Nair', action: 'moved an allocation to the week of 16 Nov', previous: '24 h', next: '26 h', time: '10:20' },
    { id: 'a2', day: '05 Nov 2026', actor: 'Farah Khan', action: 'changed a cost rate', sensitive: true, time: '09:02' },
    { id: 'a3', day: '01 Apr 2026', actor: 'Asha Rao', action: 'set the working pattern', previous: '5 days', next: '5 days', time: '11:00' },
  ],
};

const phase = (
  id: string, name: string, start: string, end: string, ownerId: string, budget: number, actual: number, etc: number, delivery: number, fee: number, status: Project['status'],
): Project['phases'][number] => ({ id, name, start, end, ownerId, budget, actual, etc, delivery, fee, status });

export const PROJECTS: Project[] = [
  {
    code: 'PRJ-01', name: 'Lakeview Residence', client: 'Lakeview Trust', contract: 'Fixed fee ₹24,00,000', pmId: 'P02', stage: 'Working drawings', status: 'Active',
    risk: { label: 'At risk', status: 'Overrun' },
    hours: { budget: 1100, actual: 820, forecast: 1102 }, delivery: 48,
    entitlement: { contracted: 2400000, entitled: 1152000, drafted: 880000, invoiced: 800000, collected: 800000 },
    openTasks: 17, blockedTasks: 1, conflicts: 1, nextMilestone: '2026-12-18',
    phases: [
      phase('p1-concept', 'Concept design', '2026-02-02', '2026-11-27', 'P04', 140, 118, 22, 85, 300000, 'In progress'),
      phase('p1-schematic', 'Schematic design', '2026-04-13', '2026-06-26', 'P02', 220, 216, 0, 100, 360000, 'Done'),
      phase('p1-dd', 'Design development', '2026-06-29', '2026-09-04', 'P02', 340, 316, 0, 100, 600000, 'Done'),
      phase('p1-wd', 'Working drawings', '2026-09-07', '2026-12-18', 'P02', 200, 170, 60, 62, 720000, 'Overrun'),
      phase('p1-tender', 'Tender', '2026-12-21', '2027-02-05', 'P08', 100, 0, 100, 0, 180000, 'Planned'),
      phase('p1-site', 'Site supervision', '2027-02-08', '2027-11-26', 'P02', 100, 0, 100, 0, 240000, 'Planned'),
    ],
  },
  {
    code: 'PRJ-02', name: 'Orchard Commercial Block', client: 'Orchard Developers', contract: '6% of ₹8,00,00,000 + hourly NTE ₹1,00,000', pmId: 'P03', stage: 'Schematic design', status: 'Active',
    risk: { label: 'On track', status: 'Active' },
    hours: { budget: 1800, actual: 620, forecast: 1700 }, delivery: 31,
    entitlement: { contracted: 4900000, entitled: 1462000, drafted: 1462000, invoiced: 1056000, collected: 896000 },
    openTasks: 12, blockedTasks: 0, conflicts: 0, nextMilestone: '2026-12-04',
    phases: [
      phase('p2-concept', 'Concept design', '2026-03-02', '2026-07-31', 'P03', 400, 396, 0, 100, 960000, 'Done'),
      phase('p2-schematic', 'Schematic design', '2026-08-03', '2026-12-04', 'P03', 500, 224, 276, 45, 1200000, 'In progress'),
      phase('p2-wd', 'Working drawings', '2026-12-07', '2027-06-25', 'P03', 900, 0, 804, 0, 2640000, 'Planned'),
    ],
  },
  {
    code: 'PRJ-03', name: 'Heritage Cafe Refit', client: 'Heritage Hospitality', contract: 'Fixed fee ₹6,00,000', pmId: 'P02', stage: 'Design development', status: 'On hold',
    risk: { label: 'On hold', status: 'On hold' },
    hours: { budget: 400, actual: 120, forecast: 400 }, delivery: 20,
    entitlement: { contracted: 600000, entitled: 120000, drafted: 120000, invoiced: 120000, collected: 120000 },
    openTasks: 4, blockedTasks: 0, conflicts: 0, nextMilestone: '2027-01-15',
    phases: [
      phase('p3-concept', 'Concept design', '2026-06-01', '2026-08-14', 'P02', 120, 110, 0, 100, 150000, 'Done'),
      phase('p3-dd', 'Design development', '2026-08-17', '2027-01-15', 'P02', 280, 10, 270, 4, 450000, 'On hold'),
    ],
  },
];

/** Contribution is a management estimate and is fenced from anyone without finance access. */
export const CONTRIBUTION: Record<string, number> = { 'PRJ-01': 640000, 'PRJ-02': 890000, 'PRJ-03': 48000 };

export const PROJECT_ATTENTION: Record<string, AttentionItem[]> = {
  'PRJ-01': [
    { id: 'pa1', status: 'Overrun', title: 'Working drawings forecast +30 h', detail: '200 h budget, 170 h actual, 60 h ETC', ageDays: 3, to: '/firm/projects/PRJ-01/phases' },
    { id: 'pa2', status: 'Conflict', title: 'Divya Menon 2 h over', detail: 'Week of 16 Nov', ageDays: 2, to: '/firm/people/P05?tab=capacity' },
    { id: 'pa3', status: 'Blocked', title: 'Stair section at grid C', detail: 'Awaiting structural input', ageDays: 2, to: '/firm/projects/PRJ-01/tasks' },
  ],
  'PRJ-02': [
    { id: 'pb1', status: 'Excess', title: 'Hourly NTE exception', detail: 'Eligible ₹4,000, excess ₹2,000', ageDays: 6, to: '/firm/projects/PRJ-02/billing' },
  ],
  'PRJ-03': [],
};

export const QUEUES: QueueSummary[] = [
  { key: 'missing', label: 'Missing time', count: 3, severity: 'warn', to: '/firm/people?issue=missing-time' },
  { key: 'approvals', label: 'Pending approvals', count: 14, severity: 'warn', to: '/firm/approvals' },
  { key: 'overallocated', label: 'Overallocations', count: 1, severity: 'danger', to: '/firm/workload' },
  { key: 'overrun', label: 'Overrun forecasts', count: 1, severity: 'danger', to: '/firm/projects?risk=at-risk' },
  { key: 'holds', label: 'Billing holds', count: 1, severity: 'neutral', to: '/firm/billing?tab=exceptions' },
  { key: 'overdue', label: 'Overdue invoices', count: 1, severity: 'danger', to: '/firm/receivables' },
];

export const ATTENTION: AttentionItem[] = [
  { id: 'x1', status: 'Overdue', title: 'INV-DEMO-0007 unpaid', detail: 'Orchard Developers · ₹1,60,000 · follow-up Farah Khan', ageDays: 40, to: '/firm/receivables' },
  { id: 'x2', status: 'Excess', title: 'PRJ-02 hourly NTE exception', detail: 'Eligible ₹4,000, excess ₹2,000 · Karan Bhat', ageDays: 6, to: '/firm/projects/PRJ-02/billing' },
  { id: 'x3', status: 'Overrun', title: 'PRJ-01 Working drawings', detail: '200 h budget, 170 h actual, 60 h ETC · forecast +30 h', ageDays: 3, to: '/firm/projects/PRJ-01/phases' },
  { id: 'x4', status: 'Conflict', title: 'Divya Menon overallocated', detail: 'Week of 16 Nov · 26 h allocated, 24 h available · 2 h over', ageDays: 2, to: '/firm/people/P05?tab=capacity' },
  { id: 'x5', status: 'Incomplete data', title: 'Nisha Kumar has no cost rate', detail: 'Utilization and cost reports are incomplete', ageDays: 9, to: '/firm/people/P09?tab=rates' },
  { id: 'x6', status: 'Returned', title: 'Arjun Das timesheet line', detail: 'PRJ-01 · returned by Vikram Nair: wrong phase', ageDays: 4, to: '/firm/projects/PRJ-01/time' },
  { id: 'x7', status: 'Pending (approval)', title: 'Rohan Shetty over 12 h on Thursday', detail: 'Timesheet exception · 12.50 h logged', ageDays: 1, to: '/firm/approvals?queue=Time' },
];

/** Attention rows whose detail carries money are rewritten for people without finance access. */
export const ATTENTION_FENCED: Record<string, string> = {
  x1: 'Orchard Developers · amount Restricted · follow-up Farah Khan',
  x2: 'Amounts Restricted · Karan Bhat',
  pb1: 'Amounts Restricted',
};

export const READY_TO_BILL = 486000;
export const AGEING = [
  { bucket: 'Current', amount: 0 },
  { bucket: '30 d', amount: 160000 },
  { bucket: '60 d', amount: 0 },
  { bucket: '90+ d', amount: 0 },
];
export const UTILIZATION = { value: 78, missing: ['Nisha Kumar cost rate'] };

const approval = (
  id: string, type: Approval['type'], submitter: string, project: string, period: string, amount: string, ageDays: number, approver: string, evidence: string[] = [], exception?: string,
): Approval => ({
  id, type, submitter, project, period, amount, ageDays, approver, exception, evidence,
  history: [
    { text: `Submitted by ${submitter}`, time: `${ageDays} d ago` },
    { text: `Routed to ${approver}`, time: `${ageDays} d ago` },
  ],
});

export const APPROVALS: Approval[] = [
  approval('ap1', 'Time', 'Rohan Shetty', 'PRJ-01, PRJ-02', '02 to 08 Nov', '38.50 h', 1, 'Vikram Nair', ['Timesheet, week of 02 Nov'], 'Over 12 h day'),
  approval('ap2', 'Time', 'Arjun Das', 'PRJ-01', '26 Oct to 01 Nov', '40.00 h', 5, 'Vikram Nair', ['Timesheet, week of 26 Oct']),
  approval('ap3', 'Time', 'Divya Menon', 'PRJ-01', '26 Oct to 01 Nov', '36.00 h', 5, 'Vikram Nair', ['Timesheet, week of 26 Oct']),
  approval('ap4', 'Time', 'Karan Bhat', 'PRJ-02', '26 Oct to 01 Nov', '40.00 h', 5, 'Meera Iyer', ['Timesheet, week of 26 Oct']),
  approval('ap5', 'Time', 'Sneha Pillai', 'PRJ-02', '26 Oct to 01 Nov', '32.00 h', 5, 'Meera Iyer', ['Timesheet, week of 26 Oct']),
  approval('ap6', 'Time', 'Nisha Kumar', 'Internal', '26 Oct to 01 Nov', '40.00 h', 5, 'Asha Rao', ['Timesheet, week of 26 Oct']),
  approval('ap7', 'Leave', 'Karan Bhat', 'Earned leave', '20 Nov', '8.00 h', 3, 'Meera Iyer'),
  approval('ap8', 'Leave', 'Sneha Pillai', 'Earned leave', '04 to 05 Dec', '16.00 h', 2, 'Meera Iyer'),
  approval('ap9', 'Expenses', 'Arjun Das', 'PRJ-01', 'Drawing prints', '₹1,240', 4, 'Vikram Nair', ['Print shop receipt']),
  approval('ap10', 'Expenses', 'Karan Bhat', 'PRJ-02', 'Site visit', '₹920', 2, 'Meera Iyer', ['Taxi receipt']),
  approval('ap11', 'Bills', 'Structural consultant', 'PRJ-01', 'Bill, 10% markup', '₹2,50,000', 6, 'Asha Rao', ['Consultant invoice']),
  approval('ap12', 'Changes', 'Vikram Nair', 'PRJ-01', 'Courtyard revision', '+40.00 h', 2, 'Asha Rao', ['Client email, courtyard option B']),
  approval('ap13', 'Billing drafts', 'Farah Khan', 'PRJ-01', 'Fixed-fee claim', '₹80,000', 1, 'Asha Rao'),
  approval('ap14', 'Billing drafts', 'Farah Khan', 'PRJ-01', 'Consultant recharge, 10% markup', '₹2,75,000', 1, 'Asha Rao', ['Consultant invoice']),
];

export const NOTIFICATIONS: NotificationGroupData[] = [
  { label: 'Today', items: [
    { id: 'n1', text: 'INV-DEMO-0007 is 40 days overdue', time: '09:00', unread: true },
    { id: 'n2', text: 'Working drawings is forecast 30 h over budget', time: '14:30', unread: true },
    { id: 'n3', text: 'Billing draft for PRJ-02 was approved', time: '11:20', unread: true },
  ] },
  { label: 'Earlier', items: [
    { id: 'n4', text: 'Divya Menon has a 2 h conflict in the week of 16 Nov', time: '05 Nov 2026' },
    { id: 'n5', text: 'Vikram Nair returned a timesheet line from Arjun Das', time: '05 Nov 2026' },
  ] },
];

export const OFFICES = ['Bengaluru'];
export const PERMISSION_SETS = ['Principal', 'Project manager', 'Finance', 'Operations', 'Staff'];

export * from './plan';
export * from './work';
export * from './commercial';
export * from './team';
