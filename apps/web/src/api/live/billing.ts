import { apiFetch, isRestricted, rupees, type ListResponse, type LiveMoney, type Restricted } from '../live';
import type { BillingDraft, NteException, ReadyItem } from '../types';
import type { Status } from '../../ui/status-colors';
import { RESTRICTED } from '../../ui/DataTable';

type M = LiveMoney | Restricted | null;
type Proj = { id: string; code: string; name: string };

/** Money for a DataTable cell: the RESTRICTED marker when fenced, null when absent. Never a silent 0. */
export function cellMoney(m: M | undefined): number | null | typeof RESTRICTED {
  if (isRestricted(m)) return RESTRICTED;
  return rupees(m);
}

export type LiveReadyItemRaw = { id: string; project: Proj; component: string; billing_method: string; phase: string | null; line_type: string; label: string; basis: unknown; previous_net_billing: M; current_claim: M; remaining_entitlement: M; status: string };
export type LiveExceptionRaw = { id: string; project: Proj; component: string; title: string; status: string; hours: unknown; cap: M; consumed: M; requested: M; eligible: M; excess: M };
export type LiveReadyResponse = ListResponse<LiveReadyItemRaw> & { total: M; count: number; exceptions: LiveExceptionRaw[]; missing: unknown[] };
export type LiveSource = { type: string; id: string; amount: M; service_date: string | null; hours: unknown; person: string | null };
export type LiveLine = { id: string; label: string; line_type: string; phase: string | null; component: string | null; calculation_basis: Record<string, unknown> | null; previous_net_billing: M; current_claim: M; remaining_entitlement: M; tax_mapping_code: string | null; sources: LiveSource[] };
export type LiveDraftRaw = {
  id: string; draft_no: string; project: Proj; client: string; cutoff_date: string; prepared_by: string | null; approval_state: string; accounting_state: string; pm_confirmed: boolean;
  total: M; external_invoice: { id: string; invoice_no: string } | null; job: { status: string; last_error: string | null; adapter: string } | null; lines?: LiveLine[];
};
export type LiveWipRaw = { project: Proj; awaiting_approval_hours: unknown; approved_unbilled_hours: unknown; reserved_hours: unknown; ready: M; in_drafts: M; invoiced: M; label: string };
export type LiveIntegrations = { accounting: { adapter: string; label: string; mode: 'MOCK' | 'CSV'; last_success: string | null; last_error: string | null } };

/** Extra live state kept beside the mock-shaped draft row. */
export type LiveDraftMeta = { uuid: string; approvalState: string; accountingState: string; pmConfirmed: boolean; invoiceNo: string | null; jobError: string | null };
export type LiveDraft = BillingDraft & { live: LiveDraftMeta };

const asStatus = (s: string) => s as Status;

export const mapReadyItem = (r: LiveReadyItemRaw): ReadyItem => ({
  id: r.id, project: r.project.code, projectName: r.project.name, component: r.component, basis: r.label, status: asStatus(r.status),
  amount: cellMoney(r.current_claim) as unknown as number,
});

export const mapException = (e: LiveExceptionRaw): NteException => ({
  id: e.id, project: e.project.code, projectName: e.project.name, title: e.title, status: asStatus(e.status),
  limit: cellMoney(e.cap) as unknown as number, billed: cellMoney(e.consumed) as unknown as number, requested: cellMoney(e.requested) as unknown as number,
  eligible: cellMoney(e.eligible) as unknown as number, excess: cellMoney(e.excess) as unknown as number,
});

/** Draft status shown in the list: accounting state wins once the draft has left approval. */
export function draftStatus(d: Pick<LiveDraftRaw, 'approval_state' | 'accounting_state'>): Status {
  if (d.accounting_state && d.accounting_state !== 'Not sent' && d.accounting_state !== 'Unsent') return asStatus(d.accounting_state === 'Pending' ? 'Pending (accounting)' : d.accounting_state);
  return asStatus(d.approval_state);
}

const basisText = (v: unknown) => (isRestricted(v) ? 'Restricted' : v == null ? 'Not set' : typeof v === 'object' && 'amount' in (v as object) ? (v as LiveMoney).amount : String(v));

