import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { isLive } from '../../../api/live';
import { getStudioSchedule, hoursNum, mockStudioSchedule, type StudioSchedule, type StudioScheduleRow } from '../../../api/live/schedule';
import { useResource } from '../../../api/useResource';
import { useSession } from '../../../app/session';
import { ErrorState } from '../../../ui/ErrorState';
import { Segmented } from '../../../ui/Segmented';
import { Skeleton } from '../../../ui/Skeleton';
import { Gantt, GanttChip, GanttLegend, dayMonth, dayWord, monthYear, rangeText, shortRange, windowFor, addDays, type GanttRow, type Zoom } from '../../../ui/Gantt';

const ZOOMS: { value: Zoom; label: string }[] = [{ value: 'month', label: 'Month' }, { value: 'quarter', label: 'Quarter' }, { value: 'year', label: 'Year' }];
type StatusFilter = 'all' | 'active' | 'hold' | 'done';
const STATUS_PARAM: Record<StatusFilter, string[] | undefined> = { all: undefined, active: ['Active'], hold: ['On hold'], done: ['Delivery complete'] };
const STATUS_LABEL: Record<StatusFilter, string> = { all: 'All', active: 'Active', hold: 'On hold', done: 'Delivery complete' };
/** A billing milestone past Planned has been signed off (authorized, then drafted and invoiced). */
const reached = (status: string) => status !== 'Planned';
const closed = (status: string) => status === 'Complete' || status === 'Cancelled';
const overBy = (p: StudioScheduleRow['phases'][number]) => {
  const b = hoursNum(p.budget_hours); const f = hoursNum(p.forecast_hours);
  return b > 0 && f > b && !closed(p.status) ? Math.round((f - b) * 100) / 100 : 0;
};

