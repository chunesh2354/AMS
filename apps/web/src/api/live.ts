/**
 * Live-mode foundation: the fetch wrapper and the small helpers every screen slice shares.
 * Live or mock is decided at build time. Mock stays the default, so tests, Storybook and screenshots do not change.
 */
export const isLive = import.meta.env.VITE_LIVE === '1';

const API_BASE = '/api/v1';
const LOGIN_PATH = '/login';

/** Routes backed by the database in live mode. Every other route shows the sample data banner. */
export const CONNECTED_ROUTES = [
  '/firm/projects',
  '/firm/projects/:id',
  '/firm/projects/:id/phases',
  '/firm/projects/:id/time',
  '/firm/projects/:id/billing',
  '/firm/approvals',
  '/firm/billing',
  '/firm/receivables',
  '/me/time',
  '/firm/settings/accounts',
  '/firm/settings/rates',
] as const;

export const SAMPLE_DATA_NOTICE = 'Sample data. This screen is not connected to the database yet.';

export class ApiFailure extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details: unknown[] = [],
    /** The whole parsed body, for extras such as `error.rule`, `error.capability` or `error.allowed`. */
    public raw: unknown = null,
  ) {
    super(message);
    this.name = 'ApiFailure';
  }
}

/** Reads the server's {error:{code,message,details}} body. A proxy or crash page still gives a usable failure. */
export function parseFailure(status: number, text: string): ApiFailure {
  let raw: unknown = text;
  try { raw = text ? JSON.parse(text) : null; } catch { /* not JSON: keep the text as raw */ }
  const err = (raw as { error?: { code?: unknown; message?: unknown; details?: unknown } } | null)?.error;
  return new ApiFailure(
    status,
    typeof err?.code === 'string' ? err.code : 'UNKNOWN',
    typeof err?.message === 'string' ? err.message : `The server could not complete this (error ${status}).`,
    Array.isArray(err?.details) ? err.details : [],
    raw,
  );
}

export type ApiOptions = {
  /** Defaults to POST when a body is given, otherwise GET. */
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Sent as the Idempotency-Key header. */
  idempotencyKey?: string;
};

/** Calls /api/v1 + path with the session cookie. Throws ApiFailure; a 401 also sends the browser to /login. */
export async function apiFetch<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const { method = options.body !== undefined ? 'POST' : 'GET', body, idempotencyKey } = options;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (cause) {
    throw new ApiFailure(0, 'NETWORK', 'Cannot reach the server. Check your connection and try again.', [], cause);
  }

  const text = await res.text();
  if (!res.ok) {
    // The sign-in pages (/login, /login/studio, /login/team) show the 401 themselves.
    const onSignIn = window.location.pathname === LOGIN_PATH || window.location.pathname.startsWith(`${LOGIN_PATH}/`);
    if (res.status === 401 && !onSignIn) window.location.assign(LOGIN_PATH);
    throw parseFailure(res.status, text);
  }
  return (text ? JSON.parse(text) : undefined) as T;
}

/** POST /auth/logout, then the login page. Throws ApiFailure if the server refuses, so the caller can show it. */
export async function signOut(): Promise<void> {
  await apiFetch<{ ok: boolean }>('/auth/logout', { method: 'POST' });
  window.location.assign(LOGIN_PATH);
}

/** What the server sends in place of a fenced value. Render it with RestrictedCell, never as blank or zero. */
export type Restricted = { restricted: true };
export type LiveMoney = { amount: string; currency: string };
/** The envelope of every list endpoint. */
export type ListResponse<T> = { data: T[]; page: number; page_size: number; total: number; complete: boolean; missing_count: number };

export const isRestricted = (v: unknown): v is Restricted => typeof v === 'object' && v !== null && (v as Restricted).restricted === true;

/** {amount,currency} to a number of rupees. Null when the value is absent or fenced, so it can never read as zero. */
export function rupees(m: LiveMoney | Restricted | null | undefined): number | null {
  if (m == null || isRestricted(m)) return null;
  return Number(m.amount);
}

/** The server's hours string ("7.50") to a number. Null when absent or fenced. */
export function hoursOf(h: string | number | Restricted | null | undefined): number | null {
  if (h == null || isRestricted(h)) return null;
  return Number(h);
}

/** The message to show for anything thrown by apiFetch. */
export const failureMessage = (e: unknown) => (e instanceof ApiFailure ? e.message : 'Something went wrong. Try again.');
