/** Section 4 number and date rules. */
const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const inrPaise = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const group = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });

export const formatINR = (n: number) => (Number.isInteger(n) ? inr : inrPaise).format(n);
export const formatGrouped = (n: number) => group.format(n);
export const formatHours = (h: number) => `${h.toFixed(2)} h`;
export const formatPercent = (p: number) => `${Math.abs(p) < 10 && !Number.isInteger(p) ? p.toFixed(1) : Math.round(p)}%`;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');

export const parseISO = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};
export const toISO = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const formatDate = (iso: string) => {
  const d = parseISO(iso);
  return `${pad(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
};
export const formatMonth = (d: Date) => `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;

/** Accepts "6:30", "6.5" or "6"; returns minutes, or null when unparseable. */
export function parseDuration(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  let m = t.match(/^(\d+):([0-5]\d)$/);
  if (m) return +m[1] * 60 + +m[2];
  m = t.match(/^\d+(\.\d+)?$/);
  if (m) return Math.round(parseFloat(t) * 60);
  return null;
}
export const formatDuration = (min: number) => `${Math.floor(min / 60)}:${pad(min % 60)}`;
export const formatElapsed = (sec: number) => `${pad(Math.floor(sec / 3600))}:${pad(Math.floor((sec % 3600) / 60))}`;
