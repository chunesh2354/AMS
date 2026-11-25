import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SessionProvider } from '../../app/session';
import { OverlaysProvider } from '../../app/overlays';
import { ToastProvider } from '../../ui/Toast';
import { ProjectTasksScreen } from '../firm/project/tasks';
import { dependencyCandidates, estimateBar, mapMyTimeWithTasks, type LiveTask, type LiveTaskDetail } from '../../api/live/tasks';
import { tasksOfPhase } from './log-time-sheet';

// Live mode, as a VITE_LIVE=1 build: the task sheet reads GET /tasks/:id and saves through the round 2 endpoints.
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
const isGet = (init: RequestInit) => (init.method ?? 'GET') === 'GET';

const ME = { person: { id: 'u-pm', ref_code: 'Q02', name: 'Nila Varma', work_email: 'x@firm.test', job_title: 'Project lead', manager_id: null },
  firm: { id: 'f', trading_name: 'Test Studio', legal_name: 'x', currency: 'INR', timezone: 'Asia/Kolkata', accounting_adapter: 'mock' },
  permission_sets: ['pm'], capabilities: { 'projects.plan': 'scoped' }, led_projects: ['prj'], member_projects: ['prj'] };
const PROJECT = { id: 'prj', code: 'LV-77', name: 'Harbour Pavilion', client: 'Port Trust', client_id: 'c1', status: 'Active', hold_reason: null, contract: null,
  pm: { id: 'u-pm', ref_code: 'Q02', name: 'Nila Varma' }, hours: { budget: '0', actual: '0', forecast: '0' }, delivery_progress_pct: 0,
  entitlement: { restricted: true }, contribution: { restricted: true },
  phases: [{ id: 'ph-b', code: 'MS', name: 'Massing studies', start_date: null, end_date: null, owner: null, budget_hours: '0', actual_hours: '0', etc_hours: '0', forecast_hours: '0', delivery_progress_pct: 0, fee: { restricted: true }, status: 'Not started' }] };
const MEMBERS = [
  { person: { id: 'u-pm', ref_code: 'Q02', name: 'Nila Varma', job_title: 'Project lead' }, role: 'pm', is_pm: true },
  { person: { id: 'u-ines', ref_code: 'Q07', name: 'Ines Kuruvilla', job_title: 'Architect' }, role: 'contributor', is_pm: false },
];
const T = (over: Record<string, unknown> = {}): LiveTask => ({
  id: 't1', project: { id: 'prj', code: 'LV-77', name: 'Harbour Pavilion' }, phase: { id: 'ph-b', code: 'MS', name: 'Massing studies' },
  title: 'Sun path study', description: null, assignee: { id: 'u-ines', ref_code: 'Q07', name: 'Ines Kuruvilla' }, due_date: '2027-01-08',
  status: 'In progress', priority: 'High', sort_order: 0, completed_at: null, note_count: 0, can_edit: true, can_change_status: true,
  parent_task_id: null, start_date: '2026-12-01', estimate_hours: '10.00', logged_hours: '12.00', subtask_count: 1, ...over,
} as LiveTask);
const SUB = T({ id: 's1', title: 'North elevation', parent_task_id: 't1', status: 'To do', estimate_hours: null, logged_hours: '0.00', subtask_count: 0 });
const OTHER = T({ id: 't9', title: 'Site model', start_date: null, estimate_hours: null, logged_hours: '0.00', subtask_count: 0 });
const DETAIL = (over: Partial<LiveTaskDetail> = {}): LiveTaskDetail => ({
  ...T(), notes: [], subtasks: [SUB], followers: [{ id: 'u-ines', ref_code: 'Q07', name: 'Ines Kuruvilla' }], is_following: false,
  blocked_by: [{ dependency_id: 'd1', type: 'finish_to_start', lag_days: 0, task: { id: 't7', title: 'Survey', status: 'In progress', start_date: null, due_date: '2026-01-02', assignee_id: null, phase_id: 'ph-b' } }],
  blocks: [], approved_hours: '8.00',
  estimate: { estimate_hours: '10.00', logged_hours: '12.00', remaining_hours: '0.00', over_estimate: true, subtasks: { estimate_hours: '0.00', logged_hours: '0.00' }, total: { estimate_hours: '10.00', logged_hours: '12.00' } },
  ...over,
});

