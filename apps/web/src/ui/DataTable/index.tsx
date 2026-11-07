import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronRight, ChevronsUpDown, Columns3, MoreHorizontal } from 'lucide-react';
import { Avatar } from '../Avatar';
import { Button } from '../Button';
import { Checkbox } from '../Checkbox';
import { EmptyState } from '../EmptyState';
import { ErrorState } from '../ErrorState';
import { Menu, type MenuItem } from '../Menu';
import { PermissionDenied } from '../PermissionDenied';
import { Popover } from '../Popover';
import { RestrictedCell } from '../RestrictedCell';
import { Skeleton } from '../Skeleton';
import { StatusChip } from '../StatusChip';
import { formatDate, formatGrouped, formatHours, formatINR } from '../format';
import type { Status } from '../status-colors';
import { cx } from '../cx';

export const RESTRICTED = Symbol('restricted');
export type ColumnType = 'text' | 'number' | 'money' | 'hours' | 'date' | 'status' | 'person' | 'restricted';

export type Column<T> = {
  key: string;
  header: string;
  type?: ColumnType;
  /** The raw value. Return RESTRICTED to fence this cell. */
  value: (row: T) => unknown;
  render?: (row: T) => ReactNode;
  sortable?: boolean;
  hiddenByDefault?: boolean;
  width?: number | string;
  /** Totals row value for this column. */
  total?: number | ((rows: T[]) => number);
  /** Totals row text, when the unit already sits in the header. */
  formatTotal?: (n: number) => string;
  /** Enables inline editing. */
  onEdit?: (row: T, next: string) => void;
  /** Marks one cell as invalid, such as an import error. */
  cellError?: (row: T) => boolean;
};

export type DataTableState = 'ready' | 'loading' | 'empty' | 'error' | 'denied';

export type DataTableProps<T> = {
  label: string;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  density?: 'comfortable' | 'dense';
  state?: DataTableState;
  empty?: { message: string; action?: ReactNode; icon?: ReactNode };
  errorMessage?: string;
  onRetry?: () => void;
  capability?: string;
  columnPicker?: boolean;
  selection?: { selected: string[]; onChange: (keys: string[]) => void; isSelectable?: (row: T) => boolean };
  groupBy?: (row: T) => string;
  rowActions?: (row: T) => MenuItem[];
  onRowClick?: (row: T) => void;
  maxHeight?: number | string;
  /** Marks the row whose detail is showing elsewhere on the page. */
  activeKey?: string;
  /** Narrower cell padding, for tables with many money columns. */
  tight?: boolean;
  /** Tints a whole row: returned lines are warn, unclassified lines are danger. */
  rowTone?: (row: T) => 'warn' | 'danger' | undefined;
  /** Adds a disclosure button to each row and renders content under it when open. */
  expand?: { render: (row: T) => ReactNode; isExpandable?: (row: T) => boolean; defaultOpen?: string[] };
};

const NUMERIC: ColumnType[] = ['number', 'money', 'hours'];

function formatValue(type: ColumnType, v: unknown): ReactNode {
  if (v == null || v === '') return <span className="ink-2">Not set</span>;
  switch (type) {
    case 'number': return formatGrouped(v as number);
    case 'money': return formatINR(v as number);
    case 'hours': return formatHours(v as number);
    case 'date': return <span className="t-numeric">{formatDate(v as string)}</span>;
    case 'status': return <StatusChip size="sm" status={v as Status} />;
    case 'person': return <span className="dt__person"><Avatar name={v as string} size={20} />{v as string}</span>;
    default: return v as ReactNode;
  }
}

function EditCell({ text, label, onCommit }: { text: string; label: string; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  if (draft == null) return <button type="button" className="dt__edit" aria-label={`Edit ${label} ${text}`} onClick={(e) => { e.stopPropagation(); setDraft(text); }}>{text}</button>;
  return (
    <input
      autoFocus aria-label={label} className="dt__edit-input" value={draft}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { onCommit(draft); setDraft(null); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { onCommit(draft); setDraft(null); }
        if (e.key === 'Escape') { e.stopPropagation(); setDraft(null); }
      }}
    />
  );
}

