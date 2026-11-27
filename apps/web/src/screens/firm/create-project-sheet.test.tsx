import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
import { ToastProvider } from '../../ui/Toast';
import { CreateProjectSheet } from './create-project-sheet';

vi.mock('../../api/live', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/live')>()), isLive: true }));

type Handler = (url: string, init: RequestInit) => { status: number; body: unknown } | undefined;
let handler: Handler;
const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const r = handler(String(input), init) ?? { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Not found' } } };
  return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
});
const list = (data: unknown[]) => ({ status: 200, body: { data, page: 1, page_size: 200, total: data.length, complete: true, missing_count: 0 } });
const bodyOf = (init: RequestInit) => JSON.parse(String(init.body ?? '{}'));
const posts = (path: string) => fetchMock.mock.calls.filter(([u, i]) => String(u).endsWith(path) && (i as RequestInit | undefined)?.method === 'POST');

const PEOPLE = [
  { id: 'u-asha', ref_code: 'P01', name: 'Asha Rao', job_title: 'Principal', manager_id: null, employment_state: 'Active', login_state: 'Enabled', sets: ['principal'], can_be_pm: true, can_be_principal: true },
  { id: 'u-vikram', ref_code: 'P02', name: 'Vikram Nair', job_title: 'Project architect', manager_id: 'u-asha', employment_state: 'Active', login_state: 'Enabled', sets: ['pm'], can_be_pm: true, can_be_principal: false },
];
const CLIENTS = [{ id: 'c-lake', name: 'Lakeview Trust' }];

/** GET /clients and /people, plus whatever the test adds. */
const withDirectory = (extra: Handler): Handler => (url, init) => {
  const hit = extra(url, init);
  if (hit) return hit;
  if (url.endsWith('/clients') && (init.method ?? 'GET') === 'GET') return list(CLIENTS);
  if (url.endsWith('/project-candidates')) return list(PEOPLE);
  return undefined;
};

beforeEach(() => { vi.stubGlobal('fetch', fetchMock); fetchMock.mockClear(); });
afterEach(() => vi.unstubAllGlobals());

