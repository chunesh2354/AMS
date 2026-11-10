import { describe, expect, it } from 'vitest';
import { leaveDates, leaveStatus, leaveStrip, mapBalances, mapLeaveRequest, type LiveLeaveBalance, type LiveLeaveRequest } from './leave';
import { mapApproval, periodText, type LiveApproval } from './approvals';

// Shapes follow requestView() and leaveBalances() in apps/api/src/modules/leave/leave.routes.ts.
const req = (extra: Partial<LiveLeaveRequest> = {}): LiveLeaveRequest => ({
  id: 'l-1', leave_type: { id: 't-1', key: 'earned', name: 'Earned leave' }, start_date: '2026-11-16', end_date: '2026-11-17', half_day: false,
  days: '2.00', hours: '16.00', status: 'Approved', reason: null, handover_note: null, approver: { id: 'p02', name: 'Vikram Nair' },
  approval_request_id: null, decided_at: null, decision_reason: null, can_withdraw: true, ...extra,
});

describe('live leave mapping', () => {
  it('words dates as the mock does', () => {
    expect(leaveDates('2026-11-20', '2026-11-20')).toBe('20 Nov 2026');
    expect(leaveDates('2026-11-16', '2026-11-17')).toBe('16 to 17 Nov 2026');
    expect(leaveDates('2026-11-30', '2026-12-02')).toBe('30 Nov to 02 Dec 2026');
  });

  it('maps statuses onto the status vocabulary', () => {
    expect(['Pending', 'Approved', 'Returned', 'Rejected', 'Withdrawn', 'Odd'].map(leaveStatus)).toEqual(['Pending (approval)', 'Approved', 'Returned', 'Rejected', 'Cancelled', 'None']);
  });

  it('maps a request to a table row with hours, approver and whether it can be withdrawn', () => {
    expect(mapLeaveRequest(req(), 'p04')).toEqual({
      id: 'l-1', personId: 'p04', type: 'Earned leave', dates: '16 to 17 Nov 2026', hours: 16, status: 'Approved', canWithdraw: true, approver: 'Vikram Nair', decisionReason: null,
    });
    expect(mapLeaveRequest(req({ half_day: true, hours: '4.00', approver: null, can_withdraw: false }), 'p04')).toMatchObject({ type: 'Earned leave, half days', hours: 4, approver: undefined, canWithdraw: false });
  });

  it('shows balance tiles only for types that keep a balance', () => {
    const b: LiveLeaveBalance[] = [
      { leave_type: { id: 't-1', key: 'earned', name: 'Earned leave' }, tracks_balance: true, allowance_days: '14.00', taken_days: '2.00', pending_days: '0.00', available_days: '12.00' },
      { leave_type: { id: 't-4', key: 'unpaid', name: 'Unpaid leave' }, tracks_balance: false, allowance_days: null, taken_days: '0.00', pending_days: '0.00', available_days: null },
    ];
    expect(mapBalances(b)).toEqual([{ label: 'Earned leave', days: 12 }]);
  });

  it('builds 12 weeks from the studio today and marks leave days, ignoring withdrawn leave', () => {
    const strip = leaveStrip('2026-11-10', [req(), req({ id: 'l-2', start_date: '2026-11-18', end_date: '2026-11-18', half_day: true, status: 'Pending' }), req({ id: 'l-3', start_date: '2026-12-07', end_date: '2026-12-08', status: 'Withdrawn' })]);
    expect(strip).toHaveLength(12);
    expect(strip[0]).toEqual({ label: '09 Nov', today: true });
    expect(strip[1]).toEqual({ label: '16 Nov', kind: 'leave', note: 'Leave 2.5 d' });
    expect(strip[4]).toEqual({ label: '07 Dec' });
  });
});

describe('leave in the approvals inbox', () => {
  const item: LiveApproval = {
    id: 'a-1', type: 'leave', status: 'Pending', record_type: 'leave_request', record_id: 'l-9', submitter: { id: 'p06', name: 'Karan Bhat' },
    approver: { id: 'p03', name: 'Meera Iyer' }, delegated_to_id: null, project: null, exception_flags: [], age_days: 3,
    period: { start: '2026-11-20', end: '2026-11-20' }, hours: '8.00', amount: null, draft_no: null, lines: [], history: [],
    leave: { leave_type: { id: 't-1', key: 'earned', name: 'Earned leave' }, start_date: '2026-11-20', end_date: '2026-11-20', half_day: false, days: '1.00', reason: null, handover_note: 'Sneha has the set', status: 'Pending' },
  };

  it('files it under Leave with the type, the day and the hours, as the mock row does', () => {
    expect(mapApproval(item)).toMatchObject({ type: 'Leave', submitter: 'Karan Bhat', project: 'Earned leave', period: '20 Nov', amount: '8.00 h', ageDays: 3, approver: 'Meera Iyer' });
    expect(mapApproval(item).evidence).toEqual(['Earned leave, 1.00 day', 'Handover: Sneha has the set']);
  });

  it('words a range as before and a single day on its own', () => {
    expect(periodText({ start: '2026-12-04', end: '2026-12-05' }, null)).toBe('04 to 05 Dec');
    expect(periodText({ start: '2026-11-20', end: '2026-11-20' }, null)).toBe('20 Nov');
  });
});
