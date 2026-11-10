import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SessionProvider } from '../../app/session';
import { ToastProvider } from '../../ui/Toast';
import { RatesSettings } from './rates';

vi.mock('../../api/live', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/live')>()), isLive: true }));

type Handler = (url: string, init: RequestInit) => { status: number; body: unknown } | undefined;
let handler: Handler;
const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const r = handler(String(input), init) ?? { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Not found' } } };
  return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
});
const list = (data: unknown[]) => ({ status: 200, body: { data, page: 1, page_size: 200, total: data.length, complete: true, missing_count: 0 } });
const bodyOf = (init: RequestInit) => JSON.parse(String(init.body ?? '{}'));
const inr = (n: number) => ({ amount: n.toFixed(2), currency: 'INR' });

const me = (capabilities: Record<string, string>) => ({
  status: 200,
  body: {
    person: { id: 'u-me', ref_code: 'P01', name: 'Asha Rao', work_email: 'p01@firm.test', job_title: 'Principal', manager_id: null },
    firm: { id: 'f1', trading_name: 'Studio', legal_name: 'Studio LLP', currency: 'INR', timezone: 'Asia/Kolkata', accounting_adapter: 'mock' },
    permission_sets: ['principal'], capabilities, led_projects: [], member_projects: [],
  },
});
const person = (id: string, ref: string, name: string) => ({ id, ref_code: ref, name, job_title: 'Architect', employment_state: 'Active' });
const FULL = [
  { person: person('u-vikram', 'P02', 'Vikram Nair'), bill_rate: { id: 'b2', amount: inr(3000), effective_from: '2026-01-01' }, cost_rate: { id: 'c2', amount: inr(1234), effective_from: '2026-01-01' } },
  { person: person('u-nisha', 'P09', 'Nisha Kumar'), bill_rate: { id: 'b9', amount: inr(800), effective_from: '2026-01-01' }, cost_rate: null },
];
const FENCED = FULL.map((r) => ({ ...r, cost_rate: { restricted: true } }));

beforeEach(() => { vi.stubGlobal('fetch', fetchMock); fetchMock.mockClear(); });
afterEach(() => vi.unstubAllGlobals());

const openRates = () => render(<SessionProvider><ToastProvider><MemoryRouter><RatesSettings /></MemoryRouter></ToastProvider></SessionProvider>);

describe('Rates settings, live mode', () => {
  it('shows bill and cost rates to a holder of rates.cost.view', async () => {
    handler = (url) => (url.endsWith('/me') ? me({ 'rates.bill.manage': 'firm', 'rates.cost.view': 'firm', 'rates.cost.manage': 'firm' }) : url.includes('/rates') ? list(FULL) : undefined);
    openRates();
    const table = (await screen.findByText('Vikram Nair')).closest('table')!;
    expect(within(table).getByRole('columnheader', { name: /Cost rate per hour/ })).toBeInTheDocument();
    expect(table).toHaveTextContent('3,000');
    expect(table).toHaveTextContent('1,234');
    expect(screen.getByRole('button', { name: 'Add rate version' })).toBeInTheDocument();
  });

  it('hides the cost column from a bill-rate manager without rates.cost.view', async () => {
    handler = (url) => (url.endsWith('/me') ? me({ 'rates.bill.manage': 'firm' }) : url.includes('/rates') ? list(FENCED) : undefined);
    openRates();
    const table = (await screen.findByText('Vikram Nair')).closest('table')!;
    expect(within(table).queryByRole('columnheader', { name: /Cost rate/ })).toBeNull();
    expect(table).toHaveTextContent('3,000');
    expect(table).not.toHaveTextContent('1,234');
  });

  it('adds a bill rate version through POST /rates and reloads', async () => {
    let posted: Record<string, unknown> | null = null;
    handler = (url, init) => {
      if (url.endsWith('/me')) return me({ 'rates.bill.manage': 'firm' });
      if (url.endsWith('/rates') && init.method === 'POST') { posted = bodyOf(init); return { status: 200, body: { id: 'r-new', audit_event_id: 'e1' } }; }
      if (url.includes('/rates')) return list(FENCED);
      return undefined;
    };
    openRates();
    await screen.findByText('Vikram Nair');
    await userEvent.click(screen.getByRole('button', { name: 'Add rate version' }));
    const sheet = await screen.findByRole('dialog', { name: 'Add rate version' });
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save rate' }));
    expect(within(sheet).getByText('Choose a person')).toBeInTheDocument();
    expect(within(sheet).getByText('Enter a rate per hour')).toBeInTheDocument();
    expect(posted).toBeNull();

    const who = within(sheet).getByRole('combobox', { name: 'Person' });
    await userEvent.click(who);
    await userEvent.type(who, 'Vik');
    await userEvent.click(await screen.findByRole('option', { name: /Vikram Nair/ }));
    await userEvent.type(within(sheet).getByLabelText('Rate per hour'), '3500');
    await userEvent.type(within(sheet).getByLabelText('Reason'), 'Annual review');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save rate' }));
    expect(await screen.findByText('New bill rate for Vikram Nair saved.')).toBeInTheDocument();
    expect(posted).toMatchObject({ person_id: 'u-vikram', rate_type: 'bill', amount: 3500, change_reason: 'Annual review' });
    expect(String((posted as unknown as { effective_from: string }).effective_from)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(fetchMock.mock.calls.filter(([u, i]) => String(u).endsWith('/rates') && ((i as RequestInit | undefined)?.method ?? 'GET') === 'GET').length).toBeGreaterThanOrEqual(2);
  });

  it('shows a server refusal in the sheet', async () => {
    handler = (url, init) => {
      if (url.endsWith('/me')) return me({ 'rates.bill.manage': 'firm' });
      if (url.endsWith('/rates') && init.method === 'POST') return { status: 409, body: { error: { code: 'OVERLAPPING_VERSION', message: 'This overlaps an existing version.' } } };
      if (url.includes('/rates')) return list(FENCED);
      return undefined;
    };
    openRates();
    await screen.findByText('Vikram Nair');
    await userEvent.click(screen.getByRole('button', { name: 'Add rate version' }));
    const sheet = await screen.findByRole('dialog', { name: 'Add rate version' });
    const who = within(sheet).getByRole('combobox', { name: 'Person' });
    await userEvent.click(who);
    await userEvent.type(who, 'Nis');
    await userEvent.click(await screen.findByRole('option', { name: /Nisha Kumar/ }));
    await userEvent.type(within(sheet).getByLabelText('Rate per hour'), '900');
    await userEvent.type(within(sheet).getByLabelText('Reason'), 'Promotion');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save rate' }));
    expect(await within(sheet).findByText(/A rate version already starts on or after this date/)).toBeInTheDocument();
  });

  it('shows the permission state when the server refuses the list', async () => {
    handler = (url) => (url.endsWith('/me') ? me({}) : url.includes('/rates') ? { status: 403, body: { error: { code: 'FORBIDDEN_CAPABILITY', message: 'You need rates.bill.manage for this.' } } } : undefined);
    openRates();
    expect(await screen.findByText(/manage rates/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add rate version' })).toBeNull();
  });
});
