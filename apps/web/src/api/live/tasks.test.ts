import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTask, dueGroup, dueSoon, getMyTasksLive, listProjectTasks, needsTeam, phaseLabel, rowPriority, statusChip, updateTask, type LiveTask } from './tasks';

const task = (over: Partial<LiveTask>): LiveTask => ({
  id: 't', project: { id: 'p', code: 'LV-77', name: 'Harbour Pavilion' }, phase: null, title: 'T', description: null, assignee: null,
  due_date: null, status: 'To do', priority: 'Normal', sort_order: 0, completed_at: null, note_count: 0, can_edit: false, can_change_status: true, ...over,
});

describe('task helpers', () => {
  it('groups by due date against the studio today', () => {
    expect(dueGroup(null, '2026-11-10')).toBe('No due date');
    expect(dueGroup('2026-11-09', '2026-11-10')).toBe('Overdue');
    expect(dueGroup('2026-11-10', '2026-11-10')).toBe('Today');
    expect(dueGroup('2026-11-17', '2026-11-10')).toBe('This week');
    expect(dueGroup('2026-11-18', '2026-11-10')).toBe('Later');
    // Across a month end.
    expect(dueGroup('2026-12-03', '2026-11-28')).toBe('This week');
  });

  it('lists open tasks overdue or due within seven days, soonest first', () => {
    const list = [
      task({ id: 'later', due_date: '2026-12-01' }),
      task({ id: 'soon', due_date: '2026-11-12' }),
      task({ id: 'over', due_date: '2026-11-02' }),
      task({ id: 'done', due_date: '2026-11-11', status: 'Done' }),
      task({ id: 'none' }),
    ];
    expect(dueSoon(list, '2026-11-10').map((t) => t.id)).toEqual(['over', 'soon']);
  });

  it('maps statuses and priorities to the design system, and labels phases', () => {
    expect(statusChip('To do')).toEqual({ status: 'Planned', label: 'To do' });
    expect(statusChip('Blocked')).toEqual({ status: 'Blocked' });
    expect(rowPriority('Normal')).toBe('Medium');
    expect(rowPriority('High')).toBe('High');
    expect(phaseLabel(task({}))).toBe('No phase');
    expect(phaseLabel(task({ phase: { id: 'x', code: 'MS', name: 'Massing studies' } }))).toBe('MS Massing studies');
    expect(needsTeam('u1', new Set(['u2']))).toBe(true);
    expect(needsTeam('u1', new Set(['u1']))).toBe(false);
    expect(needsTeam(null, new Set())).toBe(false);
  });
});

describe('task requests', () => {
  const fetchMock = vi.fn();
  beforeEach(() => { vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset(); });
  afterEach(() => vi.unstubAllGlobals());
  const reply = (body: unknown) => fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status: 200 }));

  it('reads a project list with can_plan, and my tasks with today and counts', async () => {
    reply({ data: [task({ id: 'a' })], page: 1, page_size: 200, total: 1, complete: true, missing_count: 0, can_plan: true });
    expect(await listProjectTasks('LV 77')).toEqual({ tasks: [task({ id: 'a' })], canPlan: true });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/projects/LV%2077/tasks');
    reply({ data: [], page: 1, page_size: 200, total: 0, complete: true, missing_count: 0, today: '2026-11-10', overdue: 2, due_soon: 3 });
    expect(await getMyTasksLive()).toEqual({ today: '2026-11-10', tasks: [], overdue: 2, dueSoon: 3 });
    expect(fetchMock.mock.calls[1][0]).toBe('/api/v1/me/tasks');
  });

  it('creates with POST and the add_to_team flag, updates with PUT', async () => {
    reply(task({ id: 'n' }));
    await createTask('LV-77', { title: 'Site model', assignee_id: 'u9', add_to_team: true });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/projects/LV-77/tasks');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST' });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ title: 'Site model', assignee_id: 'u9', add_to_team: true });
    reply(task({ id: 'n', status: 'Done' }));
    await updateTask('n', { status: 'Done', note: 'Sent to the client' });
    expect(fetchMock.mock.calls[1][0]).toBe('/api/v1/tasks/n');
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: 'PUT' });
  });
});
