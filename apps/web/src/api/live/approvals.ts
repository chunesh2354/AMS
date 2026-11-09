import { apiFetch, hoursOf, isRestricted, rupees, type ListResponse, type LiveMoney, type Restricted } from '../live';
import type { Approval, ApprovalType } from '../types';
import { formatHours, formatINR, parseISO } from '../../ui/format';

/** Shape of one item from GET /approvals (apps/api/src/modules/approvals.ts, view()). */
export type LiveApproval = {
  id: string;
  type: 'time' | 'internal_time' | 'billing_draft' | string;
  status: string;
  record_type: string;
  record_id: string;
  submitter: { id: string; name: string };
  approver: { id: string; name: string };
  delegated_to_id: string | null;
  project: { code: string; name: string } | null;
  exception_flags: string[];
  /** Routed back to its submitter: a sole principal approving their own work. Older servers omit it. */
  self_approval?: boolean;
  age_days: number | string | null;
  period: { start: string; end: string } | null;
  hours: string | Restricted | null;
  amount: LiveMoney | Restricted | null;
  draft_no: string | null;
  lines: { id: string; service_date: string; duration_hours: string | Restricted | null; approval_state: string; note: string | null; correction_reason: string | null }[];
  history: { action: string; reason: string | null; at: string; actor: string }[];
};

/** Shape of one item from GET /people (apps/api/src/modules/auth.ts). */
export type LivePerson = { id: string; ref_code: string; name: string; job_title: string | null; manager_id: string | null; employment_state: string; login_state: string };

export const RESTRICTED_TEXT = 'Restricted';
export const NOT_RECORDED = 'Not recorded';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = (iso: string) => { const d = parseISO(iso.slice(0, 10)); return { d: String(d.getDate()).padStart(2, '0'), m: MONTHS[d.getMonth()] }; };

export function approvalTypeOf(t: string): ApprovalType {
  if (t === 'time' || t === 'internal_time') return 'Time';
  if (t === 'billing_draft') return 'Billing drafts';
  return 'Changes';
}

/** "02 to 08 Nov", or "28 Oct to 03 Nov" across months. */
export function periodText(p: LiveApproval['period'], draftNo: string | null): string {
  if (p) {
    const a = day(p.start), b = day(p.end);
    return a.m === b.m ? `${a.d} to ${b.d} ${b.m}` : `${a.d} ${a.m} to ${b.d} ${b.m}`;
  }
  return draftNo ? `Draft ${draftNo}` : NOT_RECORDED;
}

/** Hours for time, money for drafts. A fenced value says Restricted; a missing one is never shown as zero. */
export function amountText(a: Pick<LiveApproval, 'hours' | 'amount'>): string {
  if (isRestricted(a.hours) || isRestricted(a.amount)) return RESTRICTED_TEXT;
  const h = hoursOf(a.hours);
  if (h != null) return formatHours(h);
  const r = rupees(a.amount);
  if (r != null) return formatINR(r);
  return NOT_RECORDED;
}

export const exceptionText = (flags: string[] | null | undefined): string | undefined => {
  if (!flags?.length) return undefined;
  return flags.map((f) => (f === 'over_12h_day' ? 'Over 12 h day' : f.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()))).join(', ');
};

const stamp = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });
const ACTIONS: Record<string, string> = { approve: 'Approved', return: 'Returned', reject: 'Rejected', delegate: 'Delegated', submit: 'Submitted' };

export function historyOf(h: LiveApproval['history']): Approval['history'] {
  return (h ?? []).map((e) => ({
    text: `${ACTIONS[e.action] ?? e.action} by ${e.actor}${e.reason ? `: ${e.reason}` : ''}`,
    time: Number.isNaN(Date.parse(e.at)) ? '' : stamp.format(new Date(e.at)),
  }));
}

