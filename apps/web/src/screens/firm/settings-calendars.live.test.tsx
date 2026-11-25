import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SessionProvider } from '../../app/session';
import { ToastProvider } from '../../ui/Toast';
import { SettingsScreen } from './settings';

// A VITE_LIVE=1 build: Settings > Calendars lists and changes studio holidays through /holidays (planning.routes.ts).
vi.mock('../../api/live', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/live')>()), isLive: true }));

const ME = (sets: string[], caps: Record<string, string>) => ({
  person: { id: 'u-P01', ref_code: 'P01', name: 'Mira Kapoor', work_email: 'mira@harbour.test', job_title: 'Partner', manager_id: null },
  firm: { id: 'f1', trading_name: 'Harbour Works', legal_name: 'Harbour Works LLP', currency: 'INR', timezone: 'Asia/Kolkata', accounting_adapter: 'mock' },
  permission_sets: sets, capabilities: caps, led_projects: [], member_projects: [],
});
let me = ME(['principal'], { 'firm.settings.manage': 'firm', 'people.view': 'firm' });
let canManage = true;
let holidays = [{ id: 'h-1', date: '2026-11-20', name: 'Studio holiday', half_day: false }, { id: 'h-2', date: '2026-12-25', name: 'Christmas', half_day: false }];
const calls: { url: string; method: string; body?: unknown }[] = [];
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const method = init?.method ?? 'GET';
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  calls.push({ url, method, body });
  if (url === '/api/v1/me') return json(200, me);
  if (url === '/api/v1/holidays' && method === 'GET') return json(200, { from: '2026-01-01', to: '2027-12-31', can_manage: canManage, data: holidays, page: 1, page_size: 200, total: holidays.length, complete: true, missing_count: 0 });
  if (url === '/api/v1/holidays' && method === 'POST') {
    if (holidays.some((h) => h.date === body.date)) return json(409, { error: { code: 'HOLIDAY_EXISTS', message: `There is already a holiday on ${body.date}.` } });
    const h = { id: 'h-new', ...body };
    holidays = [...holidays, h].sort((a, b) => a.date.localeCompare(b.date));
    return json(200, { ...h, audit_event_id: 'e-1' });
  }
  if (url === '/api/v1/holidays/h-2' && method === 'DELETE') { holidays = holidays.filter((h) => h.id !== 'h-2'); return json(200, { id: 'h-2', deleted: true }); }
  return json(404, { error: { code: 'NOT_FOUND', message: 'Not found' } });
});
beforeEach(() => {
  calls.length = 0; canManage = true;
  me = ME(['principal'], { 'firm.settings.manage': 'firm', 'people.view': 'firm' });
  holidays = [{ id: 'h-1', date: '2026-11-20', name: 'Studio holiday', half_day: false }, { id: 'h-2', date: '2026-12-25', name: 'Christmas', half_day: false }];
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-10T06:00:00Z'));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

const open = () => render(
  <SessionProvider><ToastProvider>
    <MemoryRouter initialEntries={['/firm/settings/calendars']}><Routes><Route path="/firm/settings/*" element={<SettingsScreen />} /></Routes></MemoryRouter>
  </ToastProvider></SessionProvider>,
);

describe('Settings, Calendars in live mode', () => {
  it('lists the studio holidays from GET /holidays', async () => {
    open();
    const table = await screen.findByRole('table');
    expect(within(table).getByText('Studio holiday')).toBeInTheDocument();
    expect(within(table).getByText('25 Dec 2026')).toBeInTheDocument();
    expect(screen.queryByText('Not available yet')).toBeNull();
  });

  it('adds a holiday and says when the date is taken', async () => {
    open();
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('button', { name: 'Add holiday' }));
    expect(screen.getByText('Choose a date')).toBeInTheDocument();
    expect(screen.getByText('Enter a name')).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Date'));
    await userEvent.click(await screen.findByRole('button', { name: /^20 Nov 2026/ }));
    await userEvent.type(screen.getByLabelText('Name'), 'Founders day');
    await userEvent.click(screen.getByRole('button', { name: 'Add holiday' }));
    expect(await screen.findByText('There is already a holiday on this date')).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Date'));
    await userEvent.click(await screen.findByRole('button', { name: /^27 Nov 2026/ }));
    await userEvent.click(screen.getByLabelText(/Half day/));
    await userEvent.click(screen.getByRole('button', { name: 'Add holiday' }));
    await waitFor(() => expect(within(screen.getByRole('table')).getByText('Founders day')).toBeInTheDocument());
    expect(calls.filter((c) => c.method === 'POST').at(-1)?.body).toEqual({ date: '2026-11-27', name: 'Founders day', half_day: true });
  });

  it('removes a holiday after asking', async () => {
    open();
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('button', { name: 'Remove Christmas, 25 Dec 2026' }));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Remove holiday' }));
    await waitFor(() => expect(within(screen.getByRole('table')).queryByText('Christmas')).toBeNull());
    expect(calls.some((c) => c.method === 'DELETE' && c.url === '/api/v1/holidays/h-2')).toBe(true);
  });

  it('is read-only for those the server does not let manage holidays', async () => {
    me = ME(['operations'], { 'people.manage': 'firm', 'people.view': 'firm' });
    canManage = false;
    open();
    await screen.findByRole('table');
    expect(screen.queryByRole('button', { name: 'Add holiday' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Remove/ })).toBeNull();
    expect(screen.getByText(/Only people who manage studio settings/)).toBeInTheDocument();
  });
});