export const mapDraft = (d: LiveDraftRaw): LiveDraft => ({
  id: d.draft_no, project: d.project.code, projectName: d.project.name, client: d.client, preparedBy: d.prepared_by ?? 'Not set', status: draftStatus(d),
  amount: cellMoney(d.total) as unknown as number,
  lines: (d.lines ?? []).map((l) => ({
    id: l.id, name: l.label, source: l.line_type, qty: l.sources.length, amount: cellMoney(l.current_claim) as unknown as number,
    detail: l.sources.length ? l.sources.map((s) => [s.service_date, s.person, s.hours != null && !isRestricted(s.hours) ? `${s.hours} h` : null].filter(Boolean).join(' · ')).join('; ') : undefined,
  })),
  basis: (d.lines ?? []).flatMap((l) => Object.entries(l.calculation_basis ?? {}).map(([k, v]) => ({ label: `${l.label}: ${k.replace(/_/g, ' ')}`, value: basisText(v) }))),
  note: d.external_invoice ? `Invoice ${d.external_invoice.invoice_no}` : undefined,
  live: { uuid: d.id, approvalState: d.approval_state, accountingState: d.accounting_state, pmConfirmed: d.pm_confirmed, invoiceNo: d.external_invoice?.invoice_no ?? null, jobError: d.job?.last_error ?? null },
});

export type WipRowLive = { project: string; name: string; entitled: number; invoiced: number; label: string };
export const mapWip = (w: LiveWipRaw): WipRowLive => {
  const ready = rupees(w.ready); const drafts = rupees(w.in_drafts); const inv = rupees(w.invoiced);
  const entitled = ready == null || drafts == null || inv == null ? null : ready + drafts + inv;
  return { project: w.project.code, name: w.project.name, entitled: (isRestricted(w.ready) ? RESTRICTED : entitled) as unknown as number, invoiced: cellMoney(w.invoiced) as unknown as number, label: w.label };
};

export const mapAccounting = (i: LiveIntegrations) => ({
  adapter: i.accounting.label, mode: i.accounting.mode, status: asStatus(i.accounting.last_error ? 'Failed' : 'Enabled'),
  lastSuccess: i.accounting.last_success ? new Date(i.accounting.last_success).toLocaleString('en-IN') : 'Not set', sent: i.accounting.last_error ?? 'No errors',
});

// ---- Reads ----
export async function liveReady(project?: string) {
  const r = await apiFetch<LiveReadyResponse>(`/billing/ready${project ? `?project=${encodeURIComponent(project)}` : ''}`);
  return { items: r.data.map(mapReadyItem), exceptions: r.exceptions.map(mapException), total: rupees(r.total), complete: r.complete };
}
export async function liveDrafts(project?: string): Promise<LiveDraft[]> {
  const r = await apiFetch<ListResponse<LiveDraftRaw>>(`/billing/drafts${project ? `?project=${encodeURIComponent(project)}` : ''}`);
  return Promise.all(r.data.map(async (d) => mapDraft(d.lines ? d : await apiFetch<LiveDraftRaw>(`/billing/drafts/${encodeURIComponent(d.id)}`))));
}
export const liveWip = async () => (await apiFetch<ListResponse<LiveWipRaw>>('/billing/wip')).data.map(mapWip);
export const liveAccounting = async () => mapAccounting(await apiFetch<LiveIntegrations>('/integrations'));

// ---- Actions ----
const act = (id: string, verb: string, body: unknown = {}, idempotencyKey?: string) => apiFetch<Record<string, unknown>>(`/billing/drafts/${encodeURIComponent(id)}/${verb}`, { method: 'POST', body, idempotencyKey });
export const createDraft = (project: string, idempotencyKey: string, cutoffDate = new Date().toISOString().slice(0, 10)) =>
  apiFetch<LiveDraftRaw>('/billing/drafts', { method: 'POST', body: { project, cutoff_date: cutoffDate }, idempotencyKey });
export const sendForReview = (id: string) => act(id, 'review');
export const pmConfirm = (id: string) => act(id, 'pm-confirm');
export const rejectDraft = (id: string, reason: string) => act(id, 'reject', { reason });
export const submitDraft = (id: string, simulateTimeout: boolean, idempotencyKey: string) => act(id, 'submit', simulateTimeout ? { simulate: 'timeout' } : {}, idempotencyKey);
export const reconcileDraft = (id: string) => act(id, 'reconcile');
