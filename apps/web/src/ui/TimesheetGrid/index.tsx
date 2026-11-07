import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { CircleAlert, Lock, Plus, Undo2 } from 'lucide-react';
import { Button } from '../Button';
import { DayTotalRing } from '../DayTotalRing';
import { Tooltip } from '../Tooltip';
import { parseDuration } from '../format';
import { cx } from '../cx';

export type TimesheetDay = { key: string; label: string; date: string; scheduled: number };
export type TimesheetLine = {
  id: string; title: string; subtitle?: string;
  hours: number[];
  /** locked = submitted, returned carries a reason, unclassified needs a project. */
  state?: 'open' | 'locked' | 'returned' | 'unclassified';
  reason?: string;
};
export type TimesheetGridProps = {
  label: string;
  days: TimesheetDay[];
  lines: TimesheetLine[];
  onChange?: (lineId: string, day: number, hours: number) => void;
  onAddLine?: () => void;
};

const fmt = (h: number) => (h ? h.toFixed(2) : '');

function CellEditor({ initial, selectAll, onCommit, onCancel }: { initial: string; selectAll: boolean; onCommit: (text: string, move: 'down' | 'right' | null) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState(initial);
  const finished = useRef(false);
  const finish = (fn: () => void) => { finished.current = true; fn(); };
  return (
    <input
      autoFocus className="ts__input" inputMode="decimal" aria-label="Hours" value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => { if (selectAll) e.target.select(); }}
      onBlur={() => { if (!finished.current) onCommit(draft, null); }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); finish(() => onCommit(draft, 'down')); }
        if (e.key === 'Tab') { e.preventDefault(); finish(() => onCommit(draft, 'right')); }
        if (e.key === 'Escape') { e.preventDefault(); finish(onCancel); }
      }}
    />
  );
}

function DayCell({ value, editing, locked, focusable, initial, onEdit, onCommit, onCancel, onFocus, cellKey }: {
  value: number; editing: boolean; locked: boolean; focusable: boolean; initial: string | null; cellKey: string;
  onEdit: () => void; onCommit: (text: string, move: 'down' | 'right' | null) => void; onCancel: () => void; onFocus: () => void;
}) {
  return (
    <td
      role="gridcell" data-cell={cellKey} tabIndex={focusable ? 0 : -1} aria-readonly={locked || undefined}
      className={cx('ts__c', value > 0 && 'ts__c--filled')}
      onFocus={onFocus} onDoubleClick={() => { if (!locked) onEdit(); }}
    >
      {editing
        ? <CellEditor initial={initial ?? fmt(value)} selectAll={initial == null} onCommit={onCommit} onCancel={onCancel} />
        : <span className="t-numeric">{fmt(value)}</span>}
    </td>
  );
}

