import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SessionProvider } from '../../../app/session';
import { ToastProvider } from '../../../ui/Toast';
import { ProjectTimelineScreen } from './timeline';

// Live mode, as a VITE_LIVE=1 build: the Timeline tab reads GET /projects/:code/schedule and saves through PUT .../dates.
vi.mock('../../../api/live', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../../api/live')>()), isLive: true }));

type Reply = { status: number; body: unknown } | undefined;
let handler: (url: string, init: RequestInit) => Reply;
const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const r = handler(String(input), init) ?? { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Not found' } } };
  return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
});

const ME = {
  person: { id: 'u-pm', ref_code: 'Q02', name: 'Nila Varma', work_email: 'x@firm.test', job_title: 'Project lead', manager_id: null },
  firm: { id: 'f', trading_name: 'Test Studio', legal_name: 'x', currency: 'INR', timezone: 'Asia/Kolkata', accounting_adapter: 'mock' },
  permission_sets: ['pm'], capabilities: { 'projects.plan': 'scoped' }, led_projects: ['prj'], member_projects: ['prj'],
};
const ref = (id: string, name: string) => ({ id, ref_code: id, name });
const PHASE = (over: Record<string, unknown>) => ({
  id: 'ph-wd', code: 'WD', name: 'Working drawings', status: 'In progress', sort_order: 1, owner: ref('u-pm', 'Nila Varma'),
  start_date: '2026-11-02', end_date: '2026-12-18', progress_pct: 62, forecast_end: '2026-12-18', slip_days: 0,
  budget_hours: '200.00', actual_hours: '120.00', etc_hours: '60.00', forecast_hours: '180.00', task_count: 2, open_tasks: 2, overdue_tasks: 0, ...over,
});
const TASK = (over: Record<string, unknown>) => ({
  id: 't-a', title: 'GA plans issued', phase_id: 'ph-wd', parent_task_id: null, status: 'In progress', priority: 'High', sort_order: 0,
  start_date: '2026-11-09', due_date: '2026-11-20', forecast_start: '2026-11-09', forecast_end: '2026-11-25', slip_days: 5, progress_pct: 50,
  estimate_hours: '20.00', overdue: true, blocking: true, blocks_open_tasks: 1, assignee: ref('u-ines', 'Ines Kuruvilla'), dependencies: [], ...over,
});
const SCHEDULE = (canReschedule = true) => ({
  today: '2026-11-25', timezone: 'Asia/Kolkata', as_of: null,
  project: { id: 'prj', code: 'LV-77', name: 'Harbour Pavilion', client: 'Port Trust', status: 'Active', hold_reason: null, pm: ref('u-pm', 'Nila Varma') },
  can_reschedule: canReschedule,
  planned_start: '2026-11-02', planned_end: '2027-02-05', forecast_end: '2027-02-05', slip_days: 0, end_slip_days: 0, slip_driver: null,
  progress_pct: 40, hours: { budget: '300.00', actual: '120.00', etc: '60.00', forecast: '180.00' },
  phases: [PHASE({}), PHASE({ id: 'ph-tn', code: 'TN', name: 'Tender', sort_order: 2, start_date: '2026-12-21', end_date: '2027-02-05', progress_pct: 0, forecast_end: '2027-02-05', owner: null })],
  milestones: [{ id: 'm1', label: 'Working drawings issue', status: 'Planned', phase_id: 'ph-wd', date: '2026-12-18', date_source: 'phase_end' }],
  tasks: [
    TASK({}),
    TASK({
      id: 't-b', title: 'Structural coordination', start_date: '2026-11-23', due_date: '2026-12-11', forecast_start: '2026-11-26', forecast_end: '2026-12-14',
      progress_pct: 0, status: 'To do', overdue: false, blocking: false, blocks_open_tasks: 0, slip_days: 3, assignee: ref('u-omar', 'Omar Siddiqui'),
      dependencies: [{ dependency_id: 'd1', predecessor_id: 't-a', type: 'FS', lag_days: 0 }],
    }),
    TASK({ id: 't-c', title: 'Tender documents', phase_id: 'ph-tn', start_date: null, due_date: '2027-01-15', forecast_start: '2027-01-15', forecast_end: '2027-01-15', status: 'To do', progress_pct: 0, overdue: false, blocking: false, slip_days: 0 }),
  ],
  dependencies: [{ id: 'd1', predecessor_id: 't-a', successor_id: 't-b', type: 'FS', lag_days: 0 }],
  open_tasks: 3, overdue_tasks: 1, blocking_overdue_tasks: 1, definition: [],
});

