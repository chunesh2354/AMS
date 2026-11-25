/**
 * Gantt date arithmetic. Pure: no DOM. Dates are YYYY-MM-DD calendar days and all maths is in UTC, so a studio in
 * any timezone sees the same bars. A bar covers whole days: it starts at the left edge of its start day and ends at
 * the right edge of its end day.
 */

export type Zoom = 'week' | 'month' | 'quarter' | 'year';
export type Window = { start: string; end: string };
export type Tick = { date: string; label: string; x: number };

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const utc = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const ymd = (y: number, m: number) => { const yy = y + Math.floor(m / 12); const mm = ((m % 12) + 12) % 12; return `${yy}-${String(mm + 1).padStart(2, '0')}-01`; };

export const addDays = (d: string, n: number) => iso(utc(d) + n * 86400000);
/** Whole days from a to b (negative when b is earlier). */
export const daysBetween = (a: string, b: string) => Math.round((utc(b) - utc(a)) / 86400000);
export const yearOf = (d: string) => Number(d.slice(0, 4));
export const dayMonth = (d: string) => `${Number(d.slice(8, 10))} ${MON[Number(d.slice(5, 7)) - 1]}`;
export const dayMonthYear = (d: string) => `${dayMonth(d)} ${yearOf(d)}`;
export const monthYear = (d: string) => `${MON[Number(d.slice(5, 7)) - 1]} ${yearOf(d)}`;
export const dayWord = (n: number) => `${n} ${Math.abs(n) === 1 ? 'day' : 'days'}`;

/** "3 to 20 Nov 2026", "28 Dec 2026 to 8 Jan 2027", or one date. */
export function rangeText(s: string | null, e: string | null): string {
  if (!s && !e) return 'No dates';
  if (!s || !e || s === e) return dayMonthYear((s ?? e)!);
  return yearOf(s) === yearOf(e) ? `${dayMonth(s)} to ${dayMonthYear(e)}` : `${dayMonthYear(s)} to ${dayMonthYear(e)}`;
}
/** The short form for a dates column: the year only when it is not the year of today. */
export function shortRange(s: string | null, e: string | null, today: string): string {
  if (!s && !e) return 'No dates';
  const y = yearOf(today);
  const one = (d: string) => (yearOf(d) === y ? dayMonth(d) : dayMonthYear(d));
  if (!s || !e || s === e) return one((s ?? e)!);
  return yearOf(s) === y && yearOf(e) === y ? `${dayMonth(s)} to ${dayMonth(e)}` : `${one(s)} to ${one(e)}`;
}

/** "moved 3 days later", "ends 2 days earlier", "starts 1 day later, ends 4 days later". */
export function moveWords(ds: number, de: number): string {
  const w = (n: number) => `${dayWord(Math.abs(n))} ${n > 0 ? 'later' : 'earlier'}`;
  if (ds === de) return `moved ${w(ds)}`;
  if (ds === 0) return `ends ${w(de)}`;
  if (de === 0) return `starts ${w(ds)}`;
  return `starts ${w(ds)}, ends ${w(de)}`;
}

const mondayOnOrBefore = (d: string) => addDays(d, -((new Date(utc(d)).getUTCDay() + 6) % 7));

/**
 * The visible window for a zoom, anchored on today (and on the plan for the wide zooms, so a whole project fits).
 * The end is exclusive.
 */
export function windowFor(zoom: Zoom, today: string, plan: { start: string | null; end: string | null } = { start: null, end: null }): Window {
  const y = yearOf(today); const m = Number(today.slice(5, 7)) - 1;
  if (zoom === 'week') { const start = mondayOnOrBefore(addDays(today, -21)); return { start, end: addDays(start, 56) }; }
  if (zoom === 'month') return { start: ymd(y, m - 2), end: ymd(y, m + 4) };
  const from = plan.start && plan.start < today ? plan.start : today;
  const to = plan.end && plan.end > today ? plan.end : today;
  if (zoom === 'quarter') {
    const fq = Math.floor((Number(from.slice(5, 7)) - 1) / 3) * 3;
    const start = ymd(yearOf(from), fq);
    let end = ymd(yearOf(to), Math.floor((Number(to.slice(5, 7)) - 1) / 3) * 3 + 3);
    if (daysBetween(start, end) < 365) end = ymd(yearOf(start), fq + 12);
    return { start, end };
  }
  const start = `${yearOf(from)}-01-01`;
  return { start, end: `${Math.max(yearOf(to) + 1, yearOf(from) + 3)}-01-01` };
}

export const spanDays = (w: Window) => daysBetween(w.start, w.end);
/** Percent across the window of the left edge of day d. */
export const xOf = (w: Window, d: string) => (daysBetween(w.start, d) / spanDays(w)) * 100;
export const clampPct = (v: number) => Math.max(0, Math.min(100, v));
export const round2 = (v: number) => Math.round(v * 100) / 100;

export function ticksFor(zoom: Zoom, w: Window): Tick[] {
  const out: Tick[] = [];
  if (zoom === 'week') {
    for (let d = w.start; d < w.end; d = addDays(d, 7)) out.push({ date: d, label: dayMonth(d), x: round2(xOf(w, d)) });
    return out;
  }
  const step = zoom === 'month' ? 1 : zoom === 'quarter' ? 3 : 12;
  let y = yearOf(w.start); let m = Number(w.start.slice(5, 7)) - 1;
  for (;;) {
    const d = ymd(y, m);
    if (d >= w.end) break;
    if (d >= w.start) {
      const label = zoom === 'month' ? monthYear(d) : zoom === 'quarter' ? `Q${Math.floor(Number(d.slice(5, 7)) / 3) + 1} ${yearOf(d)}` : String(yearOf(d));
      out.push({ date: d, label, x: round2(xOf(w, d)) });
    }
    m += step; if (m > 11) { y += Math.floor(m / 12); m %= 12; }
  }
  return out;
}

/** Left and width in percent of a bar from s to e inclusive, clamped to the window. Null when it is off screen. */
export function barBox(w: Window, s: string, e: string): { left: number; width: number } | null {
  const L = xOf(w, s); const R = xOf(w, addDays(e, 1));
  if (R <= 0 || L >= 100) return null;
  return { left: round2(clampPct(L)), width: round2(Math.max(clampPct(R) - clampPct(L), 0.3)) };
}

/** A date range moved by a drag or a keyboard button. Null when the end would come before the start. */
export function shiftRange(r: { start: string | null; end: string | null }, mode: 'move' | 'start' | 'end', days: number) {
  const s = r.start; const e = r.end;
  if (mode === 'move') return { start: s && addDays(s, days), end: e && addDays(e, days) };
  if (mode === 'start') { if (!s) return null; const ns = addDays(s, days); return e && ns > e ? null : { start: ns, end: e }; }
  if (!e) return null;
  const ne = addDays(e, days);
  return s && ne < s ? null : { start: s, end: ne };
}

/** Finish-to-start with lag: the successor may start on the predecessor's end + 1 + lag (as the API's graph.ts). */
export const earliestStart = (predEnd: string, lag: number) => addDays(predEnd, 1 + lag);
