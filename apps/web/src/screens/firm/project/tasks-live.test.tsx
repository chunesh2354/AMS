import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SessionProvider } from '../../../app/session';
import { OverlaysProvider } from '../../../app/overlays';
import { ToastProvider } from '../../../ui/Toast';
import { ProjectTasksScreen } from './tasks';
import { MyWorkScreen } from '../../me/work';

// Live mode, as a VITE_LIVE=1 build: the Tasks tab and My work read the API, never the sample studio.
vi.mock('../../../api/live', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../../api/live')>()), isLive: true }));

type Reply = { status: number; body: unknown } | undefined;
let handler: (url: string, init: RequestInit) => Reply;
const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const r = handler(String(input), init) ?? { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Not found' } } };
  return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
});
const list = (data: unknown[], extra: Record<string, unknown> = {}) => ({ status: 200, body: { data, page: 1, page_size: 200, total: data.length, complete: true, missing_count: 0, ...extra } });
const isGet = (init: RequestInit) => (init.method ?? 'GET') === 'GET';

const ME = (caps: Record<string, string>, id = 'u-pm', name = 'Nila Varma') => ({
  person: { id, ref_code: 'Q02', name, work_email: 'x@firm.test', job_title: 'Project lead', manager_id: null },
  firm: { id: 'f', trading_name: 'Test Studio', legal_name: 'x', currency: 'INR', timezone: 'Asia/Kolkata', accounting_adapter: 'mock' },
  permission_sets: ['pm'], capabilities: caps, led_projects: ['prj-uuid'], member_projects: ['prj-uuid'],
});
const PROJECT = {
  id: 'prj-uuid', code: 'LV-77', name: 'Harbour Pavilion', client: 'Port Trust', client_id: 'c1', status: 'Active', hold_reason: null, contract: null,
  pm: { id: 'u-pm', ref_code: 'Q02', name: 'Nila Varma' }, hours: { budget: '0', actual: '0', forecast: '0' }, delivery_progress_pct: 0,
  entitlement: { restricted: true }, contribution: { restricted: true },
  phases: [{ id: 'ph-b', code: 'MS', name: 'Massing studies', start_date: null, end_date: null, owner: null, budget_hours: '0', actual_hours: '0', etc_hours: '0', forecast_hours: '0', delivery_progress_pct: 0, fee: { restricted: true }, status: 'Not started' }],
};
const MEMBERS = [
  { person: { id: 'u-pm', ref_code: 'Q02', name: 'Nila Varma', job_title: 'Project lead' }, role: 'pm', is_pm: true },
  { person: { id: 'u-ines', ref_code: 'Q07', name: 'Ines Kuruvilla', job_title: 'Architect' }, role: 'contributor', is_pm: false },
];
const DIRECTORY = [
  ...MEMBERS.map((m) => ({ id: m.person.id, ref_code: m.person.ref_code, name: m.person.name, job_title: m.person.job_title, manager_id: null, employment_state: 'Active', login_state: 'Enabled' })),
  { id: 'u-omar', ref_code: 'Q09', name: 'Omar Siddiqui', job_title: 'Designer', manager_id: null, employment_state: 'Active', login_state: 'Enabled' },
];
const TASK = (over: Record<string, unknown> = {}) => ({
  id: 't1', project: { id: 'prj-uuid', code: 'LV-77', name: 'Harbour Pavilion' }, phase: { id: 'ph-b', code: 'MS', name: 'Massing studies' },
  title: 'Sun path study', description: null, assignee: { id: 'u-ines', ref_code: 'Q07', name: 'Ines Kuruvilla' }, due_date: '2027-01-08',
  status: 'In progress', priority: 'High', sort_order: 0, completed_at: null, note_count: 0, can_edit: true, can_change_status: true, ...over,
});

let me = ME({ 'projects.plan': 'scoped' });
let posted: unknown = null;
let put: { url: string; body: unknown } | null = null;
function api(url: string, init: RequestInit, opts: { canPlan: boolean; tasks: unknown[] }): Reply {
  if (url.endsWith('/me')) return { status: 200, body: me };
  if (url.endsWith('/projects/LV-77/tasks') && isGet(init)) return list(opts.tasks, { can_plan: opts.canPlan });
  if (url.endsWith('/projects/LV-77/tasks') && init.method === 'POST') {
    posted = JSON.parse(String(init.body));
    return { status: 200, body: { ...TASK({ id: 't2', title: 'Site model', status: 'To do', assignee: { id: 'u-omar', ref_code: 'Q09', name: 'Omar Siddiqui' } }), notes: [], added_to_team: true } };
  }
  if (url.endsWith('/projects/LV-77/members')) return list(MEMBERS);
  if (url.endsWith('/projects/LV-77')) return { status: 200, body: PROJECT };
  if (url.endsWith('/people')) return list(DIRECTORY);
  if (url.endsWith('/tasks/t1') && isGet(init)) return { status: 200, body: { ...TASK(), notes: [] } };
  if (url.endsWith('/tasks/t1') && init.method === 'PUT') {
    put = { url, body: JSON.parse(String(init.body)) };
    return { status: 200, body: { ...TASK({ ...(put.body as object), can_edit: false }), notes: [] } };
  }
  return undefined;
}