/** Solid surface table. Every list state is built in: loading, empty, error and permission-denied. */
export function DataTable<T>({
  label, columns, rows, rowKey, density = 'comfortable', state = 'ready', empty, errorMessage, onRetry, capability = 'view this list',
  columnPicker, selection, groupBy, rowActions, onRowClick, maxHeight, rowTone, expand, activeKey, tight,
}: DataTableProps<T>) {
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);
  const [hidden, setHidden] = useState(() => new Set(columns.filter((c) => c.hiddenByDefault).map((c) => c.key)));
  const visible = columns.filter((c) => !hidden.has(c.key));
  const [opened, setOpened] = useState<string[]>(expand?.defaultOpen ?? []);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return rows;
    const rank = (v: unknown) => (v === RESTRICTED ? null : v);
    return [...rows].sort((a, b) => {
      const x = rank(col.value(a)); const y = rank(col.value(b));
      if (x == null) return 1;
      if (y == null) return -1;
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
      return sort.dir === 'asc' ? c : -c;
    });
  }, [rows, sort, columns]);

  const groups = useMemo(() => {
    if (!groupBy) return [{ name: null as string | null, rows: sorted }];
    const map = new Map<string, T[]>();
    sorted.forEach((r) => map.set(groupBy(r), [...(map.get(groupBy(r)) ?? []), r]));
    return [...map].map(([name, list]) => ({ name: name as string | null, rows: list }));
  }, [sorted, groupBy]);

  if (state === 'loading') return <Skeleton kind="table" rows={8} />;
  const shell = (body: ReactNode) => <div className="dt">{body}</div>;
  if (state === 'error') return shell(<ErrorState message={errorMessage ?? `${label} could not be loaded.`} onRetry={onRetry} />);
  if (state === 'denied') return shell(<PermissionDenied capability={capability} />);
  if (state === 'empty' || rows.length === 0) return shell(<EmptyState message={empty?.message ?? 'Nothing to show yet.'} action={empty?.action} icon={empty?.icon} />);

  const selectable = selection ? rows.filter((r) => selection.isSelectable?.(r) ?? true).map(rowKey) : [];
  const allOn = selection && selectable.length > 0 && selectable.every((k) => selection.selected.includes(k));
  const someOn = selection && !allOn && selectable.some((k) => selection.selected.includes(k));
  const hasTotals = visible.some((c) => c.total != null);
  const toggleSort = (key: string) => setSort((s) => (s?.key !== key ? { key, dir: 'asc' } : s.dir === 'asc' ? { key, dir: 'desc' } : null));
  const span = visible.length + (selection ? 1 : 0) + (rowActions ? 1 : 0) + (expand ? 1 : 0);

  return (
    <div className={cx('dt', density === 'dense' && 'dt--dense', tight && 'dt--tight')}>
      {columnPicker && (
        <div className="dt__tools">
          <span>{rows.length} {rows.length === 1 ? 'row' : 'rows'}</span>
          <Popover label="Columns" placement="bottom-end" trigger={(p) => <Button {...p} size="dense" variant="ghost" icon={<Columns3 size={16} strokeWidth={1.5} aria-hidden />}>Columns</Button>}>
            <div className="dt__picker">
              {columns.map((c) => (
                <Checkbox
                  key={c.key} label={c.header} checked={!hidden.has(c.key)}
                  onChange={(e) => setHidden((h) => { const n = new Set(h); if (e.target.checked) n.delete(c.key); else n.add(c.key); return n; })}
                />
              ))}
            </div>
          </Popover>
        </div>
      )}
      <div className="dt__scroll" tabIndex={0} role="region" aria-label={label} style={{ maxHeight }}>
        <table>
          <thead>
            <tr>
              {selection && (
                <th className="dt__check" scope="col">
                  <Checkbox hideLabel label="Select all" checked={!!allOn} indeterminate={!!someOn} onChange={(e) => selection.onChange(e.target.checked ? selectable : [])} />
                </th>
              )}
              {expand && <th className="dt__expcol" scope="col"><span className="sr-only">Details</span></th>}
              {visible.map((c) => {
                const num = NUMERIC.includes(c.type ?? 'text');
                const active = sort?.key === c.key;
                return (
                  <th key={c.key} scope="col" className={cx(num && 'dt__num')} style={{ width: c.width }} aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : c.sortable ? 'none' : undefined}>
                    {c.sortable
                      ? <button type="button" className="dt__sort" onClick={() => toggleSort(c.key)}>
                          {c.header}
                          {active ? (sort!.dir === 'asc' ? <ArrowUp size={14} strokeWidth={1.5} aria-hidden /> : <ArrowDown size={14} strokeWidth={1.5} aria-hidden />) : <ChevronsUpDown size={14} strokeWidth={1.5} aria-hidden />}
                        </button>
                      : c.header}
                  </th>
                );
              })}
              {rowActions && <th className="dt__actions" scope="col"><span className="sr-only">Actions</span></th>}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <Fragment key={g.name ?? 'all'}>
                {g.name != null && <tr className="dt__group"><td colSpan={span}>{g.name}</td></tr>}
                {g.rows.map((row) => {
                  const k = rowKey(row);
                  const on = selection?.selected.includes(k);
                  const tone = rowTone?.(row);
                  const canOpen = expand && (expand.isExpandable?.(row) ?? true);
                  const isOpen = opened.includes(k);
                  return (
                    <Fragment key={k}>
                    <tr aria-selected={selection ? !!on : undefined} className={cx('dt__row', onRowClick && 'dt__row--click', tone && `dt__row--${tone}`, activeKey === k && 'dt__row--active')} aria-current={activeKey === k ? 'true' : undefined} tabIndex={onRowClick ? 0 : undefined} onClick={() => onRowClick?.(row)} onKeyDown={onRowClick ? (e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onRowClick(row); } } : undefined}>
                      {selection && (
                        <td className="dt__check" onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            hideLabel label={`Select ${String(visible[0]?.value(row) ?? k)}`} checked={!!on}
                            disabled={!(selection.isSelectable?.(row) ?? true)}
                            onChange={(e) => selection.onChange(e.target.checked ? [...selection.selected, k] : selection.selected.filter((x) => x !== k))}
                          />
                        </td>
                      )}
                      {expand && (
                        <td className="dt__expcol" onClick={(e) => e.stopPropagation()}>
                          {canOpen && (
                            <button type="button" className="dt__expbtn" aria-expanded={isOpen} aria-label={`${isOpen ? 'Hide' : 'Show'} details for ${String(visible[0]?.value(row) ?? k)}`} onClick={() => setOpened((o) => (isOpen ? o.filter((x) => x !== k) : [...o, k]))}>
                              <ChevronRight size={16} strokeWidth={1.5} aria-hidden />
                            </button>
                          )}
                        </td>
                      )}
                      {visible.map((c, i) => {
                        const t = c.type ?? 'text';
                        const raw = c.value(row);
                        const fenced = t === 'restricted' || raw === RESTRICTED;
                        const inner = fenced ? <RestrictedCell />
                          : c.render ? c.render(row)
                          : c.onEdit ? <EditCell text={String(raw ?? '')} label={`${c.header}`} onCommit={(v) => c.onEdit?.(row, v)} />
                          : formatValue(t, raw);
                        const cls = cx(NUMERIC.includes(t) && 'dt__num', c.cellError?.(row) && 'dt__cell--danger');
                        return i === 0 ? <th key={c.key} scope="row" className={cls}>{inner}</th>
                          : <td key={c.key} className={cls}>{inner}</td>;
                      })}
                      {rowActions && (
                        <td className="dt__actions" onClick={(e) => e.stopPropagation()}>
                          <Menu label="Row actions" placement="bottom-end" items={rowActions(row)} trigger={(p) => (
                            <button {...p} type="button" aria-label={`Actions for ${String(visible[0]?.value(row) ?? k)}`} className="icon-btn icon-btn--dense"><MoreHorizontal size={16} strokeWidth={1.5} aria-hidden /></button>
                          )} />
                        </td>
                      )}
                    </tr>
                    {canOpen && isOpen && <tr className="dt__expand"><td colSpan={span}>{expand.render(row)}</td></tr>}
                    </Fragment>
                  );
                })}
              </Fragment>
            ))}
          </tbody>
          {hasTotals && (
            <tfoot>
              <tr className="dt__totals">
                {selection && <td />}
                {expand && <td />}
                {visible.map((c, i) => {
                  const num = NUMERIC.includes(c.type ?? 'text');
                  if (c.total == null) return <td key={c.key}>{i === 0 ? 'Total' : ''}</td>;
                  const n = typeof c.total === 'function' ? c.total(rows) : c.total;
                  return <td key={c.key} className={cx(num && 'dt__num')}>{c.formatTotal ? c.formatTotal(n) : formatValue(c.type ?? 'number', n)}</td>;
                })}
                {rowActions && <td />}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