/** Every project's phases on one timeline (GET /schedule). Read-only: a project's own Timeline tab moves dates. */
export function StudioTimelineView() {
  const { viewer } = useSession();
  const [zoom, setZoom] = useState<Zoom>('quarter');
  const [pm, setPm] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [pms, setPms] = useState<{ id: string; name: string }[]>([]);
  const { state, data, retry } = useResource<StudioSchedule>(async () => {
    if (isLive) return getStudioSchedule({ pm: pm || undefined, status: STATUS_PARAM[status] });
    const all = await mockStudioSchedule(viewer);
    const want = STATUS_PARAM[status];
    const rows = all.data.filter((r) => (!pm || r.project.pm.id === pm) && (!want || want.includes(r.project.status)));
    return { ...all, data: rows, total: rows.length };
  }, [pm, status, viewer.id]);

  // The PM chips come from an unfiltered load, so choosing one PM does not hide the others.
  useEffect(() => {
    if (!data || pm) return;
    setPms((cur) => {
      const m = new Map(cur.map((x) => [x.id, x.name]));
      for (const r of data.data) m.set(r.project.pm.id, r.project.pm.name);
      return [...m].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
    });
  }, [data, pm]);

  const today = data?.today ?? new Date().toISOString().slice(0, 10);
  const projects = data?.data ?? [];
  const starts = projects.map((p) => p.planned_start).filter((d): d is string => !!d).sort();
  const ends = projects.map((p) => p.planned_end).filter((d): d is string => !!d).sort();
  const window = windowFor(zoom, today, { start: starts[0] ?? null, end: ends.at(-1) ?? null });

  const rows: GanttRow[] = [];
  for (const p of projects) {
    const hold = p.project.status === 'On hold';
    const isOpen = !!open[p.project.code];
    const s = p.planned_start; const e = p.planned_end;
    const overs = p.phases.filter((ph) => overBy(ph) > 0 && ph.start_date && ph.end_date);
    const caption: GanttRow['caption'] = hold
      ? { text: `On hold${p.project.hold_reason ? `: ${p.project.hold_reason}` : ''}`, mark: 'grey' }
      : (p.slip_days ?? 0) > 0
        ? { text: `Forecast ${dayWord(p.slip_days!)} late${p.slip_driver ? ` (${p.slip_driver.name})` : ''}`, tone: 'red', mark: 'red' }
        : overs.length
          ? { text: `${overs[0].name} +${overBy(overs[0])} h`, tone: 'red', mark: 'red' }
          : p.overdue_tasks > 0
            ? { text: `${p.overdue_tasks === 1 ? '1 task' : `${p.overdue_tasks} tasks`} past due`, mark: 'line' }
            : { text: 'No slip, no tasks past due', mark: 'fill' };
    rows.push({
      id: `pr:${p.project.code}`, kind: 'group', depth: 0, label: `${p.project.code} ${p.project.name}`, href: `/firm/projects/${encodeURIComponent(p.project.code)}/timeline`,
      who: p.project.pm.name, caption, dates: s && e ? `${monthYear(s)} to ${monthYear(e)}` : 'No dates',
      bar: s && e ? { start: s, end: e } : null, progress: p.progress_pct, hold,
      outlines: hold ? [] : overs.map((ph) => ({ start: ph.start_date!, end: ph.end_date!, tag: `${ph.name} +${overBy(ph)} h` })),
      diamonds: p.milestones.filter((m) => m.date).map((m) => ({ date: m.date!, label: m.label, done: reached(m.status) })),
      expand: { open: isOpen, onToggle: () => setOpen((o) => ({ ...o, [p.project.code]: !isOpen })) },
      describe: `${p.project.code} ${p.project.name}, ${rangeText(s, e)}, ${p.progress_pct}% done, ${caption.text}`,
    });
    if (!isOpen) continue;
    for (const ph of [...p.phases].sort((a, b) => a.sort_order - b.sort_order)) {
      const over = overBy(ph);
      const done = ph.status === 'Complete' || ph.progress_pct >= 100;
      const paused = hold && !done;
      const cap: GanttRow['caption'] = over
        ? { text: `Forecast ${hoursNum(ph.forecast_hours)} of ${hoursNum(ph.budget_hours)} h, ${ph.progress_pct}% done`, tone: 'red', mark: 'red' }
        : paused ? { text: `Paused at ${ph.progress_pct}%`, mark: 'grey' }
          : done ? { text: 'Done', mark: 'fill' }
            : (ph.slip_days ?? 0) > 0 ? { text: `Forecast to end ${dayMonth(ph.forecast_end!)}, ${dayWord(ph.slip_days!)} late`, tone: 'red', mark: 'red' }
              : { text: ph.progress_pct ? `${ph.progress_pct}% done` : 'Not started', mark: 'line' };
      rows.push({
        id: `ph:${ph.id}`, kind: 'task', depth: 1, label: ph.name, caption: cap, dates: shortRange(ph.start_date, ph.end_date, today),
        bar: ph.start_date && ph.end_date ? { start: ph.start_date, end: ph.end_date } : null,
        progress: done ? 100 : ph.progress_pct, hold, late: !!over && !hold,
        describe: `${ph.name}, ${rangeText(ph.start_date, ph.end_date)}, ${cap.text}`,
      });
    }
  }

  // The single worst overrun among live projects.
  let crit: { p: StudioScheduleRow; ph: StudioScheduleRow['phases'][number]; over: number } | null = null;
  for (const p of projects) {
    if (p.project.status === 'On hold') continue;
    for (const ph of p.phases) { const o = overBy(ph); if (o > 0 && (!crit || o > crit.over)) crit = { p, ph, over: o }; }
  }
  const holds = projects.filter((p) => p.project.status === 'On hold').length;

  return (
    <div className="stack-rows" style={{ gap: 'var(--s-5)' }}>
      <div className="gantt-bar">
        <Segmented label="Zoom" options={ZOOMS} value={zoom} onChange={setZoom} />
        <span className="gantt-bar__range">{rangeText(window.start, addDays(window.end, -1))}</span>
        <div className="gantt-bar__end">
          <div className="gantt-filt" role="group" aria-label="Filter by project manager">
            <span className="gantt-filt__l">Project manager</span>
            <GanttChip pressed={!pm} onClick={() => setPm('')}>All</GanttChip>
            {pms.map((x) => <GanttChip key={x.id} pressed={pm === x.id} onClick={() => setPm(x.id)}>{x.name}</GanttChip>)}
          </div>
          <div className="gantt-filt" role="group" aria-label="Filter by status">
            <span className="gantt-filt__l">Status</span>
            {(Object.keys(STATUS_LABEL) as StatusFilter[]).map((k) => <GanttChip key={k} pressed={status === k} onClick={() => setStatus(k)}>{STATUS_LABEL[k]}</GanttChip>)}
          </div>
        </div>
      </div>

      {crit && (
        <div className="gantt-crit" role="group" aria-labelledby="gantt-crit-t">
          <div className="gantt-crit__txt">
            <p id="gantt-crit-t" className="gantt-crit__t"><span className="gchart__mk gchart__mk--red" aria-hidden />Critical overrun: {crit.p.project.code} {crit.p.project.name}, {crit.ph.name}</p>
            <p className="gantt-crit__b">
              Forecast {hoursNum(crit.ph.forecast_hours)} of {hoursNum(crit.ph.budget_hours)} h, {crit.over} h over budget with {crit.ph.progress_pct}% done
              {crit.ph.end_date ? `, due ${rangeText(crit.ph.end_date, crit.ph.end_date)}` : ''}.
              {crit.ph.overdue_tasks > 0 ? ` ${crit.ph.overdue_tasks === 1 ? '1 task' : `${crit.ph.overdue_tasks} tasks`} in this phase ${crit.ph.overdue_tasks === 1 ? 'is' : 'are'} past due.` : ''}
            </p>
          </div>
          <Link className="btn btn--secondary" to={`/firm/projects/${encodeURIComponent(crit.p.project.code)}/timeline`}>Open project timeline</Link>
        </div>
      )}

      <GanttLegend keys={['phase', 'late', 'hold', 'milestone', 'today']} />

      {state === 'loading' && !data ? <div className="solid-panel"><Skeleton kind="planner" rows={6} /></div>
        : state === 'error' ? <ErrorState message="The studio timeline could not be loaded." onRetry={retry} />
          : (
            <Gantt
              label="All projects on a timeline" variant="studio" rows={rows} zoom={zoom} window={window} today={today}
              columns={{ name: 'Project and phase', who: 'PM', dates: 'Dates' }}
              empty="No projects match these filters."
            />
          )}
      <p className="gantt-note">
        {projects.length === 1 ? '1 project' : `${projects.length} projects`} shown. Open a project to move its phases and tasks.
        {holds ? ` ${holds === 1 ? 'A project on hold is' : 'Projects on hold are'} greyed; booked hours still count on Workload.` : ''}
      </p>
    </div>
  );
}
