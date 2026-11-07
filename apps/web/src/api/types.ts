import type { Status, Tone } from '../ui/status-colors';

export type Role = 'principal' | 'pm' | 'staff' | 'operations' | 'finance';

export type Person = {
  id: string;
  name: string;
  title: string;
  roles: Role[];
  managerId: string | null;
  office: string;
  type: 'Full time' | 'Part time' | 'Intern';
  hoursPerWeek: number;
  daysPerWeek: number;
  skills: string[];
  projects: string[];
  invitation: Status;
  employment: Status;
  login: Status;
  missingTime?: boolean;
  costRate: number | null;
  billRate: number | null;
};

export type WeekAvailability = { week: string; scheduled: number; holiday: number; leave: number; commitments: number; allocated: number };

/** A value the viewer may not be allowed to see. The server decides; screens only render. */
export type Fenced<T> = { restricted: true } | { restricted: false; value: T };

export type Phase = {
  id: string;
  name: string;
  start: string;
  end: string;
  ownerId: string;
  budget: number;
  actual: number;
  etc: number;
  delivery: number;
  fee: number;
  status: Status;
};

export type Entitlement = { contracted: number; entitled: number; drafted: number; invoiced: number; collected: number };

export type ProjectRisk = { label: string; status: Status };

export type Project = {
  code: string;
  name: string;
  client: string;
  contract: string;
  pmId: string;
  stage: string;
  status: Status;
  risk: ProjectRisk;
  hours: { budget: number; actual: number; forecast: number };
  delivery: number;
  entitlement: Entitlement;
  openTasks: number;
  blockedTasks: number;
  conflicts: number;
  nextMilestone: string;
  phases: Phase[];
};

export type ProjectView = Omit<Project, 'entitlement'> & { contribution: Fenced<number>; entitlement: Fenced<Entitlement> };

export type AttentionItem = { id: string; status: Status; title: string; detail: string; ageDays: number; to?: string };

export type QueueSummary = { key: string; label: string; count: number; severity: Extract<Tone, 'ok' | 'warn' | 'danger' | 'neutral'>; to: string; restricted?: boolean };

export type ApprovalType = 'Time' | 'Leave' | 'Expenses' | 'Bills' | 'Changes' | 'Billing drafts';

export type Approval = {
  id: string;
  type: ApprovalType;
  submitter: string;
  project: string;
  period: string;
  amount: string;
  ageDays: number;
  approver: string;
  exception?: string;
  evidence: string[];
  history: { text: string; time: string }[];
};

export type LeaveRequest = { id: string; personId: string; type: string; dates: string; hours: number; status: Status };

export type ActivityEvent = { id: string; day: string; actor: string; action: string; time: string; previous?: string; next?: string; sensitive?: boolean };

export type NotificationItem = { id: string; text: string; time: string; unread?: boolean };
export type NotificationGroupData = { label: string; items: NotificationItem[] };

export type Overview = {
  queues: QueueSummary[];
  attention: AttentionItem[];
  readyToBill: Fenced<number>;
  ageing: Fenced<{ bucket: string; amount: number }[]>;
  utilization: { value: number; missing: string[] };
};

export type AllocationKind = 'confirmed' | 'tentative' | 'hold';
export type Allocation = { id: string; personId: string | null; project: string; phaseId: string; phaseName: string; week: number; hours: number; kind: AllocationKind; published: boolean };
export type ScheduleDay = { dow: string; date: string; cards: { hours: number; what: string; kind: AllocationKind }[]; off?: string; visit?: string };
export type ScheduleWeek = { label: string; days: ScheduleDay[] };

export type TaskStage = 'Planned' | 'Ready' | 'In progress' | 'In review' | 'Done';
export type Priority = 'High' | 'Medium' | 'Low';
export type Task = {
  id: string; project: string; phase: string; title: string; ownerId: string; reviewerId: string; due: string; stage: TaskStage; priority: Priority;
  blocked?: string; brief: string; estimate: number; logged: number;
  checklist: { label: string; done: boolean }[]; dependencies: string[]; documents: { name: string; version: string }[];
  thread: { id: string; author: string; text: string; time: string }[];
};

