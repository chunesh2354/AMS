/**
 * Password reset links and the signed-in password change.
 * Email is not connected yet: an admin copies the reset link and passes it on.
 */
import { apiFetch } from '../live';

/** POST /accounts/:id/reset-link. people.manage; only a principal may reset a principal or finance account. 24 hours, single use. */
export type ResetLink = { reset_url: string; expires_at: string; email_sent: false; audit_event_id?: string };
export const issueResetLink = (accountId: string) =>
  apiFetch<ResetLink>(`/accounts/${encodeURIComponent(accountId)}/reset-link`, { method: 'POST' });

/** Public. 404 for an unknown token, 410 RESET_EXPIRED for an expired, used or replaced one. */
export type ResetDetails = { name: string; firm_name: string; expires_at: string };
export const getResetLink = (token: string) => apiFetch<ResetDetails>(`/auth/reset/${encodeURIComponent(token)}`);

/** Public. Sets the password and signs the person out everywhere. It does not sign in. */
export const resetPassword = (token: string, password: string) =>
  apiFetch<{ ok: true }>(`/auth/reset/${encodeURIComponent(token)}`, { method: 'POST', body: { password } });

/** Signed in. 400 WRONG_PASSWORD when the current password is wrong. Other sessions are signed out; this one stays. */
export const changePassword = (current_password: string, new_password: string) =>
  apiFetch<{ ok: true; sessions_revoked: number }>('/me/password', { method: 'POST', body: { current_password, new_password } });

/** The server sends a relative path. Shown and copied as a full link. */
export const absoluteResetUrl = (url: string) => (/^https?:\/\//.test(url) ? url : `${window.location.origin}${url}`);
