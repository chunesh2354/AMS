import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { routes } from '../../router';
import { SessionProvider } from '../../app/session';
import { ToastProvider } from '../../ui/Toast';
import { TODAY } from '../../mock/studio-meridian';
import { defaultSettlementDate } from './receivables';

// A VITE_LIVE=1 build: the settlement date must be the firm's today, never the sample studio's 2026-11-06.
vi.mock('../../api/live', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/live')>()), isLive: true }));

type Reply = { status: number; body: unknown } | undefined;
let handler: (url: string, init: RequestInit) => Reply;
const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const r = handler(String(input), init) ?? { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Not found' } } };
  return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
});
const list = (data: unknown[]) => ({ status: 200, body: { data, page: 1, page_size: 200, total: data.length, complete: true, missing_count: 0 } });
const inr = (amount: string) => ({ amount, currency: 'INR' });

// Kiritimati is UTC+14: at 12:00 UTC on 9 Nov it is already 10 Nov there, so the UTC date would be wrong too.
const FIRM_TZ = 'Pacific/Kiritimati';
const NOW = new Date('2026-11-09T12:00:00Z');

const ME = {
  status: 200,
  body: {
    person: { id: 'u-me', ref_code: 'P07', name: 'Kavya Rao', work_email: 'kavya@harbour.test', job_title: 'Finance', manager_id: null },
    firm: { id: 'f', trading_name: 'Harbour Works', legal_name: 'Harbour Works LLP', currency: 'INR', timezone: FIRM_TZ, accounting_adapter: 'mock' },
    permission_sets: ['finance'], capabilities: { 'receivables.manage': 'firm', 'billing.prepare': 'firm' }, led_projects: [], member_projects: [],
  },
};
const INVOICE = {
  id: 'inv-uuid-1', invoice_no: 'HW-INV-0001', external_id: null, client: 'Port Trust',
  project: { id: 'prj-1', code: 'HW-01', name: 'Harbour Pavilion' },
  issue_date: '2026-10-01', due_date: '2026-10-31', overdue_days: 9,
  gross: inr('100000.00'), tax: inr('0.00'), net: inr('100000.00'), cash: inr('0.00'), withholding: inr('0.00'), credits: inr('0.00'),
  adjustments: inr('0.00'), outstanding: inr('100000.00'), settlement_state: 'Open', delivery_state: 'Sent', follow_up: null,
};
const AGEING = { current: inr('100000.00'), d30: inr('0.00'), d60: inr('0.00'), d90: inr('0.00'), total: inr('100000.00') };

beforeEach(() => { vi.stubGlobal('fetch', fetchMock); fetchMock.mockClear(); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('defaultSettlementDate', () => {
  it('is the firm-zone date in live mode and the sample date in mock mode', () => {
    expect(defaultSettlementDate(true, FIRM_TZ, NOW)).toBe('2026-11-10');
    expect(defaultSettlementDate(true, 'America/New_York', new Date('2026-11-09T03:00:00Z'))).toBe('2026-11-08');
    expect(defaultSettlementDate(true, undefined, new Date('2026-11-09T20:00:00Z'))).toBe('2026-11-10');
    expect(defaultSettlementDate(false, FIRM_TZ, NOW)).toBe(TODAY);
  });
});

describe('live receivables', () => {
  it('posts a settlement dated today in the firm time zone, not the sample studio date', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    let posted: Record<string, unknown> | null = null;
    handler = (url, init) => {
      if (url.endsWith('/me')) return ME;
      if (url.endsWith('/notifications')) return list([]);
      if (url.endsWith('/timers/active')) return { status: 200, body: { active: null } };
      if (url.includes('/approvals')) return list([]);
      if (url.includes('/receivables/ageing')) return { status: 200, body: AGEING };
      if (url.includes('/settlements') && init.method === 'POST') {
        posted = JSON.parse(String(init.body));
        return { status: 201, body: { settlement_id: 's1', invoice: INVOICE, audit_event_id: 'a1' } };
      }
      if (url.includes('/receivables?')) return list([INVOICE]);
      return undefined;
    };
    const router = createMemoryRouter(routes, { initialEntries: ['/firm/receivables'] });
    render(<SessionProvider><ToastProvider><RouterProvider router={router} /></ToastProvider></SessionProvider>);
    await screen.findByText('HW-INV-0001');
    await userEvent.click(screen.getByRole('button', { name: 'Record settlement' }));
    const sheet = await screen.findByRole('dialog', { name: 'Record settlement' });
    await userEvent.type(within(sheet).getByLabelText('Cash amount'), '25000');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save settlement' }));
    await waitFor(() => expect(posted).not.toBeNull());
    expect(posted).toMatchObject({ kind: 'cash', amount: '25000.00', date: '2026-11-10' });
    expect(posted!.date).not.toBe(TODAY);
  });
});