function ProjectPage() {
  return <h1>Opened {useParams().code}</h1>;
}
const onClose = vi.fn();
function openSheet() {
  render(
    <ToastProvider>
      <MemoryRouter initialEntries={['/firm/projects']}>
        <Routes>
          <Route path="/firm/projects" element={<CreateProjectSheet open onClose={onClose} people={[]} />} />
          <Route path="/firm/projects/:code" element={<ProjectPage />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
  return screen.findByRole('dialog', { name: 'Create project' });
}

async function pick(sheet: HTMLElement, label: string, option: string, type?: string) {
  const box = within(sheet).getByRole('combobox', { name: label });
  await userEvent.click(box);
  if (type) await userEvent.type(box, type);
  await userEvent.click(await screen.findByRole('option', { name: new RegExp(option) }));
}

async function fillProjectStep(sheet: HTMLElement, opts: { newClient?: string; client?: string }) {
  await userEvent.type(within(sheet).getByLabelText('Project code'), 'PRJ-07');
  await userEvent.type(within(sheet).getByLabelText('Name'), 'Riverside Homes');
  await pick(sheet, 'Client', opts.newClient ? 'Add a new client' : opts.client ?? 'Lakeview Trust');
  if (opts.newClient) await userEvent.type(within(sheet).getByLabelText('New client name'), opts.newClient);
  await pick(sheet, 'Project manager', 'Vikram Nair', 'Vik');
}

describe('Create project sheet, live mode', () => {
  it('validates the first step before calling the server', async () => {
    handler = withDirectory(() => undefined);
    const sheet = await openSheet();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save and continue' }));
    expect(within(sheet).getByText('Enter a project code')).toBeInTheDocument();
    expect(within(sheet).getByText('Choose a client or add a new one')).toBeInTheDocument();
    expect(within(sheet).getByText('Choose a project manager')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, i]) => (i as RequestInit | undefined)?.method === 'POST')).toBe(false);
  });

  it('adds a client inline, creates the project and opens it, with no demo copy', async () => {
    handler = withDirectory((url, init) => {
      if (url.endsWith('/clients') && init.method === 'POST') return { status: 200, body: { id: 'c-new', name: 'Riverside Housing', audit_event_id: 'e1' } };
      if (url.endsWith('/projects') && init.method === 'POST') return { status: 200, body: { id: 'p-new', code: 'PRJ-07', audit_event_id: 'e2' } };
      return undefined;
    });
    const sheet = await openSheet();
    expect(screen.queryByText(/Nothing is saved/)).toBeNull();
    await fillProjectStep(sheet, { newClient: 'Riverside Housing' });
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save and continue' }));
    await pick(sheet, 'Phase template', 'Residential, 6 phases');
    await userEvent.type(within(sheet).getByLabelText('Contracted fee'), '2400000');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save and continue' }));
    expect(within(sheet).getByText('Riverside Housing (new)')).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Create project' }));

    expect(await screen.findByRole('heading', { name: 'Opened PRJ-07' })).toBeInTheDocument();
    expect(bodyOf(posts('/clients')[0]![1] as RequestInit)).toEqual({ name: 'Riverside Housing' });
    const project = bodyOf(posts('/projects')[0]![1] as RequestInit);
    expect(project).toMatchObject({ code: 'PRJ-07', name: 'Riverside Homes', client_id: 'c-new', pm_id: 'u-vikram', billing_method: 'fixed_percent', contracted_amount: 2400000 });
    expect(project.phases.map((p: { code: string }) => p.code)).toEqual(['CD', 'SD', 'DD', 'WD', 'TN', 'SS']);
    expect(await screen.findByText('PRJ-07 Riverside Homes created.')).toBeInTheDocument();
    expect(screen.queryByText(/Nothing is saved/)).toBeNull();
    expect(onClose).toHaveBeenCalled();
  });

  it('shows a server refusal and keeps the sheet open', async () => {
    handler = withDirectory((url, init) => {
      if (url.endsWith('/projects') && init.method === 'POST') return { status: 403, body: { error: { code: 'FORBIDDEN_CAPABILITY', message: 'You need projects.create for this.', capability: 'projects.create' } } };
      return undefined;
    });
    const sheet = await openSheet();
    await fillProjectStep(sheet, { client: 'Lakeview Trust' });
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save and continue' }));
    await pick(sheet, 'Phase template', 'Refit, 4 phases');
    await userEvent.type(within(sheet).getByLabelText('Contracted fee'), '600000');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save and continue' }));
    await userEvent.click(within(sheet).getByRole('button', { name: 'Create project' }));
    expect(await within(sheet).findByText('You need projects.create for this.')).toBeInTheDocument();
    expect(posts('/clients')).toHaveLength(0);
    expect(bodyOf(posts('/projects')[0]![1] as RequestInit).client_id).toBe('c-lake');
    expect(screen.queryByRole('heading', { name: /Opened/ })).toBeNull();
  });

  it('sends a duplicate project code back to the first step with the server message', async () => {
    handler = withDirectory((url, init) => {
      if (url.endsWith('/projects') && init.method === 'POST') return { status: 409, body: { error: { code: 'DUPLICATE_CODE', message: 'Project PRJ-07 already exists.' } } };
      return undefined;
    });
    const sheet = await openSheet();
    await fillProjectStep(sheet, { client: 'Lakeview Trust' });
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save and continue' }));
    await pick(sheet, 'Phase template', 'Refit, 4 phases');
    await userEvent.type(within(sheet).getByLabelText('Contracted fee'), '600000');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save and continue' }));
    await userEvent.click(within(sheet).getByRole('button', { name: 'Create project' }));
    expect(await within(sheet).findByText('Project PRJ-07 already exists.')).toBeInTheDocument();
    expect(within(sheet).getByLabelText('Project code')).toBeInTheDocument();
  });
});

