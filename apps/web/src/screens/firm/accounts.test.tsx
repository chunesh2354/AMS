import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ToastProvider } from '../../ui/Toast';
import { AccountsSettings, EMAIL_NOTE, RESET_NOTE } from './accounts';
import { AcceptInviteScreen } from '../auth/accept-invite';

vi.mock('../../api/live', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/live')>()), isLive: true }));

type Handler = (url: string, init: RequestInit) => { status: number; body: unknown } | undefined;
let handler: Handler;
const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const r = handler(String(input), init) ?? { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Not found' } } };
  return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
});

const ACCOUNT = {
  id: 'a1', ref_code: 'P01', name: 'Asha Rao', work_email: 'asha@firm.test', job_title: 'Principal', manager_id: null,
  account_types: ['principal'], invitation_state: 'Accepted', login_state: 'Enabled', employment_state: 'Active', created_at: '2026-04-01',
};
const list = (data: unknown[]) => ({ status: 200, body: { data, page: 1, page_size: 50, total: data.length, complete: true, missing_count: 0 } });
const bodyOf = (init: RequestInit) => JSON.parse(String(init.body ?? '{}'));

beforeEach(() => { vi.stubGlobal('fetch', fetchMock); fetchMock.mockClear(); });
afterEach(() => vi.unstubAllGlobals());

const openAccounts = () => render(<ToastProvider><MemoryRouter><AccountsSettings /></MemoryRouter></ToastProvider>);

async function openAddSheet() {
  openAccounts();
  await screen.findByText('Asha Rao');
  await userEvent.click(screen.getAllByRole('button', { name: 'Add account' })[0]);
  return screen.findByRole('dialog', { name: 'Add account' });
}

describe('Accounts settings', () => {
  it('validates the add account form before calling the server', async () => {
    handler = (url, init) => (url.endsWith('/accounts') && (init.method ?? 'GET') === 'GET' ? list([ACCOUNT]) : undefined);
    const sheet = await openAddSheet();
    await userEvent.click(within(sheet).getByRole('checkbox', { name: /Employee/ }));
    await userEvent.click(within(sheet).getByRole('button', { name: 'Create account' }));
    expect(within(sheet).getByText('Enter their full name')).toBeInTheDocument();
    expect(within(sheet).getByText('Enter a valid work email')).toBeInTheDocument();
    expect(within(sheet).getByText('Choose at least one account type')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, i]) => (i as RequestInit | undefined)?.method === 'POST')).toBe(false);
  });

  it('creates an account and shows the invite link with the delivery note', async () => {
    let posted: Record<string, unknown> | null = null;
    handler = (url, init) => {
      if (url.endsWith('/accounts') && init.method === 'POST') {
        posted = bodyOf(init);
        return { status: 201, body: { id: 'a2', ref_code: 'P11', invite_url: '/accept-invite/tok123', invite_expires_at: '2026-11-11T10:00:00Z', email_sent: false, audit_event_id: 'e1' } };
      }
      if (url.endsWith('/accounts')) return list([ACCOUNT]);
      return undefined;
    };
    const sheet = await openAddSheet();
    await userEvent.type(within(sheet).getByLabelText('Full name'), 'Kiran Das');
    await userEvent.type(within(sheet).getByLabelText('Work email'), 'kiran@firm.test');
    await userEvent.type(within(sheet).getByLabelText('Job title'), 'Architect');
    await userEvent.click(within(sheet).getByRole('checkbox', { name: /Project manager/ }));
    await userEvent.click(within(sheet).getByRole('button', { name: 'Create account' }));
    const done = await screen.findByRole('dialog', { name: 'Account created' });
    expect(posted).toEqual({ name: 'Kiran Das', work_email: 'kiran@firm.test', job_title: 'Architect', account_types: ['pm', 'employee'] });
    expect((within(done).getByLabelText('Invite link') as HTMLInputElement).value).toBe(`${window.location.origin}/accept-invite/tok123`);
    expect(within(done).getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
    expect(within(done).getByText(EMAIL_NOTE)).toBeInTheDocument();
  });

  it('shows the server refusal for a sensitive account type', async () => {
    handler = (url, init) => {
      if (url.endsWith('/accounts') && init.method === 'POST') {
        return { status: 403, body: { error: { code: 'FORBIDDEN', message: 'You cannot give Principal or Finance access.' } } };
      }
      if (url.endsWith('/accounts')) return list([ACCOUNT]);
      return undefined;
    };
    const sheet = await openAddSheet();
    await userEvent.type(within(sheet).getByLabelText('Full name'), 'Kiran Das');
    await userEvent.type(within(sheet).getByLabelText('Work email'), 'kiran@firm.test');
    await userEvent.type(within(sheet).getByLabelText('Job title'), 'Accountant');
    await userEvent.click(within(sheet).getByRole('checkbox', { name: /Finance/ }));
    await userEvent.click(within(sheet).getByRole('button', { name: 'Create account' }));
    expect(await within(sheet).findByText('You cannot give Principal or Finance access.')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Add account' })).toBeInTheDocument();
  });

  it('shows a duplicate email inline on the email field', async () => {
    handler = (url, init) => {
      if (url.endsWith('/accounts') && init.method === 'POST') return { status: 409, body: { error: { code: 'DUPLICATE_EMAIL', message: 'This email already has an account.' } } };
      if (url.endsWith('/accounts')) return list([ACCOUNT]);
      return undefined;
    };
    const sheet = await openAddSheet();
    await userEvent.type(within(sheet).getByLabelText('Full name'), 'Asha Two');
    await userEvent.type(within(sheet).getByLabelText('Work email'), 'asha@firm.test');
    await userEvent.type(within(sheet).getByLabelText('Job title'), 'Architect');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Create account' }));
    expect(await within(sheet).findByText('This email already has an account.')).toBeInTheDocument();
  });

  it('issues a password reset link for an accepted account and shows it with the email note', async () => {
    const posts: string[] = [];
    handler = (url, init) => {
      if (init.method === 'POST') posts.push(url);
      if (url.endsWith('/accounts/a1/reset-link') && init.method === 'POST') {
        return { status: 200, body: { reset_url: '/reset-password/rtok456', expires_at: '2026-11-10T10:00:00Z', email_sent: false, audit_event_id: 'e2' } };
      }
      if (url.endsWith('/accounts')) return list([ACCOUNT]);
      return undefined;
    };
    openAccounts();
    await screen.findByText('Asha Rao');
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Asha Rao' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Reset password link' }));
    const confirm = await screen.findByRole('dialog', { name: 'Reset password link' });
    expect(within(confirm).getByText(/24 hours/)).toBeInTheDocument();
    expect(posts).toEqual([]);
    await userEvent.click(within(confirm).getByRole('button', { name: 'Create reset link' }));
    const done = await screen.findByRole('dialog', { name: 'Password reset link' });
    expect(posts).toEqual(['/api/v1/accounts/a1/reset-link']);
    expect((within(done).getByLabelText('Reset link') as HTMLInputElement).value).toBe(`${window.location.origin}/reset-password/rtok456`);
    expect(within(done).getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
    expect(within(done).getByText(RESET_NOTE)).toBeInTheDocument();
  });

  it('offers a reset link only for accepted, active accounts', async () => {
    handler = (url) => (url.endsWith('/accounts') ? list([
      { ...ACCOUNT, id: 'a2', name: 'Pending Person', invitation_state: 'Sent' },
      { ...ACCOUNT, id: 'a3', name: 'Gone Person', login_state: 'Revoked' },
    ]) : undefined);
    openAccounts();
    await screen.findByText('Pending Person');
    for (const name of ['Pending Person', 'Gone Person']) {
      await userEvent.click(screen.getByRole('button', { name: `Actions for ${name}` }));
      expect(screen.getAllByRole('menuitem').length).toBeGreaterThan(0);
      expect(screen.queryByRole('menuitem', { name: 'Reset password link' })).not.toBeInTheDocument();
      await userEvent.keyboard('{Escape}');
    }
  });

  it('shows the server refusal when only a principal may reset the account', async () => {
    handler = (url, init) => {
      if (url.endsWith('/reset-link') && init.method === 'POST') {
        return { status: 403, body: { error: { code: 'FORBIDDEN_CAPABILITY', message: 'Only a principal can reset the password of a principal or finance account.' } } };
      }
      if (url.endsWith('/accounts')) return list([ACCOUNT]);
      return undefined;
    };
    openAccounts();
    await screen.findByText('Asha Rao');
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Asha Rao' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Reset password link' }));
    const confirm = await screen.findByRole('dialog', { name: 'Reset password link' });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Create reset link' }));
    expect(await within(confirm).findByText('Only a principal can reset the password of a principal or finance account.')).toBeInTheDocument();
    expect(within(confirm).queryByLabelText('Reset link')).not.toBeInTheDocument();
  });

  it('renders permission denied on a 403 list', async () => {
    handler = () => ({ status: 403, body: { error: { code: 'FORBIDDEN', message: 'No' } } });
    openAccounts();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Add account' })).not.toBeInTheDocument());
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});

