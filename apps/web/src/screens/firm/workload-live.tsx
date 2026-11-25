import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { X } from 'lucide-react';
import { addDays, dayMonth, dayMonthYear, fmtH, loadLevel, num, weekdayDate, type LoadLevel, type Week, type Workload } from '../../api/live/planning';
import { IconButton } from '../../ui/IconButton';
import { ListStateBlock } from '../../ui/ListState';
import { NotAvailablePage } from '../../ui/NotAvailable';
import { PageHeader } from '../../ui/PageHeader';
import { PeriodNav } from '../../ui/PeriodNav';
import { Segmented } from '../../ui/Segmented';
import { Select } from '../../ui/Select';
import { Skeleton } from '../../ui/Skeleton';
import { Button } from '../../ui/Button';
import { HeatmapLegend, WorkloadHeatmap, type HeatFoot, type HeatRow } from '../../ui/WorkloadHeatmap';
import { useWorkload, usePlanningOptions } from './workload-data';
import { LivePlanner, weekColumns } from './workload-planner';

export const WORKLOAD_DETAIL = 'Who is booked on which project, week by week, against their capacity.';
const SAY: Record<LoadLevel, string> = { free: 'free', part: 'part booked', full: 'full', over: 'over capacity', away: 'away all week' };
const pct = (b: number, c: number) => (c > 0 ? `${Math.round((b / c) * 100)}%` : b > 0 ? 'Over' : 'Away');

/** Days lost to leave and holidays, counted once, from the week's own hours. */
const daysOff = (w: Week) => {
  const scheduled = num(w.scheduled);
  if (scheduled <= 0) return 0;
  return Math.round(((scheduled - num(w.available)) / (scheduled / 5)) * 2) / 2;
};

function heatRows(data: Workload): { rows: HeatRow[]; foot: HeatFoot } {
  const rows = data.people.map((p) => {
    let tb = 0; let tc = 0;
    const cells = p.weeks.map((w) => {
      const b = num(w.allocated); const c = num(w.available); const lv = loadLevel(b, c);
      const scheduled = num(w.scheduled);
      const off = daysOff(w);
      tb += b; tc += c;
      return {
        text: fmtH(b), level: lv, off: scheduled > 0 ? Math.max(0, (scheduled - c) / scheduled) : 0,
        aria: `${p.person.name}, week of ${dayMonth(w.week_start)}: ${fmtH(b)} of ${fmtH(c)} hours, ${SAY[lv]}${off ? `, ${off} ${off === 1 ? 'day' : 'days'} off` : ''}`,
      };
    });
    return { id: p.person.id, name: p.person.name, sublabel: p.inactive ? 'Left the studio' : undefined, cells, total: `${fmtH(tb)} h`, avg: pct(tb, tc) };
  });
  let ab = 0; let ac = 0;
  const cells = data.weeks.map((ws) => {
    let b = 0; let c = 0;
    data.people.forEach((p) => { const w = p.weeks.find((x) => x.week_start === ws); if (w) { b += num(w.allocated); c += num(w.available); } });
    ab += b; ac += c;
    return { text: pct(b, c), over: c > 0 ? b > c : b > 0 };
  });
  return { rows, foot: { label: 'Studio load %', cells, total: pct(ab, ac), hours: `${fmtH(ab)} of ${fmtH(ac)} h` } };
}