let detail = DETAIL();
function api(url: string, init: RequestInit): Reply {
  if (url.endsWith('/me')) return { status: 200, body: ME };
  if (url.endsWith('/projects/LV-77/tasks') && isGet(init)) return list([T(), SUB, OTHER], { can_plan: true });
  if (url.endsWith('/projects/LV-77/members')) return list(MEMBERS);
  if (url.endsWith('/projects/LV-77')) return { status: 200, body: PROJECT };
  if (url.endsWith('/people')) return list([]);
  if (url.endsWith('/tasks/t1') && isGet(init)) return { status: 200, body: detail };
  if (url.endsWith('/tasks/t1/followers') && init.method === 'POST') {
    return { status: 200, body: { task_id: 't1', person_id: 'u-pm', following: true, followers: [...detail.followers!, { id: 'u-pm', ref_code: 'Q02', name: 'Nila Varma' }] } };
  }
  if (url.endsWith('/tasks/t1/subtasks') && init.method === 'POST') {
    detail = DETAIL({ subtasks: [SUB, T({ id: 's2', title: 'South elevation', parent_task_id: 't1', status: 'To do' })] });
    return { status: 200, body: { ...detail.subtasks![1], notes: [] } };
  }
  if (url.endsWith('/tasks/s1') && init.method === 'PUT') return { status: 200, body: { ...SUB, status: 'Done', notes: [] } };
  if (url.endsWith('/tasks/t1/dependencies') && init.method === 'POST') {
    return { status: 422, body: { error: { code: 'RULE', message: 'This would make a cycle: "Sun path study" already waits, directly or through other tasks, for "Site model".', details: [{ field: 'successor_id', code: 'cycle' }] } } };
  }
  if (url.endsWith('/tasks/t1/dependencies/d1') && init.method === 'DELETE') return { status: 200, body: { id: 'd1', deleted: true, task: DETAIL({ blocked_by: [] }) } };
  if (url.endsWith('/time-entries') && init.method === 'POST') return { status: 200, body: { id: 'te1', approval_state: 'Draft', task_id: 't1' } };
  return undefined;
}

beforeEach(() => { vi.stubGlobal('fetch', fetchMock); fetchMock.mockClear(); calls.length = 0; detail = DETAIL(); handler = api; });
afterEach(() => vi.unstubAllGlobals());

async function openSheet() {
  render(
    <SessionProvider><ToastProvider><OverlaysProvider>
      <MemoryRouter initialEntries={['/firm/projects/LV-77/tasks?view=list']}>
        <Routes><Route path="/firm/projects/:id/tasks" element={<ProjectTasksScreen />} /></Routes>
      </MemoryRouter>
    </OverlaysProvider></ToastProvider></SessionProvider>,
  );
  // Sub-tasks stay off the list and out of the count.
  expect(await screen.findByText('2 tasks, 0 blocked')).toBeInTheDocument();
  expect(screen.queryByText('North elevation')).toBeNull();
  await userEvent.click(screen.getByText('Sun path study'));
  const sheet = await screen.findByRole('dialog', { name: 'Sun path study' });
  await within(sheet).findByRole('heading', { name: 'Sub-tasks' });
  return sheet;
}