/** Solid grid entry. Arrow keys move, Enter or typing edits, Escape cancels. Locked rows cannot be edited. */
export function TimesheetGrid({ label, days, lines, onChange, onAddLine }: TimesheetGridProps) {
  const [active, setActive] = useState({ r: 0, c: 0 });
  const [editing, setEditing] = useState<{ initial: string | null } | null>(null);
  const root = useRef<HTMLTableElement>(null);
  const refocus = useRef(false);
  const key = (r: number, c: number) => `ts-${r}-${c}`;

  useLayoutEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    root.current?.querySelector<HTMLElement>(`[data-cell="${key(active.r, active.c)}"]`)?.focus();
  });

  const go = (r: number, c: number) => {
    refocus.current = true;
    setEditing(null);
    setActive({ r: Math.max(0, Math.min(lines.length - 1, r)), c: Math.max(0, Math.min(days.length - 1, c)) });
  };
  const lockedAt = (r: number) => lines[r]?.state === 'locked';

  const onKey = (e: KeyboardEvent<HTMLTableElement>) => {
    if (editing || !lines.length) return;
    const { r, c } = active;
    switch (e.key) {
      case 'ArrowLeft': e.preventDefault(); go(r, c - 1); return;
      case 'ArrowRight': e.preventDefault(); go(r, c + 1); return;
      case 'ArrowUp': e.preventDefault(); go(r - 1, c); return;
      case 'ArrowDown': e.preventDefault(); go(r + 1, c); return;
      case 'Home': e.preventDefault(); go(r, 0); return;
      case 'End': e.preventDefault(); go(r, days.length - 1); return;
      case 'Enter': if (!lockedAt(r)) { e.preventDefault(); setEditing({ initial: null }); } return;
      case 'Delete': case 'Backspace': if (!lockedAt(r)) { e.preventDefault(); onChange?.(lines[r].id, c, 0); } return;
      default:
        if (/^[0-9.:]$/.test(e.key) && !lockedAt(r)) { e.preventDefault(); setEditing({ initial: e.key }); }
    }
  };

  const commit = (r: number, c: number, text: string, move: 'down' | 'right' | null) => {
    const trimmed = text.trim();
    const minutes = trimmed === '' ? 0 : parseDuration(trimmed);
    if (minutes != null && minutes / 60 !== lines[r].hours[c]) onChange?.(lines[r].id, c, minutes / 60);
    if (move === 'down') go(r + 1, c);
    else if (move === 'right') go(r, c + 1);
    else setEditing(null);
  };

  const dayTotal = (c: number) => lines.reduce((s, l) => s + (l.hours[c] ?? 0), 0);
  const lineTotal = (l: TimesheetLine) => l.hours.reduce((s, h) => s + h, 0);
  const weekTotal = lines.reduce((s, l) => s + lineTotal(l), 0);

  return (
    <div className="ts" tabIndex={0} role="region" aria-label={`${label}, scrollable`}>
      <table ref={root} role="grid" aria-label={label} onKeyDown={onKey}>
        <thead>
          <tr>
            <th scope="col" className="ts__line">Line</th>
            {days.map((d) => <th key={d.key} scope="col" className="ts__day"><span>{d.label}</span> <span className="t-numeric ink-2">{d.date}</span></th>)}
            <th scope="col" className="ts__total">Total (h)</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, r) => (
            <tr key={l.id} className={cx(l.state === 'returned' && 'ts__row--returned', l.state === 'unclassified' && 'ts__row--unclassified', l.state === 'locked' && 'ts__row--locked')}>
              <th scope="row" className="ts__line">
                <span className="ts__head">
                  {l.state === 'locked' && <span className="ts__glyph"><Lock size={14} strokeWidth={1.5} aria-hidden /><span className="sr-only">Locked. </span></span>}
                  {l.state === 'returned' && (
                    <Tooltip text={l.reason ?? 'Returned'}>
                      <span className="ts__glyph" tabIndex={0} role="img" aria-label={`Returned. ${l.reason ?? ''}`}><Undo2 size={14} strokeWidth={1.5} aria-hidden /></span>
                    </Tooltip>
                  )}
                  {l.state === 'unclassified' && (
                    <Tooltip text={l.reason ?? 'Needs a project and phase'}>
                      <span className="ts__glyph" tabIndex={0} role="img" aria-label={`Unclassified. ${l.reason ?? ''}`}><CircleAlert size={14} strokeWidth={1.5} aria-hidden /></span>
                    </Tooltip>
                  )}
                  <span className="ts__names"><span className="ts__title">{l.title}</span>{l.subtitle && <span className="t-caption ink-2">{l.subtitle}</span>}</span>
                </span>
              </th>
              {days.map((d, c) => {
                const isActive = active.r === r && active.c === c;
                return (
                  <DayCell
                    key={d.key} cellKey={key(r, c)} value={l.hours[c] ?? 0} locked={l.state === 'locked'} focusable={isActive}
                    editing={!!editing && isActive} initial={editing?.initial ?? null}
                    onFocus={() => { if (!isActive) { setEditing(null); setActive({ r, c }); } }}
                    onEdit={() => { setActive({ r, c }); setEditing({ initial: null }); }}
                    onCommit={(text, move) => commit(r, c, text, move)}
                    onCancel={() => { refocus.current = true; setEditing(null); }}
                  />
                );
              })}
              <td className="ts__total t-numeric">{lineTotal(l).toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          {onAddLine && (
            <tr className="ts__addrow">
              <td colSpan={days.length + 2}><Button size="dense" variant="ghost" icon={<Plus size={16} strokeWidth={1.5} aria-hidden />} onClick={onAddLine}>Add line</Button></td>
            </tr>
          )}
          <tr className="ts__foot">
            <th scope="row" className="ts__line">Day total</th>
            {days.map((d, c) => <td key={d.key} className="ts__ringcell"><DayTotalRing hours={dayTotal(c)} scheduled={d.scheduled} label={d.label} /></td>)}
            <td className="ts__total t-numeric">{weekTotal.toFixed(2)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
