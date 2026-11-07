import { useState, type KeyboardEvent } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { IconButton } from '../IconButton';
import { formatDate, formatMonth, parseISO, toISO } from '../format';
import { cx } from '../cx';

export type CalendarProps = {
  selected?: string | null;
  rangeEnd?: string | null;
  min?: string;
  max?: string;
  holidays?: string[];
  today?: string;
  onSelect: (iso: string) => void;
};

const DOW = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

/** Month grid with arrow-key navigation. Week starts Monday. */
export function Calendar({ selected, rangeEnd, min, max, holidays = [], today, onSelect }: CalendarProps) {
  const start = parseISO(selected ?? today ?? toISO(new Date()));
  const [cursor, setCursor] = useState(toISO(start));
  const c = parseISO(cursor);
  const first = new Date(c.getFullYear(), c.getMonth(), 1);
  const lead = (first.getDay() + 6) % 7;
  const days = Array.from({ length: 42 }, (_, i) => toISO(new Date(c.getFullYear(), c.getMonth(), i - lead + 1)));
  const shift = (n: number) => { const d = parseISO(cursor); d.setDate(d.getDate() + n); setCursor(toISO(d)); };
  const month = (n: number) => { const d = parseISO(cursor); setCursor(toISO(new Date(d.getFullYear(), d.getMonth() + n, 1))); };
  const onKey = (e: KeyboardEvent) => {
    const map: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (e.key in map) {
      e.preventDefault();
      const next = parseISO(cursor);
      next.setDate(next.getDate() + map[e.key]);
      shift(map[e.key]);
      const iso = toISO(next);
      requestAnimationFrame(() => (e.target as HTMLElement).closest('.calendar')?.querySelector<HTMLElement>(`[data-day="${iso}"]`)?.focus());
    }
  };
  return (
    <div className="calendar">
      <div className="calendar__head">
        <IconButton dense label="Previous month" icon={<ChevronLeft size={16} strokeWidth={1.5} aria-hidden />} onClick={() => month(-1)} />
        <span className="t-h3" aria-live="polite">{formatMonth(c)}</span>
        <IconButton dense label="Next month" icon={<ChevronRight size={16} strokeWidth={1.5} aria-hidden />} onClick={() => month(1)} />
      </div>
      <div className="calendar__grid" onKeyDown={onKey}>
        {DOW.map((d) => <span key={d} className="calendar__dow" aria-hidden>{d}</span>)}
        {days.map((iso) => {
          const inMonth = parseISO(iso).getMonth() === c.getMonth();
          const isHoliday = holidays.includes(iso);
          const inRange = selected && rangeEnd && iso > selected && iso < rangeEnd;
          const isSel = iso === selected || iso === rangeEnd;
          return (
            <button
              key={iso} type="button" data-day={iso} tabIndex={iso === cursor ? 0 : -1}
              disabled={(min && iso < min) || (max && iso > max) || undefined}
              aria-label={`${formatDate(iso).replace(/^0/, '')}${isHoliday ? ', holiday' : ''}`}
              aria-pressed={isSel}
              className={cx('calendar__day', !inMonth && 'calendar__day--other', isHoliday && 'calendar__day--holiday', iso === today && 'calendar__day--today', inRange && 'calendar__day--range', isSel && 'calendar__day--selected')}
              onClick={() => onSelect(iso)}
            >
              {parseISO(iso).getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