describe('live task sheet, round 2', () => {
  it('shows followers, dates, hours over the estimate, sub-tasks, dependencies and time on the task', async () => {
    const sheet = await openSheet();
    expect(within(sheet).getByText('1 following')).toBeInTheDocument();
    expect(within(sheet).getByLabelText('Start')).toBeInTheDocument();
    expect(within(sheet).getByLabelText('Estimate (hours)')).toHaveValue('10');
    expect(within(sheet).getByText('2 h over estimate')).toBeInTheDocument();
    expect(within(sheet).getByRole('img', { name: '12 h logged of a 10 h estimate' })).toBeInTheDocument();
    expect(within(sheet).getByText('0 of 1 done')).toBeInTheDocument();
    expect(within(within(sheet).getByRole('list', { name: 'Blocked by' })).getByText('Overdue since 02 Jan 2026, holds this task up')).toBeInTheDocument();
    expect(within(sheet).getByText('8 h')).toBeInTheDocument();
  });

  it('follows, adds and ticks sub-tasks, and shows the API cycle error on a dependency', async () => {
    const user = userEvent.setup();
    const sheet = await openSheet();
    const follow = within(sheet).getByRole('button', { name: 'Follow' });
    expect(follow).toHaveAttribute('aria-pressed', 'false');
    await user.click(follow);
    expect(await within(sheet).findByRole('button', { name: 'Following' })).toHaveAttribute('aria-pressed', 'true');
    expect(calls).toContainEqual({ method: 'POST', url: '/api/v1/tasks/t1/followers', body: {} });

    await user.type(within(sheet).getByLabelText('New sub-task'), 'South elevation{Enter}');
    expect(await within(sheet).findByText('South elevation')).toBeInTheDocument();
    expect(calls).toContainEqual({ method: 'POST', url: '/api/v1/tasks/t1/subtasks', body: { title: 'South elevation' } });
    // Enter in the sub-task field did not submit the sheet's Save.
    expect(calls.some((c) => c.method === 'PUT' && c.url.endsWith('/tasks/t1'))).toBe(false);

    await user.click(within(sheet).getByRole('checkbox', { name: 'North elevation' }));
    await waitFor(() => expect(calls).toContainEqual({ method: 'PUT', url: '/api/v1/tasks/s1', body: { status: 'Done' } }));

    await user.click(within(sheet).getByRole('combobox', { name: 'This task' }));
    await user.click(await screen.findByRole('option', { name: 'Blocks' }));
    await user.click(within(sheet).getByRole('combobox', { name: 'Other task' }));
    expect(screen.queryByRole('option', { name: 'North elevation' })).toBeNull();
    await user.click(await screen.findByRole('option', { name: 'Site model' }));
    await user.click(within(sheet).getByRole('button', { name: 'Add dependency' }));
    expect(await within(sheet).findByText(/This would make a cycle/)).toBeInTheDocument();
    expect(calls).toContainEqual({ method: 'POST', url: '/api/v1/tasks/t1/dependencies', body: { successor_id: 't9' } });

    await user.click(within(sheet).getByRole('button', { name: 'Remove blocked by Survey' }));
    expect(await within(sheet).findByText('Nothing. This task can start any time.')).toBeInTheDocument();
  });

  it('adds a sub-task for a team member, and leaves a sub-task the viewer cannot move unticked and disabled', async () => {
    const user = userEvent.setup();
    detail = DETAIL({ subtasks: [{ ...SUB, can_change_status: false }] });
    const sheet = await openSheet();
    expect(within(sheet).getByRole('checkbox', { name: 'North elevation' })).toBeDisabled();
    await user.type(within(sheet).getByLabelText('New sub-task'), 'Roof plan');
    await user.click(within(sheet).getByRole('combobox', { name: 'Sub-task assignee' }));
    await user.click(await screen.findByRole('option', { name: /Ines Kuruvilla/ }));
    await user.click(within(sheet).getByRole('button', { name: 'Add sub-task' }));
    await waitFor(() => expect(calls).toContainEqual({ method: 'POST', url: '/api/v1/tasks/t1/subtasks', body: { title: 'Roof plan', assignee_id: 'u-ines' } }));
  });

  it('logs time on this task with its task_id', async () => {
    const user = userEvent.setup();
    const sheet = await openSheet();
    const form = within(sheet).getByRole('form', { name: 'Log time on this task' });
    await user.click(within(form).getByRole('button', { name: 'Log time' }));
    expect(within(form).getByText('Enter the hours')).toBeInTheDocument();
    await user.type(within(form).getByLabelText('Hours'), '1.5');
    await user.type(within(form).getByLabelText('What you did'), 'Shadow diagrams');
    await user.click(within(form).getByRole('button', { name: 'Log time' }));
    await waitFor(() => expect(calls.find((c) => c.url.endsWith('/time-entries'))?.body).toMatchObject({ task_id: 't1', duration_hours: 1.5, note: 'Shadow diagrams' }));
    expect(await within(form).findByText(/1.5 h logged on .*on your timesheet as a draft/)).toBeInTheDocument();
  });
});

