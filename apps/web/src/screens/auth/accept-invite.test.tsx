import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AcceptInviteScreen, MIN_PASSWORD } from './accept-invite';

vi.mock('../../api/live', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/live')>()), isLive: true }));

const INVITE = { name: 'Meera Iyer', work_email: 'meera@chintala.studio', firm_name: 'Studio Chintala', expires_at: '2026-11-11T10:00:00Z' };
const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
  String(input).endsWith('/auth/invite/tok123')
    ? new Response(JSON.stringify(INVITE), { status: 200 })
    : new Response('{"error":{"code":"NOT_FOUND","message":"Not found"}}', { status: 404 }));

beforeEach(() => { vi.stubGlobal('fetch', fetchMock); fetchMock.mockClear(); });
afterEach(() => vi.unstubAllGlobals());

const open = () => render(
  <MemoryRouter initialEntries={['/accept-invite/tok123']}>
    <Routes><Route path="/accept-invite/:token" element={<AcceptInviteScreen onAccepted={vi.fn()} />} /></Routes>
  </MemoryRouter>,
);
const rule = (name: RegExp) => screen.getAllByRole('listitem').find((li) => name.test(li.textContent ?? ''))!;

describe('accept invite checklist', () => {
  it('shows who is invited, when the link expires, and how to sign in instead', async () => {
    open();
    expect(await screen.findByRole('heading', { level: 1, name: 'Join Studio Chintala' })).toBeInTheDocument();
    expect(screen.getByText('Meera Iyer')).toBeInTheDocument();
    expect(screen.getByText('meera@chintala.studio')).toBeInTheDocument();
    expect(screen.getByText(/expires on 11 November 2026/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login/team');
  });

  it('ticks each rule as the passwords are typed', async () => {
    open();
    const pw = await screen.findByLabelText('New password');
    expect(pw).toHaveAccessibleDescription(/At least 12 characters, not yet.*Both passwords match, not yet/);
    expect(rule(/^At least 12 characters/)).toHaveTextContent('not yet');
    expect(rule(/^Both passwords match/)).toHaveTextContent('not yet');

    await userEvent.type(pw, 'x'.repeat(MIN_PASSWORD - 1));
    expect(rule(/^At least 12 characters/)).toHaveTextContent('not yet');
    await userEvent.type(pw, 'x');
    expect(rule(/^At least 12 characters/)).toHaveTextContent('done');
    expect(rule(/^At least 12 characters/)).toHaveClass('is-met');

    await userEvent.type(screen.getByLabelText('Confirm password'), 'x'.repeat(MIN_PASSWORD));
    expect(rule(/^Both passwords match/)).toHaveTextContent('done');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'y');
    expect(rule(/^Both passwords match/)).toHaveTextContent('not yet');
  });

  it('marks missed rules after a submit and focuses the password', async () => {
    open();
    const pw = await screen.findByLabelText('New password');
    await userEvent.type(pw, 'short');
    await userEvent.click(screen.getByRole('button', { name: 'Set password and sign in' }));
    expect(rule(/^At least 12 characters/)).toHaveClass('is-missed');
    expect(pw).toHaveAttribute('aria-invalid', 'true');
    expect(pw).toHaveFocus();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('shows both password fields when Show is pressed', async () => {
    open();
    const pw = await screen.findByLabelText('New password');
    await userEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(pw).toHaveAttribute('type', 'text');
    expect(screen.getByLabelText('Confirm password')).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Hide password' })).toHaveAttribute('aria-pressed', 'true');
  });
});
