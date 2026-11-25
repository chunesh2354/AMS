import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SessionProvider } from '../../app/session';
import { ToastProvider } from '../../ui/Toast';
import { WorkloadScreen } from './workload';
import { DIRECTORY, ME, PROJECT, WEEKS, workload } from './workload-fixture.test-data';

// A VITE_LIVE=1 build: Workload reads GET /workload, never the sample studio.
vi.mock('../../api/live', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/live')>()), isLive: true }));

type Reply = { status: number; body: unknown } | undefined;
let handler: (url: string, init: RequestInit) => Reply;
const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const r = handler(String(input), init) ?? { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Not found' } } };
  return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
});
const list = (data: unknown[]) => ({ status: 200, body: { data, page: 1, page_size: 200, total: data.length, complete: true, missing_count: 0 } });
const rule = (name: string, message: string, details: unknown[] = []) => ({ status: 422, body: { error: { code: 'RULE_VIOLATION', message, details, rule: name } } });

let data: Record<string, unknown> = workload();
let posts: { url: string; method: string; body: unknown }[] = [];
let writeReplies: Reply[] = [];
const base = (url: string, init: RequestInit): Reply => {
  const method = init.method ?? 'GET';
  if (method !== 'GET') {
    posts.push({ url, method, body: init.body ? JSON.parse(String(init.body)) : null });
    return writeReplies.shift();
  }
  if (url.endsWith('/me')) return { status: 200, body: ME({ 'projects.plan': 'firm', 'capacity.manage': 'firm' }) };
  if (url.startsWith('/api/v1/workload')) return { status: 200, body: data };
  if (url.endsWith('/projects')) return list([PROJECT]);
  if (url.endsWith('/people')) return list(DIRECTORY);
  return undefined;
};

