import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SessionProvider } from '../../../app/session';
import { ToastProvider } from '../../../ui/Toast';
import { ProjectPhasesScreen } from './phases';

// Live mode: the Phases tab edits status, owner, dates, budget and progress through the three phase writes.
vi.mock('../../../api/live', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../../api/live')>()), isLive: true }));

type Reply = { status: number; body: unknown } | undefined;
let handler: (url: string, init: RequestInit) => Reply;
const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const r = handler(String(input), init) ?? { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Not found' } } };
  return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
});
const m = (amount: string) => ({ amount, currency: 'INR' });
const list = (data: unknown[]) => ({ status: 200, body: { data, page: 1, page_size: 50, total: data.length, complete: true, missing_count: 0 } });

const ME = {
  person: { id: 'u-pm', ref_code: 'Q02', name: 'Nila Varma', work_email: 'nila@firm.test', job_title: 'Project lead', manager_id: null },
  firm: { id: 'f', trading_name: 'Test Studio', legal_name: 'x', currency: 'INR', timezone: 'Asia/Kolkata', accounting_adapter: 'mock' },
  permission_sets: ['pm'], capabilities: { 'projects.plan': 'scoped' }, led_projects: ['prj-uuid'], member_projects: ['prj-uuid'],
};
const PHASE = (over: Record<string, unknown>) => ({
  id: 'ph-a', code: 'BR', name: 'Brief and survey', start_date: '2026-08-03', end_date: '2026-10-30', owner: { id: 'u-o', ref_code: 'Q07', name: 'Ines Kuruvilla' },
  budget_hours: '110.00', actual_hours: '40.00', etc_hours: '30.00', forecast_hours: '70.00', delivery_progress_pct: 60, fee: m('200000.00'), status: 'In progress', ...over,
});
const PROJECT = (perms = { edit_phases: true, change_status: true, archive: false }) => ({
  id: 'prj-uuid', code: 'LV-77', name: 'Harbour Pavilion', client: 'Port Trust', client_id: 'c1', status: 'Active', hold_reason: null, contract: 'Fixed fee',
  pm: { id: 'u-pm', ref_code: 'Q02', name: 'Nila Varma' },
  hours: { budget: '110.00', actual: '40.00', forecast: '70.00' }, delivery_progress_pct: 30,
  entitlement: { restricted: true }, contribution: { restricted: true },
  phases: [
    PHASE({}),
    // Made in the wizard: no dates, no owner, no hours budget.
    PHASE({ id: 'ph-b', code: 'MS', name: 'Massing studies', start_date: null, end_date: null, owner: null, budget_hours: null, actual_hours: '0.00', etc_hours: '0.00', forecast_hours: '0.00', delivery_progress_pct: 0, status: 'Not started' }),
  ],
  permissions: perms,
});
const MEMBERS = [
  { person: { id: 'u-pm', ref_code: 'Q02', name: 'Nila Varma', job_title: 'Project lead' }, role: 'lead', is_pm: true },
  { person: { id: 'u-tp', ref_code: 'Q09', name: 'Tomas Pereira', job_title: 'Architect' }, role: 'contributor', is_pm: false },
];

let project = PROJECT();
let members: unknown[] = MEMBERS;
let writes: { method: string; url: string; body: unknown }[] = [];
function api(url: string, init: RequestInit): Reply {
  if (url.endsWith('/me')) return { status: 200, body: ME };
  if (url.endsWith('/projects/LV-77/members')) return list(members);
  if (url.endsWith('/projects/LV-77') && (init.method ?? 'GET') === 'GET') return { status: 200, body: project };
  if (init.method === 'PUT') {
    writes.push({ method: 'PUT', url, body: JSON.parse(String(init.body)) });
    if (url.endsWith('/dates')) return { status: 200, body: { cascade: false, shifted_days: 0, moved: [], violations: [], audit_event_id: 'a', phase: { id: 'x', start_date: null, end_date: null } } };
    return { status: 200, body: { ok: true, audit_event_id: 'a' } };
  }
  return undefined;
}

beforeEach(() => { vi.stubGlobal('fetch', fetchMock); fetchMock.mockClear(); project = PROJECT(); members = MEMBERS; writes = []; handler = api; });
afterEach(() => vi.unstubAllGlobals());

