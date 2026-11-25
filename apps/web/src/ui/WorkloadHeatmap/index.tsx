import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { Avatar } from '../Avatar';
import { cx } from '../cx';
import './WorkloadHeatmap.css';

export type HeatLevel = 'free' | 'part' | 'full' | 'over' | 'away';
export type HeatColumn = { key: string; label: string; sub?: string; today?: boolean };
export type HeatCell = {
  /** Shown in the cell. */
  text: string;
  level: HeatLevel;
  /** Share of the working week lost to leave or holidays, 0 to 1: the width of the hatched band. */
  off: number;
  /** The whole cell read aloud, such as "Asha Rao, week of 9 Nov: 30 of 40 hours, full". */
  aria: string;
};
export type HeatRow = { id: string; name: string; sublabel?: string; cells: HeatCell[]; total: string; avg: string };
export type HeatFoot = { label: string; cells: { text: string; over: boolean }[]; total: string; hours: string };

export type WorkloadHeatmapProps = {
  label: string;
  columns: HeatColumn[];
  rows: HeatRow[];
  foot?: HeatFoot;
  selected?: { rowId: string; column: number } | null;
  onSelect?: (rowId: string, column: number) => void;
  /** Detail shown beside the grid, such as the selected week. */
  aside?: ReactNode;
};

/**
 * Booked hours per person per week. Grey steps: white under 50%, light 50 to 79%, mid 80 to 100%, redline over 100%.
 * A hatched band along the bottom of a cell is the share of the week lost to leave or a studio holiday.
 * Arrow keys, Home and End move between cells; the last cell focused keeps the one Tab stop (a roving tabindex).
 */
export function WorkloadHeatmap({ label, columns, rows, foot, selected, onSelect, aside }: WorkloadHeatmapProps) {
  const [active, setActive] = useState<{ r: number; c: number }>({ r: 0, c: 0 });
  // The Tab stop stays on a real cell when rows or weeks change.
  const stop = { r: Math.min(active.r, Math.max(0, rows.length - 1)), c: Math.min(active.c, Math.max(0, columns.length - 1)) };
  const template = { gridTemplateColumns: `minmax(160px, 1.5fr) repeat(${columns.length}, minmax(48px, 1fr)) minmax(76px, 0.8fr)` };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    const r = Number(t.dataset.r);
    const c = Number(t.dataset.c);
    if (!t.dataset.r) return;
    const move: Record<string, [number, number]> = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] };
    let next: [number, number] | null = move[e.key] ? [r + move[e.key][0], c + move[e.key][1]] : null;
    if (e.key === 'Home') next = [r, 0];
    if (e.key === 'End') next = [r, columns.length - 1];
    if (!next) return;
    e.preventDefault();
    const [nr, nc] = [Math.max(0, Math.min(rows.length - 1, next[0])), Math.max(0, Math.min(columns.length - 1, next[1]))];
    e.currentTarget.querySelector<HTMLElement>(`[data-r="${nr}"][data-c="${nc}"]`)?.focus();
  };
  return (
    <div className="heat-body">
      <div className="heat" role="table" aria-label={label} onKeyDown={onKeyDown}>
        <div className="heat__row heat__row--head" role="row" style={template}>
          <div className="heat__th" role="columnheader">Person</div>
          {columns.map((c) => (
            <div key={c.key} className={cx('heat__th heat__th--wk', c.today && 'heat__th--today')} role="columnheader">
              <span className="t-numeric">{c.label}</span><span className="heat__sub">{c.sub ?? ''}</span>
            </div>
          ))}
          <div className="heat__th heat__th--tot" role="columnheader"><span>Total</span><span className="heat__sub">avg load</span></div>
        </div>
        {rows.map((row, r) => (
          <div key={row.id} className="heat__row" role="row" style={template}>
            <div className="heat__name" role="rowheader">
              <Avatar name={row.name} size={20} />
              <span className="heat__who"><span>{row.name}</span>{row.sublabel && <span className="t-caption ink-2">{row.sublabel}</span>}</span>
            </div>
            {row.cells.map((cell, c) => {
              const isSel = selected?.rowId === row.id && selected.column === c;
              return (
                <div key={columns[c]?.key ?? c} className="heat__td" role="cell">
                  <button
                    type="button" data-r={r} data-c={c} tabIndex={r === stop.r && c === stop.c ? 0 : -1}
                    onFocus={() => setActive({ r, c })}
                    className={cx('heat__cell', `heat__cell--${cell.level}`, isSel && 'heat__cell--sel')}
                    aria-label={cell.aria} aria-pressed={isSel} onClick={() => onSelect?.(row.id, c)}
                  >
                    {cell.text}
                    {cell.off > 0 && <span className="heat__band" style={{ width: `${Math.min(1, cell.off) * 100}%` }} aria-hidden />}
                  </button>
                </div>
              );
            })}
            <div className="heat__tot" role="cell"><span className="heat__toth t-numeric">{row.total}</span><span className="heat__totp t-numeric">{row.avg}</span></div>
          </div>
        ))}
        {foot && (
          <div className="heat__row heat__row--foot" role="row" style={template}>
            <div className="heat__name heat__name--foot" role="rowheader">{foot.label}</div>
            {foot.cells.map((f, c) => <div key={columns[c]?.key ?? c} className={cx('heat__ft t-numeric', f.over && 'heat__ft--over')} role="cell">{f.text}</div>)}
            <div className="heat__tot" role="cell"><span className="heat__toth t-numeric">{foot.total}</span><span className="heat__totp t-numeric">{foot.hours}</span></div>
          </div>
        )}
      </div>
      {aside}
    </div>
  );
}

export function HeatmapLegend() {
  return (
    <ul className="heat-legend" aria-label="Legend">
      <li><span className="heat-legend__sw heat__cell--free" aria-hidden />Free <span className="ink-2">under 50%</span></li>
      <li><span className="heat-legend__sw heat__cell--part" aria-hidden />Part booked <span className="ink-2">50 to 79%</span></li>
      <li><span className="heat-legend__sw heat__cell--full" aria-hidden />Full <span className="ink-2">80 to 100%</span></li>
      <li><span className="heat-legend__sw heat__cell--over" aria-hidden />Over capacity <span className="ink-2">above 100%</span></li>
      <li><span className="heat-legend__sw heat-legend__sw--hatch" aria-hidden />Leave or studio holiday <span className="ink-2">band width = days off</span></li>
    </ul>
  );
}
