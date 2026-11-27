import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { isLive, ApiFailure } from '../../../api/live';
import {
  getProjectSchedule, hoursNum, mockProjectSchedule, putPhaseDates, putTaskDates,
  type MovedItem, type ProjectSchedule, type ScheduleTask, type Violation,
} from '../../../api/live/schedule';
import { useResource } from '../../../api/useResource';
import { useSession } from '../../../app/session';
import { Button } from '../../../ui/Button';
import { EmptyState } from '../../../ui/EmptyState';
import { ErrorState } from '../../../ui/ErrorState';
import { InlineAlert } from '../../../ui/InlineAlert';
import { Segmented } from '../../../ui/Segmented';
import { Skeleton } from '../../../ui/Skeleton';
import { Toggle } from '../../../ui/Toggle';
import { PhaseDatesSheet } from './phase-sheets';
import {
  Gantt, GanttChip, GanttLegend, GanttSelection, addDays, daysBetween, dayMonth, dayWord, earliestStart, moveWords, rangeText, shortRange, windowFor,
  type GanttLink, type GanttRow, type Range, type Zoom,
} from '../../../ui/Gantt';

type Dates = { start: string | null; end: string | null };
type Item =
  | { key: string; kind: 'phase'; id: string; name: string; dates: Dates }
  | { key: string; kind: 'task'; id: string; name: string; dates: Dates; task: ScheduleTask };

const ZOOMS: { value: Zoom; label: string }[] = [{ value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }, { value: 'quarter', label: 'Quarter' }];
/** A billing milestone past Planned has been signed off (authorized, then drafted and invoiced). */
const reached = (status: string) => status !== 'Planned';
const CAUSE: Record<MovedItem['cause'], string> = { requested: 'as you asked', phase_moved: 'moved with its phase', parent_moved: 'moved with its parent task', dependency: 'pushed later by a dependency' };

/** Whole-day dates of a task bar: a due-only task is a one-day bar on its due date. */
const taskRange = (d: Dates): Range | null => {
  const s = d.start ?? d.end; const e = d.end ?? d.start;
  return s && e ? { start: s, end: e } : null;
};

export function ProjectTimelineScreen() {
  const { id = '' } = useParams();
  const { viewer } = useSession();
  const { state, data, retry } = useResource<ProjectSchedule | null>(
    () => (isLive ? getProjectSchedule(id).catch((e) => { if (e instanceof ApiFailure && e.status === 404) return null; throw e; }) : mockProjectSchedule(id, viewer)),
    [id, viewer.id],
  );
  if (state === 'loading' && !data) return <div className="solid-panel"><Skeleton kind="planner" rows={6} /></div>;
  if (state === 'error') return <ErrorState message="The timeline could not be loaded." onRetry={retry} />;
  if (!data) return <div className="solid-panel"><EmptyState message="No project has that code." /></div>;
  return <TimelineView key={data.project.code} schedule={data} reload={retry} />;
}

