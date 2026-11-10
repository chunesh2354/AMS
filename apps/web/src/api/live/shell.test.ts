import { afterEach, describe, expect, it, vi } from 'vitest';
import { approvalsBadge, firmFromMe } from './shell';
import { pendingApprovalCount } from './approvals';
import { timerFromActive, todayIn } from './time';
import { FIRM_NAV, MOCK_APPROVALS_BADGE, firmNav, firmTabs } from '../../app/nav';

const approvalsItem = (sections: ReturnType<typeof firmNav>) => sections.flatMap((s) => s.items).find((i) => i.to === '/firm/approvals')!;

describe('the signed-in firm (GET /me)', () => {
  it('uses the trading name, then the legal name, and keeps the time zone and currency', () => {
    expect(firmFromMe({ id: 'f', trading_name: 'Harbour Works', legal_name: 'Harbour Works LLP', currency: 'INR', timezone: 'Asia/Kolkata' }))
      .toEqual({ name: 'Harbour Works', timezone: 'Asia/Kolkata', currency: 'INR' });
    expect(firmFromMe({ id: 'f', trading_name: ' ', legal_name: 'Harbour Works LLP', currency: 'INR', timezone: 'Asia/Dubai' })?.name).toBe('Harbour Works LLP');
  });
  it('never falls back to the sample studio', () => {
    expect(firmFromMe({ id: 'f', trading_name: null, legal_name: null, currency: '', timezone: '' })).toEqual({ name: '', timezone: 'Asia/Kolkata', currency: 'INR' });
    expect(firmFromMe(undefined)).toBeUndefined();
  });
});

describe('Approvals badge', () => {
  it('shows a real count and hides zero or an unknown count', () => {
    expect(approvalsBadge(3)).toBe(3);
    expect(approvalsBadge(0)).toBeUndefined();
    expect(approvalsBadge(null)).toBeUndefined();
  });
  it('the mock nav keeps its sample count; the live nav carries only what it is given', () => {
    expect(approvalsItem(FIRM_NAV).badge).toBe(MOCK_APPROVALS_BADGE);
    expect(approvalsItem(firmNav()).badge).toBeUndefined();
    expect(approvalsItem(firmNav(7)).badge).toBe(7);
    const more = firmTabs(() => {}, firmNav(7)).find((t) => t.label === 'More')!;
    expect(more.menu?.map((m) => ('label' in m ? m.label : ''))).toContain('Billing');
  });
});

describe('pendingApprovalCount', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('reads the total of the pending queue, one row fetched', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [{}], page: 1, page_size: 1, total: 5, complete: true, missing_count: 0 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await pendingApprovalCount()).toBe(5);
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe('/api/v1/approvals?status=Pending&page_size=1');
  });
  it('throws when the server refuses, so the shell can hide the badge', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":{"code":"INTERNAL","message":"x"}}', { status: 500 })));
    await expect(pendingApprovalCount()).rejects.toMatchObject({ status: 500 });
  });
});

describe('todayIn', () => {
  it('is the studio date, not the UTC date', () => {
    // 20:00 UTC on 9 Nov is 01:30 on 10 Nov in Bengaluru.
    expect(todayIn('Asia/Kolkata', new Date('2026-11-09T20:00:00Z'))).toBe('2026-11-10');
    expect(todayIn('Asia/Kolkata', new Date('2026-11-09T10:00:00Z'))).toBe('2026-11-09');
    expect(todayIn('America/New_York', new Date('2026-11-09T03:00:00Z'))).toBe('2026-11-08');
  });
  it('falls back to the studio default for an unknown or missing zone', () => {
    expect(todayIn('Not/AZone', new Date('2026-11-09T20:00:00Z'))).toBe('2026-11-10');
    expect(todayIn(undefined, new Date('2026-11-09T20:00:00Z'))).toBe('2026-11-10');
  });
  it('never returns the mock date', () => {
    expect(todayIn('Asia/Kolkata', new Date('2027-01-15T06:00:00Z'))).toBe('2027-01-15');
  });
});

describe('timerFromActive (GET /timers/active)', () => {
  const now = new Date('2026-11-09T10:00:00Z');
  it('is null when nothing runs', () => {
    expect(timerFromActive(null, now)).toBeNull();
    expect(timerFromActive({ id: 't', started_at: 'not a date', phase_name: null, project_code: null, internal_category_id: null }, now)).toBeNull();
  });
  it('gives elapsed seconds and the project and phase', () => {
    expect(timerFromActive({ id: 't', started_at: '2026-11-09T09:30:00Z', phase_name: 'Concept', project_code: 'LV-77', internal_category_id: null }, now))
      .toEqual({ elapsed: 1800, context: 'LV-77 · Concept' });
    expect(timerFromActive({ id: 't', started_at: '2026-11-09T09:59:00Z', phase_name: null, project_code: null, internal_category_id: 'c1' }, now))
      .toEqual({ elapsed: 60, context: 'Internal work' });
  });
});