describe('round 2 task helpers', () => {
  it('leaves the task, its sub-tasks, its parent and linked tasks out of the dependency picker', () => {
    const d = DETAIL();
    const all = [T(), SUB, OTHER, T({ id: 't7', title: 'Survey' }), T({ id: 'p0', title: 'Parent' })];
    expect(dependencyCandidates(all, d).map((t) => t.id)).toEqual(['t9', 'p0']);
    expect(dependencyCandidates(all, { ...DETAIL({ blocked_by: [] }), id: 's1', parent_task_id: 'p0', subtasks: [] }).map((t) => t.id)).toEqual(['t1', 't9', 't7']);
  });

  it('draws hours against the estimate, with the redline only past it', () => {
    expect(estimateBar(12, 10)).toMatchObject({ over: true, note: '2 h over estimate', estimatePct: (10 / 12) * 100 });
    expect(estimateBar(4, 10)).toMatchObject({ over: false, note: '6 h left', loggedPct: 40, overPct: 0 });
    expect(estimateBar(3, null)).toMatchObject({ estimatePct: null, note: 'No estimate' });
  });

  it('titles a My time task line (phase:task) with its task and keeps a plain phase line as it was', () => {
    const line = (key: string, extra: Record<string, unknown> = {}) => ({ key, phase_id: 'ph-b', internal_category_id: null, title: 'Massing studies', subtitle: 'LV-77 Harbour Pavilion', hours: [1, 0, 0, 0, 0, 0, 0], entries: [], reason: null, state: 'open' as const, ...extra });
    const sheet = mapMyTimeWithTasks({
      period_start: '2026-11-23', period_end: '2026-11-29', timesheet_id: null, status: 'Open', day_totals: [2, 0, 0, 0, 0, 0, 0], flags: [],
      lines: [line('ph-b'), line('ph-b:t1', { task_id: 't1', task: { id: 't1', title: 'Sun path study' } })],
    }, 0);
    expect(sheet.lines.map((l) => [l.id, l.title, l.subtitle])).toEqual([
      ['ph-b', 'Massing studies', 'LV-77 Harbour Pavilion'],
      ['ph-b:t1', 'Sun path study', 'LV-77 Harbour Pavilion · Massing studies'],
    ]);
    expect(sheet.tasks).toEqual({ 'ph-b:t1': { taskId: 't1', title: 'Sun path study' } });
  });

  it('offers the open tasks of the chosen phase in the Log time picker', () => {
    const all = [T(), OTHER, T({ id: 'x', title: 'Other phase', phase: { id: 'ph-c', code: 'CD', name: 'Concept' } }), T({ id: 'done', title: 'Finished', status: 'Done' })];
    expect(tasksOfPhase(all, 'ph-b').map((t) => t.id)).toEqual(['t1', 't9']);
    expect(tasksOfPhase(all, 'ph-b', 'done').map((t) => t.id)).toEqual(['t1', 't9', 'done']);
    expect(tasksOfPhase(all, null)).toEqual([]);
  });
});