let schedule = SCHEDULE();
let puts: { url: string; body: Record<string, unknown> }[] = [];
function api(url: string, init: RequestInit): Reply {
  if (url.endsWith('/me')) return { status: 200, body: ME };
  if (url.endsWith('/projects/LV-77/schedule')) return { status: 200, body: schedule };
  if (init.method === 'PUT' && /\/(tasks|phases)\/[^/]+\/dates$/.test(url)) {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    puts.push({ url, body });
    const id = url.split('/').at(-2)!;
    const task = schedule.tasks.find((t) => t.id === id);
    return {
      status: 200,
      body: {
        cascade: body.cascade, shifted_days: 7, audit_event_id: 'a1',
        moved: [{ kind: task ? 'task' : 'phase', id, label: task?.title ?? 'Working drawings', cause: 'requested', previous: { start_date: '2026-11-23', end_date: '2026-12-11' }, next: { start_date: body.start_date ?? null, end_date: body.due_date ?? body.end_date }, shifted_days: null, audit_event_id: 'a1' },
          ...(body.cascade && task ? [{ kind: 'task', id: 't-x', label: 'Door schedules', cause: 'dependency', previous: { start_date: '2026-12-14', end_date: '2026-12-16' }, next: { start_date: '2026-12-19', end_date: '2026-12-21' }, shifted_days: 5, audit_event_id: 'a2' }] : [])],
        violations: [],
      },
    };
  }
  return undefined;
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock); fetchMock.mockClear(); puts = []; schedule = SCHEDULE(); handler = api;
  // jsdom has no layout: the timeline track is 560 px wide, so one day of the 56-day week view is 10 px.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, top: 0, left: 0, right: 560, bottom: 48, width: 560, height: 48, toJSON: () => ({}) } as DOMRect);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function open() {
  render(
    <SessionProvider>
      <ToastProvider>
        <MemoryRouter initialEntries={['/firm/projects/LV-77/timeline']}>
          <Routes><Route path="/firm/projects/:id/timeline" element={<ProjectTimelineScreen />} /></Routes>
        </MemoryRouter>
      </ToastProvider>
    </SessionProvider>,
  );
}
const bar = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name},.*Select to move`) });

describe('project timeline in live mode', () => {
  it('renders phases, tasks, the milestone and the dependency, redlined when the predecessor is past due', async () => {
    open();
    const table = await screen.findByRole('table', { name: 'Harbour Pavilion phases and tasks on a timeline' });
    expect(within(table).getByRole('button', { name: 'Collapse Working drawings' })).toHaveAttribute('aria-expanded', 'true');
    expect(within(table).getByText('Tender')).toBeInTheDocument();
    expect(within(table).getByText('GA plans issued')).toBeInTheDocument();
    expect(within(table).getByText('5 days past due')).toBeInTheDocument();
    expect(within(table).getByText('Waiting on GA plans issued, 5 days late')).toBeInTheDocument();
    expect(within(table).getByRole('img', { name: /Working drawings issue, milestone/ })).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('/projects/LV-77/schedule'))).toBe(true);
    const links = table.querySelectorAll('[data-link]');
    expect(links.length).toBeGreaterThan(0);
    expect([...links].every((l) => l.getAttribute('data-link') === 'red')).toBe(true);
    expect(screen.getByText('Today 25 Nov')).toBeInTheDocument();
  });

  it('a drag is a draft until Save, which PUTs the task dates with cascade, and lists what moved', async () => {
    const user = userEvent.setup();
    open();
    await screen.findByRole('table');
    const b = bar('Structural coordination');
    fireEvent.pointerDown(b, { clientX: 100, button: 0, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 170, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 170, pointerId: 1 });
    expect(await screen.findByText('Moved: 7 days later. Not saved yet.')).toBeInTheDocument();
    expect(screen.getByText(/Structural coordination now runs 30 Nov to 18 Dec 2026 \(was 23 Nov to 11 Dec 2026\)/)).toBeInTheDocument();
    expect(puts).toEqual([]);
    expect(screen.getByRole('switch', { name: 'Move dependent tasks too' })).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0].url).toMatch(/\/api\/v1\/tasks\/t-b\/dates$/);
    expect(puts[0].body).toEqual({ start_date: '2026-11-30', due_date: '2026-12-18', cascade: true });
    const moved = await screen.findByRole('list', { name: 'Moved items' });
    expect(within(moved).getByText(/Door schedules: 19 Dec to 21 Dec 2026 .*pushed later by a dependency, 5 days/)).toBeInTheDocument();
    expect(screen.queryByText(/Not saved yet/)).toBeNull();
  });

  it('Undo drops the draft without saving', async () => {
    const user = userEvent.setup();
    open();
    await screen.findByRole('table');
    const b = bar('Structural coordination');
    fireEvent.pointerDown(b, { clientX: 300, button: 0, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 280, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 280, pointerId: 1 });
    expect(await screen.findByText('Moved: 2 days earlier. Not saved yet.')).toBeInTheDocument();
    // Moving before GA plans finishes breaks the finish-to-start order.
    expect(screen.getByText(/Structural coordination starts before GA plans issued is finished/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.queryByText(/Not saved yet/)).toBeNull();
    expect(screen.getByText('23 Nov to 11 Dec')).toBeInTheDocument();
    expect(puts).toEqual([]);
  });

  it('works from the keyboard: select a bar, use the move and end buttons, save a phase without cascade', async () => {
    const user = userEvent.setup();
    open();
    await screen.findByRole('table');
    bar('Working drawings').focus();
    await user.keyboard('{Enter}');
    const controls = screen.getByRole('group', { name: 'Change the dates of Working drawings' });
    await user.click(within(controls).getByRole('button', { name: 'Move 1 day later' }));
    await user.click(within(controls).getByRole('button', { name: 'Move 1 day later' }));
    await user.click(within(controls).getByRole('button', { name: 'End 1 day later' }));
    expect(screen.getByText('Changed: starts 2 days later, ends 3 days later. Not saved yet.')).toBeInTheDocument();
    await user.click(screen.getByRole('switch', { name: 'Move dependent tasks too' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0].url).toMatch(/\/phases\/ph-wd\/dates$/);
    expect(puts[0].body).toEqual({ start_date: '2026-11-04', end_date: '2026-12-21', cascade: false });
  });

  it('arrow keys on a focused bar move it, and a due-only task sends only its due date', async () => {
    const user = userEvent.setup();
    open();
    await screen.findByRole('table');
    await user.click(screen.getByRole('radio', { name: 'Quarter' }));
    bar('Tender documents').focus();
    await user.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}');
    expect(screen.getByText('Moved: 3 days later. Not saved yet.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0].body).toEqual({ due_date: '2027-01-18', cascade: true });
  });

  it('is read-only for a viewer who cannot reschedule', async () => {
    schedule = SCHEDULE(false);
    open();
    await screen.findByRole('table');
    expect(screen.getByText(/You can see this timeline/)).toBeInTheDocument();
    expect(screen.queryAllByRole('button', { name: /Select to move/ })).toEqual([]);
    expect(screen.getByRole('img', { name: /^Structural coordination, Omar Siddiqui/ })).toBeInTheDocument();
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });

  it('dragging the end grip resizes the task as a draft and saves both dates', async () => {
    const user = userEvent.setup();
    open();
    await screen.findByRole('table');
    const grip = bar('Structural coordination').querySelector('[data-grip="end"]')!;
    fireEvent.pointerDown(grip, { clientX: 200, button: 0, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 230, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 230, pointerId: 1 });
    expect(await screen.findByText('Changed: ends 3 days later. Not saved yet.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0].body).toEqual({ start_date: '2026-11-23', due_date: '2026-12-14', cascade: true });
  });

  it('draws the dependency line plain when the predecessor is done and the order holds', async () => {
    schedule = SCHEDULE();
    schedule.tasks[0] = { ...schedule.tasks[0], status: 'Done', overdue: false, blocking: false, progress_pct: 100, due_date: '2026-11-20' };
    open();
    const table = await screen.findByRole('table');
    const links = [...table.querySelectorAll('[data-link]')];
    expect(links.length).toBeGreaterThan(0);
    expect(links.every((l) => l.getAttribute('data-link') === 'ok')).toBe(true);
    expect(within(table).queryByText(/Waiting on/)).toBeNull();
  });
});
