import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '../Button';
import { IconButton } from '../IconButton';

export type PeriodNavProps = { range: string; todayLabel?: string; onPrev: () => void; onNext: () => void; onToday: () => void; unit?: string };

/** Added for planner and timesheet headers: previous, this period, next, with the visible range in mono. */
export function PeriodNav({ range, todayLabel = 'This week', onPrev, onNext, onToday, unit = 'week' }: PeriodNavProps) {
  return (
    <div className="period" role="group" aria-label="Period">
      <IconButton dense label={`Previous ${unit}`} icon={<ChevronLeft size={16} strokeWidth={1.5} aria-hidden />} onClick={onPrev} />
      <Button size="dense" variant="ghost" onClick={onToday}>{todayLabel}</Button>
      <IconButton dense label={`Next ${unit}`} icon={<ChevronRight size={16} strokeWidth={1.5} aria-hidden />} onClick={onNext} />
      <span className="t-numeric ink-2 period__range">{range}</span>
    </div>
  );
}