describe('Create project sheet, live mode: phase dates and hours', () => {
  const day = async (sheet: HTMLElement, group: string, field: 'Start' | 'End', which: 'first' | 'last') => {
    await userEvent.click(within(within(sheet).getByRole('group', { name: group })).getByRole('button', { name: field }));
    const cal = await screen.findByRole('dialog', { name: `${field} calendar` });
    const days = [...cal.querySelectorAll<HTMLButtonElement>('.calendar__day:not(.calendar__day--other):not(:disabled)')];
    await userEvent.click(which === 'first' ? days[0] : days[days.length - 1]);
  };

  it('sends optional dates and an hours budget per phase from a template, and leaves unset keys out', async () => {
    handler = withDirectory((url, init) => (url.endsWith('/projects') && init.method === 'POST' ? { status: 200, body: { id: 'p-new', code: 'PRJ-07', audit_event_id: 'e2' } } : undefined));
    const sheet = await openSheet();
    await fillProjectStep(sheet, { client: 'Lakeview Trust' });
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save and continue' }));
    await pick(sheet, 'Phase template', 'Refit, 4 phases');
    await userEvent.type(within(sheet).getByLabelText('Contracted fee'), '600000');
    const cd = 'Concept design dates and hours';
    await day(sheet, cd, 'Start', 'first');
    // One date alone is refused.
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save and continue' }));
    expect(within(sheet).getByText('Concept design: Set both dates, or clear both')).toBeInTheDocument();
    await day(sheet, cd, 'End', 'last');
    await userEvent.type(within(within(sheet).getByRole('group', { name: cd })).getByLabelText('Hours'), '120');
    await userEvent.type(within(within(sheet).getByRole('group', { name: 'Site supervision dates and hours' })).getByLabelText('Hours'), '0');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save and continue' }));
    await userEvent.click(within(sheet).getByRole('button', { name: 'Create project' }));
    expect(await screen.findByRole('heading', { name: 'Opened PRJ-07' })).toBeInTheDocument();
    const phases = bodyOf(posts('/projects')[0]![1] as RequestInit).phases as Record<string, unknown>[];
    expect(phases[0]).toMatchObject({ code: 'CD', budget_hours: 120 });
    expect(String(phases[0].start_date)).toMatch(/^\d{4}-\d{2}-01$/);
    expect(String(phases[0].end_date) > String(phases[0].start_date)).toBe(true);
    expect(phases[3]).toMatchObject({ code: 'SS', budget_hours: 0 });
    for (const p of phases.slice(1)) expect(p).not.toHaveProperty('start_date');
    expect(phases[1]).not.toHaveProperty('budget_hours');
  });

  it('takes hours up to 99999.99 (the server limit) and refuses more', async () => {
    handler = withDirectory((url, init) => (url.endsWith('/projects') && init.method === 'POST' ? { status: 200, body: { id: 'p-new', code: 'PRJ-07', audit_event_id: 'e2' } } : undefined));
    const sheet = await openSheet();
    await fillProjectStep(sheet, { client: 'Lakeview Trust' });
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save and continue' }));
    await pick(sheet, 'Phase template', 'Refit, 4 phases');
    await userEvent.type(within(sheet).getByLabelText('Contracted fee'), '600000');
    expect(within(sheet).getByText(/Hours from 0 to 99999\.99 per phase/)).toBeInTheDocument();
    const hours = within(within(sheet).getByRole('group', { name: 'Concept design dates and hours' })).getByLabelText('Hours');
    await userEvent.type(hours, '100000');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save and continue' }));
    expect(within(sheet).getByText('Concept design: Enter hours from 0 to 99999.99')).toBeInTheDocument();
    await userEvent.clear(hours);
    await userEvent.type(hours, '99999.99');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save and continue' }));
    await userEvent.click(within(sheet).getByRole('button', { name: 'Create project' }));
    expect(await screen.findByRole('heading', { name: 'Opened PRJ-07' })).toBeInTheDocument();
    const phases = bodyOf(posts('/projects')[0]![1] as RequestInit).phases as Record<string, unknown>[];
    expect(phases[0]).toMatchObject({ code: 'CD', budget_hours: 99999.99 });
  });

  it('clears a phase’s dates again', async () => {
    handler = withDirectory(() => undefined);
    const sheet = await openSheet();
    await fillProjectStep(sheet, { client: 'Lakeview Trust' });
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save and continue' }));
    await pick(sheet, 'Phase template', 'Refit, 4 phases');
    const cd = within(sheet).getByRole('group', { name: 'Concept design dates and hours' });
    await day(sheet, 'Concept design dates and hours', 'Start', 'first');
    await userEvent.click(within(cd).getByRole('button', { name: 'Clear dates' }));
    expect(within(cd).getAllByText('Not set')).toHaveLength(2);
  });
});