function WeekDetail({ data, personId, column, onClose, onPlanner }: { data: Workload; personId: string; column: number; onClose: () => void; onPlanner: () => void }) {
  const p = data.people.find((x) => x.person.id === personId);
  const w = p?.weeks[column];
  if (!p || !w) return null;
  const b = num(w.allocated); const c = num(w.available); const lv = loadLevel(b, c);
  const scheduled = num(w.scheduled);
  const status = lv === 'over' ? `Over capacity by ${fmtH(b - c)} h`
    : lv === 'full' ? (Math.abs(b - c) < 0.01 ? 'Fully booked' : `Full, ${fmtH(c - b)} h left`)
      : lv === 'part' ? `Part booked, ${fmtH(c - b)} h free`
        : lv === 'away' ? 'Away all week' : `Free, ${fmtH(c - b)} h open`;
  const mk = lv === 'over' ? 'heat-mk--red' : lv === 'full' ? 'heat-mk--fill' : lv === 'part' ? 'heat-mk--grey' : 'heat-mk--line';
  const capNote = scheduled - c > 0.001
    ? `Available this week is ${fmtH(c)} h: ${fmtH(scheduled)} h scheduled less ${fmtH(scheduled - c)} h of leave and holidays.`
    : `Available is the ${fmtH(scheduled)} h scheduled week.`;
  const clip = (s: string, e: string) => {
    const from = s < w.week_start ? w.week_start : s;
    const to = e > w.week_end ? w.week_end : e;
    return from === to ? weekdayDate(from) : `${weekdayDate(from)} to ${weekdayDate(to)}`;
  };
  const offs = [
    ...w.holidays.map((h) => ({ what: h.name, when: `${weekdayDate(h.date)}, studio holiday${h.half_day ? ', half day' : ''}` })),
    ...w.leave.map((l) => ({ what: l.leave_type?.name ?? l.label, when: `${clip(l.start_date, l.end_date)}${l.half_day ? ', half day' : ''}${l.status === 'Pending' ? ', pending (not subtracted)' : ''}` })),
  ];
  const other = num(w.other_hours);
  return (
    <aside className="heat-panel" aria-label="Week detail">
      <div className="heat-panel__head">
        <div><h2 className="t-h3" style={{ margin: 0 }}>{p.person.name}</h2><p className="t-caption ink-2" style={{ margin: 0 }}>Week of {dayMonthYear(w.week_start)}</p></div>
        <IconButton dense label="Close week detail" icon={<X size={18} strokeWidth={1.5} aria-hidden />} onClick={onClose} />
      </div>
      <div className="heat-panel__sec">
        <div className="heat-panel__kpi"><span className="heat-panel__kpiv">{fmtH(b)}</span><span className="ink-2">of {fmtH(c)} h booked</span></div>
        <span className={lv === 'over' ? 'heat-panel__st heat-panel__st--over' : 'heat-panel__st'}><span className={`heat-mk ${mk}`} aria-hidden />{status}</span>
        <p className="t-caption ink-2" style={{ margin: 0 }}>{capNote}</p>
      </div>
      <div className="heat-panel__sec">
        <h3 className="t-body" style={{ margin: 0, fontWeight: 500 }}>Allocations</h3>
        {!w.allocations.length && !other && <p className="t-caption ink-2" style={{ margin: 0 }}>Nothing allocated this week.</p>}
        <ul className="heat-panel__list">
          {w.allocations.map((a) => (
            <li key={a.id} className="heat-alloc">
              <div className="heat-alloc__row"><span>{a.project.code} {a.project.name}</span><span className="heat-alloc__h">{fmtH(num(a.hours))} h</span></div>
              <span className="t-caption ink-2">{a.phase?.name ?? 'No phase'}</span>
              <div className="heat-alloc__meta">
                <span className="heat-panel__st" style={{ fontSize: 13 }}><span className={`heat-mk ${a.state === 'confirmed' ? 'heat-mk--fill' : 'heat-mk--line'}`} aria-hidden />{a.state === 'confirmed' ? 'Confirmed' : 'Tentative'}</span>
                {a.unpublished_change && <span className="ink-2">{a.published ? 'Edited, not yet published' : 'New, not yet published'}</span>}
                {a.on_hold && <span className="heat-panel__st heat-panel__st--over" style={{ fontSize: 13 }}><span className="heat-mk heat-mk--red" aria-hidden />Project on hold</span>}
              </div>
            </li>
          ))}
          {other > 0 && (
            <li className="heat-alloc">
              <div className="heat-alloc__row"><span>Other projects</span><span className="heat-alloc__h">{fmtH(other)} h</span></div>
              <span className="t-caption ink-2">{data.project ? `Outside ${data.project.code}, or on projects you cannot open.` : 'On projects you cannot open.'}</span>
            </li>
          )}
        </ul>
      </div>
      <div className="heat-panel__sec">
        <h3 className="t-body" style={{ margin: 0, fontWeight: 500 }}>Leave and holidays</h3>
        {!offs.length && <p className="t-caption ink-2" style={{ margin: 0 }}>None this week.</p>}
        {offs.map((o, i) => <div key={i} className="heat-off"><span>{o.what}</span><span className="heat-off__when">{o.when}</span></div>)}
      </div>
      <div className="heat-panel__sec" style={{ flexDirection: 'row' }}>
        <Button onClick={onPlanner}>Open in planner</Button>
      </div>
    </aside>
  );
}

