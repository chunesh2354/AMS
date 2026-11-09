import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../../ui/Toast';
import { ApprovalsSettings } from './approvals-settings';
import { settingsSectionsFor } from './settings';
import type { Viewer } from '../../app/session';

vi.mock('../../api/live', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/live')>()), isLive: true }));

type Handler = (url: string, init: RequestInit) => { status: number; body: unknown } | undefined;
let handler: Handler;
const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const r = handler(String(input), init) ?? { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Not found' } } };
  return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
});
beforeEach(() => { vi.stubGlobal('fetch', fetchMock); fetchMock.mockClear(); });
afterEach(() => vi.unstubAllGlobals());

const ASHA = { id: 'p1', ref_code: 'P01', name: 'Asha Rao', job_title: 'Principal' };
const MEERA = { id: 'p3', ref_code: 'P03', name: 'Meera Iyer', job_title: 'Project architect' };
const SETTINGS = { fallback_approver: ASHA, fallback_approver_eligible: true, allow_self_approval: false, candidates: [ASHA, MEERA] };
const open = () => render(<ToastProvider><MemoryRouter><ApprovalsSettings /></MemoryRouter></ToastProvider>);
const puts = () => fetchMock.mock.calls.filter(([, i]) => (i as RequestInit | undefined)?.method === 'PUT');

describe('Settings, Approvals', () => {
  it('shows the fallback approver and saves a new one from the people who can approve time', async () => {
    handler = (url, init) => {
      if (!url.endsWith('/firm/approvals-settings')) return undefined;
      if (init.method === 'PUT') return { status: 200, body: { fallback_approver: MEERA, fallback_approver_eligible: true, allow_self_approval: false, audit_event_id: 'e1' } };
      return { status: 200, body: SETTINGS };
    };
    open();
    const picker = await screen.findByRole('combobox', { name: 'Fallback approver' });
    expect(picker).toHaveValue('Asha Rao');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    await userEvent.click(picker);
    await userEvent.click(await screen.findByRole('option', { name: /Meera Iyer/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Meera Iyer is now the fallback approver.')).toBeInTheDocument();
    expect(JSON.parse(String((puts()[0][1] as RequestInit).body))).toEqual({ fallback_approver_id: 'p3' });
  });

  it("shows the server's refusal and keeps the choice", async () => {
    handler = (url, init) => {
      if (!url.endsWith('/firm/approvals-settings')) return undefined;
      if (init.method === 'PUT') return { status: 422, body: { error: { code: 'RULE_VIOLATION', rule: 'FALLBACK_APPROVER_ELIGIBLE', message: 'The fallback approver must be an active person who can approve time.', details: [] } } };
      return { status: 200, body: SETTINGS };
    };
    open();
    await userEvent.click(await screen.findByRole('button', { name: 'Clear' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/must be an active person who can approve time/)).toBeInTheDocument();
    expect(JSON.parse(String((puts()[0][1] as RequestInit).body))).toEqual({ fallback_approver_id: null });
  });

  it('warns when the stored fallback can no longer approve', async () => {
    handler = (url) => (url.endsWith('/firm/approvals-settings') ? { status: 200, body: { ...SETTINGS, fallback_approver_eligible: false } } : undefined);
    open();
    expect(await screen.findByText('Asha Rao can no longer approve time')).toBeInTheDocument();
  });

  it('shows permission denied on a 403', async () => {
    handler = () => ({ status: 403, body: { error: { code: 'FORBIDDEN_CAPABILITY', message: 'You need firm.settings.manage for this.', capability: 'firm.settings.manage', details: [] } } });
    open();
    await waitFor(() => expect(screen.getByText(/change firm settings/)).toBeInTheDocument());
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('is listed only for viewers who hold firm.settings.manage firm-wide', () => {
    const viewer = (roles: Viewer['roles'], caps: Viewer['capabilities']): Viewer => ({ id: 'P01', name: 'X', title: '', roles, capabilities: caps });
    expect(settingsSectionsFor(viewer(['principal'], { 'firm.settings.manage': 'firm' })).map((s) => s.key)).toContain('approvals');
    expect(settingsSectionsFor(viewer(['operations'], {})).map((s) => s.key)).not.toContain('approvals');
  });
});