describe('Accept invite', () => {
  const openInvite = (onAccepted = vi.fn()) => {
    render(<MemoryRouter initialEntries={['/accept-invite/tok123']}><Routes><Route path="/accept-invite/:token" element={<AcceptInviteScreen onAccepted={onAccepted} />} /></Routes></MemoryRouter>);
    return onAccepted;
  };

  it('shows who is invited and validates the password before sending', async () => {
    let accepted: Record<string, unknown> | null = null;
    handler = (url, init) => {
      if (url.endsWith('/auth/invite/tok123')) return { status: 200, body: { name: 'Kiran Das', work_email: 'kiran@firm.test', firm_name: 'Studio Meridian', expires_at: '2026-11-11T10:00:00Z' } };
      if (url.endsWith('/auth/accept-invite')) { accepted = bodyOf(init); return { status: 200, body: { ok: true } }; }
      return undefined;
    };
    const onAccepted = openInvite();
    expect(await screen.findByText('Kiran Das')).toBeInTheDocument();
    expect(screen.getByText('kiran@firm.test')).toBeInTheDocument();
    const submit = screen.getByRole('button', { name: 'Set password and sign in' });

    await userEvent.type(screen.getByLabelText('New password'), 'short');
    await userEvent.click(submit);
    expect(screen.getByText('Use at least 12 characters')).toBeInTheDocument();
    expect(screen.getByText('Enter the password again')).toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText('New password'));
    await userEvent.type(screen.getByLabelText('New password'), 'a-long-password-1');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'a-long-password-2');
    await userEvent.click(submit);
    expect(screen.getByText('The passwords do not match')).toBeInTheDocument();
    expect(accepted).toBeNull();

    await userEvent.clear(screen.getByLabelText('Confirm password'));
    await userEvent.type(screen.getByLabelText('Confirm password'), 'a-long-password-1');
    await userEvent.click(submit);
    await waitFor(() => expect(onAccepted).toHaveBeenCalled());
    expect(accepted).toEqual({ token: 'tok123', password: 'a-long-password-1' });
  });

  it('shows the expired state for a used or expired link', async () => {
    handler = () => ({ status: 410, body: { error: { code: 'INVITE_EXPIRED', message: 'Expired' } } });
    openInvite();
    expect(await screen.findByText('This invite link has expired')).toBeInTheDocument();
  });
});
