import { Tooltip } from '../Tooltip';
import { formatDate, formatMonth, parseISO } from '../format';
import { markerOf, toneClass, toneOf, type Status } from '../status-colors';

export type GanttPhase = { name: string; start: string; end: string; status: Status };
export type GanttStripProps = { phases: GanttPhase[]; today?: string };

export function GanttStrip({ phases, today }: GanttStripProps) {
  const times = phases.flatMap((p) => [parseISO(p.start).getTime(), parseISO(p.end).getTime()]);
  const min = Math.min(...times);
  const span = Math.max(Math.max(...times) - min, 1);
  const at = (iso: string) => ((parseISO(iso).getTime() - min) / span) * 100;
  const months: { label: string; left: number }[] = [];
  const first = new Date(min);
  // Quarterly ticks stay legible at any width without overlapping.
  for (let d = new Date(first.getFullYear(), first.getMonth(), 1); d.getTime() <= min + span; d = new Date(d.getFullYear(), d.getMonth() + 3, 1)) {
    if (d.getTime() >= min) months.push({ label: formatMonth(d), left: ((d.getTime() - min) / span) * 100 });
  }
  const showToday = today && at(today) >= 0 && at(today) <= 100;
  return (
    <div className="gantt">
      <div className="gantt__axis" aria-hidden>
        <span />
        <div className="gantt__ticks">{months.filter((m) => m.left < 88).map((m) => <span key={m.label} style={{ left: `${m.left}%` }}>{m.label}</span>)}</div>
      </div>
      {phases.map((p) => {
        const left = at(p.start);
        const width = Math.max(at(p.end) - left, 1);
        return (
          <div key={p.name} className="gantt__row">
            <span className="gantt__name">{p.name}</span>
            <div className="gantt__track">
              <Tooltip text={`${p.name}: ${formatDate(p.start)} to ${formatDate(p.end)}, ${p.status}`}>
                <span
                  className={`gantt__bar gantt__bar--${markerOf(p.status)} ${toneClass(toneOf(p.status))}`} tabIndex={0} role="img"
                  aria-label={`${p.name}, ${formatDate(p.start)} to ${formatDate(p.end)}, ${p.status}`}
                  style={{ left: `${left}%`, width: `${width}%` }}
                />
              </Tooltip>
              {showToday && <span className="gantt__today" aria-hidden style={{ left: `${at(today!)}%` }} />}
            </div>
          </div>
        );
      })}
    </div>
  );
}
