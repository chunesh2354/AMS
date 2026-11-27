import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Avatar } from '../Avatar';
import { IconButton } from '../IconButton';
import { cx } from '../cx';
import {
  addDays, barBox, clampPct, dayMonth, moveWords, rangeText, round2, shiftRange, spanDays, ticksFor, xOf,
  type Window, type Zoom,
} from './model';
import './Gantt.css';

export * from './model';

export type Range = { start: string; end: string };
export type EditMode = 'move' | 'start' | 'end';

export type GanttRow = {
  id: string;
  /** group: a phase or a project (heavier row); task; milestone: a read-only diamond. */
  kind: 'group' | 'task' | 'milestone';
  depth: 0 | 1 | 2;
  label: string;
  /** The name links here (the studio timeline links a project to its own timeline). */
  href?: string;
  caption?: { text: string; tone?: 'red' | 'grey'; mark?: 'fill' | 'line' | 'red' | 'grey' };
  who?: string | null;
  dates: string;
  done?: string;
  /** Where the bar is drawn now (an unsaved draft included). */
  bar?: Range | null;
  /** The saved position, drawn as a dashed ghost while a draft differs from it. */
  saved?: Range | null;
  /** A thin line under the bar: the forecast, when it differs from the plan. */
  forecast?: Range | null;
  /** Open work past its end: a dashed redline from the end to this day (today). */
  lateTo?: string | null;
  progress?: number;
  late?: boolean;
  hold?: boolean;
  milestoneDone?: boolean;
  /** Read-only milestone diamonds drawn on this row (the studio's project rows). */
  diamonds?: { date: string; label: string; done?: boolean }[];
  /** Red outlines over the bar, such as a phase over its hours on a project's summary bar. */
  outlines?: (Range & { tag: string })[];
  /** What the viewer may change. Null or absent: read-only. A task with a due date only can move but not resize. */
  editable?: { move: boolean; start: boolean; end: boolean } | null;
  expand?: { open: boolean; onToggle: () => void };
  /** A control drawn in the track when the row has no bar, such as "Set dates" on a phase with no dates. */
  action?: ReactNode;
  /** The accessible description of the bar: name, dates and state. */
  describe: string;
};

export type GanttLink = { id: string; from: string; to: string; red: boolean };

export type GanttProps = {
  label: string;
  rows: GanttRow[];
  links?: GanttLink[];
  zoom: Zoom;
  window: Window;
  today: string;
  columns: { name: string; who: string; dates: string; done?: string };
  variant?: 'project' | 'studio';
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  /** A drag or a keyboard button changed a bar. The caller keeps it as a draft. */
  onEdit?: (id: string, range: Range) => void;
  empty?: ReactNode;
};

const ROW_H = { group: 56, task: 48, milestone: 48 } as const;
const STUDIO_H = { group: 58, task: 44, milestone: 44 } as const;
const ELB = 0.8;

type Drag = { id: string; mode: EditMode; x0: number; width: number; days: number; moved: boolean };

/** The chevron that opens and closes a group. */
const Chevron = () => <ChevronRight size={16} strokeWidth={1.5} aria-hidden />;

