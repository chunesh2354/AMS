import { describe, expect, it } from 'vitest';
import { ApiFailure } from '../live';
import { amountErrorOf, toAgeing, toInvoice, type ApiInvoice } from './receivables';

const m = (amount: string) => ({ amount, currency: 'INR' });

/** Copied from the shape of view() in apps/api/src/modules/receivables.ts. */
const ROW: ApiInvoice = {
  id: '6f1c2d3e-0000-4000-8000-000000000001', invoice_no: 'INV-2026-014', external_id: 'ZB-1014', client: 'Asha Developers',
  project: { id: '6f1c2d3e-0000-4000-8000-0000000000aa', code: 'PRJ-01', name: 'Lakeview Residences' },
  issue_date: '2026-09-01', due_date: '2026-10-01', overdue_days: 38,
  gross: m('118000.00'), tax: m('18000.00'), net: m('100000.00'),
  cash: m('50000.00'), withholding: m('10000.00'), credits: m('0.00'), adjustments: m('0.00'), outstanding: m('58000.00'),
  settlement_state: 'part_settled', delivery_state: 'delivered',
  follow_up: { owner: { id: '6f1c2d3e-0000-4000-8000-0000000000p1', ref_code: 'P10', name: 'Neha Kapoor' }, date: '2026-11-10' },
};

describe('toInvoice', () => {
  it('keeps gross, cash, withholding and credits as four separate numbers', () => {
    const i = toInvoice(ROW);
    expect(i).toMatchObject({ id: 'INV-2026-014', uuid: ROW.id, client: 'Asha Developers', project: 'PRJ-01', issue: '2026-09-01', due: '2026-10-01', gross: 118000, cash: 50000, withholding: 10000, credits: 0, overdueDays: 38, dispute: 'None' });
  });

  it('maps the follow-up owner by ref code and keeps the server name', () => {
    expect(toInvoice(ROW)).toMatchObject({ ownerId: 'P10', ownerName: 'Neha Kapoor', followUp: '2026-11-10' });
  });

  it('shows no follow-up when the server has none', () => {
    const i = toInvoice({ ...ROW, follow_up: null });
    expect(i.followUp).toBeNull();
    expect(i.ownerName).toBeUndefined();
  });

  it('reads overdue days sent as a string', () => {
    expect(toInvoice({ ...ROW, overdue_days: '91' }).overdueDays).toBe(91);
  });

  it('refuses a missing amount instead of a silent zero', () => {
    expect(() => toInvoice({ ...ROW, withholding: null })).toThrow(ApiFailure);
  });

  it('refuses a fenced amount instead of a silent zero', () => {
    expect(() => toInvoice({ ...ROW, cash: { restricted: true } })).toThrow(/cash/);
  });
});

describe('toAgeing', () => {
  it('reads the four buckets and the total', () => {
    expect(toAgeing({ current: m('1000.00'), d30: m('2000.50'), d60: m('0.00'), d90: m('300.00'), total: m('3300.50') }))
      .toEqual({ current: 1000, d30: 2000.5, d60: 0, d90: 300, total: 3300.5 });
  });

  it('refuses a missing bucket', () => {
    expect(() => toAgeing({ current: m('1.00'), d30: m('0.00'), d60: m('0.00'), d90: undefined as never, total: m('1.00') })).toThrow(ApiFailure);
  });
});

describe('amountErrorOf', () => {
  it('puts an F14 422 on the amount field', () => {
    const e = new ApiFailure(422, 'RULE_VIOLATION', 'That is more than the 58000.00 outstanding.', [{ field: 'amount', code: 'over_outstanding' }]);
    expect(amountErrorOf(e)).toBe('That is more than the 58000.00 outstanding.');
  });

  it('puts a 400 about the amount inline', () => {
    expect(amountErrorOf(new ApiFailure(400, 'VALIDATION', 'Amount must be above zero.', [{ field: 'amount', code: 'range' }]))).toBe('Amount must be above zero.');
  });

  it('leaves other failures to the toast', () => {
    expect(amountErrorOf(new ApiFailure(403, 'FORBIDDEN_CAPABILITY', 'No', []))).toBeNull();
    expect(amountErrorOf(new ApiFailure(400, 'VALIDATION', 'Unknown settlement kind.', [{ field: 'kind', code: 'unknown' }]))).toBeNull();
    expect(amountErrorOf(new Error('x'))).toBeNull();
  });
});
