import { useLayoutEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type PointerEvent } from 'react';
import { CircleCheck, Flag } from 'lucide-react';
import { Avatar } from '../Avatar';
import { StatusChip } from '../StatusChip';
import type { Status } from '../status-colors';
import { cx } from '../cx';

export type PlannerColumn = { key: string; label: string; note?: string; today?: boolean };
export type PlannerRow = { id: string; label: string; sublabel?: string; avatar?: boolean; group?: string; groupStatus?: Status; pinned?: boolean };
export type PlannerAllocation = {
  id: string; rowId: string; column: number; hours: number; label: string;
  kind: 'confirmed' | 'tentative' | 'hold'; published?: boolean;
};
export type PlannerMark = { rowId: string; column: number; label: string };

export type PlannerGridProps = {
  label: string;
  columns: PlannerColumn[];
  rows: PlannerRow[];
  allocations: PlannerAllocation[];
  /** Leave and holidays: hatched cells. */
  off?: PlannerMark[];
  /** Small flags inside a cell, such as site visits. */
  markers?: PlannerMark[];
  /** Hours over capacity for a cell. Above zero, the cell turns red and carries a badge. */
  over?: (rowId: string, column: number) => number;
  readOnly?: boolean;
  /** Text of the first column header. */
  rowHeader?: string;
  /** Marks one cell as today when rows are weeks rather than people. */
  todayCell?: { rowId: string; column: number };
  firstColumnWidth?: number;
  columnMinWidth?: number;
  onMove?: (id: string, rowId: string, column: number) => void;
  onResize?: (id: string, hours: number) => void;
  onCellClick?: (rowId: string, column: number) => void;
  onCardClick?: (allocation: PlannerAllocation) => void;
};

const CARD = 40;
const GAP = 4;
const GROUP = 32;
const MARKER = 16;
const HEADER = 36;
const PX_PER_HOUR = 8;

type Item = { type: 'group'; name: string; status?: Status; top: number; height: number } | { type: 'row'; row: PlannerRow; index: number; top: number; height: number };