/** Live /firm/workload: the heatmap (default) and the planner, both from GET /workload. */
export function LiveWorkloadScreen() {
  const [params, setParams] = useSearchParams();
  const view = params.get('view') === 'planner' ? 'planner' : 'heatmap';
  const from = params.get('from') ?? undefined;
  const project = params.get('project') || null;
  const sel = params.get('person') && params.get('week') ? { rowId: params.get('person')!, week: params.get('week')! } : null;
  const { data, state, message, reload } = useWorkload({ from, project });
  const { projects, people } = usePlanningOptions();

  const set = (patch: Record<string, string | null>) => setParams((p) => {
    const next = new URLSearchParams(p);
    Object.entries(patch).forEach(([k, v]) => { if (v == null || v === '') next.delete(k); else next.set(k, v); });
    return next;
  }, { replace: true });

  const heat = useMemo(() => (data ? heatRows(data) : null), [data]);
  if (state === 'missing') return <NotAvailablePage title="Workload" detail={WORKLOAD_DETAIL} />;

  const pending = data?.pending_changes ?? 0;
  const subtitle = view === 'planner'
    ? 'Plan who works on what, week by week.'
    : `Booked hours per person per week against their available hours. Counts confirmed and tentative work${pending ? `, including the ${pending} planner ${pending === 1 ? 'change' : 'changes'} not yet published` : ''}.`;
  const range = data ? `${dayMonthYear(data.from)} to ${dayMonthYear(data.to)}` : '';
  const shift = (n: number) => data && set({ from: addDays(data.from, n * 7) });
  const projectOptions = [{ value: '', label: 'All projects' }, ...projects.filter((p) => p.status !== 'Archived').map((p) => ({ value: p.code, label: `${p.code} ${p.name}${p.status === 'On hold' ? ', on hold' : ''}` }))];
  if (project && !projectOptions.some((o) => o.value === project)) projectOptions.push({ value: project, label: data?.project ? `${data.project.code} ${data.project.name}` : project });
  const column = sel && data ? data.weeks.indexOf(sel.week) : -1;

  return (
    <>
      <PageHeader title="Workload" subtitle={subtitle} />
      <div className="stack-4">
        <div className="wl-bar">
          <Segmented label="View" value={view} onChange={(v) => set({ view: v === 'planner' ? 'planner' : null })} options={[{ value: 'heatmap', label: 'Heatmap' }, { value: 'planner', label: 'Planner' }]} />
          <PeriodNav range={range} onPrev={() => shift(-1)} onNext={() => shift(1)} onToday={() => set({ from: null })} />
          <div className="wl-bar__filter"><Select label="Project" dense options={projectOptions} value={project ?? ''} onChange={(v) => set({ project: v || null, person: null, week: null })} /></div>
        </div>
        {state === 'denied' || state === 'error'
          ? <ListStateBlock state={state} label="The resource plan" errorMessage={message} onRetry={reload} capability="view the resource plan (capacity.manage)" />
          : !data
            ? <Skeleton kind={view === 'planner' ? 'planner' : 'table'} />
            : view === 'heatmap' && heat
              ? (
                <>
                  <HeatmapLegend />
                  {data.project && <p className="t-caption ink-2" style={{ margin: 0 }}>Showing the {data.project.code} {data.project.name} team and anyone allocated on it. Each cell still counts their whole week, so load stays honest.</p>}
                  {!data.people.length
                    ? <ListStateBlock state="empty" label="People" empty={{ message: 'Nobody to show for these weeks.' }} />
                    : (
                      <WorkloadHeatmap
                        label="Booked hours by person and week" columns={weekColumns(data).map((c) => ({ key: c.key, label: c.label, sub: c.note, today: c.today }))}
                        rows={heat.rows} foot={heat.foot}
                        selected={sel && column >= 0 ? { rowId: sel.rowId, column } : null}
                        onSelect={(rowId, c) => set({ person: rowId, week: data.weeks[c] })}
                        aside={sel && column >= 0 ? <WeekDetail data={data} personId={sel.rowId} column={column} onClose={() => set({ person: null, week: null })} onPlanner={() => set({ view: 'planner', person: null, week: null })} /> : null}
                      />
                    )}
                </>
              )
              : <LivePlanner data={data} reload={reload} projects={projects} people={people} />}
      </div>
    </>
  );
}