export function evidenceOf(a: LiveApproval): string[] {
  if (a.type === 'billing_draft') return a.draft_no ? [`Billing draft ${a.draft_no}`] : [];
  const out: string[] = [];
  if (a.period) { const s = day(a.period.start); out.push(`Timesheet, week of ${s.d} ${s.m}`); }
  if (a.lines?.length) out.push(`${a.lines.length} time ${a.lines.length === 1 ? 'entry' : 'entries'}`);
  return out;
}

/** Shown on a request routed back to its submitter, a sole principal: the server audits it as self_approval_override. */
export const SELF_APPROVAL_LABEL = 'Self-approved: no other approver in the studio';

/** An inbox item, plus whether it is a sole principal's own work. */
export type ApprovalItem = Approval & { selfApproval?: boolean };

export function mapApproval(a: LiveApproval): ApprovalItem {
  const age = a.age_days == null ? NaN : Number(a.age_days);
  return {
    id: a.id,
    type: approvalTypeOf(a.type),
    submitter: a.submitter.name,
    project: a.project ? a.project.code : a.type === 'internal_time' ? 'Internal time' : NOT_RECORDED,
    period: periodText(a.period, a.draft_no),
    amount: amountText(a),
    ageDays: Number.isFinite(age) ? age : 0,
    approver: a.approver.name,
    exception: exceptionText(a.exception_flags),
    selfApproval: !!a.self_approval,
    evidence: evidenceOf(a),
    history: historyOf(a.history),
  };
}

export async function liveApprovals(): Promise<ApprovalItem[]> {
  const res = await apiFetch<ListResponse<LiveApproval>>('/approvals');
  return res.data.map(mapApproval);
}

export type DelegateOption = { id: string; name: string; title: string };
export const mapDelegates = (people: LivePerson[]): DelegateOption[] =>
  people.filter((p) => p.login_state === 'Enabled' && p.employment_state === 'Active').map((p) => ({ id: p.id, name: p.name, title: p.job_title ?? p.ref_code }));

export async function liveDelegates(): Promise<DelegateOption[]> {
  const res = await apiFetch<ListResponse<LivePerson>>('/people');
  return mapDelegates(res.data);
}

export const approveOne = (id: string) => apiFetch<{ status: string }>(`/approvals/${id}/approve`, { method: 'POST', body: {} });
export const returnOne = (id: string, reason: string) => apiFetch<{ status: string }>(`/approvals/${id}/return`, { body: { reason } });
export const delegateOne = (id: string, to: string, until: string) => apiFetch<{ ok: boolean }>(`/approvals/${id}/delegate`, { body: { to, until } });
export const batchApprove = (ids: string[]) => apiFetch<{ approved: string[]; skipped: { id: string; reason: string }[] }>('/approvals/batch-approve', { body: { ids } });

export function batchMessage(r: { approved: string[]; skipped: unknown[] }): string {
  const s = r.skipped.length;
  return `${r.approved.length} approved.${s ? ` ${s} skipped.` : ''}`;
}

/** How many approvals wait on the signed-in person: the `total` of GET /approvals (Pending by default), one row fetched. */
export async function pendingApprovalCount(): Promise<number> {
  const res = await apiFetch<ListResponse<LiveApproval>>('/approvals?status=Pending&page_size=1');
  return Number(res.total) || 0;
}

/** GET /firm/approvals-settings: who approves when routing finds nobody else, and who may be named. */
export type ApprovalSettingsPerson = { id: string; ref_code: string; name: string; job_title: string | null };
export type LiveApprovalSettings = {
  fallback_approver: ApprovalSettingsPerson | null;
  /** False when the stored fallback has left or lost time.approve: routing skips them. */
  fallback_approver_eligible: boolean | null;
  allow_self_approval: boolean;
  candidates: ApprovalSettingsPerson[];
};
export const getApprovalSettings = () => apiFetch<LiveApprovalSettings>('/firm/approvals-settings');
export const saveFallbackApprover = (personId: string | null) =>
  apiFetch<Omit<LiveApprovalSettings, 'candidates'> & { audit_event_id: string }>('/firm/approvals-settings', { method: 'PUT', body: { fallback_approver_id: personId } });