beforeEach(() => {
  data = workload(); posts = []; writeReplies = []; handler = base;
  vi.stubGlobal('fetch', fetchMock); fetchMock.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

const open = (path = '/firm/workload') => render(
  <SessionProvider><ToastProvider><MemoryRouter initialEntries={[path]}><Routes><Route path="/firm/workload" element={<WorkloadScreen />} /></Routes></MemoryRouter></ToastProvider></SessionProvider>,
);
const cell = (name: RegExp) => screen.getByRole('button', { name });
const rowOf = (name: RegExp) => screen.getByRole('rowheader', { name }).closest('[role=row]') as HTMLElement;

describe('Workload heatmap in live mode', () => {
  it('shows hours per person and week in grey steps, the redline over 100% and the leave and holiday band', async () => {
    open();
    const table = await screen.findByRole('table', { name: 'Booked hours by person and week' });
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/workload?weeks=8', expect.anything());
    expect(screen.getByRole('radio', { name: 'Heatmap' })).toBeChecked();
    expect(cell(/Ines Kuruvilla, week of 23 Nov: 44 of 40 hours, over capacity/)).toHaveClass('heat__cell--over');
    expect(cell(/Ines Kuruvilla, week of 30 Nov: 24 of 40 hours, part booked/)).toHaveClass('heat__cell--part');
    expect(cell(/Nila Varma, week of 30 Nov: 0 of 40 hours, free/)).toHaveClass('heat__cell--free');
    expect(cell(/Ines Kuruvilla, week of 7 Dec: 36 of 40 hours, full/)).toHaveClass('heat__cell--full');
    const leave = cell(/Ines Kuruvilla, week of 14 Dec: 6 of 32 hours, free, 1 day off/);
    expect(leave.querySelector('.heat__band')).toHaveStyle({ width: '20%' });
    // Christmas is named under its week.
    expect(within(table).getByText('Christmas')).toBeInTheDocument();
    expect(within(table).getByText('This week')).toBeInTheDocument();
    // Row totals and the studio footer.
    expect(within(rowOf(/Ines Kuruvilla/)).getByText('110 h')).toBeInTheDocument();
    expect(within(rowOf(/Studio load/)).getByText('110 of 616 h')).toBeInTheDocument();
    expect(screen.getByText(/including the 3 planner changes not yet published/)).toBeInTheDocument();
  });

  it('opens the week detail from a cell, with the allocations, "On leave", the other hours and Open in planner', async () => {
    open();
    await screen.findByRole('table', { name: 'Booked hours by person and week' });
    await userEvent.click(cell(/Ines Kuruvilla, week of 23 Nov/));
    const panel = screen.getByRole('complementary', { name: 'Week detail' });
    expect(within(panel).getByText('Over capacity by 4 h')).toBeInTheDocument();
    expect(within(panel).getByText('LV-77 Harbour Pavilion')).toBeInTheDocument();
    expect(within(panel).getByText('Edited, not yet published')).toBeInTheDocument();
    await userEvent.click(cell(/Ines Kuruvilla, week of 14 Dec/));
    expect(within(panel).getByText('On leave')).toBeInTheDocument();
    expect(within(panel).getByText('Fri 18 Dec')).toBeInTheDocument();
    expect(within(panel).getByText('Other projects')).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole('button', { name: 'Close week detail' }));
    expect(screen.queryByRole('complementary', { name: 'Week detail' })).toBeNull();
    await userEvent.click(cell(/Nila Varma, week of 21 Dec/));
    expect(within(screen.getByRole('complementary', { name: 'Week detail' })).getByText('Fri 25 Dec, studio holiday')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Open in planner' }));
    expect(await screen.findByRole('grid', { name: 'Resource planner' })).toBeInTheDocument();
  });

  it('moves a week at a time and filters by project', async () => {
    open();
    await screen.findByRole('table', { name: 'Booked hours by person and week' });
    await userEvent.click(screen.getByRole('button', { name: 'Next week' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/v1/workload?from=2026-11-30&weeks=8', expect.anything()));
    await userEvent.click(screen.getByRole('button', { name: 'This week' }));
    await userEvent.click(screen.getByRole('combobox', { name: 'Project' }));
    await userEvent.click(await screen.findByRole('option', { name: /LV-77 Harbour Pavilion/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/v1/workload?weeks=8&project=LV-77', expect.anything()));
  });

  it('gives staff the permission state, not an empty grid', async () => {
    handler = (url, init) => (url.startsWith('/api/v1/workload')
      ? { status: 403, body: { error: { code: 'FORBIDDEN_CAPABILITY', message: 'You need capacity.manage for this.', details: [], capability: 'capacity.manage' } } }
      : base(url, init));
    open();
    expect(await screen.findByText(/capacity\.manage/)).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('grid')).toBeNull();
  });

  it('says "Not available yet" when the server has no planning API', async () => {
    handler = (url, init) => (url.startsWith('/api/v1/workload') ? undefined : base(url, init));
    open();
    expect(await screen.findByText('Not available yet')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Workload' })).toBeInTheDocument();
  });
});

describe('Workload planner in live mode', () => {
  it('shows unassigned demand, project groups, tentative and confirmed blocks and the conflict with its reason', async () => {
    open('/firm/workload?view=planner');
    const grid = await screen.findByRole('grid', { name: 'Resource planner' });
    expect(screen.getByText("Draft plan. Only published allocations appear on people's schedules; until then your changes are visible to you and other planners only.")).toBeInTheDocument();
    const demand = within(rowOf(/Unassigned demand/)).getAllByRole('gridcell');
    expect(demand[0]).toHaveTextContent('LV-77');
    expect(demand[0]).toHaveTextContent('5 h');
    expect(within(grid).getByRole('row', { name: /LV-77 Harbour Pavilion/ })).toBeInTheDocument();
    const ines = within(rowOf(/Ines Kuruvilla/)).getAllByRole('gridcell');
    expect(ines[0]).toHaveClass('plan__c--conflict');
    expect(ines[0]).toHaveTextContent('+4 h');
    expect(ines[0].querySelector('.pcard')).toHaveClass('pcard--conflict');
    expect(ines[0]).toHaveTextContent('Why: Competition deadline');
    expect(ines[1].querySelector('.pcard')).toHaveClass('pcard--tentative');
    expect(ines[1]).toHaveTextContent('New, not yet published');
    expect(ines[2].querySelector('.pcard')).toHaveClass('pcard--confirmed');
    expect(ines[3]).toHaveClass('plan__c--off');
    expect(ines[3]).toHaveTextContent('On leave');
    // Nila has nothing in these weeks but can still be planned.
    expect(within(grid).getByRole('row', { name: /No allocations in these weeks/ })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /1 week is over capacity/ })).toHaveTextContent('Ines Kuruvilla, week of 23 Nov: 44 h confirmed against 40 h available, 4 h over.');
  });

  it('publishes the plan after a confirmation', async () => {
    writeReplies = [{ status: 200, body: { revision: { id: 'r2', revision_no: 2, scope: 'firm', project: null, note: null, published_at: 'x', published_by: { id: 'u-pm', name: 'Nila Varma' }, change_count: 3 }, projects: ['LV-77'], changes: [], notified: ['u-ines'], conflicts: [], audit_event_id: 'e' } }];
    open('/firm/workload?view=planner');
    await screen.findByRole('grid', { name: 'Resource planner' });
    await userEvent.click(screen.getByRole('button', { name: 'Publish plan (3 changes)' }));
    const sheet = await screen.findByRole('dialog', { name: 'Publish plan' });
    expect(posts).toHaveLength(0);
    await userEvent.click(within(sheet).getByRole('button', { name: 'Publish' }));
    await waitFor(() => expect(posts[0]).toMatchObject({ url: '/api/v1/allocations/publish', method: 'POST', body: {} }));
    expect(await screen.findByText('Plan revision 2 published: 3 changes, 1 person notified.')).toBeInTheDocument();
  });

  it('adds an allocation from an empty cell and offers "add to team" when the API asks', async () => {
    writeReplies = [
      rule('PERSON_ON_TEAM', 'Nila Varma is not on the LV-77 team. Add them to the team first, or choose "add to team".', [{ field: 'person_id', code: 'not_member' }]),
      { status: 200, body: { id: 'n1', person: { id: 'u-pm', ref_code: 'Q02', name: 'Nila Varma' }, added_to_team: true, person_week: null, audit_event_id: 'e' } },
    ];
    open('/firm/workload?view=planner');
    await screen.findByRole('grid', { name: 'Resource planner' });
    await userEvent.click(within(rowOf(/Nila Varma/)).getAllByRole('gridcell')[1]);
    const sheet = await screen.findByRole('dialog', { name: 'Add allocation' });
    await userEvent.click(within(sheet).getByRole('combobox', { name: 'Project' }));
    await userEvent.click(await screen.findByRole('option', { name: 'LV-77 Harbour Pavilion' }));
    await userEvent.type(within(sheet).getByRole('textbox', { name: 'Hours' }), '8');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save allocation' }));
    const add = await within(sheet).findByRole('checkbox', { name: 'Add Nila Varma to the team as a contributor' });
    expect(posts[0].body).toMatchObject({ project_id: 'prj-uuid', person_id: 'u-pm', week_start: WEEKS[1], hours: 8, state: 'confirmed' });
    await userEvent.click(add);
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save allocation' }));
    await waitFor(() => expect(posts[1].body).toMatchObject({ project_id: 'prj-uuid', person_id: 'u-pm', add_to_team: true }));
    expect(await screen.findByText(/Allocation saved and Nila Varma added to the team/)).toBeInTheDocument();
  });

  it('moves a block with the keyboard and asks for a reason when the API refuses an overload', async () => {
    writeReplies = [
      rule('OVERALLOCATION', 'This puts the person 20 h over their 40 h available in the week of 7 Dec. Give a reason to save it anyway.', [{ field: 'overallocation_reason', code: 'required', available: '40.00', confirmed_allocations: '60.00', over_hours: '20.00' }]),
      { status: 200, body: { id: 'a2', added_to_team: false, person_week: null, audit_event_id: 'e' } },
    ];
    open('/firm/workload?view=planner');
    await screen.findByRole('grid', { name: 'Resource planner' });
    const ines = within(rowOf(/Ines Kuruvilla/)).getAllByRole('gridcell');
    ines[1].focus();
    await userEvent.keyboard('{Shift>}{ArrowRight}{/Shift}');
    await waitFor(() => expect(posts[0]).toMatchObject({ url: '/api/v1/allocations/a2', method: 'PUT', body: { week_start: WEEKS[2] } }));
    const sheet = await screen.findByRole('dialog', { name: 'Edit allocation' });
    expect(within(sheet).getByRole('group', { name: 'Conflict: Overallocated' })).toHaveTextContent('40 h available, 60 h confirmed with this change.');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save allocation' }));
    expect(within(sheet).getByText('Say why this goes ahead')).toBeInTheDocument();
    await userEvent.type(within(sheet).getByRole('textbox', { name: /reason/i }), 'Client review');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save allocation' }));
    await waitFor(() => expect(posts[1]).toMatchObject({ url: '/api/v1/allocations/a2', method: 'PUT', body: { week_start: WEEKS[2], overallocation_reason: 'Client review' } }));
  });

  it('removes an allocation from its sheet', async () => {
    writeReplies = [{ status: 200, body: { id: 'a3', deleted: true, removed_on_publish: true, audit_event_id: 'e' } }];
    open('/firm/workload?view=planner');
    await screen.findByRole('grid', { name: 'Resource planner' });
    await userEvent.click(within(within(rowOf(/Ines Kuruvilla/)).getAllByRole('gridcell')[2]).getByRole('button'));
    const sheet = await screen.findByRole('dialog', { name: 'Edit allocation' });
    await userEvent.click(within(sheet).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(posts[0]).toMatchObject({ url: '/api/v1/allocations/a3', method: 'DELETE' }));
    expect(await screen.findByText('Allocation removed. It stays on schedules until the plan is published.')).toBeInTheDocument();
  });

  it('never presets a project the viewer may not plan when a PM clicks an empty cell in its row', async () => {
    // A PM (projects.plan scoped) who leads another project, not LV-77: the server still says can_plan for the studio view.
    handler = (url, init) => (url.endsWith('/me')
      ? { status: 200, body: { ...ME({ 'projects.plan': 'scoped', 'capacity.manage': 'view' }), led_projects: ['prj-other'], member_projects: ['prj-other'] } }
      : base(url, init));
    open('/firm/workload?view=planner');
    const grid = await screen.findByRole('grid', { name: 'Resource planner' });
    // Ines's row sits under the LV-77 group; her last week is empty.
    expect(within(grid).getByRole('row', { name: /LV-77 Harbour Pavilion/ })).toBeInTheDocument();
    const cells = within(rowOf(/Ines Kuruvilla/)).getAllByRole('gridcell');
    await userEvent.click(cells[cells.length - 1]);
    const sheet = await screen.findByRole('dialog', { name: 'Add allocation' });
    expect(within(sheet).getByRole('combobox', { name: 'Project' })).not.toHaveTextContent('LV-77');
    await userEvent.type(within(sheet).getByRole('textbox', { name: 'Hours' }), '8');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save allocation' }));
    expect(await within(sheet).findByText('Choose a project')).toBeInTheDocument();
    expect(posts).toEqual([]);
  });

  it('is read-only for a viewer who may not plan', async () => {
    data = workload({ can_plan: false });
    data.people = (data.people as { weeks: { allocations: Record<string, unknown>[] }[] }[]).map((p) => ({ ...p, weeks: p.weeks.map((w) => ({ ...w, allocations: w.allocations.map((a) => ({ ...a, can_edit: false })) })) }));
    open('/firm/workload?view=planner');
    await screen.findByRole('grid', { name: 'Resource planner' });
    expect(screen.getByText('You can see the plan. Changing it needs projects.plan on the project.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Publish plan/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add allocation' })).toBeNull();
    await userEvent.click(within(within(rowOf(/Ines Kuruvilla/)).getAllByRole('gridcell')[2]).getByRole('button'));
    const sheet = await screen.findByRole('dialog', { name: 'Allocation' });
    expect(within(sheet).queryByRole('button', { name: 'Save allocation' })).toBeNull();
    expect(within(sheet).getByText('Only a planner of LV-77 can change this.')).toBeInTheDocument();
  });
});
