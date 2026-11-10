import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '../../ui/Toast';
import { ChangePassword } from './profile';

vi.mock('../../api/live', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/live')>()), isLive: true }));

type Reply = { status: number; body: unknown };
let reply: Reply;
const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init: RequestInit = {}) =>
  new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'Content-Type': 'application/json' } }));
const posted = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');

beforeEach(() => {
  reply = { status: 200, body: { ok: true, sessions_revoked: 1 } };
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

const open = () => render(<ToastProvider><ChangePassword /></ToastProvider>);
async function fill(current: string, next: string, confirm = next) {
  if (current) await userEvent.type(screen.getByLabelText('Current password'), current);
  if (next) await userEvent.type(screen.getByLabelText('New password'), next);
  if (confirm) await userEvent.type(screen.getByLabelText('Confirm new password'), confirm);
  await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
}

describe('Change password', () => {
  it('validates before calling the server', async () => {
    open();
    await fill('', 'short', 'other');
    expect(screen.getByText('Enter your current password')).toBeInTheDocument();
    expect(screen.getByText('Use at least 12 characters')).toBeInTheDocument();
    expect(screen.getByText('The passwords do not match')).toBeInTheDocument();
    expect(posted()).toEqual([]);
  });

  it('sends the current and new password, then clears the form', async () => {
    open();
    await fill('my-old-password', 'a-long-new-password');
    expect(await screen.findByText(/Password changed/)).toBeInTheDocument();
    expect(posted()).toHaveLength(1);
    expect(String(posted()[0][0])).toBe('/api/v1/me/password');
    expect(JSON.parse(String(posted()[0][1]!.body))).toEqual({ current_password: 'my-old-password', new_password: 'a-long-new-password' });
    expect(screen.getByLabelText('Current password')).toHaveValue('');
  });

  it('shows a wrong current password on that field', async () => {
    reply = { status: 400, body: { error: { code: 'WRONG_PASSWORD', message: 'Your current password is not correct.' } } };
    open();
    await fill('not-my-password', 'a-long-new-password');
    expect(await screen.findByText('Your current password is not correct')).toBeInTheDocument();
    expect(screen.getByLabelText('Current password')).toHaveAttribute('aria-invalid', 'true');
  });
});