/** Week or day planner on a solid surface. Rows are windowed, so it stays fast with a large firm. */
export function PlannerGrid({
  label, columns, rows, allocations, off = [], markers = [], over, readOnly, rowHeader = 'Person', todayCell, firstColumnWidth = 208, columnMinWidth = 104, onMove, onResize, onCellClick, onCardClick,
}: PlannerGridProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ top: 0, height: 0 });
  const [active, setActive] = useState({ r: 0, c: 0 });
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<string | null>(null);
  const [resize, setResize] = useState<{ id: string; hours: number } | null>(null);
  const [grip, setGrip] = useState<string | null>(null);
  const afterResize = useRef(false);
  const focusNext = useRef(false);

  const pinned = useMemo(() => rows.filter((r) => r.pinned), [rows]);
  const body = useMemo(() => rows.filter((r) => !r.pinned), [rows]);
  const ordered = useMemo(() => [...pinned, ...body], [pinned, body]);

  const byCell = useMemo(() => {
    const m = new Map<string, PlannerAllocation[]>();
    allocations.forEach((a) => { const k = `${a.rowId}|${a.column}`; m.set(k, [...(m.get(k) ?? []), a]); });
    return m;
  }, [allocations]);
  const offAt = useMemo(() => new Map(off.map((o) => [`${o.rowId}|${o.column}`, o.label])), [off]);
  const markerAt = useMemo(() => new Map(markers.map((o) => [`${o.rowId}|${o.column}`, o.label])), [markers]);

  const heightOf = (rowId: string) => {
    let tallest = 48;
    columns.forEach((_, c) => {
      const n = byCell.get(`${rowId}|${c}`)?.length ?? 0;
      const marker = markerAt.has(`${rowId}|${c}`) ? MARKER + (n ? GAP : 0) : 0;
      tallest = Math.max(tallest, GAP * 2 + n * CARD + Math.max(0, n - 1) * GAP + marker);
    });
    return tallest;
  };

  const items = useMemo(() => {
    const out: Item[] = [];
    let top = 0;
    let lastGroup: string | undefined;
    body.forEach((row) => {
      if (row.group && row.group !== lastGroup) {
        out.push({ type: 'group', name: row.group, status: row.groupStatus, top, height: GROUP });
        top += GROUP;
        lastGroup = row.group;
      }
      const height = heightOf(row.id);
      out.push({ type: 'row', row, index: pinned.length + body.indexOf(row), top, height });
      top += height;
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body, pinned.length, byCell, markerAt, columns]);
  const total = items.length ? items[items.length - 1].top + items[items.length - 1].height : 0;

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setView({ top: el.scrollTop, height: el.clientHeight });
    measure();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);

  // Without a measured height (first paint, tests) every row renders; once measured, only those in view do.
  const overscan = 300;
  const visible = view.height === 0 ? items : items.filter((i) => i.top + i.height >= view.top - overscan && i.top <= view.top + view.height + overscan);
  const topSpace = visible[0]?.top ?? 0;
  const lastShown = visible[visible.length - 1];
  const bottomSpace = lastShown ? total - lastShown.top - lastShown.height : 0;

  const cellId = (r: number, c: number) => `plan-${r}-${c}`;

  useLayoutEffect(() => {
    if (!focusNext.current) return;
    focusNext.current = false;
    scroller.current?.querySelector<HTMLElement>(`[data-cell="${cellId(active.r, active.c)}"]`)?.focus();
  });

  const go = (r: number, c: number) => {
    const nr = Math.max(0, Math.min(ordered.length - 1, r));
    const nc = Math.max(0, Math.min(columns.length - 1, c));
    const el = scroller.current;
    const item = items.find((i) => i.type === 'row' && i.index === nr);
    if (el && item && view.height) {
      const head = HEADER + pinned.reduce((s, p) => s + heightOf(p.id), 0);
      const y = item.top + head;
      if (y < el.scrollTop + head) el.scrollTop = y - head;
      else if (y + item.height > el.scrollTop + el.clientHeight) el.scrollTop = y + item.height - el.clientHeight;
      setView({ top: el.scrollTop, height: el.clientHeight });
    }
    focusNext.current = true;
    setActive({ r: nr, c: nc });
  };

  const firstCard = (r: number, c: number) => byCell.get(`${ordered[r]?.id}|${c}`)?.[0];

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const { r, c } = active;
    const card = firstCard(r, c);
    if (e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && card && !readOnly) {
      e.preventDefault();
      const nc = c + (e.key === 'ArrowLeft' ? -1 : 1);
      if (nc >= 0 && nc < columns.length) { onMove?.(card.id, card.rowId, nc); go(r, nc); }
      return;
    }
    switch (e.key) {
      case 'ArrowLeft': e.preventDefault(); go(r, c - 1); break;
      case 'ArrowRight': e.preventDefault(); go(r, c + 1); break;
      case 'ArrowUp': e.preventDefault(); go(r - 1, c); break;
      case 'ArrowDown': e.preventDefault(); go(r + 1, c); break;
      case 'Home': e.preventDefault(); go(r, 0); break;
      case 'End': e.preventDefault(); go(r, columns.length - 1); break;
      case '+': case '=':
        if (card && !readOnly) { e.preventDefault(); onResize?.(card.id, card.hours + 1); }
        break;
      case '-':
        if (card && !readOnly && card.hours > 1) { e.preventDefault(); onResize?.(card.id, card.hours - 1); }
        break;
      case 'Enter': case ' ':
        e.preventDefault();
        if (card) onCardClick?.(card); else onCellClick?.(ordered[r].id, c);
        break;
      case 'Escape':
        setDragging(null); setDropAt(null); setResize(null);
        break;
      default:
    }
  };

  const startResize = (e: PointerEvent<HTMLSpanElement>, a: PlannerAllocation) => {
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    let hours = a.hours;
    setGrip(a.id);
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('keydown', key);
      setGrip(null);
      setResize(null);
    };
    const move = (ev: globalThis.PointerEvent) => {
      hours = Math.max(1, a.hours + Math.round((ev.clientX - startX) / PX_PER_HOUR));
      setResize({ id: a.id, hours });
    };
    const up = () => {
      stop();
      afterResize.current = true;
      if (hours !== a.hours) onResize?.(a.id, hours);
    };
    const key = (ev: globalThis.KeyboardEvent) => { if (ev.key === 'Escape') stop(); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('keydown', key);
  };

  const template = { gridTemplateColumns: `${firstColumnWidth}px repeat(${columns.length}, minmax(${columnMinWidth}px, 1fr))` };
  const inner = { minWidth: firstColumnWidth + columns.length * columnMinWidth };

  const renderRow = (row: PlannerRow, r: number, height: number) => (
    <div key={row.id} role="row" aria-rowindex={r + 2} className={cx('plan__row', row.pinned && 'plan__row--pinned')} style={{ ...template, height }}>
      <div role="rowheader" className="plan__rowhead">
        {row.avatar && <Avatar name={row.label} size={20} />}
        <span className="plan__rowtext"><span>{row.label}</span>{row.sublabel && <span className="t-numeric ink-2">{row.sublabel}</span>}</span>
      </div>
      {columns.map((col, c) => {
        const key = `${row.id}|${c}`;
        const cards = byCell.get(key) ?? [];
        const offLabel = offAt.get(key);
        const marker = markerAt.get(key);
        const overBy = over?.(row.id, c) ?? 0;
        const isActive = active.r === r && active.c === c;
        return (
          <div
            key={col.key} role="gridcell" data-cell={cellId(r, c)} tabIndex={isActive ? 0 : -1}
            className={cx('plan__c', (col.today || (todayCell?.rowId === row.id && todayCell.column === c)) && 'plan__c--today', offLabel && 'plan__c--off', overBy > 0 && 'plan__c--conflict', dropAt === key && 'plan__c--drop')}
            onFocus={() => setActive({ r, c })}
            onClick={() => { setActive({ r, c }); if (!cards.length) onCellClick?.(row.id, c); }}
            onDragOver={readOnly ? undefined : (e: DragEvent) => { e.preventDefault(); setDropAt(key); }}
            onDragLeave={readOnly ? undefined : () => setDropAt((d) => (d === key ? null : d))}
            onDrop={readOnly ? undefined : (e: DragEvent) => {
              e.preventDefault();
              const id = e.dataTransfer.getData('text/plain') || dragging;
              setDragging(null); setDropAt(null);
              if (id) onMove?.(id, row.id, c);
            }}
          >
            {offLabel && <span className="plan__off">{offLabel}</span>}
            {cards.map((a) => {
              const hours = resize?.id === a.id ? resize.hours : a.hours;
              return (
                <button
                  key={a.id} type="button" tabIndex={-1} draggable={!readOnly && grip !== a.id}
                  className={cx('pcard', `pcard--${a.kind}`, dragging === a.id && 'pcard--dragging')}
                  onClick={(e) => { e.stopPropagation(); setActive({ r, c }); if (afterResize.current) { afterResize.current = false; return; } onCardClick?.(a); }}
                  onDragStart={(e) => { e.dataTransfer.setData('text/plain', a.id); e.dataTransfer.effectAllowed = 'move'; setDragging(a.id); }}
                  onDragEnd={() => { setDragging(null); setDropAt(null); }}
                >
                  <span className="pcard__top">
                    <span className="t-numeric">{hours} h</span>
                    {a.published && <span className="pcard__pub"><CircleCheck size={14} strokeWidth={1.5} aria-hidden /><span className="sr-only">Published</span></span>}
                    {a.kind === 'tentative' && <span className="sr-only">Tentative</span>}
                    {a.kind === 'hold' && <span className="sr-only">On hold, retained</span>}
                  </span>
                  <span className="pcard__what">{a.label}</span>
                  {!readOnly && (
                    <span
                      className="pcard__grip" aria-hidden
                      onPointerDown={(e) => startResize(e, a)}
                    />
                  )}
                </button>
              );
            })}
            {overBy > 0 && <span className="plan__badge t-numeric">+{overBy} h<span className="sr-only"> over capacity</span></span>}
            {marker && <span className="plan__marker"><Flag size={14} strokeWidth={1.5} aria-hidden />{marker}</span>}
          </div>
        );
      })}
    </div>
  );

  return (
    <div
      ref={scroller} className="plan" role="grid" aria-label={label} aria-rowcount={ordered.length + 1} aria-colcount={columns.length + 1}
      onKeyDown={onKeyDown} onScroll={(e) => setView({ top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight })}
    >
      <div className="plan__inner" style={inner} role="presentation">
        <div role="row" aria-rowindex={1} className="plan__row plan__row--head" style={template}>
          <div role="columnheader" className="plan__rowhead">{rowHeader}</div>
          {columns.map((c) => (
            <div key={c.key} role="columnheader" className={cx('plan__h', c.today && 'plan__h--today')}>
              <span className="t-numeric">{c.label}</span>{c.note && <span className="plan__note">{c.note}</span>}
            </div>
          ))}
        </div>
        {pinned.map((row, i) => renderRow(row, i, heightOf(row.id)))}
        {topSpace > 0 && <div role="presentation" style={{ height: topSpace }} />}
        {visible.map((item) => (item.type === 'group'
          ? (
            <div key={`g-${item.name}`} role="row" className="plan__group" style={{ height: item.height }}>
              <div role="gridcell" aria-colspan={columns.length + 1} className="plan__groupcell">
                <span>{item.name}</span>
                {item.status && <StatusChip size="sm" status={item.status} />}
              </div>
            </div>
          )
          : renderRow(item.row, item.index, item.height)))}
        {bottomSpace > 0 && <div role="presentation" style={{ height: bottomSpace }} />}
      </div>
    </div>
  );
}

export function PlannerLegend({ hint }: { hint?: string }) {
  return (
    <div className="plan-legend">
      <span><i className="plan-legend__sw pcard--confirmed" />Confirmed</span>
      <span><i className="plan-legend__sw pcard--tentative" />Tentative</span>
      <span><i className="plan-legend__sw pcard--hold" />On hold</span>
      <span><i className="plan-legend__sw plan__c--conflict" />Conflict</span>
      <span><i className="plan-legend__sw plan__c--off" />Leave, holiday</span>
      {hint && <span className="plan-legend__hint">{hint}</span>}
    </div>
  );
}
