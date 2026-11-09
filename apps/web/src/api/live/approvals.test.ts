import { describe, expect, it } from 'vitest';
import { amountText, batchMessage, exceptionText, historyOf, mapApproval, mapDelegates, periodText, type LiveApproval, type LivePerson } from './approvals';

// Fixtures follow view() in apps/api/src/modules/approvals.ts: hours() gives "38.50", money() gives { amount, currency }.
const timeItem: LiveApproval = {
  id: '6f1c2e9a-0000-4000-8000-000000000001', type: 'time', status: 'Pending', record_type: 'timesheet', record_id: 'ts-1',
  submitter: { id: 'p05', name: 'Rohan Shetty' }, approver: { id: 'p02', name: 'Vikram Nair' }, delegated_to_id: null,
  project: { code: 'PRJ-01', name: 'Harbour Library' }, exception_flags: ['over_12h_day'], age_days: 1,
  period: { start: '2026-11-02', end: '2026-11-08' }, hours: '38.50', amount: null, draft_no: null,
  lines: [
    { id: 'te-1', service_date: '2026-11-05', duration_hours: '12.50', approval_state: 'Submitted', note: null, correction_reason: null },
    { id: 'te-2', service_date: '2026-11-06', duration_hours: '8.00', approval_state: 'Submitted', note: null, correction_reason: null },
  ],
  history: [{ action: 'return', reason: 'Split Thursday', at: '2026-11-07T05:30:00.000Z', actor: 'Vikram Nair' }],
};

const draftItem: LiveApproval = {
  ...timeItem, id: 'd-1', type: 'billing_draft', record_type: 'billing_draft', project: { code: 'PRJ-02', name: 'Lakeside' },
  exception_flags: [], age_days: 3, period: null, hours: null, amount: { amount: '125000.00', currency: 'INR' }, draft_no: 'BD-0007', lines: [], history: [],
};

describe('mapApproval', () => {
  it('maps a timesheet request with hours, period, exception and history', () => {
    const a = mapApproval(timeItem);
    expect(a).toMatchObject({ id: timeItem.id, type: 'Time', submitter: 'Rohan Shetty', project: 'PRJ-01', period: '02 to 08 Nov', amount: '38.50 h', ageDays: 1, approver: 'Vikram Nair', exception: 'Over 12 h day' });
    expect(a.evidence).toEqual(['Timesheet, week of 02 Nov', '2 time entries']);
    expect(a.history[0].text).toBe('Returned by Vikram Nair: Split Thursday');
    expect(a.history[0].time).toMatch(/07 Nov/);
  });

  it('maps a billing draft with en-IN rupees and no exception', () => {
    const a = mapApproval(draftItem);
    expect(a.type).toBe('Billing drafts');
    expect(a.amount).toBe('₹1,25,000');
    expect(a.period).toBe('Draft BD-0007');
    expect(a.exception).toBeUndefined();
    expect(a.evidence).toEqual(['Billing draft BD-0007']);
  });

  it('labels internal time without a project', () => {
    expect(mapApproval({ ...timeItem, type: 'internal_time', project: null }).project).toBe('Internal time');
  });
});

describe('amountText', () => {
  it('shows Restricted for a fenced value', () => {
    expect(amountText({ hours: null, amount: { restricted: true } })).toBe('Restricted');
    expect(amountText({ hours: { restricted: true }, amount: null })).toBe('Restricted');
  });
  it('never turns a missing value into zero', () => {
    expect(amountText({ hours: null, amount: null })).toBe('Not recorded');
    expect(amountText({ hours: '0.00', amount: null })).toBe('0.00 h');
  });
});

describe('helpers', () => {
  it('formats periods across months and missing periods', () => {
    expect(periodText({ start: '2026-10-26', end: '2026-11-01' }, null)).toBe('26 Oct to 01 Nov');
    expect(periodText(null, null)).toBe('Not recorded');
  });
  it('joins and humanises exception flags', () => {
    expect(exceptionText([])).toBeUndefined();
    expect(exceptionText(['over_12h_day', 'late_submission'])).toBe('Over 12 h day, Late submission');
  });
  it('keeps an empty history empty', () => {
    expect(historyOf([])).toEqual([]);
  });
  it('counts approved and skipped from the batch response', () => {
    expect(batchMessage({ approved: ['a', 'b'], skipped: [{ id: 'c', reason: 'over_12h_day' }] })).toBe('2 approved. 1 skipped.');
    expect(batchMessage({ approved: ['a'], skipped: [] })).toBe('1 approved.');
  });
  it('offers only enabled, active people as delegates', () => {
    const people: LivePerson[] = [
      { id: 'u1', ref_code: 'P02', name: 'Vikram Nair', job_title: 'Project manager', manager_id: null, employment_state: 'Active', login_state: 'Enabled' },
      { id: 'u2', ref_code: 'P09', name: 'Gone', job_title: null, manager_id: null, employment_state: 'Left', login_state: 'Disabled' },
      { id: 'u3', ref_code: 'P03', name: 'Meera Iyer', job_title: null, manager_id: null, employment_state: 'Active', login_state: 'Enabled' },
    ];
    expect(mapDelegates(people)).toEqual([
      { id: 'u1', name: 'Vikram Nair', title: 'Project manager' },
      { id: 'u3', name: 'Meera Iyer', title: 'P03' },
    ]);
  });
});

describe('self-approval', () => {
  it("marks a sole principal's own work, and only that", () => {
    expect(mapApproval({ ...timeItem, self_approval: true }).selfApproval).toBe(true);
    expect(mapApproval({ ...timeItem, self_approval: false }).selfApproval).toBe(false);
    expect(mapApproval(timeItem).selfApproval).toBe(false);
  });
});
