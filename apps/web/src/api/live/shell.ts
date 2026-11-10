/** Live-mode helpers for the app shell: the firm the person signed in to, and the Approvals badge. */

/** The firm block of GET /me (apps/api/src/modules/identity/identity.routes.ts). */
export type ApiMeFirm = { id: string; trading_name: string | null; legal_name: string | null; currency: string; timezone: string };
/** What the shell needs about the signed-in firm. */
export type LiveFirm = { name: string; timezone: string; currency: string };

/** The trading name, else the legal name. Never a sample name: an unnamed firm reads as an empty brand. */
export function firmFromMe(f: ApiMeFirm | null | undefined): LiveFirm | undefined {
  if (!f) return undefined;
  return { name: (f.trading_name ?? '').trim() || (f.legal_name ?? '').trim(), timezone: f.timezone || 'Asia/Kolkata', currency: f.currency || 'INR' };
}

/** The side-nav badge for Approvals: the real count, hidden when nothing waits or the count is not known. */
export const approvalsBadge = (count: number | null | undefined): number | undefined => (count != null && count > 0 ? count : undefined);
