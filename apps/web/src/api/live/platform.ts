/**
 * Platform panel calls. The platform has its own login and cookie (ams_platform); it never uses the firm session,
 * so this has its own fetch wrapper: a 401 goes to /platform/login, not the firm /login.
 * The platform sees counts for each company and, since the owner's decision, the people and accounts inside it
 * (names, emails, account types, invitation and sign-in state). Never projects, money or time.
 * Passwords are never set or seen here: the platform hands out one-time reset links.
 */
import { ApiFailure, parseFailure } from '../live';
import type { AccountType, InvitationState } from './accounts';

const PLATFORM_BASE = '/api/v1/platform';
export const PLATFORM_LOGIN_PATH = '/platform/login';
export const PLATFORM_HOME_PATH = '/platform';

export type PlatformAdmin = { id: string; name: string; email: string };
export type FirmStatus = 'Active' | 'Suspended';
export type PlatformFirm = {
  id: string;
  trading_name: string;
  legal_name: string;
  status: FirmStatus;
  currency: string;
  timezone: string;
  created_at: string;
  people: number;
  active_people: number;
  last_login_at: string | null;
};
export type NewFirm = { trading_name: string; legal_name: string; timezone: string; currency: string; owner_name: string; owner_email: string };
export type NewFirmResult = { firm_id: string; invite_url: string; invite_expires_at: string; email_sent: false };
export type PlatformAuditEntry = { id: string; at: string; admin_name: string; action: string; firm_id: string | null; firm_name: string | null; reason: string | null };

type Options = { method?: 'GET' | 'POST' | 'PUT'; body?: unknown; redirectOn401?: boolean };

/** Calls /api/v1/platform + path with the platform cookie. Throws ApiFailure; a 401 sends the browser to the platform login. */
export async function platformFetch<T>(path: string, { method, body, redirectOn401 = true }: Options = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`${PLATFORM_BASE}${path}`, {
      method: method ?? (body !== undefined ? 'POST' : 'GET'),
      headers,
      credentials: 'same-origin',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (cause) {
    throw new ApiFailure(0, 'NETWORK', 'Cannot reach the server. Check your connection and try again.', [], cause);
  }
  const text = await res.text();
  if (!res.ok) {
    if (res.status === 401 && redirectOn401 && window.location.pathname !== PLATFORM_LOGIN_PATH) window.location.assign(PLATFORM_LOGIN_PATH);
    throw parseFailure(res.status, text);
  }
  return (text ? JSON.parse(text) : undefined) as T;
}

export const platformLogin = (email: string, password: string) =>
  platformFetch<{ ok: boolean }>('/auth/login', { body: { email, password }, redirectOn401: false });

export async function platformLogout(): Promise<void> {
  await platformFetch<{ ok: boolean }>('/auth/logout', { method: 'POST', redirectOn401: false });
  window.location.assign(PLATFORM_LOGIN_PATH);
}

/** Who is signed in to the platform. Pass redirectOn401=false to probe without leaving the page. */
export const platformMe = (redirectOn401 = true) => platformFetch<PlatformAdmin>('/me', { redirectOn401 });

export const listFirms = () => platformFetch<{ data: PlatformFirm[] }>('/firms').then((r) => r.data);

export const createFirm = (input: NewFirm) => platformFetch<NewFirmResult>('/firms', { body: input });

export const suspendFirm = (id: string, reason: string) =>
  platformFetch<unknown>(`/firms/${encodeURIComponent(id)}/suspend`, { body: { reason } });

export const reactivateFirm = (id: string, reason: string) =>
  platformFetch<unknown>(`/firms/${encodeURIComponent(id)}/reactivate`, { body: { reason } });

export const listPlatformAudit = () => platformFetch<{ data: PlatformAuditEntry[] }>('/audit').then((r) => r.data);

export type OwnerInvitationState = 'Not sent' | 'Sent' | 'Accepted' | 'Expired';
/** One company. Still counts only; the one person named is the company owner, so the invite can be handed over. */
export type PlatformFirmDetail = PlatformFirm & {
  suspended_reason: string | null;
  owner_name: string | null;
  owner_email: string | null;
  owner_invitation_state: OwnerInvitationState | null;
};
export type OwnerInvite = { invite_url: string; invite_expires_at: string; email_sent: false };

export const getFirm = (id: string) => platformFetch<PlatformFirmDetail>(`/firms/${encodeURIComponent(id)}`);

/** A new owner invite link. Only while the owner has not accepted; earlier links stop working. */
export const reissueOwnerInvite = (id: string) =>
  platformFetch<OwnerInvite>(`/firms/${encodeURIComponent(id)}/owner-invite`, { method: 'POST', body: {} });

/** One person in a company, as the platform sees them: who they are and how they can sign in. Nothing else. */
export type PlatformPerson = {
  id: string;
  name: string;
  work_email: string;
  job_title: string | null;
  account_types: string[];
  invitation_state: InvitationState;
  login_state: string;
  last_sign_in_at: string | null;
};
export type NewPlatformPerson = { name: string; work_email: string; job_title?: string; account_types: AccountType[] };
export type PlatformPersonInvite = { invite_url: string; invite_expires_at: string; email_sent: false };
export type PlatformPersonCreated = PlatformPersonInvite & { person: PlatformPerson };
export type PlatformResetLink = { reset_url: string; expires_at: string; email_sent: false };

const personPath = (firmId: string, personId?: string) =>
  `/firms/${encodeURIComponent(firmId)}/people${personId ? `/${encodeURIComponent(personId)}` : ''}`;

export const listFirmPeople = (firmId: string) =>
  platformFetch<{ data: PlatformPerson[] }>(personPath(firmId)).then((r) => r.data);

/** Adds a person and returns their invite link. Email is not sent. */
export const addFirmPerson = (firmId: string, input: NewPlatformPerson) =>
  platformFetch<PlatformPersonCreated>(personPath(firmId), { method: 'POST', body: input });

/** A one-time password reset link, 24 hours. Accepted and Enabled accounts only; earlier unused reset links stop working. */
export const issuePersonResetLink = (firmId: string, personId: string) =>
  platformFetch<PlatformResetLink>(`${personPath(firmId, personId)}/reset-link`, { method: 'POST', body: {} });

/** A new invite link, 72 hours. Only before the invite is accepted; earlier unused invite links stop working. */
export const issuePersonInviteLink = (firmId: string, personId: string) =>
  platformFetch<PlatformPersonInvite>(`${personPath(firmId, personId)}/invite-link`, { method: 'POST', body: {} });

/** Replaces the account types. The server keeps at least one Enabled principal in every company. */
export const setPersonTypes = (firmId: string, personId: string, account_types: AccountType[], reason: string) =>
  platformFetch<{ person: PlatformPerson }>(`${personPath(firmId, personId)}/types`, { method: 'PUT', body: { account_types, reason } }).then((r) => r.person);

/** Stops sign-in: every session and open link is revoked. The last Enabled principal cannot be disabled. */
export const disablePerson = (firmId: string, personId: string, reason: string) =>
  platformFetch<{ person: PlatformPerson }>(`${personPath(firmId, personId)}/disable`, { method: 'POST', body: { reason } }).then((r) => r.person);

export const enablePerson = (firmId: string, personId: string, reason: string) =>
  platformFetch<{ person: PlatformPerson }>(`${personPath(firmId, personId)}/enable`, { method: 'POST', body: { reason } }).then((r) => r.person);

/** The server sends a relative path. Shown and copied as a full link. */
export const absolutePlatformUrl = (url: string) => new URL(url, window.location.origin).toString();
