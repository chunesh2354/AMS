import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SessionProvider } from '../../app/session';
import { OverlaysProvider } from '../../app/overlays';
import { ToastProvider } from '../../ui/Toast';
import { LogTimeSheet } from '../shared/log-time-sheet';
import { MyTimeScreen } from './time';

// Live mode, as a VITE_LIVE=1 build: task lines from GET /me/time and the Task picker from GET /projects/:code/tasks.
vi.mock('../../api/live', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/live')>()), isLive: true }));

type Reply = { status: number; body: unknown } | undefined;
let handler: (url: string, init: RequestInit) => Reply;
const calls: { method: string; url: string; body: unknown }[] = [];
const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const url = String(input);
  if (init.method && init.method !== 'GET') calls.push({ method: init.method, url, body: init.body ? JSON.parse(String(init.body)) : null });
  const r = handler(url, init) ?? { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Not found' } } };
  return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
});
const list = (data: unknown[], extra: Record<string, unknown> = {}) => ({ status: 200, body: { data, page: 1, page_size: 200, total: data.length, complete: true, missing_count: 0, ...extra } });

const ME = { person: { id: 'u-ines', ref_code: 'Q07', name: 'Ines Kuruvilla', work_email: 'x@firm.test', job_title: 'Architect', manager_id: null },
  firm: { id: 'f', trading_name: 'Test Studio', legal_name: 'x', currency: 'INR', timezone: 'Asia/Kolkata', accounting_adapter: 'mock' },
  permission_sets: ['staff'], capabilities: { 'time.enter': 'own' }, led_projects: [], member_projects: ['prj'] };
const line = (key: string, extra: Record<string, unknown> = {}) => ({
  key, phase_id: 'ph-b', internal_category_id: null, task_id: null, task: null, title: 'Massing studies', subtitle: 'LV-77 Harbour Pavilion',
  hours: [2, 0, 0, 0, 0, 0, 0], entries: [], reason: null, state: 'open', ...extra,
});
const TASK = (id: string, title: string, phase = 'ph-b', status = 'In progress') => ({
  id, project: { id: 'prj', code: 'LV-77', name: 'Harbour Pavilion' }, phase: { id: phase, code: 'MS', name: 'Massing studies' }, title, description: null,
  assignee: null, due_date: null, status, priority: 'Normal', sort_order: 0, completed_at: null, note_count: 0, can_edit: false, can_change_status: false,
});

function api(url: string): Reply {
  if (url.endsWith('/me')) return { status: 200, body: ME };
  if (url.includes('/me/time?period=')) {
    return { status: 200, body: {
      period_start: '2026-11-23', period_end: '2026-11-29', timesheet_id: null, status: 'Open', day_totals: [3.5, 0, 0, 0, 0, 0, 0], flags: [],
      lines: [line('ph-b'), line('ph-b:t1', { task_id: 't1', task: { id: 't1', title: 'Sun path study' }, hours: [1.5, 0, 0, 0, 0, 0, 0] })],
    } };
  }
  if (url.endsWith('/me/time/cell')) return { status: 200, body: { ok: true } };
  if (url.endsWith('/projects')) return list([{ id: 'prj', code: 'LV-77', name: 'Harbour Pavilion', phases: [{ id: 'ph-b', name: 'Massing studies' }, { id: 'ph-c', name: 'Concept' }] }]);
  if (url.endsWith('/internal-categories')) return list([{ id: 'cat1', key: 'admin', name: 'Admin' }]);
  if (url.endsWith('/projects/LV-77/tasks')) return list([TASK('t1', 'Sun path study'), TASK('t2', 'Concept sketches', 'ph-c'), TASK('t3', 'Finished thing', 'ph-b', 'Done')], { can_plan: false });
  if (url.endsWith('/time-entries')) return { status: 200, body: { id: 'te1', approval_state: 'Draft', task_id: 't1' } };
  if (url.endsWith('/timers/active')) return { status: 200, body: { active: null } };
  return undefined;
}

beforeEach(() => { vi.stubGlobal('fetch', fetchMock); fetchMock.mockClear(); calls.length = 0; handler = api; });
afterEach(() => vi.unstubAllGlobals());

describe('My time task lines (live)', () => {
  it('titles a task line with its task, and a cell on it writes to the task, not the phase line', async () => {
    const user = userEvent.setup();
    render(<SessionProvider><ToastProvider><OverlaysProvider><MemoryRouter><MyTimeScreen /></MemoryRouter></OverlaysProvider></ToastProvider></SessionProvider>);
    const grid = await screen.findByRole('grid');
    const taskRow = within(grid).getByText('Sun path study').closest('tr')!;
    expect(within(taskRow).getByText('LV-77 Harbour Pavilion · Massing studies')).toBeInTheDocument();
    const phaseRow = within(grid).getByText('Massing studies', { selector: '.ts__title' }).closest('tr')!;

    await user.dblClick(within(taskRow).getAllByRole('gridcell')[1]);
    await user.keyboard('3{Enter}');
    await waitFor(() => expect(calls.find((c) => c.url.endsWith('/me/time/cell'))?.body).toEqual({ service_date: '2026-11-24', duration_hours: 3, phase_id: 'ph-b', task_id: 't1' }));

    calls.length = 0;
    await user.dblClick(within(phaseRow).getAllByRole('gridcell')[1]);
    await user.keyboard('1{Enter}');
    await waitFor(() => expect(calls.find((c) => c.url.endsWith('/me/time/cell'))?.body).toEqual({ service_date: '2026-11-24', duration_hours: 1, phase_id: 'ph-b' }));
  });
});

describe('Log time Task picker (live)', () => {
  it('offers the open tasks of the chosen phase and sends task_id', async () => {
    const user = userEvent.setup();
    render(<SessionProvider><ToastProvider><LogTimeSheet open onClose={() => {}} prefill={{ phaseId: 'ph-b' }} /></ToastProvider></SessionProvider>);
    const dialog = await screen.findByRole('dialog', { name: 'Log time' });
    const picker = await within(dialog).findByRole('combobox', { name: 'Task' });
    await user.click(picker);
    expect(await screen.findByRole('option', { name: 'Sun path study' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Concept sketches' })).toBeNull();
    expect(screen.queryByRole('option', { name: 'Finished thing' })).toBeNull();
    await user.click(screen.getByRole('option', { name: 'Sun path study' }));
    await user.type(within(dialog).getByLabelText('Duration (h:mm)'), '1:30');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.find((c) => c.url.endsWith('/time-entries'))?.body).toMatchObject({ phase_id: 'ph-b', task_id: 't1', duration_hours: 1.5 }));
  });

  it('offers no task for internal work', async () => {
    render(<SessionProvider><ToastProvider><LogTimeSheet open onClose={() => {}} prefill={{ phaseId: 'cat:cat1' }} /></ToastProvider></SessionProvider>);
    const dialog = await screen.findByRole('dialog', { name: 'Log time' });
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('/internal-categories'))).toBe(true));
    await new Promise((r) => setTimeout(r, 30));
    expect(within(dialog).queryByRole('combobox', { name: 'Task' })).toBeNull();
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/tasks'))).toBe(false);
  });
});
