import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalendarRange, ChevronDown, Search, X } from 'lucide-react';
import { Button } from '../Button';
import { Calendar } from '../DateField';
import { Checkbox } from '../Checkbox';
import { Popover } from '../Popover';
import { Menu } from '../Menu';
import { formatDate } from '../format';
import { cx } from '../cx';

export type FilterDef =
  | { type: 'search'; key: string; label: string }
  | { type: 'select'; key: string; label: string; options: { value: string; label: string }[] }
  | { type: 'multi'; key: string; label: string; options: { value: string; label: string }[] }
  | { type: 'dateRange'; key: string; label: string };

export type SavedView = { name: string; params: Record<string, string> };
export type FilterBarProps = { filters: FilterDef[]; savedViews?: SavedView[]; end?: ReactNode };

/** All state lives in URL params, so filtered views can be linked and restored. */
export function FilterBar({ filters, savedViews, end }: FilterBarProps) {
  const [params, setParams] = useSearchParams();
  const set = (key: string, value: string | null) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set(key, value); else next.delete(key);
      return next;
    }, { replace: true });
  };
  const active = filters.filter((f) => params.get(f.key)).length;
  const clear = () => setParams((prev) => {
    const next = new URLSearchParams(prev);
    filters.forEach((f) => next.delete(f.key));
    return next;
  }, { replace: true });

  return (
    <div className="filters" role="group" aria-label="Filters">
      {filters.map((f) => {
        const value = params.get(f.key);
        if (f.type === 'search') {
          return (
            <label key={f.key} className="filter-search">
              <Search size={16} strokeWidth={1.5} aria-hidden />
              <span className="sr-only">{f.label}</span>
              <input placeholder={f.label} value={value ?? ''} onChange={(e) => set(f.key, e.target.value)} />
            </label>
          );
        }
        if (f.type === 'dateRange') {
          const [from, to] = (value ?? '').split('..');
          return (
            <Popover key={f.key} label={f.label} trigger={(p) => (
              <button {...p} type="button" className={cx('filter-chip', value && 'filter-chip--active')}>
                <CalendarRange size={16} strokeWidth={1.5} aria-hidden />{f.label}
                {value && <span className="filter-chip__value t-numeric">{formatDate(from)}{to ? ` to ${formatDate(to)}` : ''}</span>}
              </button>
            )}>
              {(close) => (
                <Calendar selected={from || null} rangeEnd={to || null} onSelect={(iso) => {
                  if (!from || to || iso < from) set(f.key, iso);
                  else { set(f.key, `${from}..${iso}`); close(); }
                }} />
              )}
            </Popover>
          );
        }
        const current = value ? value.split(',') : [];
        const names = f.options.filter((o) => current.includes(o.value)).map((o) => o.label);
        const chip = (p: object) => (
          <button {...p} type="button" className={cx('filter-chip', value && 'filter-chip--active')}>
            {f.label}{names.length > 0 && <span className="filter-chip__value">{names.length > 2 ? `${names.length} selected` : names.join(', ')}</span>}
            <ChevronDown size={16} strokeWidth={1.5} aria-hidden />
          </button>
        );
        if (f.type === 'select') {
          return <Menu key={f.key} label={f.label} trigger={chip} items={f.options.map((o) => ({ label: o.label, onSelect: () => set(f.key, o.value === value ? null : o.value) }))} />;
        }
        return (
          <Popover key={f.key} label={f.label} trigger={chip}>
            <div className="dt__picker">
              {f.options.map((o) => (
                <Checkbox key={o.value} label={o.label} checked={current.includes(o.value)} onChange={(e) => set(f.key, (e.target.checked ? [...current, o.value] : current.filter((v) => v !== o.value)).join(','))} />
              ))}
            </div>
          </Popover>
        );
      })}
      {active > 0 && (
        <>
          <span className="filters__count" role="status">{active} active</span>
          <Button size="dense" variant="ghost" icon={<X size={16} strokeWidth={1.5} aria-hidden />} onClick={clear}>Clear all</Button>
        </>
      )}
      <div className="filters__end">
        {savedViews && savedViews.length > 0 && (
          <Menu label="Saved views" placement="bottom-end" items={savedViews.map((v) => ({ label: v.name, onSelect: () => setParams(v.params, { replace: true }) }))} trigger={(p) => <Button {...p} size="dense" variant="ghost">Saved views</Button>} />
        )}
        {end}
      </div>
    </div>
  );
}