function TimelineView({ schedule, reload }: { schedule: ProjectSchedule; reload: () => void }) {
  const today = schedule.today;
  const canEdit = schedule.can_reschedule;
  const [zoom, setZoom] = useState<Zoom>('week');
  const [showForecast, setShowForecast] = useState(true);
  const [open, setOpen] = useState<Record<string, boolean>>(() => Object.fromEntries(schedule.phases.map((p) => [p.id, p.status !== 'Complete' && p.status !== 'Cancelled'])));
  /** Mock mode keeps saved moves in the page. */
  const [local, setLocal] = useState<Record<string, Dates>>({});
  const [drafts, setDrafts] = useState<Record<string, Dates>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [cascade, setCascade] = useState(true);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [result, setResult] = useState<{ moved: MovedItem[]; violations: Violation[] } | null>(null);
  /** The undated phase whose "Set dates" sheet is open. */
  const [dating, setDating] = useState<{ id: string; name: string; start: string | null; end: string | null } | null>(null);

  const items = useMemo(() => {
    const m = new Map<string, Item>();
    for (const p of schedule.phases) m.set(`p:${p.id}`, { key: `p:${p.id}`, kind: 'phase', id: p.id, name: p.name, dates: { start: p.start_date, end: p.end_date } });
    for (const t of schedule.tasks) m.set(`t:${t.id}`, { key: `t:${t.id}`, kind: 'task', id: t.id, name: t.title, dates: { start: t.start_date, end: t.due_date }, task: t });
    return m;
  }, [schedule]);
  const savedOf = (key: string): Dates => local[key] ?? items.get(key)!.dates;
  const curOf = (key: string): Dates => drafts[key] ?? savedOf(key);
  const taskById = new Map(schedule.tasks.map((t) => [t.id, t]));
  const open_ = (t: ScheduleTask) => t.status !== 'Done';
  const overdue = (t: ScheduleTask) => { const c = curOf(`t:${t.id}`); return open_(t) && !!c.end && c.end < today; };
  const finishOf = (t: ScheduleTask) => { const c = curOf(`t:${t.id}`); return overdue(t) ? today : c.end; };
  const preds = (t: ScheduleTask) => t.dependencies.map((d) => ({ dep: d, task: taskById.get(d.predecessor_id) })).filter((x): x is { dep: typeof x.dep; task: ScheduleTask } => !!x.task);
  const serverViolation = new Set((result?.violations ?? []).map((v) => `${v.predecessor_id}>${v.successor_id}`));
  /** Finish-to-start + lag broken with the dates on screen (graph.ts violations), or the predecessor is overdue. */
  const broken = (p: ScheduleTask, s: ScheduleTask, lag: number) => {
    const pe = finishOf(p); const sc = curOf(`t:${s.id}`); const anchor = sc.start ?? sc.end;
    return !!pe && !!anchor && open_(s) && anchor < earliestStart(pe, lag);
  };
  const blockers = (t: ScheduleTask) => (open_(t) ? preds(t).filter((x) => overdue(x.task)).map((x) => x.task) : []);

  const window = windowFor(zoom, today, { start: schedule.planned_start, end: schedule.planned_end });

  // ---- Rows ----
  const rows: GanttRow[] = [];
  const editPhase = canEdit ? { move: true, start: true, end: true } : null;
  const editTask = (t: ScheduleTask, d: Dates) => (!canEdit || !open_(t) ? null : d.start && d.end ? { move: true, start: true, end: true } : d.start || d.end ? { move: true, start: false, end: false } : null);

  const taskRow = (t: ScheduleTask, depth: 1 | 2) => {
    const key = `t:${t.id}`; const c = curOf(key); const sv = savedOf(key);
    const bar = taskRange(c);
    const late = overdue(t); const b = blockers(t);
    const who = t.assignee?.name ?? null;
    let caption: GanttRow['caption'];
    if (late) caption = { text: `${dayWord(daysBetween(c.end!, today))} past due`, tone: 'red' };
    else if (b.length) caption = { text: `Waiting on ${b[0].title}, ${dayWord(daysBetween(curOf(`t:${b[0].id}`).end!, today))} late`, tone: 'red' };
    else if (drafts[key]) caption = { text: 'Moved, not saved' };
    else if (t.forecast_end && t.due_date && t.forecast_end > t.due_date) caption = { text: `Forecast to end ${dayMonth(t.forecast_end)}` };
    const state = t.status === 'Done' ? 'done' : t.progress_pct ? `${t.progress_pct}% done` : t.status === 'Blocked' ? 'blocked' : 'not started';
    rows.push({
      id: key, kind: 'task', depth, label: t.title, who, caption,
      dates: shortRange(c.start, c.end, today), done: t.status === 'Done' ? 'Done' : `${t.progress_pct}%`,
      bar, saved: taskRange(sv), forecast: showForecast && t.forecast_start && t.forecast_end && !drafts[key] ? { start: t.forecast_start, end: t.forecast_end } : null,
      lateTo: late ? today : null, progress: t.progress_pct, late: late || b.length > 0,
      editable: editTask(t, c),
      describe: `${t.title}${who ? `, ${who}` : ''}, ${rangeText(c.start, c.end)}, ${state}${caption ? `, ${caption.text}` : ''}`,
    });
    for (const sub of schedule.tasks.filter((x) => x.parent_task_id === t.id)) if (depth === 1) taskRow(sub, 2);
  };

  const phaseIds = new Set(schedule.phases.map((p) => p.id));
  const groups = [...schedule.phases].sort((a, b) => a.sort_order - b.sort_order).map((p) => ({ id: p.id, phase: p }));
  const loose = schedule.tasks.filter((t) => !t.phase_id || !phaseIds.has(t.phase_id));
  const looseMs = schedule.milestones.filter((m) => !m.phase_id || !phaseIds.has(m.phase_id));

  const milestoneRows = (phaseId: string | null) => {
    for (const m of schedule.milestones.filter((x) => (phaseId ? x.phase_id === phaseId : looseMs.includes(x)))) {
      if (!m.date) continue;
      const isReached = reached(m.status);
      const missed = !isReached && m.date < today;
      rows.push({
        id: `m:${m.id}`, kind: 'milestone', depth: 1, label: m.label, dates: shortRange(m.date, m.date, today), done: isReached ? 'Done' : '',
        caption: missed ? { text: 'Missed', tone: 'red' } : m.date_source === 'phase_end' ? { text: 'On the phase end date' } : undefined,
        bar: { start: m.date, end: m.date }, milestoneDone: isReached, late: missed,
        describe: `${m.label}, milestone, ${rangeText(m.date, m.date)}, ${isReached ? 'reached' : missed ? 'missed' : 'not reached'}`,
      });
    }
  };

  for (const { phase: p } of groups) {
    const key = `p:${p.id}`; const c = curOf(key); const sv = savedOf(key);
    const isOpen = !!open[p.id];
    const over = hoursNum(p.budget_hours) > 0 && hoursNum(p.forecast_hours) > hoursNum(p.budget_hours);
    const slip = (p.slip_days ?? 0) > 0 && !drafts[key];
    let caption: GanttRow['caption'];
    if (over) caption = { text: `Forecast ${hoursNum(p.forecast_hours)} of ${hoursNum(p.budget_hours)} h, ${Math.round((hoursNum(p.forecast_hours) - hoursNum(p.budget_hours)) * 100) / 100} h over`, tone: 'red' };
    else if (slip) caption = { text: `Forecast to end ${dayMonth(p.forecast_end!)}, ${dayWord(p.slip_days!)} late`, tone: 'red' };
    else if (drafts[key]) caption = { text: 'Moved, not saved' };
    const done = p.status === 'Complete';
    rows.push({
      id: key, kind: 'group', depth: 0, label: p.name, who: p.owner?.name ?? null, caption,
      dates: shortRange(c.start, c.end, today), done: done ? 'Done' : `${p.progress_pct}%`,
      bar: c.start && c.end ? { start: c.start, end: c.end } : null,
      saved: sv.start && sv.end ? { start: sv.start, end: sv.end } : null,
      forecast: showForecast && c.start && p.forecast_end && !drafts[key] ? { start: c.start, end: p.forecast_end } : null,
      progress: done ? 100 : p.progress_pct, late: over || slip,
      editable: c.start && c.end ? editPhase : null,
      // A phase with no dates has no bar to drag: it gets a button that opens the dates sheet instead.
      action: canEdit && isLive && !(c.start && c.end)
        ? <Button variant="secondary" size="dense" onClick={() => setDating({ id: p.id, name: p.name, start: c.start, end: c.end })} aria-label={`Set dates for ${p.name}`}>Set dates</Button>
        : undefined,
      expand: { open: isOpen, onToggle: () => setOpen((o) => ({ ...o, [p.id]: !isOpen })) },
      describe: `${p.name}, phase${p.owner ? `, ${p.owner.name}` : ''}, ${rangeText(c.start, c.end)}, ${done ? 'done' : `${p.progress_pct}% done`}${caption ? `, ${caption.text}` : ''}`,
    });
    if (isOpen) {
      for (const t of schedule.tasks.filter((x) => x.phase_id === p.id && !x.parent_task_id)) taskRow(t, 1);
      for (const t of schedule.tasks.filter((x) => x.phase_id === p.id && x.parent_task_id && !taskById.get(x.parent_task_id))) taskRow(t, 1);
      milestoneRows(p.id);
    }
  }
  if (loose.length || looseMs.some((m) => m.date)) {
    const isOpen = open[''] ?? true;
    rows.push({
      id: 'p:', kind: 'group', depth: 0, label: 'Not in a phase', dates: '', describe: 'Tasks not in a phase',
      expand: { open: isOpen, onToggle: () => setOpen((o) => ({ ...o, '': !isOpen })) },
    });
    if (isOpen) {
      for (const t of loose.filter((x) => !x.parent_task_id || !taskById.get(x.parent_task_id))) taskRow(t, 1);
      milestoneRows(null);
    }
  }

  const links: GanttLink[] = schedule.dependencies.map((d) => {
    const p = taskById.get(d.predecessor_id); const s = taskById.get(d.successor_id);
    const red = !!p && !!s && (overdue(p) || broken(p, s, d.lag_days) || serverViolation.has(`${d.predecessor_id}>${d.successor_id}`));
    return { id: d.id, from: `t:${d.predecessor_id}`, to: `t:${d.successor_id}`, red };
  });

  // ---- Drafts ----
  const edit = (key: string, r: Range) => {
    const it = items.get(key);
    if (!it) return;
    const sv = savedOf(key);
    let next: Dates = { start: r.start, end: r.end };
    if (it.kind === 'task' && (!sv.start || !sv.end)) next = sv.start ? { start: r.start, end: null } : { start: null, end: r.end };
    setDrafts((d) => {
      const o = { ...d };
      if (next.start === sv.start && next.end === sv.end) delete o[key]; else o[key] = next;
      return o;
    });
    setSelected(key);
    setResult(null);
    setFailure(null);
  };

  const pending = Object.keys(drafts);
  const primary = pending.includes(selected ?? '') ? selected! : pending[0];
  const warnings: string[] = [];
  let chgTitle = ''; let chgBody = '';
  if (primary) {
    const it = items.get(primary)!; const sv = savedOf(primary); const c = curOf(primary);
    const ds = sv.start && c.start ? daysBetween(sv.start, c.start) : sv.end && c.end ? daysBetween(sv.end, c.end) : 0;
    const de = sv.end && c.end ? daysBetween(sv.end, c.end) : ds;
    chgTitle = `${ds === de ? `Moved: ${dayWord(Math.abs(ds))} ${ds > 0 ? 'later' : 'earlier'}.` : `Changed: ${moveWords(ds, de)}.`} Not saved yet.`;
    const others = pending.length - 1;
    chgBody = `${it.name} now runs ${rangeText(c.start, c.end)} (was ${rangeText(sv.start, sv.end)}).${others ? ` ${others} other ${others === 1 ? 'item has' : 'items have'} unsaved changes too.` : ''} Nobody else sees this until you save.`;
    for (const key of pending) {
      const p = items.get(key)!;
      if (p.kind !== 'task') continue;
      const t = p.task;
      for (const x of preds(t)) if (broken(x.task, t, x.dep.lag_days)) warnings.push(`${t.title} starts before ${x.task.title} is finished (${overdue(x.task) ? `still open, ${dayWord(daysBetween(curOf(`t:${x.task.id}`).end!, today))} late` : `ends ${dayMonth(finishOf(x.task)!)}`}).`);
      for (const s of schedule.tasks.filter((y) => y.dependencies.some((d) => d.predecessor_id === t.id))) {
        const dep = s.dependencies.find((d) => d.predecessor_id === t.id)!;
        if (broken(t, s, dep.lag_days)) warnings.push(`${s.title} starts ${dayMonth((curOf(`t:${s.id}`).start ?? curOf(`t:${s.id}`).end)!)}, before ${t.title} finishes.${cascade ? ' It moves later when you save.' : ''}`);
      }
      const ph = t.phase_id ? curOf(`p:${t.phase_id}`) : null;
      if (ph?.end && p.dates && curOf(key).end && curOf(key).end! > ph.end) warnings.push(`${t.title} now ends after its phase (${dayMonth(ph.end)}).`);
    }
  }

  const undo = () => { setDrafts({}); setFailure(null); };

  const save = async () => {
    setSaving(true); setFailure(null);
    const order = [...pending].sort((a, b) => (a.startsWith('p:') === b.startsWith('p:') ? 0 : a.startsWith('p:') ? -1 : 1));
    const moved: MovedItem[] = []; const violations: Violation[] = [];
    const left = { ...drafts };
    try {
      for (const key of order) {
        const it = items.get(key)!; const d = drafts[key]; const sv = savedOf(key);
        if (!isLive) {
          moved.push({ kind: it.kind, id: it.id, label: it.name, cause: 'requested', previous: { start_date: sv.start, end_date: sv.end }, next: { start_date: d.start, end_date: d.end }, shifted_days: null, audit_event_id: '' });
        } else if (it.kind === 'phase') {
          const r = await putPhaseDates(it.id, { start_date: d.start, end_date: d.end, cascade });
          moved.push(...r.moved); violations.push(...r.violations);
        } else {
          const body: { start_date?: string | null; due_date: string | null; cascade: boolean } = { due_date: d.end, cascade };
          if (sv.start) body.start_date = d.start;
          const r = await putTaskDates(it.id, body);
          moved.push(...r.moved); violations.push(...r.violations);
        }
        delete left[key];
      }
    } catch (e) {
      setFailure(e instanceof ApiFailure ? e.message : 'The new dates could not be saved. Try again.');
    }
    setSaving(false);
    setDrafts(left);
    if (!isLive) setLocal((l) => ({ ...l, ...Object.fromEntries(order.filter((k) => !left[k]).map((k) => [k, drafts[k]])) }));
    const unique = [...new Map(moved.map((m) => [`${m.kind}:${m.id}`, m])).values()];
    if (unique.length || violations.length) setResult({ moved: unique, violations });
    if (isLive && order.some((k) => !left[k])) reload();
  };

  const selRow = selected ? rows.find((r) => r.id === selected) : undefined;
  const nameOfTask = (tid: string) => taskById.get(tid)?.title ?? 'A task';
  const lateCount = schedule.tasks.filter(overdue).length;
  const waiting = schedule.tasks.filter((t) => blockers(t).length).length;

  return (
    <div className="stack-rows" style={{ gap: 'var(--s-5)' }}>
      <div>
        <div className="gantt-bar">
          <Segmented label="Zoom" options={ZOOMS} value={zoom} onChange={setZoom} />
          <span className="gantt-bar__range" aria-live="polite">{rangeText(window.start, addDays(window.end, -1))}</span>
          <div className="gantt-bar__end">
            <GanttChip pressed={showForecast} onClick={() => setShowForecast((v) => !v)}>Show forecast dates</GanttChip>
            <Button variant="ghost" onClick={() => setOpen(Object.fromEntries([...schedule.phases.map((p) => [p.id, true]), ['', true]]))}>Expand all</Button>
            <Button variant="ghost" onClick={() => setOpen(Object.fromEntries([...schedule.phases.map((p) => [p.id, false]), ['', false]]))}>Collapse all</Button>
          </div>
        </div>
        {canEdit && selRow && <GanttSelection row={selRow} onEdit={edit} note={selRow.kind === 'group' && cascade ? 'Moving a phase moves its open tasks too when you save.' : undefined} />}
      </div>

      {!canEdit && (
        <p className="gantt-note">
          {schedule.project.status === 'Archived'
            ? 'This project is archived. Restore it to change its dates.'
            : 'You can see this timeline. Only the project’s PM, a project lead or the principal can change its dates.'}
        </p>
      )}

      {pending.length > 0 && (
        <div className="gantt-chg" role="region" aria-label="Unsaved changes">
          <div className="gantt-chg__txt" role="status">
            <p className="gantt-chg__t">{chgTitle}</p>
            <p className="gantt-chg__b">{chgBody}</p>
            {warnings.map((w) => <p key={w} className="gantt-chg__w"><span className="gchart__mk gchart__mk--red" aria-hidden />{w}</p>)}
          </div>
          <div className="gantt-chg__act">
            <Toggle label="Move dependent tasks too" checked={cascade} onChange={(e) => setCascade(e.target.checked)} />
            <Button variant="secondary" onClick={undo} disabled={saving}>Undo</Button>
            <Button variant="primary" onClick={save} loading={saving}>Save</Button>
          </div>
        </div>
      )}
      {failure && <InlineAlert variant="danger" title="Not saved">{failure}</InlineAlert>}
      {result && (
        <div role="status" className="stack-rows" style={{ gap: 'var(--s-1)' }}>
          <p className="gantt-note gantt-note--done">Saved. {result.moved.length === 1 ? '1 item moved' : `${result.moved.length} items moved`}. Assignees and followers are told.</p>
          {result.moved.length > 0 && (
            <ul className="gantt-moved" aria-label="Moved items">
              {result.moved.map((m) => <li key={`${m.kind}${m.id}`}>{m.label}: {rangeText(m.next.start_date, m.next.end_date)} (was {rangeText(m.previous.start_date, m.previous.end_date)}), {CAUSE[m.cause]}{m.shifted_days ? `, ${dayWord(m.shifted_days)}` : ''}.</li>)}
            </ul>
          )}
          {result.violations.map((v) => (
            <p key={`${v.predecessor_id}>${v.successor_id}`} className="gantt-chg__w"><span className="gchart__mk gchart__mk--red" aria-hidden />{nameOfTask(v.successor_id)} starts before {nameOfTask(v.predecessor_id)} finishes. It can start {rangeText(v.earliest_start, v.earliest_start)} at the earliest.</p>
          ))}
        </div>
      )}

      <GanttLegend keys={['phase', 'task', 'forecast', 'milestone', 'dep', 'late', 'today']} />

      <Gantt
        label={`${schedule.project.name} phases and tasks on a timeline`}
        rows={rows} links={links} zoom={zoom} window={window} today={today}
        columns={{ name: 'Phase and task', who: 'Who', dates: 'Dates', done: 'Done' }}
        selectedId={selected} onSelect={canEdit ? setSelected : undefined} onEdit={canEdit ? edit : undefined}
        empty="This project has no phases or tasks with dates yet."
      />
      <PhaseDatesSheet phase={dating} today={today} onClose={() => setDating(null)} onSaved={reload} />
      <div className="stack-rows" style={{ gap: 'var(--s-2)' }}>
        <p className="gantt-note">Bars show the planned dates. A thin line under a bar is the forecast when it differs. A line joins a task to the one that can only start once it finishes; it turns red when that order is broken or the first task is past due.</p>
        <p className="gantt-note">{lateCount === 1 ? '1 task past due' : `${lateCount} tasks past due`} and {waiting} waiting on them.{schedule.slip_driver && (schedule.slip_days ?? 0) > 0 ? ` Forecast to finish ${dayWord(schedule.slip_days!)} late (${schedule.slip_driver.name}).` : ''}</p>
      </div>
    </div>
  );
}

