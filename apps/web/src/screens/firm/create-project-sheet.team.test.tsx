import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
import { ToastProvider } from '../../ui/Toast';
import { splitFee } from '../../api/live/setup';
import { CreateProjectSheet } from './create-project-sheet';

// The live wizard's fee basis, phase fees, team and principal: what makes a new project billable and staffable.
vi.mock('../../api/live', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/live')>()), isLive: true }));

type Handler = (url: string, init: RequestInit) => { status: number; body: unknown } | undefined;
let handler: Handler;
const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const r = handler(String(input), init) ?? { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Not found' } } };
  return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
});
const list = (data: unknown[]) => ({ status: 200, body: { data, page: 1, page_size: 200, total: data.length, complete: true, missing_count: 0 } });
const bodyOf = (init: RequestInit) => JSON.parse(String(init.body ?? '{}'));
const projectPosts = () => fetchMock.mock.calls.filter(([u, i]) => String(u).endsWith('/projects') && (i as RequestInit | undefined)?.method === 'POST');

const PEOPLE = [
  { id: 'u-asha', ref_code: 'P01', name: 'Asha Rao', job_title: 'Principal', manager_id: null, employment_state: 'Active', login_state: 'Enabled', sets: ['principal'], can_be_pm: true, can_be_principal: true },
  { id: 'u-vikram', ref_code: 'P02', name: 'Vikram Nair', job_title: 'Project architect', manager_id: 'u-asha', employment_state: 'Active', login_state: 'Enabled', sets: ['pm'], can_be_pm: true, can_be_principal: false },
  { id: 'u-rohan', ref_code: 'P04', name: 'Rohan Shetty', job_title: 'Senior architect', manager_id: 'u-vikram', employment_state: 'Active', login_state: 'Enabled', sets: ['staff'], can_be_pm: false, can_be_principal: false },
];
const ME = (sets: string[]) => ({ status: 200, body: { person: { id: 'u-asha', ref_code: 'P01', name: 'Asha Rao' }, permission_sets: sets, capabilities: {}, led_projects: [], member_projects: [] } });

const directory = (sets: string[]): Handler => (url, init) => {
  if (url.endsWith('/clients') && (init.method ?? 'GET') === 'GET') return list([{ id: 'c-lake', name: 'Lakeview Trust' }]);
  if (url.endsWith('/project-candidates')) return list(PEOPLE);
  if (url.endsWith('/me')) return ME(sets);
  if (url.endsWith('/projects') && init.method === 'POST') return { status: 200, body: { id: 'p-new', code: 'PRJ-07', principal_id: 'u-asha', audit_event_id: 'e' } };
  return undefined;
};

beforeEach(() => { vi.stubGlobal('fetch', fetchMock); fetchMock.mockClear(); });
afterEach(() => vi.unstubAllGlobals());

