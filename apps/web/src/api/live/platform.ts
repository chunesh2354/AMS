/**
 * Platform panel calls. The platform has its own login and cookie (ams_platform); it never uses the firm session,
 * so this has its own fetch wrapper: a 401 goes to /platform/login, not the firm /login.
 * The platform API returns counts only. Nothing here may carry a firm's business data.
 */
import { ApiFailure, parseFailure } from '../live';

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

type Options = { method?: 'GET' | 'POST'; body?: unknown; redirectOn401?: boolean };

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
