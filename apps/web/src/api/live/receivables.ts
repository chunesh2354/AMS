import { apiFetch, ApiFailure, rupees, type ListResponse, type LiveMoney, type Restricted } from '../live';
import type { Invoice } from '../types';

/** Shape of one row from GET /receivables (apps/api/src/modules/receivables.ts view()). */
export type ApiInvoice = {
  id: string; invoice_no: string; external_id: string | null; client: string;
  project: { id: string; code: string; name: string };
  issue_date: string; due_date: string; overdue_days: number | string;
  gross: LiveMoney | Restricted | null; tax: LiveMoney | Restricted | null; net: LiveMoney | Restricted | null;
  cash: LiveMoney | Restricted | null; withholding: LiveMoney | Restricted | null; credits: LiveMoney | Restricted | null;
  adjustments: LiveMoney | Restricted | null; outstanding: LiveMoney | Restricted | null;
  settlement_state: string; delivery_state: string;
  follow_up: { owner: { id: string; ref_code: string; name: string }; date: string | null } | null;
};

export type ApiAgeing = { current: LiveMoney; d30: LiveMoney; d60: LiveMoney; d90: LiveMoney; total: LiveMoney };

/** Invoice as the screen uses it; id stays the invoice number for display, uuid is what the API takes. */
export type LiveInvoice = Invoice & { uuid: string; ownerName?: string };

/** A missing or fenced amount is an error, never a silent zero. */
function amount(m: LiveMoney | Restricted | null | undefined, field: string, invoiceNo: string): number {
  const v = rupees(m);
  if (v == null) throw new ApiFailure(0, 'BAD_SHAPE', `Invoice ${invoiceNo} has no ${field} amount.`);
  return v;
}

const day = (d: string) => String(d).slice(0, 10);

export function toInvoice(r: ApiInvoice): LiveInvoice {
  return {
    id: r.invoice_no,
    uuid: r.id,
    client: r.client,
    project: r.project.code,
    issue: day(r.issue_date),
    due: day(r.due_date),
    gross: amount(r.gross, 'gross', r.invoice_no),
    cash: amount(r.cash, 'cash', r.invoice_no),
    withholding: amount(r.withholding, 'withholding', r.invoice_no),
    credits: amount(r.credits, 'credits', r.invoice_no),
    dispute: 'None',
    ownerId: r.follow_up?.owner.ref_code ?? '',
    ownerName: r.follow_up?.owner.name,
    followUp: r.follow_up?.date ? day(r.follow_up.date) : null,
    overdueDays: Number(r.overdue_days) || 0,
  };
}

export type AgeingBuckets = { current: number; d30: number; d60: number; d90: number; total: number };

export function toAgeing(a: ApiAgeing): AgeingBuckets {
  const pick = (k: keyof ApiAgeing) => {
    const v = rupees(a[k]);
    if (v == null) throw new ApiFailure(0, 'BAD_SHAPE', `Ageing has no ${k} bucket.`);
    return v;
  };
  return { current: pick('current'), d30: pick('d30'), d60: pick('d60'), d90: pick('d90'), total: pick('total') };
}

export type SettlementKind = 'cash' | 'withholding' | 'credit_applied';

export async function getLiveReceivables(): Promise<{ invoices: LiveInvoice[]; ageing: AgeingBuckets }> {
  const [list, ageing] = await Promise.all([
    apiFetch<ListResponse<ApiInvoice>>('/receivables?page_size=200'),
    apiFetch<ApiAgeing>('/receivables/ageing'),
  ]);
  return { invoices: list.data.map(toInvoice), ageing: toAgeing(ageing) };
}

export function recordSettlement(uuid: string, body: { kind: SettlementKind; amount: number; date: string; reference?: string }, idempotencyKey: string) {
  return apiFetch<{ settlement_id: string; invoice: ApiInvoice; audit_event_id: string }>(`/receivables/${uuid}/settlements`, {
    method: 'POST',
    body: { kind: body.kind, amount: body.amount.toFixed(2), date: body.date, reference: body.reference || undefined },
    idempotencyKey,
  });
}

/** The amount field's own error from a 400/422 settlement refusal, or null when the error is not about the amount. */
export function amountErrorOf(e: unknown): string | null {
  if (!(e instanceof ApiFailure) || (e.status !== 422 && e.status !== 400)) return null;
  const onAmount = e.details.some((d) => typeof d === 'object' && d !== null && (d as { field?: string }).field === 'amount');
  return onAmount || e.status === 422 ? e.message : null;
}
