import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SessionProvider } from '../../../app/session';
import { ToastProvider } from '../../../ui/Toast';
import { ProjectStaffingScreen } from './staffing';
import { DIRECTORY, ME, PROJECT, WEEKS, workload } from '../workload-fixture.test-data';

// A VITE_LIVE=1 build: the Staffing tab is the Team panel plus the workload planner filtered to the project.
vi.mock('../../../api/live', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../../api/live')>()), isLive: true }));

type Reply = { status: number; body: unknown } | undefined;
let handler: (url: string, init: RequestInit) => Reply;
const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const r = handler(String(input), init) ?? { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Not found' } } };
  return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
});
const list = (data: unknown[]) => ({ status: 200, body: { data, page: 1, page_size: 200, total: data.length, complete: true, missing_count: 0 } });
const MEMBERS = [
  { person: { id: 'u-pm', ref_code: 'Q02', name: 'Nila Varma', job_title: 'Project lead' }, role: 'pm', is_pm: true },
  { person: { id: 'u-ines', ref_code: 'Q07', name: 'Ines Kuruvilla', job_title: 'Architect' }, role: 'contributor', is_pm: false },
];
let posts: { url: string; method: string; body: unknown }[] = [];
const base = (url: string, init: RequestInit): Reply => {
  const method = init.method ?? 'GET';
  if (method !== 'GET') {
    posts.push({ url, method, body: init.body ? JSON.parse(String(init.body)) : null });
    return { status: 409, body: { error: { code: 'NOTHING_TO_PUBLISH', message: 'There are no unpublished changes to publish.', details: [] } } };
  }
  if (url.endsWith('/me')) return { status: 200, body: ME({ 'projects.plan': 'scoped', 'capacity.manage': 'scoped' }) };
  if (url.startsWith('/api/v1/workload')) return { status: 200, body: workload({ project: { id: 'prj-uuid', code: 'LV-77', name: 'Harbour Pavilion', status: 'Active' } }) };
  if (url.endsWith('/projects/LV-77/members')) return list(MEMBERS);
  if (url.endsWith('/projects/LV-77')) return { status: 200, body: PROJECT };
  if (url.endsWith('/projects')) return list([PROJECT]);
  if (url.endsWith('/people')) return list(DIRECTORY);
  return undefined;
};
beforeEach(() => { posts = []; handler = base; vi.stubGlobal('fetch', fetchMock); fetchMock.mockClear(); });
afterEach(() => vi.unstubAllGlobals());

const open = () => render(
  <SessionProvider><ToastProvider><MemoryRouter initialEntries={['/firm/projects/LV-77/staffing']}><Routes><Route path="/firm/projects/:id/staffing" element={<ProjectStaffingScreen />} /></Routes></MemoryRouter></ToastProvider></SessionProvider>,
);
const rowOf = (name: RegExp) => within(screen.getByRole('grid', { name: 'LV-77 staffing' })).getByRole('rowheader', { name }).closest('[role=row]') as HTMLElement;

describe('Project Staffing in live mode', () => {
  it('keeps the Team panel and shows the plan for this project, grouped by phase', async () => {
    open();
    const team = await screen.findByRole('region', { name: 'Team' });
    expect(await within(team).findByText('Ines Kuruvilla')).toBeInTheDocument();
    const grid = await screen.findByRole('grid', { name: 'LV-77 staffing' });
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/workload?weeks=8&project=LV-77', expect.anything());
    expect(within(grid).getByRole('row', { name: /MS Massing studies/ })).toBeInTheDocument();
    expect(within(rowOf(/Unassigned demand/)).getAllByRole('gridcell')[0]).toHaveTextContent('5 h');
    expect(within(rowOf(/Ines Kuruvilla/)).getAllByRole('gridcell')[0]).toHaveTextContent('Why: Competition deadline');
  });

  it('groups by person on request', async () => {
    open();
    await screen.findByRole('grid', { name: 'LV-77 staffing' });
    await userEvent.click(screen.getByRole('radio', { name: 'By person' }));
    const grid = screen.getByRole('grid', { name: 'LV-77 staffing' });
    expect(within(grid).queryByRole('row', { name: /MS Massing studies/ })).toBeNull();
    expect(within(rowOf(/Ines Kuruvilla/)).getAllByRole('gridcell')[1]).toHaveTextContent('24 h');
  });

  it('publishes this project only, and says when there is nothing to publish', async () => {
    open();
    await screen.findByRole('grid', { name: 'LV-77 staffing' });
    await userEvent.click(screen.getByRole('button', { name: 'Publish plan (3 changes)' }));
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Publish plan' })).getByRole('button', { name: 'Publish' }));
    await waitFor(() => expect(posts[0]).toMatchObject({ url: '/api/v1/allocations/publish', body: { project: 'LV-77' } }));
    expect(await screen.findByText('There are no unpublished changes to publish.')).toBeInTheDocument();
  });

  it('keeps the Team panel working when the planning API is missing', async () => {
    handler = (url, init) => (url.startsWith('/api/v1/workload') ? undefined : base(url, init));
    open();
    expect(await screen.findByText('Not available yet')).toBeInTheDocument();
    expect(await within(await screen.findByRole('region', { name: 'Team' })).findByText('Ines Kuruvilla')).toBeInTheDocument();
    expect(WEEKS).toHaveLength(8);
  });
});
