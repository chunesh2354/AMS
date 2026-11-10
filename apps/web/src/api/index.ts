import {
  AGEING, APPROVALS, ATTENTION, ATTENTION_FENCED, AVAILABILITY, CONTRIBUTION, LEAVE, NOTIFICATIONS, PEOPLE, PERSON_ACTIVITY, PROJECTS,
  PROJECT_ATTENTION, QUEUES, READY_TO_BILL, UTILIZATION, WORKING_PATTERNS, defaultAvailability,
} from '../mock/studio-meridian';
import { fence, hasFinanceAccess, sample, sampleSync, sampleView, type ViewerRef } from './access';
import type { ActivityEvent, Approval, AttentionItem, Fenced, LeaveRequest, NotificationGroupData, Overview, Person, ProjectView, WeekAvailability } from './types';

export * from './types';
export * from './planning';
export * from './work';
export * from './commercial';
export * from './team';

/**
 * The only door between screens and data. Each function returns mock data today and keeps its
 * signature when the backend replaces it. Fencing happens here, as it will on the server.
 */
export { canSeeRatesTab, hasFinanceAccess, type ViewerRef } from './access';

export function getOverview(viewer: ViewerRef): Promise<Overview> {
  const finance = hasFinanceAccess(viewer);
  return sampleView(() => ({
    queues: QUEUES.map((q) => ({ ...q, restricted: q.key === 'overdue' ? !finance : undefined })),
    attention: ATTENTION.map((a) => (!finance && ATTENTION_FENCED[a.id] ? { ...a, detail: ATTENTION_FENCED[a.id] } : a)),
    readyToBill: fence(finance, READY_TO_BILL),
    ageing: fence(finance, AGEING),
    utilization: UTILIZATION,
  }));
}

export const getPeople = (): Promise<Person[]> => sample(() => PEOPLE, []);
export const getPerson = (id: string): Promise<Person | null> => sample(() => PEOPLE.find((p) => p.id === id) ?? null, null);
/** A sample person's name. Live mode has no sample people: a reference code there is never read as one. */
export const personName = (id: string | null) => sampleSync(() => PEOPLE.find((p) => p.id === id)?.name ?? 'None', id ? 'Unknown person' : 'None');

export function getAvailability(id: string): Promise<WeekAvailability[]> {
  const p = PEOPLE.find((x) => x.id === id);
  return sample(() => AVAILABILITY[id] ?? (p ? defaultAvailability(p) : []), []);
}
export const getWorkingPattern = (id: string) => {
  const p = PEOPLE.find((x) => x.id === id);
  return sample(() => WORKING_PATTERNS[id] ?? [{ from: '2026-04-01', to: null, label: `${p?.daysPerWeek ?? 5} days, ${p?.hoursPerWeek ?? 40} h`, detail: 'Current working pattern' }], []);
};
export const getPersonLeave = (id: string): Promise<LeaveRequest[]> => sample(() => LEAVE.filter((l) => l.personId === id), []);
export const getPersonActivity = (id: string): Promise<ActivityEvent[]> => sample(() => PERSON_ACTIVITY[id] ?? [], []);
export const getRates = (id: string, viewer: ViewerRef): Promise<{ cost: Fenced<number | null>; bill: Fenced<number | null> }> => {
  const p = PEOPLE.find((x) => x.id === id);
  const finance = hasFinanceAccess(viewer);
  return sample(() => ({ cost: fence(finance, p?.costRate ?? null), bill: fence(finance, p?.billRate ?? null) }), { cost: fence(finance, null), bill: fence(finance, null) });
};

const toView = (code: string, viewer: ViewerRef): ProjectView | null => {
  const p = PROJECTS.find((x) => x.code === code);
  if (!p) return null;
  const finance = hasFinanceAccess(viewer);
  return { ...p, contribution: fence(finance, CONTRIBUTION[code]), entitlement: { restricted: false, value: p.entitlement } };
};
export const getProjects = (viewer: ViewerRef): Promise<ProjectView[]> => sample(() => PROJECTS.map((p) => toView(p.code, viewer)!), []);
export const getProject = (code: string, viewer: ViewerRef): Promise<ProjectView | null> => sample(() => toView(code, viewer), null);
export const getProjectAttention = (code: string, viewer: ViewerRef): Promise<AttentionItem[]> =>
  sample(() => (PROJECT_ATTENTION[code] ?? []).map((a) => (!hasFinanceAccess(viewer) && ATTENTION_FENCED[a.id] ? { ...a, detail: ATTENTION_FENCED[a.id] } : a)), []);

export const getApprovals = (): Promise<Approval[]> => sample(() => APPROVALS, []);
export const getNotifications = (): NotificationGroupData[] => sampleSync(() => NOTIFICATIONS, []);