function Opened() {
  return <h1>Opened {useParams().code}</h1>;
}
function openSheet() {
  render(
    <ToastProvider>
      <MemoryRouter initialEntries={['/firm/projects']}>
        <Routes>
          <Route path="/firm/projects" element={<CreateProjectSheet open onClose={() => {}} people={[]} />} />
          <Route path="/firm/projects/:code" element={<Opened />} />
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
const next = (sheet: HTMLElement) => userEvent.click(within(sheet).getByRole('button', { name: 'Save and continue' }));
async function firstStep(sheet: HTMLElement) {
  await userEvent.type(within(sheet).getByLabelText('Project code'), 'PRJ-07');
  await userEvent.type(within(sheet).getByLabelText('Name'), 'Riverside Homes');
  await pick(sheet, 'Client', 'Lakeview Trust');
  await pick(sheet, 'Project manager', 'Vikram Nair', 'Vik');
  await next(sheet);
}

describe('splitFee', () => {
  it('splits in whole rupees and puts the remainder on the last phase', () => {
    expect(splitFee(1000000, 3)).toEqual([333333, 333333, 333334]);
    expect(splitFee(100.5, 2)).toEqual([50, 50.5]);
    expect(splitFee(5, 0)).toEqual([]);
  });
});

describe('create project wizard, fee and team', () => {
  it('splits a fixed fee across phases, refuses phase fees that do not add up, and sends fees, team and principal', async () => {
    handler = directory(['principal']);
    const sheet = await openSheet();
    await firstStep(sheet);
    await pick(sheet, 'Phase template', 'Refit, 4 phases');
    expect(within(sheet).getByRole('combobox', { name: 'Fee basis' })).toHaveTextContent('Fixed fee');
    await userEvent.type(within(sheet).getByLabelText('Contracted fee'), '1000000');
    const concept = within(sheet).getByLabelText('Concept design fee');
    expect(concept).toHaveValue('2,50,000');

    await userEvent.clear(concept);
    await userEvent.type(concept, '300000');
    await next(sheet);
    expect(within(sheet).getByRole('alert')).toHaveTextContent('Phase fees add up to ₹10,50,000. They must add up to the fee of ₹10,00,000.');
    expect(within(sheet).getByLabelText('Contracted fee')).toBeInTheDocument();

    const site = within(sheet).getByLabelText('Site supervision fee');
    await userEvent.clear(site);
    await userEvent.type(site, '200000');
    await next(sheet);

    // Team and review: the creating principal is the default principal.
    expect(within(sheet).getByRole('combobox', { name: 'Principal' })).toHaveValue('Asha Rao');
    await userEvent.click(within(sheet).getByRole('combobox', { name: 'Team' }));
    await userEvent.click(await screen.findByRole('option', { name: /Rohan Shetty/ }));
    expect(within(sheet).getByText('Fixed fee')).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Create project' }));
    expect(await screen.findByRole('heading', { name: 'Opened PRJ-07' })).toBeInTheDocument();

    const body = bodyOf(projectPosts()[0]![1] as RequestInit);
    expect(body).toMatchObject({ billing_method: 'fixed_percent', contracted_amount: 1000000, principal_id: 'u-asha', members: [{ person_id: 'u-rohan', role: 'contributor' }] });
    expect(body.phases.map((p: { code: string; fee: number }) => [p.code, p.fee])).toEqual([['CD', 300000], ['DD', 250000], ['WD', 250000], ['SS', 200000]]);
  });

  it('offers Hourly: no fee fields, no phase fees, and the server picks the principal when the creator is not one', async () => {
    handler = directory(['operations']);
    const sheet = await openSheet();
    await firstStep(sheet);
    await pick(sheet, 'Phase template', 'Refit, 4 phases');
    await pick(sheet, 'Fee basis', '^Hourly$');
    expect(within(sheet).queryByLabelText('Contracted fee')).toBeNull();
    expect(within(sheet).getByText(/Approved time is billed at each person/)).toBeInTheDocument();
    await next(sheet);
    expect(within(sheet).getByText('Approved time at bill rates')).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Create project' }));
    await screen.findByRole('heading', { name: 'Opened PRJ-07' });
    const body = bodyOf(projectPosts()[0]![1] as RequestInit);
    expect(body.billing_method).toBe('hourly');
    expect(body.principal_id).toBeUndefined();
    expect(body.contracted_amount).toBeUndefined();
    expect(body.members).toEqual([]);
    expect(body.phases.every((p: { fee?: number }) => p.fee === undefined)).toBe(true);
  });

  it('needs a cap for hourly up to a cap', async () => {
    handler = directory(['principal']);
    const sheet = await openSheet();
    await firstStep(sheet);
    await pick(sheet, 'Phase template', 'Refit, 4 phases');
    await pick(sheet, 'Fee basis', 'Hourly up to a cap');
    await next(sheet);
    expect(within(sheet).getByText('Enter the cap')).toBeInTheDocument();
    await userEvent.type(within(sheet).getByLabelText('Cap'), '500000');
    await next(sheet);
    await userEvent.click(within(sheet).getByRole('button', { name: 'Create project' }));
    await screen.findByRole('heading', { name: 'Opened PRJ-07' });
    expect(bodyOf(projectPosts()[0]![1] as RequestInit)).toMatchObject({ billing_method: 'hourly_nte', cap_amount: 500000 });
  });
});

describe('create project wizard, required fees and eligible people', () => {
  it('needs the contracted fee for a fixed fee before it moves on, and never says it can be set later', async () => {
    handler = directory(['principal']);
    const sheet = await openSheet();
    await firstStep(sheet);
    await pick(sheet, 'Phase template', 'Refit, 4 phases');
    expect(within(sheet).queryByText(/can be set later/)).toBeNull();
    await next(sheet);
    expect(within(sheet).getByText('Enter the contracted fee')).toBeInTheDocument();
    expect(within(sheet).getByLabelText('Contracted fee')).toBeInTheDocument();
    // Clearing one phase's fee is refused too: every phase needs a fee.
    await userEvent.type(within(sheet).getByLabelText('Contracted fee'), '400000');
    await userEvent.clear(within(sheet).getByLabelText('Concept design fee'));
    await next(sheet);
    expect(within(sheet).getByRole('alert')).toHaveTextContent('Enter a fee for every phase');
    expect(projectPosts()).toHaveLength(0);
  });

  it('lists only PMs and principals as project manager, and only principals other than the PM as principal', async () => {
    handler = directory(['principal']);
    const sheet = await openSheet();
    await userEvent.click(within(sheet).getByRole('combobox', { name: 'Project manager' }));
    expect(await screen.findByRole('option', { name: /Vikram Nair/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Asha Rao/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Rohan Shetty/ })).toBeNull();
    // Asha (the creating principal) as PM: she is no longer the principal, and the principal list leaves her out.
    await userEvent.click(screen.getByRole('option', { name: /Asha Rao/ }));
    await userEvent.type(within(sheet).getByLabelText('Project code'), 'PRJ-07');
    await userEvent.type(within(sheet).getByLabelText('Name'), 'Riverside Homes');
    await pick(sheet, 'Client', 'Lakeview Trust');
    await next(sheet);
    await pick(sheet, 'Phase template', 'Refit, 4 phases');
    await userEvent.type(within(sheet).getByLabelText('Contracted fee'), '400000');
    await next(sheet);
    const principal = within(sheet).getByRole('combobox', { name: 'Principal' });
    expect(principal).toHaveValue('');
    await userEvent.click(principal);
    expect(screen.queryByRole('option', { name: /Asha Rao/ })).toBeNull();
    expect(screen.queryByRole('option', { name: /Vikram Nair/ })).toBeNull();
    await userEvent.keyboard('{Escape}');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Create project' }));
    await screen.findByRole('heading', { name: 'Opened PRJ-07' });
    const body = bodyOf(projectPosts()[0]![1] as RequestInit);
    expect(body.pm_id).toBe('u-asha');
    expect(body.principal_id).toBeUndefined();
  });
});
