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
