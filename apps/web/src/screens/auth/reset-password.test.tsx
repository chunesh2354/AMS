import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ResetPasswordScreen } from './reset-password';
import { MIN_PASSWORD } from './accept-invite';

vi.mock('../../api/live', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/live')>()), isLive: true }));

const RESET = { name: 'Rohan Shetty', firm_name: 'Studio Meridian', expires_at: '2026-11-10T10:00:00Z' };
type Reply = { status: number; body: unknown };
let replies: Record<string, Reply>;
const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const r = replies[`${init.method ?? 'GET'} ${String(input)}`] ?? { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Not found' } } };
  return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
});
const posted = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');

beforeEach(() => {
  replies = { 'GET /api/v1/auth/reset/rtok': { status: 200, body: RESET } };
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

const open = (token = 'rtok') => render(
  <MemoryRouter initialEntries={[`/reset-password/${token}`]}>
    <Routes><Route path="/reset-password/:token" element={<ResetPasswordScreen />} /></Routes>
  </MemoryRouter>,
);
const rule = (name: RegExp) => screen.getAllByRole('listitem').find((li) => name.test(li.textContent ?? ''))!;

describe('reset password page', () => {
  it('shows whose password is reset, the company and when the link expires', async () => {
    open();
    expect(await screen.findByRole('heading', { level: 1, name: 'Choose a new password' })).toBeInTheDocument();
    expect(screen.getByText('Rohan Shetty')).toBeInTheDocument();
    expect(screen.getByText('Studio Meridian')).toBeInTheDocument();
    expect(screen.getByText(/expires on 10 November 2026/)).toBeInTheDocument();
  });

  it('ticks the live checklist and refuses a short or mismatched password before calling the server', async () => {
    open();
    const pw = await screen.findByLabelText('New password');
    expect(rule(/^At least 12 characters/)).toHaveTextContent('not yet');
    await userEvent.type(pw, 'x'.repeat(MIN_PASSWORD - 1));
    await userEvent.click(screen.getByRole('button', { name: 'Set new password' }));
    expect(rule(/^At least 12 characters/)).toHaveClass('is-missed');
    expect(pw).toHaveAttribute('aria-invalid', 'true');
    expect(pw).toHaveFocus();
    await userEvent.type(pw, 'x');
    expect(rule(/^At least 12 characters/)).toHaveTextContent('done');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'y'.repeat(MIN_PASSWORD));
    expect(rule(/^Both passwords match/)).toHaveTextContent('not yet');
    await userEvent.click(screen.getByRole('button', { name: 'Set new password' }));
    expect(screen.getByText('The passwords do not match')).toBeInTheDocument();
    expect(posted()).toEqual([]);
  });

  it('sets the password and sends the person to sign in, without signing in', async () => {
    replies['POST /api/v1/auth/reset/rtok'] = { status: 200, body: { ok: true } };
    open();
    await userEvent.type(await screen.findByLabelText('New password'), 'a-long-new-password');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'a-long-new-password');
    await userEvent.click(screen.getByRole('button', { name: 'Set new password' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Password changed' })).toBeInTheDocument();
    expect(posted()).toHaveLength(1);
    expect(JSON.parse(String(posted()[0][1]!.body))).toEqual({ password: 'a-long-new-password' });
    expect(screen.getByRole('link', { name: 'Go to sign in' })).toHaveAttribute('href', '/login');
  });

  it('says when the link has expired or was used', async () => {
    replies['GET /api/v1/auth/reset/rtok'] = { status: 410, body: { error: { code: 'RESET_EXPIRED', message: 'Expired' } } };
    open();
    expect(await screen.findByRole('heading', { level: 1, name: 'This reset link has expired' })).toBeInTheDocument();
    expect(screen.getByText(/Ask your studio admin for a new one/)).toBeInTheDocument();
  });

  it('says when the link is not valid', async () => {
    open('unknown');
    expect(await screen.findByRole('heading', { level: 1, name: 'This reset link is not valid' })).toBeInTheDocument();
  });

  it('switches to the expired state when the link is used up between preview and submit', async () => {
    replies['POST /api/v1/auth/reset/rtok'] = { status: 410, body: { error: { code: 'RESET_EXPIRED', message: 'Expired' } } };
    open();
    await userEvent.type(await screen.findByLabelText('New password'), 'a-long-new-password');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'a-long-new-password');
    await userEvent.click(screen.getByRole('button', { name: 'Set new password' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'This reset link has expired' })).toBeInTheDocument();
  });
});