export function Gantt({ label, rows, links = [], zoom, window: w, today, columns, variant = 'project', selectedId, onSelect, onEdit, empty }: GanttProps) {
  const span = spanDays(w);
  const half = 50 / span;
  const ticks = ticksFor(zoom, w);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const suppressClick = useRef(false);
  const heights = variant === 'studio' ? STUDIO_H : ROW_H;

  useEffect(() => {
    if (!drag) return undefined;
    const move = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const days = d.width > 0 ? Math.round(((e.clientX - d.x0) / d.width) * span) : 0;
      if (days !== d.days) { dragRef.current = { ...d, days, moved: d.moved || days !== 0 }; setDrag(dragRef.current); }
    };
    const up = () => {
      const d = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (!d) return;
      if (d.moved) suppressClick.current = true;
      const row = rows.find((r) => r.id === d.id);
      if (!row?.bar || d.days === 0) return;
      const next = shiftRange(row.bar, d.mode, d.days);
      if (next?.start && next.end) onEdit?.(d.id, { start: next.start, end: next.end });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
  }, [drag, rows, span, onEdit]);

  const startDrag = (e: ReactPointerEvent, row: GanttRow, mode: EditMode) => {
    if (!onEdit || !row.editable || e.button !== 0) return;
    if (mode === 'move' ? !row.editable.move : !row.editable[mode]) return;
    e.stopPropagation();
    const track = (e.currentTarget as HTMLElement).closest('.gchart__track') as HTMLElement | null;
    const width = track?.getBoundingClientRect().width ?? 0;
    dragRef.current = { id: row.id, mode, x0: e.clientX, width, days: 0, moved: false };
    setDrag(dragRef.current);
  };

  const shown = (row: GanttRow): Range | null => {
    if (!row.bar) return null;
    if (drag && drag.id === row.id && drag.days) {
      const n = shiftRange(row.bar, drag.mode, drag.days);
      if (n?.start && n.end) return { start: n.start, end: n.end };
    }
    return row.bar;
  };

  const onBarKey = (e: KeyboardEvent, row: GanttRow) => {
    if (!onEdit || !row.editable || !row.bar) return;
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    const mode: EditMode = e.shiftKey ? 'end' : 'move';
    if (mode === 'move' ? !row.editable.move : !row.editable.end) return;
    e.preventDefault();
    const n = shiftRange(row.bar, mode, step);
    if (n?.start && n.end) onEdit(row.id, { start: n.start, end: n.end });
  };

  // Row positions, for the dependency elbows.
  const rowY = new Map<string, { y: number; h: number; row: GanttRow }>();
  let y = 0;
  for (const r of rows) { const h = heights[r.kind]; rowY.set(r.id, { y, h, row: r }); y += h; }
  const bodyH = y;

  const segs: { key: string; cls: string; l: number; w: string; t: number; h: number }[] = [];
  for (const link of links) {
    const a = rowY.get(link.from); const b = rowY.get(link.to);
    if (!a || !b) continue;
    const pa = shown(a.row); const sb = shown(b.row);
    if (!pa || !sb) continue;
    const pEnd = a.row.lateTo && a.row.lateTo > pa.end ? a.row.lateTo : pa.end;
    const x1 = a.row.kind === 'milestone' ? xOf(w, pa.start) + half : xOf(w, addDays(pEnd, 1));
    const x2 = b.row.kind === 'milestone' ? xOf(w, sb.start) + half : xOf(w, sb.start);
    if (x1 < 0 || x1 > 100 || x2 < 0 || x2 > 100) continue;
    const y1 = a.y + a.h / 2; const y2 = b.y + b.h / 2;
    const k = link.red ? ' ln--red' : '';
    const msIn = b.row.kind === 'milestone' ? 1.1 : 0;
    if (x2 - msIn >= x1 + ELB) {
      segs.push({ key: `${link.id}a`, cls: `ln${k}`, l: round2(x1), w: `${ELB}%`, t: y1, h: 1 });
      segs.push({ key: `${link.id}b`, cls: `ln ln--v${k}`, l: round2(x1 + ELB), w: '1px', t: Math.min(y1, y2), h: Math.abs(y2 - y1) + 1 });
      segs.push({ key: `${link.id}c`, cls: `ln${k}`, l: round2(x1 + ELB), w: `${round2(x2 - msIn - x1 - ELB)}%`, t: y2, h: 1 });
      segs.push({ key: `${link.id}d`, cls: `ln ln--cap${k}`, l: round2(x2 - msIn), w: '5px', t: y2 - 2, h: 5 });
    } else {
      // The successor starts at or before the predecessor's finish: drop straight down to its start.
      const top = y1 + (a.row.kind === 'group' ? 10 : 8);
      const bot = y2 - (b.row.kind === 'milestone' ? 10 : 8);
      segs.push({ key: `${link.id}a`, cls: `ln ln--v${k}`, l: round2(x2), w: '1px', t: Math.min(top, bot), h: Math.max(Math.abs(bot - top), 4) });
      segs.push({ key: `${link.id}b`, cls: `ln ln--capv${k}`, l: round2(x2), w: '5px', t: bot - 4, h: 5 });
    }
  }

  const todayX = xOf(w, today);
  const todayIn = todayX >= 0 && todayX <= 100;

  return (
    <div className="gantt-scroll">
      <div className={cx('gchart', variant === 'studio' && 'gchart--studio')} role="table" aria-label={label}>
        <div className="gchart__head" role="row">
          <div className="gchart__lh">
            <span role="columnheader">{columns.name}</span>
            <span role="columnheader">{columns.who}</span>
            <span role="columnheader">{columns.dates}</span>
            {columns.done && <span role="columnheader">{columns.done}</span>}
          </div>
          <div className="gchart__th" role="columnheader" aria-label="Timeline">
            {ticks.map((t) => <span key={t.date} className="gchart__tick" style={{ left: `${t.x}%` }} aria-hidden>{t.label}</span>)}
            {todayIn && <span className="gchart__todayl" style={{ left: `${round2(todayX + half)}%` }}>Today {dayMonth(today)}</span>}
          </div>
        </div>
        {!rows.length && empty && <div className="gchart__empty">{empty}</div>}
        <div className="gchart__body" style={{ height: bodyH }}>
          <div className="gchart__under" aria-hidden>
            {ticks.map((t) => <span key={t.date} className="gchart__vl" style={{ left: `${t.x}%` }} />)}
          </div>
          {rows.map((r) => {
            const cur = shown(r);
            const box = cur && r.kind !== 'milestone' ? barBox(w, cur.start, cur.end) : null;
            const sel = selectedId === r.id;
            const isDragging = drag?.id === r.id;
            const ghost = r.saved && cur && (r.saved.start !== cur.start || r.saved.end !== cur.end) && r.kind !== 'milestone' ? barBox(w, r.saved.start, r.saved.end) : null;
            const fc = r.forecast && cur && (r.forecast.start !== cur.start || r.forecast.end !== cur.end) ? barBox(w, r.forecast.start, r.forecast.end) : null;
            const lateBox = r.lateTo && cur && r.lateTo > cur.end ? (() => {
              const L = clampPct(xOf(w, addDays(cur.end, 1))); const R = clampPct(xOf(w, addDays(r.lateTo!, 1)));
              return R > L ? { left: round2(L), width: round2(R - L) } : null;
            })() : null;
            const mx = cur && r.kind === 'milestone' ? xOf(w, cur.start) + half : null;
            const interactive = !!(onEdit && r.editable && (r.editable.move || r.editable.start || r.editable.end));
            const tip = cur ? (isDragging && drag?.days && r.bar ? `${rangeText(cur.start, cur.end)}, ${moveWords(drag.mode === 'end' ? 0 : drag.days, drag.mode === 'start' ? 0 : drag.days)}` : rangeText(cur.start, cur.end)) : '';
            const barCls = cx('gb', r.kind === 'group' && 'gb--group', r.late && 'gb--late', r.hold && 'gb--hold', sel && 'is-sel', isDragging && 'is-dragging');
            const fill = <span className="gb__fill" style={{ width: `${Math.max(0, Math.min(100, r.progress ?? 0))}%` }} />;
            return (
              <div key={r.id} className={cx('gchart__row', r.kind === 'group' && 'gchart__row--group', r.hold && 'gchart__row--hold', sel && 'is-selrow')} style={{ height: heights[r.kind] }} role="row">
                <div className="gchart__l">
                  <div className={cx('gchart__namec', r.depth === 1 && 'gchart__namec--d1', r.depth === 2 && 'gchart__namec--d2')} role="rowheader">
                    {r.expand
                      ? <button type="button" className={cx('gchart__tg', r.expand.open && 'is-open')} aria-expanded={r.expand.open} aria-label={`${r.expand.open ? 'Collapse' : 'Expand'} ${r.label}`} onClick={r.expand.onToggle}><Chevron /></button>
                      : r.depth === 0 && <span className="gchart__tgsp" aria-hidden />}
                    <span className="gchart__nm">
                      {r.href ? <Link className="gchart__n" to={r.href} title={r.label}>{r.label}</Link> : <span className="gchart__n" title={r.label}>{r.label}</span>}
                      {r.caption && (
                        <span className={cx('gchart__c', r.caption.tone === 'red' && 'gchart__c--red')}>
                          {r.caption.mark && <span className={`gchart__mk gchart__mk--${r.caption.mark}`} aria-hidden />}
                          {r.caption.text}
                        </span>
                      )}
                    </span>
                  </div>
                  <span role="cell">{r.who && <Avatar name={r.who} size={20} />}</span>
                  <span className="gchart__d" role="cell">{r.dates}</span>
                  {columns.done && <span className="gchart__p" role="cell">{r.done ?? ''}</span>}
                </div>
                <div className="gchart__track" role="cell">
                  {fc && <span className={cx('gb-base', r.kind === 'group' && 'gb-base--group')} style={{ left: `${fc.left}%`, width: `${fc.width}%` }} aria-hidden title={`Forecast ${rangeText(r.forecast!.start, r.forecast!.end)}`} />}
                  {ghost && <span className={cx('gb-ghost', r.kind === 'group' && 'gb-ghost--group')} style={{ left: `${ghost.left}%`, width: `${ghost.width}%` }} aria-hidden />}
                  {lateBox && <span className="gb-late" style={{ left: `${lateBox.left}%`, width: `${lateBox.width}%` }} aria-hidden />}
                  {box && (interactive ? (
                    <button
                      type="button" className={barCls} style={{ left: `${box.left}%`, width: `${box.width}%` }}
                      aria-label={`${r.describe}. Select to move or change its dates`} aria-pressed={sel}
                      onClick={() => { if (suppressClick.current) { suppressClick.current = false; onSelect?.(r.id); return; } onSelect?.(sel ? null : r.id); }}
                      onPointerDown={(e) => startDrag(e, r, 'move')}
                      onKeyDown={(e) => onBarKey(e, r)}
                    >
                      {fill}
                      {r.editable?.start && <span className="gb__grip gb__grip--s" aria-hidden data-grip="start" onPointerDown={(e) => startDrag(e, r, 'start')} />}
                      {r.editable?.end && <span className="gb__grip gb__grip--e" aria-hidden data-grip="end" onPointerDown={(e) => startDrag(e, r, 'end')} />}
                      <span className="gb__tip" aria-hidden>{tip}</span>
                    </button>
                  ) : (
                    <span className={barCls} style={{ left: `${box.left}%`, width: `${box.width}%` }} role="img" aria-label={r.describe} title={r.describe}>{fill}</span>
                  ))}
                  {!box && r.action && <span className="gchart__act">{r.action}</span>}
                  {r.outlines?.map((o) => {
                    const b = barBox(w, o.start, o.end);
                    return b && (
                      <span key={o.tag}>
                        <span className="gb-out" style={{ left: `${b.left}%`, width: `${b.width}%` }} aria-hidden />
                        <span className="gb-tag" style={{ left: `${b.left}%` }}>{o.tag}</span>
                      </span>
                    );
                  })}
                  {mx != null && mx >= 0 && mx <= 100 && (
                    <span className={cx('gm', r.milestoneDone && 'gm--done', r.late && 'gm--late', r.hold && 'gm--hold')} style={{ left: `${round2(mx)}%` }} role="img" aria-label={r.describe} title={r.describe} />
                  )}
                  {r.diamonds?.map((d) => {
                    const x = xOf(w, d.date) + half;
                    return x >= 0 && x <= 100 && <span key={`${d.label}${d.date}`} className={cx('gm gm--row', d.done && 'gm--done', r.hold && 'gm--hold')} style={{ left: `${round2(x)}%` }} role="img" aria-label={`${d.label}, ${rangeText(d.date, d.date)}`} title={`${d.label}, ${rangeText(d.date, d.date)}`} />;
                  })}
                </div>
              </div>
            );
          })}
          <div className="gchart__over" aria-hidden>
            {segs.map((s) => <span key={s.key} className={s.cls} style={{ left: `${s.l}%`, width: s.w, top: s.t, height: s.h }} data-link={s.cls.includes('ln--red') ? 'red' : 'ok'} />)}
            {todayIn && <span className="gchart__today" style={{ left: `${round2(todayX + half)}%` }} />}
          </div>
        </div>
      </div>
    </div>
  );
}