export type TimeRow = { id: string; project: string; personId: string; phase: string; draft: number; submitted: number; approved: number; status: Extract<Status, 'Draft' | 'Submitted' | 'Returned' | 'Approved'>; note?: string };
export type Cost = { id: string; project: string; date: string; type: 'Bill' | 'Expense'; who: string; amount: number; allocation: string; approval: Status; payable: Status; recharge: Status; markup: number | null; duplicateOf?: string };
export type ChangeRequest = { id: string; project: string; title: string; state: Status; hours: number; fee: number; days: number; authorization: string; phase: string; evidence: { name: string; date: string }[] };
export type FileDoc = { id: string; project: string; name: string; version: string; phase: string; byId: string; updated: string };

export type OpportunityStage = 'New' | 'Qualified' | 'Proposal' | 'Won' | 'Lost' | 'On hold';
export type Opportunity = { id: string; stage: OpportunityStage; name: string; client: string; fee: number; ownerId: string; next: string | null; overdue?: boolean; proposalId?: string };
export type Proposal = {
  id: string; name: string; client: string; version: string; state: Status; locked: boolean; scope: string; exclusions: string;
  phases: { name: string; start: string; end: string; hours: number }[];
  fees: { name: string; method: string; amount: number }[];
  milestones: { name: string; due: string; amount: number }[];
  terms: string;
  versions: { from: string; to: string | null; label: string; detail: string }[];
  evidence: { name: string; by: string; date: string } | null;
};

export type ReadyItem = { id: string; project: string; projectName: string; component: string; basis: string; amount: number; status: Status };
export type BillingDraft = {
  id: string; project: string; projectName: string; client: string; preparedBy: string; amount: number; status: Status;
  lines: { id: string; name: string; source: string; qty: number; amount: number; detail?: string }[];
  basis: { label: string; value: string; danger?: boolean }[];
  note?: string;
};
export type NteException = { id: string; project: string; projectName: string; title: string; limit: number; billed: number; requested: number; eligible: number; excess: number; status: Status };
export type Invoice = { id: string; client: string; project: string; issue: string; due: string; gross: number; cash: number; withholding: number; credits: number; dispute: Status; ownerId: string; followUp: string | null; overdueDays: number };

type ReportBase = { key: string; label: string; chart: 'bar' | 'line' | 'donut'; numerator: string; denominator: string; col1: string; col2: string; col3: string; headline?: string; estimate?: boolean; missing?: string[]; fenceValue?: boolean; fenceExtra?: boolean };
export type Report = ReportBase & { rows: { key: string; label: string; chart: number; value: string; extra: string; missing?: string[] }[] };
export type ReportView = ReportBase & { fenced: boolean; rows: { key: string; label: string; chart: number | null; value: Fenced<string>; extra: Fenced<string>; missing?: string[] }[] };

export type Integration = { name: string; mode: Status; body: string; action: string };
export type ImportRow = { row: number; person: string; title: string; manager: string; hours: string; errors?: string[] };

export type TimesheetLineData = { id: string; title: string; subtitle?: string; hours: number[]; state?: 'open' | 'locked' | 'returned' | 'unclassified'; reason?: string };
export type Timesheet = { offset: number; range: string; status: Status; days: { key: string; label: string; date: string; scheduled: number }[]; lines: TimesheetLineData[] };
export type Expense = { id: string; amount: number; date: string; what: string; where: string; approval: Status; approvalLabel?: string; reimbursement: Status; reimbursementLabel?: string; receipt: string };
export type MyDay = { today: Task[]; counts: { dueToday: number; blocked: number; reviews: number; missingDays: number; returned: number; leaveDecisions: number }; allocation: { label: string; hours: number }[] };
