import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SessionProvider } from '../../app/session';
import { OverlaysProvider } from '../../app/overlays';
import { ToastProvider } from '../../ui/Toast';
import { statusMoves, type ProjectPermissions } from '../../api/live/projects';
import { ProjectLayout } from './project-layout';

// Live mode: the header reads GET /projects/:code and changes status through PUT /projects/:code/status.
vi.mock('../../api/live', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/live')>()), isLive: true }));

type Reply = { status: number; body: unknown } | undefined;
let handler: (url: string, init: RequestInit) => Reply;
const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const r = handler(String(input), init) ?? { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Not found' } } };
  return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
});

const ME = {
  person: { id: 'u-pm', ref_code: 'Q02', name: 'Nila Varma', work_email: 'nila@firm.test', job_title: 'Project lead', manager_id: null },
  firm: { id: 'f', trading_name: 'Test Studio', legal_name: 'x', currency: 'INR', timezone: 'Asia/Kolkata', accounting_adapter: 'mock' },
  permission_sets: ['pm'], capabilities: { 'projects.plan': 'scoped' }, led_projects: ['prj-uuid'], member_projects: ['prj-uuid'],
};
const ALL: ProjectPermissions = { edit_phases: true, change_status: true, archive: true };
const PM: ProjectPermissions = { edit_phases: true, change_status: true, archive: false };
const PROJECT = (status: string, permissions: ProjectPermissions | undefined, hold: string | null = null) => ({
  id: 'prj-uuid', code: 'LV-77', name: 'Harbour Pavilion', client: 'Port Trust', client_id: 'c1', status, hold_reason: hold, contract: 'Fixed fee',
  pm: { id: 'u-pm', ref_code: 'Q02', name: 'Nila Varma' },
  // No hours budget yet (a wizard project from a template).
  hours: { budget: '0.00', actual: '0.00', forecast: '0.00' }, delivery_progress_pct: 0,
  entitlement: { restricted: true }, contribution: { restricted: true }, phases: [],
  ...(permissions ? { permissions } : {}),
});

let project = PROJECT('Active', PM);
let puts: { url: string; body: unknown }[] = [];
let tabMounts = 0;
function Tab() {
  useEffect(() => { tabMounts += 1; }, []);
  return <p>Tab body</p>;
}
function api(url: string, init: RequestInit): Reply {
  if (url.endsWith('/me')) return { status: 200, body: ME };
  if (url.endsWith('/projects/LV-77/status') && init.method === 'PUT') {
    const body = JSON.parse(String(init.body)) as { status: string; reason?: string };
    puts.push({ url, body });
    project = PROJECT(body.status, project.permissions, body.status === 'On hold' ? body.reason ?? null : null);
    return { status: 200, body: { status: body.status, hold_reason: project.hold_reason, audit_event_id: 'a1' } };
  }
  if (url.endsWith('/projects/LV-77')) return { status: 200, body: project };
  return undefined;
}

beforeEach(() => { vi.stubGlobal('fetch', fetchMock); fetchMock.mockClear(); puts = []; tabMounts = 0; handler = api; project = PROJECT('Active', PM); });
afterEach(() => vi.unstubAllGlobals());

function open() {
  render(
    <SessionProvider>
      <ToastProvider>
        <OverlaysProvider>
          <MemoryRouter initialEntries={['/firm/projects/LV-77']}>
            <Routes>
              <Route path="/firm/projects/:id" element={<ProjectLayout />}>
                <Route index element={<Tab />} />
              </Route>
            </Routes>
          </MemoryRouter>
        </OverlaysProvider>
      </ToastProvider>
    </SessionProvider>,
  );
}
const labels = (status: string, p: ProjectPermissions) => statusMoves(status, p).map((m) => m.label);
const menuItems = async () => {
  await userEvent.click(await screen.findByRole('button', { name: 'Project status' }));
  return (await screen.findAllByRole('menuitem')).map((b) => b.textContent);
};

describe('status moves', () => {
  it('offers only the moves valid from each status', () => {
    expect(labels('Draft', ALL)).toEqual(['Make active', 'Archive…']);
    expect(labels('Active', ALL)).toEqual(['Put on hold…', 'Mark delivery complete', 'Archive…']);
    expect(labels('On hold', ALL)).toEqual(['Resume', 'Mark delivery complete', 'Archive…']);
    expect(labels('Delivery complete', ALL)).toEqual(['Reopen', 'Archive…']);
    expect(labels('Archived', ALL)).toEqual(['Restore']);
  });
  it('keeps Archive and Restore to permissions.archive, and the rest to change_status', () => {
    expect(labels('Active', PM)).toEqual(['Put on hold…', 'Mark delivery complete']);
    expect(labels('Archived', PM)).toEqual([]);
    expect(labels('Active', { edit_phases: false, change_status: false, archive: true })).toEqual(['Archive…']);
    expect(labels('Archived', { edit_phases: false, change_status: false, archive: true })).toEqual(['Restore']);
    expect(statusMoves('Active', ALL).filter((m) => m.needsReason).map((m) => m.to)).toEqual(['On hold', 'Archived']);
  });
});