/** The selected bar's keyboard controls: the same moves as dragging, one day per press. */
export function GanttSelection({ row, onEdit, note }: { row: GanttRow; onEdit: (id: string, range: Range) => void; note?: string }) {
  if (!row.bar || !row.editable) return null;
  const bar = row.bar;
  const apply = (mode: EditMode, days: number) => {
    const n = shiftRange(bar, mode, days);
    if (n?.start && n.end) onEdit(row.id, { start: n.start, end: n.end });
  };
  const left = <ChevronLeft size={16} strokeWidth={1.5} aria-hidden />;
  const right = <ChevronRight size={16} strokeWidth={1.5} aria-hidden />;
  return (
    <div className="gantt-sel" role="group" aria-label={`Change the dates of ${row.label}`}>
      <div className="gantt-sel__what"><span className="gantt-sel__name">{row.label}</span><span className="gantt-cap">{rangeText(bar.start, bar.end)}{note ? `. ${note}` : ''}</span></div>
      <div className="gantt-sel__ctl">
        {row.editable.move && (
          <div className="gantt-sel__grp"><span className="gantt-sel__l">Move</span>
            <IconButton dense label="Move 1 day earlier" icon={left} onClick={() => apply('move', -1)} />
            <IconButton dense label="Move 1 day later" icon={right} onClick={() => apply('move', 1)} />
          </div>
        )}
        {row.editable.start && (
          <div className="gantt-sel__grp"><span className="gantt-sel__l">Start date</span>
            <IconButton dense label="Start 1 day earlier" icon={left} onClick={() => apply('start', -1)} />
            <IconButton dense label="Start 1 day later" icon={right} onClick={() => apply('start', 1)} disabled={bar.start >= bar.end} />
          </div>
        )}
        {row.editable.end && (
          <div className="gantt-sel__grp"><span className="gantt-sel__l">End date</span>
            <IconButton dense label="End 1 day earlier" icon={left} onClick={() => apply('end', -1)} disabled={bar.end <= bar.start} />
            <IconButton dense label="End 1 day later" icon={right} onClick={() => apply('end', 1)} />
          </div>
        )}
        <span className="gantt-cap">Drag the bar to move it, drag either end to change a date, or use these buttons. Arrow keys on a bar move it too.</span>
      </div>
    </div>
  );
}

export type LegendKey = 'phase' | 'task' | 'forecast' | 'milestone' | 'dep' | 'late' | 'hold' | 'today';
const LEGEND: Record<LegendKey, [string, string, string?]> = {
  phase: ['phase', 'Phase', 'fill = % done'],
  task: ['task', 'Task'],
  forecast: ['base', 'Forecast', 'when it differs from the plan'],
  milestone: ['dia', 'Milestone'],
  dep: ['dep', 'Starts when the line’s source finishes'],
  late: ['late', 'Late, over hours or held up'],
  hold: ['hold', 'On hold'],
  today: ['today', 'Today'],
};

export function GanttLegend({ keys }: { keys: LegendKey[] }) {
  return (
    <ul className="gantt-legend" aria-label="Legend">
      {keys.map((k) => {
        const [sw, text, note] = LEGEND[k];
        return <li key={k} className="gantt-lg"><span className={`gantt-sw gantt-sw--${sw}`} aria-hidden />{text}{note && <span className="gantt-lg__n">{note}</span>}</li>;
      })}
    </ul>
  );
}

/** Pressed-state chip used for filters and toggles in the timeline toolbars. */
export function GanttChip({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" className="gantt-chip" aria-pressed={pressed} onClick={onClick}>{children}</button>;
}
