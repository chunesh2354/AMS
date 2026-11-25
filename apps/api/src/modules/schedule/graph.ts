import { addDays } from '@ams/domain';

/**
 * Task scheduling arithmetic. Pure: no I/O. Dates are YYYY-MM-DD and every day counts (calendar days, no working-day
 * calendar), matching how phases and tasks are dated everywhere else.
 *
 * Finish-to-start with lag L: the successor may start on the day after the predecessor's due date plus L days,
 * so its earliest start is due(predecessor) + 1 + L. A negative lag lets it overlap.
 * A task's anchor is its start date, or its due date when it has no start. A task with neither has no dates to keep.
 */

export type GraphTask = { id: string; start: string | null; due: string | null; done: boolean; completedOn?: string | null };
export type GraphEdge = { id?: string; predecessor_id: string; successor_id: string; lag_days: number };

const utc = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d); };
/** Whole days from a to b (negative when b is earlier). */
export const daysFrom = (a: string, b: string) => Math.round((utc(b) - utc(a)) / 86400000);
const maxDate = (a: string | null, b: string | null) => (a == null ? b : b == null ? a : a > b ? a : b);
export const earliestStart = (predDue: string, lag: number) => addDays(predDue, 1 + lag);
export const shift = (d: string | null, days: number) => (d == null ? null : addDays(d, days));

/** True when `from` reaches `to` following edges forward. Adding to -> from would then close a cycle. */
export function reaches(edges: GraphEdge[], from: string, to: string): boolean {
  const out = new Map<string, string[]>();
  for (const e of edges) out.set(e.predecessor_id, [...(out.get(e.predecessor_id) ?? []), e.successor_id]);
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length) {
    const n = stack.pop()!;
    if (n === to) return true;
    if (seen.has(n)) continue;
    seen.add(n);
    stack.push(...(out.get(n) ?? []));
  }
  return false;
}

/** Topological order of the whole graph (dependencies are acyclic by construction). */
export function topoOrder(ids: string[], edges: GraphEdge[]): string[] {
  const indeg = new Map(ids.map((id) => [id, 0]));
  const out = new Map<string, string[]>();
  for (const e of edges) {
    if (!indeg.has(e.predecessor_id) || !indeg.has(e.successor_id)) continue;
    indeg.set(e.successor_id, indeg.get(e.successor_id)! + 1);
    out.set(e.predecessor_id, [...(out.get(e.predecessor_id) ?? []), e.successor_id]);
  }
  const queue = ids.filter((id) => indeg.get(id) === 0);
  const order: string[] = [];
  while (queue.length) {
    const n = queue.shift()!;
    order.push(n);
    for (const s of out.get(n) ?? []) {
      indeg.set(s, indeg.get(s)! - 1);
      if (indeg.get(s) === 0) queue.push(s);
    }
  }
  // A cycle cannot be stored, but never drop a task if one ever was.
  for (const id of ids) if (!order.includes(id)) order.push(id);
  return order;
}

/**
 * Cascade after a move. `tasks` holds the dates after the move (the moved seeds already updated). Successors of the
 * seeds, transitively, are pushed later just far enough that every finish-to-start + lag from a moved task holds,
 * taking the latest requirement over all of a task's moved predecessors. Durations are kept (start and due move
 * together). Tasks are never pulled earlier; seeds keep the dates they were given; Done tasks never move (and so
 * stop the cascade). Returns the shift in days for each task it moved.
 */
export function cascade(tasks: Map<string, GraphTask>, edges: GraphEdge[], seeds: Set<string>): Map<string, number> {
  const moved = new Map<string, number>();
  const affected = new Set(seeds);
  const preds = new Map<string, GraphEdge[]>();
  for (const e of edges) preds.set(e.successor_id, [...(preds.get(e.successor_id) ?? []), e]);
  for (const id of topoOrder([...tasks.keys()], edges)) {
    if (seeds.has(id)) continue;
    const t = tasks.get(id)!;
    const anchor = t.start ?? t.due;
    if (t.done || anchor == null) continue;
    let need: string | null = null;
    for (const e of preds.get(id) ?? []) {
      if (!affected.has(e.predecessor_id)) continue;
      const p = tasks.get(e.predecessor_id);
      if (p?.due) need = maxDate(need, earliestStart(p.due, e.lag_days));
    }
    if (need == null || anchor >= need) continue;
    const days = daysFrom(anchor, need);
    t.start = shift(t.start, days);
    t.due = shift(t.due, days);
    moved.set(id, days);
    affected.add(id);
  }
  return moved;
}

/** Dependencies whose finish-to-start + lag does not hold with the dates given. */
export function violations(tasks: Map<string, GraphTask>, edges: GraphEdge[], only?: Set<string>) {
  const out: { dependency_id: string | undefined; predecessor_id: string; successor_id: string; lag_days: number; earliest_start: string }[] = [];
  for (const e of edges) {
    if (only && !only.has(e.predecessor_id) && !only.has(e.successor_id)) continue;
    const p = tasks.get(e.predecessor_id); const s = tasks.get(e.successor_id);
    const anchor = s ? s.start ?? s.due : null;
    if (!p?.due || anchor == null || s!.done) continue;
    const need = earliestStart(p.due, e.lag_days);
    if (anchor < need) out.push({ dependency_id: e.id, predecessor_id: e.predecessor_id, successor_id: e.successor_id, lag_days: e.lag_days, earliest_start: need });
  }
  return out;
}

/**
 * Forecast dates (a forward pass, in topological order). A Done task ends on the day it was completed (else its due
 * date). An open task starts no earlier than its own start and than every predecessor's forecast end + 1 + lag,
 * keeps its planned duration, and cannot end before `today` (unfinished work does not finish in the past).
 * A task with no due date has no forecast end.
 */
export function forecast(tasks: Map<string, GraphTask>, edges: GraphEdge[], today: string): Map<string, { start: string | null; end: string | null }> {
  const out = new Map<string, { start: string | null; end: string | null }>();
  const preds = new Map<string, GraphEdge[]>();
  for (const e of edges) preds.set(e.successor_id, [...(preds.get(e.successor_id) ?? []), e]);
  for (const id of topoOrder([...tasks.keys()], edges)) {
    const t = tasks.get(id)!;
    if (t.done) {
      out.set(id, { start: t.start, end: t.completedOn ?? t.due });
      continue;
    }
    let need: string | null = null;
    for (const e of preds.get(id) ?? []) {
      const pe = out.get(e.predecessor_id)?.end;
      if (pe) need = maxDate(need, earliestStart(pe, e.lag_days));
    }
    const anchor = t.start ?? t.due;
    const duration = t.start && t.due ? daysFrom(t.start, t.due) : 0;
    const start = anchor == null ? need : maxDate(anchor, need);
    let end = t.due == null ? null : start != null ? addDays(start, duration) : t.due;
    if (end != null && end < today) end = today;
    out.set(id, { start, end });
  }
  return out;
}
