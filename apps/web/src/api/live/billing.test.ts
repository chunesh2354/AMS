import { describe, expect, it } from 'vitest';
import { RESTRICTED } from '../../ui/DataTable';
import { cellMoney, draftStatus, mapAccounting, mapDraft, mapException, mapReadyItem, mapWip, type LiveDraftRaw, type LiveExceptionRaw, type LiveReadyItemRaw, type LiveWipRaw } from './billing';

const proj = { id: 'u-1', code: 'PRJ-01', name: 'Lakeview Residence' };
const inr = (amount: string) => ({ amount, currency: 'INR' });

// Shapes copied from apps/api/src/modules/billing.ts itemView / exceptionView / draftView / wip and integrations.ts.
const readyRaw: LiveReadyItemRaw = {
  id: 'time:te-1', project: proj, component: 'Design development', billing_method: 'hourly', phase: 'DD', line_type: 'time', label: 'Hourly time, DD',
  basis: { hours: '6.00' }, previous_net_billing: inr('0.00'), current_claim: inr('25000.00'), remaining_entitlement: null, status: 'Eligible',
};
const excRaw: LiveExceptionRaw = {
  id: 'nte:fc-1', project: proj, component: 'Site visits', title: 'Site visits over not-to-exceed', status: 'Excess', hours: '10.00',
  cap: inr('100000.00'), consumed: inr('80000.00'), requested: inr('30000.00'), eligible: inr('20000.00'), excess: inr('10000.00'),
};
const draftRaw: LiveDraftRaw = {
  id: 'd-uuid', draft_no: 'DRAFT-0001', project: proj, client: 'Orchard Developers', cutoff_date: '2026-11-06', prepared_by: 'Meera Rao',
  approval_state: 'Approved', accounting_state: 'Finalized', pm_confirmed: true, total: inr('25000.00'),
  external_invoice: { id: 'inv-1', invoice_no: 'INV-MOCK-0001' }, job: { status: 'Succeeded', last_error: null, adapter: 'mock' },
  lines: [{
    id: 'l-1', label: 'Hourly time, DD', line_type: 'time', phase: 'DD', component: 'Design development', calculation_basis: { hours: '6.00', rate: inr('4166.67') },
    previous_net_billing: inr('0.00'), current_claim: inr('25000.00'), remaining_entitlement: null, tax_mapping_code: null,
    sources: [{ type: 'time_entry', id: 'te-1', amount: inr('25000.00'), service_date: '2026-11-03', hours: '6.00', person: 'Rohan Iyer' }],
  }],
};

describe('live billing mapping', () => {
  it('maps a ready item to the table shape with rupees', () => {
    expect(mapReadyItem(readyRaw)).toEqual({ id: 'time:te-1', project: 'PRJ-01', projectName: 'Lakeview Residence', component: 'Design development', basis: 'Hourly time, DD', status: 'Eligible', amount: 25000 });
  });

  it('never turns a fenced or missing amount into 0', () => {
    expect(cellMoney({ restricted: true })).toBe(RESTRICTED);
    expect(cellMoney(null)).toBeNull();
    expect(cellMoney(undefined)).toBeNull();
    expect(mapReadyItem({ ...readyRaw, current_claim: { restricted: true } }).amount).toBe(RESTRICTED);
    expect(mapException({ ...excRaw, excess: { restricted: true } }).excess).toBe(RESTRICTED);
  });

  it('maps exceptions with eligible and excess', () => {
    const e = mapException(excRaw);
    expect(e).toMatchObject({ id: 'nte:fc-1', project: 'PRJ-01', limit: 100000, billed: 80000, requested: 30000, eligible: 20000, excess: 10000, status: 'Excess' });
  });

  it('maps a draft with lines, sources as detail, basis panel and invoice number', () => {
    const d = mapDraft(draftRaw);
    expect(d.id).toBe('DRAFT-0001');
    expect(d.status).toBe('Finalized');
    expect(d.amount).toBe(25000);
    expect(d.lines[0]).toMatchObject({ id: 'l-1', name: 'Hourly time, DD', source: 'time', qty: 1, amount: 25000 });
    expect(d.lines[0].detail).toBe('2026-11-03 · Rohan Iyer · 6.00 h');
    expect(d.basis).toEqual([{ label: 'Hourly time, DD: hours', value: '6.00' }, { label: 'Hourly time, DD: rate', value: '4166.67' }]);
    expect(d.live).toEqual({ uuid: 'd-uuid', approvalState: 'Approved', accountingState: 'Finalized', pmConfirmed: true, invoiceNo: 'INV-MOCK-0001', jobError: null });
  });

  it('shows Restricted in the basis panel for a fenced basis value', () => {
    const d = mapDraft({ ...draftRaw, lines: [{ ...draftRaw.lines![0], calculation_basis: { rate: { restricted: true } } }] });
    expect(d.basis).toEqual([{ label: 'Hourly time, DD: rate', value: 'Restricted' }]);
  });

  it('derives draft status from approval, then accounting', () => {
    expect(draftStatus({ approval_state: 'In review', accounting_state: 'Not sent' })).toBe('In review');
    expect(draftStatus({ approval_state: 'Approved', accounting_state: 'Uncertain' })).toBe('Uncertain');
    expect(draftStatus({ approval_state: 'Approved', accounting_state: 'Pending' })).toBe('Pending (accounting)');
  });

  it('maps WIP without a silent zero when a part is missing', () => {
    const w: LiveWipRaw = { project: proj, awaiting_approval_hours: '0', approved_unbilled_hours: '6.00', reserved_hours: '0', ready: inr('25000.00'), in_drafts: inr('5000.00'), invoiced: inr('10000.00'), label: 'Operational, not statutory accounting WIP' };
    expect(mapWip(w)).toMatchObject({ project: 'PRJ-01', entitled: 40000, invoiced: 10000, label: 'Operational, not statutory accounting WIP' });
    expect(mapWip({ ...w, in_drafts: null }).entitled).toBeNull();
    expect(mapWip({ ...w, ready: { restricted: true } }).entitled).toBe(RESTRICTED);
  });

  it('keeps the MOCK mode from /integrations', () => {
    const a = mapAccounting({ accounting: { adapter: 'mock', label: 'Mock accounting adapter', mode: 'MOCK', last_success: null, last_error: null } });
    expect(a).toMatchObject({ adapter: 'Mock accounting adapter', mode: 'MOCK', status: 'Enabled', lastSuccess: 'Not set' });
  });
});