beforeEach(() => { vi.stubGlobal('fetch', fetchMock); fetchMock.mockClear(); posted = null; put = null; me = ME({ 'projects.plan': 'scoped' }); });
afterEach(() => vi.unstubAllGlobals());

function open(path: string) {
  render(
    <SessionProvider>
      <ToastProvider>
        <OverlaysProvider>
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route path="/firm/projects/:id/tasks" element={<ProjectTasksScreen />} />
              <Route path="/me/work" element={<MyWorkScreen />} />
            </Routes>
          </MemoryRouter>
        </OverlaysProvider>
      </ToastProvider>
    </SessionProvider>,
  );
}

describe('project tasks in live mode', () => {
  it('shows the API tasks on the board, never the sample studio, with the team panel for a planner', async () => {
    handler = (url, init) => api(url, init, { canPlan: true, tasks: [TASK()] });
    open('/firm/projects/LV-77/tasks');
    expect(await screen.findByText('1 task, 0 blocked')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'In progress, 1' })).getByText('Sun path study')).toBeInTheDocument();
    expect(screen.queryByText(/Stair section at grid C/)).toBeNull();
    expect(screen.getByRole('button', { name: 'New task' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Add to team' })).toBeInTheDocument();
  });

  it('offers the team in the assignee picker, and adds someone from outside it to the team on save', async () => {
    const user = userEvent.setup();
    handler = (url, init) => api(url, init, { canPlan: true, tasks: [] });
    open('/firm/projects/LV-77/tasks');
    await user.click((await screen.findAllByRole('button', { name: 'New task' }))[0]);
    const sheet = await screen.findByRole('dialog', { name: 'New task' });
    await user.type(within(sheet).getByLabelText('Title'), 'Site model');
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('/projects/LV-77/members'))).toBe(true));
    await user.click(within(sheet).getByRole('combobox', { name: 'Assignee' }));
    expect(await screen.findByRole('option', { name: /Ines Kuruvilla/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Omar Siddiqui/ })).toBeNull();
    await user.keyboard('{Escape}');
    await user.click(within(sheet).getByRole('checkbox', { name: /Include people not on the team/ }));
    await user.click(within(sheet).getByRole('combobox', { name: 'Assignee' }));
    await user.click(await screen.findByRole('option', { name: /Omar Siddiqui/ }));
    expect(within(sheet).getByText('Omar Siddiqui is not on the team. Saving adds them as a contributor.')).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'Add task' }));
    await waitFor(() => expect(posted).toMatchObject({ title: 'Site model', assignee_id: 'u-omar', add_to_team: true, priority: 'Normal', status: 'To do' }));
    expect(await screen.findByText('Site model added for Omar Siddiqui. Omar Siddiqui joined the team.')).toBeInTheDocument();
  });

  it('lets the assignee change the status from the list, without planner controls', async () => {
    const user = userEvent.setup();
    me = ME({ 'projects.plan': 'own' }, 'u-ines', 'Ines Kuruvilla');
    handler = (url, init) => api(url, init, { canPlan: false, tasks: [TASK({ can_edit: false })] });
    open('/firm/projects/LV-77/tasks?view=list');
    await user.click(await screen.findByRole('combobox', { name: 'Status of Sun path study' }));
    await user.click(await screen.findByRole('option', { name: 'Done' }));
    await waitFor(() => expect(put).toEqual({ url: '/api/v1/tasks/t1', body: { status: 'Done' } }));
    expect(screen.queryByRole('button', { name: 'New task' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add to team' })).toBeNull();
  });
});

describe('My work in live mode', () => {
  it('lists my open tasks from GET /me/tasks, grouped by when they are due', async () => {
    handler = (url, init) => {
      if (url.endsWith('/me/tasks')) return list([TASK({ due_date: '2026-11-09', can_edit: false }), TASK({ id: 't3', title: 'Model photos', due_date: null, can_edit: false })], { today: '2026-11-10', overdue: 1, due_soon: 0 });
      if (url.endsWith('/me/work')) return { status: 200, body: { today: '2026-11-10', timezone: 'Asia/Kolkata', month: '2026-11', hours: '0.00', projects: [] } };
      return api(url, init, { canPlan: false, tasks: [] });
    };
    open('/me/work');
    const overdue = await screen.findByRole('region', { name: 'Overdue, 1' });
    expect(within(overdue).getByText('Sun path study')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'No due date, 1' })).getByText('Model photos')).toBeInTheDocument();
    expect(screen.getByText('2 open · 1 overdue')).toBeInTheDocument();
  });
});
