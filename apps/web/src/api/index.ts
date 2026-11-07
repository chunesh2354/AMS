import {
  AGEING, APPROVALS, ATTENTION, ATTENTION_FENCED, AVAILABILITY, CONTRIBUTION, LEAVE, NOTIFICATIONS, PEOPLE, PERSON_ACTIVITY, PROJECTS,
  PROJECT_ATTENTION, QUEUES, READY_TO_BILL, UTILIZATION, WORKING_PATTERNS, defaultAvailability,
} from '../mock/studio-meridian';
import type { ActivityEvent, Approval, AttentionItem, Fenced, LeaveRequest, NotificationGroupData, Overview, Person, ProjectView, Role, WeekAvailability } from './types';

export * from './types';

/**
 * The only door between screens and data. Each function returns mock data today and keeps its
 * signature when the backend replaces it. Fencing happens here, as it will on the server.
 */
export type ViewerRef = { id: string; roles: Role[] };

export const hasFinanceAccess = (v: ViewerRef) => v.roles.includes('principal') || v.roles.includes('finance');
export const canSeeRatesTab = (v: ViewerRef) => !v.roles.every((r) => r === 'staff');

const fence = <T,>(allowed: boolean, value: T): Fenced<T> => (allowed ? { restricted: false, value } : { restricted: true });
const reply = <T,>(value: T): Promise<T> => Promise.resolve(value);

export function getOverview(viewer: ViewerRef): Promise<Overview> {
  const finance = hasFinanceAccess(viewer);
  return reply({
    queues: QUEUES.map((q) => ({ ...q, restricted: q.key === 'overdue' ? !finance : undefined })),
    attention: ATTENTION.map((a) => (!finance && ATTENTION_FENCED[a.id] ? { ...a, detail: ATTENTION_FENCED[a.id] } : a)),
    readyToBill: fence(finance, READY_TO_BILL),
    ageing: fence(finance, AGEING),
    utilization: UTILIZATION,
  });
}

export const getPeople = (): Promise<Person[]> => reply(PEOPLE);
export const getPerson = (id: string): Promise<Person | null> => reply(PEOPLE.find((p) => p.id === id) ?? null);
export const personName = (id: string | null) => PEOPLE.find((p) => p.id === id)?.name ?? 'None';

export function getAvailability(id: string): Promise<WeekAvailability[]> {
  const p = PEOPLE.find((x) => x.id === id);
  return reply(AVAILABILITY[id] ?? (p ? defaultAvailability(p) : []));
}
export const getWorkingPattern = (id: string) => {
  const p = PEOPLE.find((x) => x.id === id);
  return reply(WORKING_PATTERNS[id] ?? [{ from: '2026-04-01', to: null, label: `${p?.daysPerWeek ?? 5} days, ${p?.hoursPerWeek ?? 40} h`, detail: 'Current working pattern' }]);
};
export const getPersonLeave = (id: string): Promise<LeaveRequest[]> => reply(LEAVE.filter((l) => l.personId === id));
export const getPersonActivity = (id: string): Promise<ActivityEvent[]> => reply(PERSON_ACTIVITY[id] ?? []);
export const getRates = (id: string, viewer: ViewerRef): Promise<{ cost: Fenced<number | null>; bill: Fenced<number | null> }> => {
  const p = PEOPLE.find((x) => x.id === id);
  const finance = hasFinanceAccess(viewer);
  return reply({ cost: fence(finance, p?.costRate ?? null), bill: fence(finance, p?.billRate ?? null) });
};

const toView = (code: string, viewer: ViewerRef): ProjectView | null => {
  const p = PROJECTS.find((x) => x.code === code);
  if (!p) return null;
  const finance = hasFinanceAccess(viewer);
  return { ...p, contribution: fence(finance, CONTRIBUTION[code]), entitlement: { restricted: false, value: p.entitlement } };
};
export const getProjects = (viewer: ViewerRef): Promise<ProjectView[]> => reply(PROJECTS.map((p) => toView(p.code, viewer)!));
export const getProject = (code: string, viewer: ViewerRef): Promise<ProjectView | null> => reply(toView(code, viewer));
export const getProjectAttention = (code: string): Promise<AttentionItem[]> => reply(PROJECT_ATTENTION[code] ?? []);

export const getApprovals = (): Promise<Approval[]> => reply(APPROVALS);
export const getNotifications = (): NotificationGroupData[] => NOTIFICATIONS;