describe('project status menu, live', () => {
  it('shows "No budget", never the raw word Draft, beside the status', async () => {
    open();
    expect(await screen.findByRole('status', { name: 'No budget' })).toBeInTheDocument();
    expect(screen.queryByText('Draft')).toBeNull();
  });

  it('is not shown when the viewer may not change the status', async () => {
    project = PROJECT('Active', { edit_phases: false, change_status: false, archive: false });
    open();
    await screen.findByRole('heading', { level: 1, name: 'Harbour Pavilion' });
    expect(screen.queryByRole('button', { name: 'Project status' })).toBeNull();
  });

  it('is not shown when an older server sends no permissions', async () => {
    project = PROJECT('Active', undefined);
    open();
    await screen.findByRole('heading', { level: 1, name: 'Harbour Pavilion' });
    expect(screen.queryByRole('button', { name: 'Project status' })).toBeNull();
  });

  it('lists only the valid moves the PM may make', async () => {
    open();
    expect(await menuItems()).toEqual(['Put on hold…', 'Mark delivery complete']);
  });

  it('requires a reason to put the project on hold, sends it, then reloads the header and the tab with the reason', async () => {
    open();
    await screen.findByText('Tab body');
    await screen.findByRole('button', { name: 'Project status' });
    await waitFor(() => expect(tabMounts).toBe(1));
    await menuItems();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Put on hold…' }));
    const sheet = await screen.findByRole('dialog', { name: 'Put project on hold' });
    await userEvent.click(within(sheet).getByRole('button', { name: 'Put on hold' }));
    expect(within(sheet).getByText('Say why the project is on hold')).toBeInTheDocument();
    expect(puts).toEqual([]);
    await userEvent.type(within(sheet).getByLabelText('Reason'), 'Client funding review');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Put on hold' }));
    await waitFor(() => expect(puts).toEqual([{ url: '/api/v1/projects/LV-77/status', body: { status: 'On hold', reason: 'Client funding review' } }]));
    expect(await screen.findByText('LV-77 is on hold')).toBeInTheDocument();
    expect(screen.getByText(/Client funding review\. Allocations are retained/)).toBeInTheDocument();
    await waitFor(() => expect(tabMounts).toBe(2));
    expect(await menuItems()).toEqual(['Resume', 'Mark delivery complete']);
  });

  it('sends Resume and Mark delivery complete with no reason', async () => {
    project = PROJECT('On hold', PM, 'Funding');
    open();
    await menuItems();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Mark delivery complete' }));
    await waitFor(() => expect(puts).toEqual([{ url: '/api/v1/projects/LV-77/status', body: { status: 'Delivery complete' } }]));
    expect(await screen.findByText('LV-77 is marked delivery complete.')).toBeInTheDocument();
    expect(await menuItems()).toEqual(['Reopen']);
  });

  it('archives with a reason and restores, for a viewer the server lets archive', async () => {
    project = PROJECT('Delivery complete', ALL);
    open();
    expect(await menuItems()).toEqual(['Reopen', 'Archive…']);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Archive…' }));
    const sheet = await screen.findByRole('dialog', { name: 'Archive project' });
    await userEvent.click(within(sheet).getByRole('button', { name: 'Archive project' }));
    expect(within(sheet).getByText('Say why the project is archived')).toBeInTheDocument();
    await userEvent.type(within(sheet).getByLabelText('Reason'), 'Handed over');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Archive project' }));
    await waitFor(() => expect(puts.at(-1)).toEqual({ url: '/api/v1/projects/LV-77/status', body: { status: 'Archived', reason: 'Handed over' } }));
    expect(await screen.findByText('LV-77 is archived')).toBeInTheDocument();
    expect(await menuItems()).toEqual(['Restore']);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Restore' }));
    await waitFor(() => expect(puts.at(-1)).toEqual({ url: '/api/v1/projects/LV-77/status', body: { status: 'Active' } }));
  });

  it('says only what archiving really does in the reason sheet', async () => {
    project = PROJECT('Delivery complete', ALL);
    open();
    await menuItems();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Archive…' }));
    const sheet = await screen.findByRole('dialog', { name: 'Archive project' });
    expect(within(sheet).getByText('Archived projects leave Health, the overview, the studio timeline and the planning calendar, and take no new time or new allocations. They stay in the Projects list, and Restore brings one back.')).toBeInTheDocument();
    expect(within(sheet).queryByText(/leave the lists/)).toBeNull();
  });

  it('shows the server refusal in the sheet and keeps it open', async () => {
    handler = (url, init) => (url.endsWith('/status') && init.method === 'PUT'
      ? { status: 409, body: { error: { code: 'INVALID_TRANSITION', message: 'This project cannot go on hold from Archived.' } } }
      : api(url, init));
    open();
    await menuItems();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Put on hold…' }));
    const sheet = await screen.findByRole('dialog', { name: 'Put project on hold' });
    await userEvent.type(within(sheet).getByLabelText('Reason'), 'Paused');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Put on hold' }));
    expect(await within(sheet).findByText('This project cannot go on hold from Archived.')).toBeInTheDocument();
  });
});