function open() {
  render(
    <SessionProvider>
      <ToastProvider>
        <MemoryRouter initialEntries={['/firm/projects/LV-77/phases']}>
          <Routes><Route path="/firm/projects/:id/phases" element={<ProjectPhasesScreen />} /></Routes>
        </MemoryRouter>
      </ToastProvider>
    </SessionProvider>,
  );
}
async function editSheet(phase: string) {
  await userEvent.click(await screen.findByRole('button', { name: `Actions for ${phase}` }));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit' }));
  return screen.findByRole('dialog', { name: 'Edit phase' });
}
async function pick(sheet: HTMLElement, label: string, option: string) {
  await userEvent.click(within(sheet).getByRole('combobox', { name: label }));
  await userEvent.click(await screen.findByRole('option', { name: option }));
}

describe('phases tab, live', () => {
  it('shows Not set and No owner for a wizard phase, never NaN or a NO avatar', async () => {
    open();
    const row = (await screen.findByRole('rowheader', { name: 'Massing studies' })).closest('tr')!;
    expect(within(row).getAllByText('Not set').length).toBeGreaterThanOrEqual(2);
    expect(within(row).getByText('No owner')).toBeInTheDocument();
    expect(within(row).getByText('No budget')).toBeInTheDocument();
    expect(row.textContent).not.toMatch(/NaN|undefined/);
    expect(within(row).queryByText('NO')).toBeNull();
    // The dated phase still shows its dates.
    const dated = screen.getByRole('rowheader', { name: 'Brief and survey' }).closest('tr')!;
    expect(within(dated).getByText('03 Aug 2026')).toBeInTheDocument();
  });

  it('sends only what changed: status and owner to PUT /phases/:id, nothing else', async () => {
    open();
    const sheet = await editSheet('Brief and survey');
    await pick(sheet, 'Status', 'Complete');
    await pick(sheet, 'Owner', 'Tomas Pereira');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save phase' }));
    await waitFor(() => expect(writes).toEqual([{ method: 'PUT', url: '/api/v1/phases/ph-a', body: { status: 'Complete', owner_id: 'u-tp' } }]));
    expect(await screen.findByText('Brief and survey saved.')).toBeInTheDocument();
    await waitFor(() => expect(fetchMock.mock.calls.filter(([u]) => String(u).endsWith('/projects/LV-77')).length).toBe(2));
  });

  it('offers the PM and team as owners plus No owner, and clears the owner with null', async () => {
    open();
    const sheet = await editSheet('Brief and survey');
    await userEvent.click(within(sheet).getByRole('combobox', { name: 'Owner' }));
    const names = (await screen.findAllByRole('option')).map((o) => o.textContent);
    expect(names).toEqual(['No owner', 'Nila Varma', 'Tomas Pereira', 'Ines Kuruvilla']);
    await userEvent.click(screen.getByRole('option', { name: 'No owner' }));
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save phase' }));
    await waitFor(() => expect(writes).toEqual([{ method: 'PUT', url: '/api/v1/phases/ph-a', body: { owner_id: null } }]));
  });

  it('clears both dates through PUT /phases/:id/dates and removes the budget with null', async () => {
    open();
    const sheet = await editSheet('Brief and survey');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Clear dates' }));
    expect(within(sheet).queryByRole('button', { name: 'Clear dates' })).toBeNull();
    await userEvent.clear(within(sheet).getByLabelText('Hours budget (h)'));
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save phase' }));
    await waitFor(() => expect(writes).toEqual([
      { method: 'PUT', url: '/api/v1/phases/ph-a', body: { budget_hours: null } },
      { method: 'PUT', url: '/api/v1/phases/ph-a/dates', body: { start_date: null, end_date: null, cascade: false } },
    ]));
  });

  it('saves progress first, then the phase, then the dates, with the cascade checkbox', async () => {
    open();
    const sheet = await editSheet('Brief and survey');
    const delivery = within(sheet).getByLabelText('Delivery (%)');
    await userEvent.clear(delivery); await userEvent.type(delivery, '80');
    const budget = within(sheet).getByLabelText('Hours budget (h)');
    await userEvent.clear(budget); await userEvent.type(budget, '150');
    await userEvent.click(within(sheet).getByRole('button', { name: /End/ }));
    await userEvent.click(await screen.findByRole('button', { name: /^28 Oct 2026/ }));
    const cascade = within(sheet).getByRole('checkbox', { name: /Move this phase’s tasks too/ });
    expect(cascade).toBeChecked();
    await userEvent.click(cascade);
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save phase' }));
    await waitFor(() => expect(writes.map((w) => w.url)).toEqual(['/api/v1/phases/ph-a/progress', '/api/v1/phases/ph-a', '/api/v1/phases/ph-a/dates']));
    expect(writes[0].body).toEqual({ etc_hours: 30, delivery_progress_pct: 80 });
    expect(writes[1].body).toEqual({ budget_hours: 150 });
    expect(writes[2].body).toEqual({ start_date: '2026-08-03', end_date: '2026-10-28', cascade: false });
  });

  it('does not resend a status the progress route already set (no self-transition)', async () => {
    open();
    const sheet = await editSheet('Brief and survey');
    const delivery = within(sheet).getByLabelText('Delivery (%)');
    await userEvent.clear(delivery); await userEvent.type(delivery, '100');
    await pick(sheet, 'Status', 'Complete');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save phase' }));
    await waitFor(() => expect(writes).toEqual([{ method: 'PUT', url: '/api/v1/phases/ph-a/progress', body: { etc_hours: 30, delivery_progress_pct: 100 } }]));
    expect(await screen.findByText('Brief and survey progress saved.')).toBeInTheDocument();
  });

  it('sends a status that differs from the synced one after the progress', async () => {
    open();
    const sheet = await editSheet('Brief and survey');
    const delivery = within(sheet).getByLabelText('Delivery (%)');
    await userEvent.clear(delivery); await userEvent.type(delivery, '100');
    await pick(sheet, 'Status', 'Cancelled');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save phase' }));
    await waitFor(() => expect(writes).toEqual([
      { method: 'PUT', url: '/api/v1/phases/ph-a/progress', body: { etc_hours: 30, delivery_progress_pct: 100 } },
      { method: 'PUT', url: '/api/v1/phases/ph-a', body: { status: 'Cancelled' } },
    ]));
  });

  it('In progress at 100%: changing only the ETC and setting Complete still sends the status', async () => {
    project.phases[0] = PHASE({ delivery_progress_pct: 100, status: 'In progress' });
    open();
    const sheet = await editSheet('Brief and survey');
    const etc = within(sheet).getByLabelText('ETC (h)');
    await userEvent.clear(etc); await userEvent.type(etc, '5');
    await pick(sheet, 'Status', 'Complete');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save phase' }));
    // The delivery figure did not change, so the progress route leaves the status alone: Complete goes to PUT /phases/:id.
    await waitFor(() => expect(writes).toEqual([
      { method: 'PUT', url: '/api/v1/phases/ph-a/progress', body: { etc_hours: 5, delivery_progress_pct: 100 } },
      { method: 'PUT', url: '/api/v1/phases/ph-a', body: { status: 'Complete' } },
    ]));
  });

  it('rounds delivery to two decimals as the server does: 99.996 is 100, so Complete is not sent again', async () => {
    open();
    const sheet = await editSheet('Brief and survey');
    const delivery = within(sheet).getByLabelText('Delivery (%)');
    await userEvent.clear(delivery); await userEvent.type(delivery, '99.996');
    await pick(sheet, 'Status', 'Complete');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save phase' }));
    await waitFor(() => expect(writes).toEqual([{ method: 'PUT', url: '/api/v1/phases/ph-a/progress', body: { etc_hours: 30, delivery_progress_pct: 100 } }]));
  });

  it('takes an hours budget up to 99999.99 and refuses more, with the limit in the helper', async () => {
    open();
    const sheet = await editSheet('Brief and survey');
    expect(within(sheet).getByText('Leave empty for no budget. At most 99999.99 h.')).toBeInTheDocument();
    const budget = within(sheet).getByLabelText('Hours budget (h)');
    await userEvent.clear(budget); await userEvent.type(budget, '100000');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save phase' }));
    expect(within(sheet).getByText('Enter hours from 0 to 99999.99')).toBeInTheDocument();
    expect(writes).toEqual([]);
    await userEvent.clear(budget); await userEvent.type(budget, '99999.99');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save phase' }));
    await waitFor(() => expect(writes).toEqual([{ method: 'PUT', url: '/api/v1/phases/ph-a', body: { budget_hours: 99999.99 } }]));
  });

  it('offers as owners only people still employed, plus the current owner', async () => {
    members = [
      ...MEMBERS.map((x) => ({ ...x, person: { ...x.person, employment_state: 'Active' } })),
      { person: { id: 'u-gone', ref_code: 'Q11', name: 'Rafael Gomes', job_title: 'Architect', employment_state: 'Ended' }, role: 'contributor', is_pm: false },
      // The current owner of Brief and survey has left too: they stay offered, so the sheet still shows who owns it.
      { person: { id: 'u-o', ref_code: 'Q07', name: 'Ines Kuruvilla', job_title: 'Architect', employment_state: 'Ended' }, role: 'contributor', is_pm: false },
    ];
    open();
    const sheet = await editSheet('Brief and survey');
    await userEvent.click(within(sheet).getByRole('combobox', { name: 'Owner' }));
    expect((await screen.findAllByRole('option')).map((o) => o.textContent)).toEqual(['No owner', 'Nila Varma', 'Tomas Pereira', 'Ines Kuruvilla']);
    await userEvent.keyboard('{Escape}');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit phase' })).toBeNull());
    // A phase owned by nobody does not offer the people who left.
    const other = await editSheet('Massing studies');
    await userEvent.click(within(other).getByRole('combobox', { name: 'Owner' }));
    expect((await screen.findAllByRole('option')).map((o) => o.textContent)).toEqual(['No owner', 'Nila Varma', 'Tomas Pereira']);
  });

  it('an archived project (the server sends edit_phases false) offers no Edit or Mark complete', async () => {
    project = { ...PROJECT({ edit_phases: false, change_status: true, archive: true }), status: 'Archived' };
    open();
    await screen.findByRole('rowheader', { name: 'Brief and survey' });
    expect(screen.queryByRole('button', { name: /^Actions for/ })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Mark complete' })).toBeNull();
  });

  it('refuses one date without the other, and an end before the start', async () => {
    open();
    const sheet = await editSheet('Massing studies');
    await userEvent.click(within(sheet).getByRole('button', { name: /Start/ }));
    const cal = await screen.findByRole('dialog', { name: 'Start calendar' });
    await userEvent.click(cal.querySelector<HTMLButtonElement>('.calendar__day:not(.calendar__day--other):not(:disabled)')!);
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save phase' }));
    expect(within(sheet).getByText('Set both dates, or clear both')).toBeInTheDocument();
    expect(writes).toEqual([]);
  });

  it('closes without a request when nothing changed', async () => {
    open();
    const sheet = await editSheet('Brief and survey');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save phase' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit phase' })).toBeNull());
    expect(writes).toEqual([]);
  });

  it('marks a phase complete from the row, and offers it only for phases that are not Complete', async () => {
    project.phases[0] = PHASE({ status: 'Complete' });
    open();
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for Brief and survey' }));
    expect(screen.queryByRole('menuitem', { name: 'Mark complete' })).toBeNull();
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Massing studies' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Mark complete' }));
    await waitFor(() => expect(writes).toEqual([{ method: 'PUT', url: '/api/v1/phases/ph-b', body: { status: 'Complete' } }]));
    expect(await screen.findByText('Massing studies marked complete.')).toBeInTheDocument();
  });

  it('hides the edit actions when the server says the viewer cannot edit phases', async () => {
    project = PROJECT({ edit_phases: false, change_status: false, archive: false });
    open();
    await screen.findByRole('rowheader', { name: 'Brief and survey' });
    expect(screen.queryByRole('button', { name: /^Actions for/ })).toBeNull();
    expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('/members'))).toBe(false);
  });

  it('shows a Complete phase with the finished marker', async () => {
    project.phases[0] = PHASE({ status: 'Complete' });
    open();
    const row = (await screen.findByRole('rowheader', { name: 'Brief and survey' })).closest('tr')!;
    expect(within(row).getByRole('status', { name: 'Complete' })).toHaveAttribute('data-marker', 'done');
  });
});
