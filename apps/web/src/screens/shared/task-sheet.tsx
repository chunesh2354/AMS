import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import { PROJECTS } from '../../mock/studio-meridian';
import { personName, type Task } from '../../api';
import { failureMessage, isLive } from '../../api/live';
import {
  addDependency, createSubtask, dependencyCandidates, estimateBar, followTask, getTask, listProjectTasks, logTaskTime, removeDependency, unfollowTask, updateTask,
  type DependencyDirection, type LiveTask, type LiveTaskDetail, type TaskFollower, type TaskLink,
} from '../../api/live/tasks';
import { todayIn } from '../../api/live/time';
import { useOverlays } from '../../app/overlays';
import { useSession } from '../../app/session';
import { Avatar } from '../../ui/Avatar';
import { Button } from '../../ui/Button';
import { Checkbox } from '../../ui/Checkbox';
import { DateField } from '../../ui/DateField';
import { IconButton } from '../../ui/IconButton';
import { InlineAlert } from '../../ui/InlineAlert';
import { NumberField } from '../../ui/NumberField';
import { PersonPicker } from '../../ui/PersonPicker';
import { Select } from '../../ui/Select';
import { Sheet } from '../../ui/Sheet';
import { StatusChip } from '../../ui/StatusChip';
import { TextField } from '../../ui/TextField';
import { Thread } from '../../ui/Thread';
import { useToast } from '../../ui/Toast';
import { cx } from '../../ui/cx';
import { formatDate, formatHours } from '../../ui/format';
import { PriorityDot, taskStatus } from './task-bits';
import './task-sheet.css';

/** The sample phase id for a mock task. Live mode never looks a project code up in the sample studio. */
const phaseId = (t: Task) => (isLive ? undefined : PROJECTS.find((p) => p.code === t.project)?.phases.find((x) => x.name === t.phase)?.id);

/** The 640 px task sheet from Project Tasks and My work. */
export function TaskSheet({ task, onClose, onSubmitReview }: { task: Task | null; onClose: () => void; onSubmitReview?: (t: Task) => void }) {
  const { openLogTime } = useOverlays();
  const toast = useToast();
  const [checks, setChecks] = useState<boolean[]>([]);
  const [replies, setReplies] = useState<Task['thread']>([]);
  const [following, setFollowing] = useState(false);
  useEffect(() => { setChecks(task?.checklist.map((c) => c.done) ?? []); setReplies([]); setFollowing(false); }, [task]);
  const owner = task ? personName(task.ownerId) : '';
  const reviewer = task ? personName(task.reviewerId) : '';
  const followers = task ? [...new Set([owner, reviewer].filter(Boolean)), ...(following ? ['You'] : [])] : [];
  const bar = task ? estimateBar(task.logged, task.estimate) : null;
  const doneCount = checks.filter(Boolean).length;
  return (
    <Sheet
      open={!!task} onClose={onClose} size={640} title={task?.title ?? 'Task'}
      description={task ? `${task.stage} · ${task.project} ${task.phase}` : undefined}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          {task?.stage !== 'In review' && <Button variant="primary" disabled={!!task?.blocked} onClick={() => { if (task) { onSubmitReview?.(task); toast({ variant: 'success', message: `${task.title} sent to ${reviewer} for review.` }); } onClose(); }}>Submit for review</Button>}
        </>
      )}
    >
      {task && (
        <div className="stack-4" style={{ gap: 'var(--s-6)' }}>
          {task.blocked && <InlineAlert variant="danger" title={`Blocked: ${task.blocked}`} />}
          <dl className="def-list">
            <dt>Status</dt><dd><StatusChip size="sm" status={taskStatus(task)} /></dd>
            <dt>Owner</dt><dd className="dt__person"><Avatar name={owner} size={20} />{owner}</dd>
            <dt>Reviewer</dt><dd className="dt__person"><Avatar name={reviewer} size={20} />{reviewer}</dd>
            <dt>Due</dt><dd className="t-numeric">{formatDate(task.due)}</dd>
            <dt>Priority</dt><dd><PriorityDot priority={task.priority} withLabel /></dd>
            <dt>Followers</dt>
            <dd className="tsk-follow">
              <FollowerAvatars names={followers} />
              <span className="t-caption ink-2">{followers.length} following</span>
              <Button size="dense" aria-pressed={following} onClick={() => setFollowing((f) => !f)}>{following ? 'Following' : 'Follow'}</Button>
            </dd>
          </dl>
          <section><h3 className="t-h3">Brief</h3><p className="t-body-sm">{task.brief}</p></section>
          <section className="stack-rows">
            <div className="tsk-sec__h"><h3 className="t-h3">Checklist</h3><span className="t-caption ink-2">{doneCount} of {task.checklist.length} done</span></div>
            <ul className="check-list">
              {task.checklist.map((c, i) => (
                <li key={c.label}><Checkbox label={c.label} checked={!!checks[i]} onChange={(e) => setChecks((l) => l.map((v, j) => (j === i ? e.target.checked : v)))} /></li>
              ))}
            </ul>
          </section>
          <section className="stack-rows">
            <h3 className="t-h3">Dependencies</h3>
            {task.dependencies.length
              ? <ul className="link-list">{task.dependencies.map((d) => <li key={d}>{d}</li>)}</ul>
              : <p className="t-body-sm ink-2">No dependencies.</p>}
          </section>
          <section className="stack-rows">
            <h3 className="t-h3">Documents</h3>
            {task.documents.length
              ? <ul className="link-list">{task.documents.map((d) => <li key={d.name}><span>{d.name}</span><span className="t-numeric ink-2">{d.version}</span></li>)}</ul>
              : <p className="t-body-sm ink-2">No documents linked.</p>}
          </section>
          <section className="stack-rows">
            <div className="tsk-sec__h"><h3 className="t-h3">Time logged</h3>{bar && <span className={cx('t-caption', bar.over ? 'tsk-red' : 'ink-2')}>{bar.note}</span>}</div>
            {bar && <HoursBar bar={bar} label={`${formatHours(task.logged)} logged of a ${formatHours(task.estimate)} estimate`} />}
            <div className="toolbar toolbar--between">
              <span className="t-body-sm"><span className="t-numeric">{formatHours(task.logged)}</span> of <span className="t-numeric">{formatHours(task.estimate)}</span> estimated</span>
              <Button size="dense" onClick={() => openLogTime({ phaseId: phaseId(task), taskId: task.id })}>Log time</Button>
            </div>
          </section>
          <section className="stack-rows">
            <h3 className="t-h3">Review thread</h3>
            <Thread
              label="Review thread" messages={[...task.thread, ...replies]}
              onReply={(text) => setReplies((r) => [...r, { id: `r${r.length}`, author: 'You', text, time: '14:30' }])}
            />
          </section>
        </div>
      )}
    </Sheet>
  );
}

// ---------- Shared bits ----------

function FollowerAvatars({ names }: { names: string[] }) {
  if (!names.length) return <span className="t-caption ink-3">Nobody yet</span>;
  return <span className="tsk-avs">{names.map((n) => <Avatar key={n} name={n} size={20} />)}</span>;
}

function HoursBar({ bar, label }: { bar: ReturnType<typeof estimateBar>; label: string }) {
  return (
    <div className="tsk-hb" role="img" aria-label={label}>
      <span className="tsk-hb__seg tsk-hb__log" style={{ width: `${bar.loggedPct}%` }} />
      {bar.overPct > 0 && bar.estimatePct != null && <span className="tsk-hb__seg tsk-hb__over" style={{ left: `${bar.estimatePct}%`, width: `${bar.overPct}%` }} />}
      {bar.estimatePct != null && <span className="tsk-hb__est" style={{ left: `${bar.estimatePct}%` }} />}
    </div>
  );
}

// ---------- Live: the round 2 parts of the task sheet ----------

const num = (s: string | null | undefined) => (s == null ? 0 : Number(s));
const fmtH = (h: number) => `${Number(h.toFixed(2))} h`;
/** A predecessor that is not done and past its due date holds its successors up: the one case drawn in redline. */
export const holdsUp = (t: { status: string; due_date: string | null }, today: string) => t.status !== 'Done' && !!t.due_date && t.due_date < today;

export type LiveTaskDetailSectionsProps = {
  /** The task as listed; the sections read GET /tasks/:id themselves and refresh after each change. */
  task: LiveTask;
  /** Team members a planner may add as followers (the sheet loads them for its assignee picker). */
  team?: { id: string; name: string; title?: string }[];
};

/**
 * Followers, hours against the estimate, log time on this task, sub-tasks, blocked by and blocks, and time on this
 * task. Each change is saved at once through its own endpoint, apart from the sheet's Save. Planners (can_edit) add
 * sub-tasks, dependencies and other followers; anyone who can see the task follows it and logs time on it.
 */
export function LiveTaskDetailSections({ task, team = [] }: LiveTaskDetailSectionsProps) {
  const { viewer } = useSession();
  const toast = useToast();
  const zone = viewer.firm?.timezone;
  const today = todayIn(zone);
  const me = viewer.personId ?? '';
  const [detail, setDetail] = useState<LiveTaskDetail | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [projectTasks, setProjectTasks] = useState<LiveTask[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [subTitle, setSubTitle] = useState('');
  const [subAssignee, setSubAssignee] = useState<string | null>(null);
  const [depDir, setDepDir] = useState<DependencyDirection>('blocked_by');
  const [depTask, setDepTask] = useState<string | null>(null);
  const [newFollower, setNewFollower] = useState<string | null>(null);
  const [log, setLog] = useState<{ hours: string; date: string | null; note: string; tried: boolean }>({ hours: '', date: today, note: '', tried: false });
  const [logged, setLogged] = useState<string | null>(null);

  const reload = (id = task.id) => getTask(id).then((d) => { setDetail(d); setState('ready'); }, () => setState((s) => (s === 'ready' ? s : 'error')));
  useEffect(() => {
    setDetail(null); setState('loading'); setErrors({}); setSubTitle(''); setSubAssignee(null); setDepTask(null); setNewFollower(null); setLogged(null);
    setLog({ hours: '', date: todayIn(zone), note: '', tried: false });
    let live = true;
    getTask(task.id).then((d) => { if (live) { setDetail(d); setState('ready'); } }, () => { if (live) setState('error'); });
    if (task.can_edit) listProjectTasks(task.project.code).then((r) => { if (live) setProjectTasks(r.tasks); }, () => {});
    return () => { live = false; };
  }, [task.id, task.can_edit, task.project.code, zone]);

  const candidates = useMemo(() => (detail ? dependencyCandidates(projectTasks, detail) : []), [projectTasks, detail]);

  if (state === 'loading' && !detail) return <p className="t-body-sm ink-2" role="status">Loading the details of this task.</p>;
  if (!detail) return <InlineAlert variant="danger" title="The details of this task could not be read."><Button size="dense" onClick={() => void reload()}>Try again</Button></InlineAlert>;

  const planner = !!detail.can_edit;
  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key); setErrors((e) => ({ ...e, [key]: null }));
    try { await fn(); } catch (e) { setErrors((x) => ({ ...x, [key]: failureMessage(e) })); } finally { setBusy(null); }
  };
  const setFollowers = (list: TaskFollower[]) => setDetail((d) => (d ? { ...d, followers: list, is_following: list.some((f) => f.id === me) } : d));
  const followers = detail.followers ?? [];
  const following = detail.is_following ?? followers.some((f) => f.id === me);
  const subtasks = detail.subtasks ?? [];
  const blockedBy = detail.blocked_by ?? [];
  const blocks = detail.blocks ?? [];
  const est = detail.estimate;
  const loggedH = num(est?.logged_hours ?? detail.logged_hours);
  const estimateH = est?.estimate_hours ?? detail.estimate_hours ?? null;
  const bar = estimateBar(loggedH, estimateH == null ? null : num(estimateH));
  const doneSubs = subtasks.filter((s) => s.status === 'Done').length;
  const late = holdsUp(detail, today);
  const followOptions = team.filter((p) => !followers.some((f) => f.id === p.id));
  const hours = Number(log.hours);
  const hoursError = !log.hours.trim() ? 'Enter the hours'
    : !Number.isFinite(hours) || hours <= 0 || hours > 24 ? 'Enter hours from 0.01 to 24'
      : Math.abs(hours * 100 - Math.round(hours * 100)) > 1e-6 ? 'Use at most two decimals' : undefined;

  const toggleFollow = () => run('follow', async () => setFollowers((following ? await unfollowTask(detail.id) : await followTask(detail.id)).followers));
  const addFollower = () => { if (newFollower) void run('follow', async () => { setFollowers((await followTask(detail.id, newFollower)).followers); setNewFollower(null); }); };
  const removeFollower = (f: TaskFollower) => run('follow', async () => setFollowers((await unfollowTask(detail.id, f.id === me ? undefined : f.id)).followers));
  const tick = (s: LiveTask, done: boolean) => run(`sub:${s.id}`, async () => {
    const saved = await updateTask(s.id, { status: done ? 'Done' : 'To do' });
    setDetail((d) => (d ? { ...d, subtasks: (d.subtasks ?? []).map((x) => (x.id === s.id ? { ...x, ...saved } : x)) } : d));
  });
  const addSub = (e: FormEvent) => {
    e.preventDefault();
    if (!subTitle.trim()) { setErrors((x) => ({ ...x, sub: 'Name the sub-task' })); return; }
    // The assignee of a sub-task ticks it off; without one only a planner can.
    void run('sub', async () => {
      await createSubtask(detail.id, { title: subTitle.trim(), ...(subAssignee ? { assignee_id: subAssignee } : {}) });
      setSubTitle(''); setSubAssignee(null);
      await reload(detail.id);
    });
  };
  const addDep = (e: FormEvent) => {
    e.preventDefault();
    if (!depTask) { setErrors((x) => ({ ...x, dep: 'Choose a task' })); return; }
    void run('dep', async () => { setDetail((await addDependency(detail.id, depDir, depTask)).task); setDepTask(null); });
  };
  const removeDep = (l: TaskLink) => run('dep', async () => setDetail((await removeDependency(detail.id, l.dependency_id)).task));
  const logTime = (e: FormEvent) => {
    e.preventDefault();
    if (hoursError || !log.date) { setLog((l) => ({ ...l, tried: true })); return; }
    const date = log.date;
    void run('log', async () => {
      await logTaskTime({ task_id: detail.id, service_date: date, duration_hours: hours, note: log.note.trim() || undefined });
      const msg = `${fmtH(hours)} logged on ${formatDate(date)}. It is on your timesheet as a draft.`;
      setLog({ hours: '', date, note: '', tried: false });
      setLogged(msg);
      toast({ variant: 'success', message: msg });
      await reload(detail.id);
    });
  };

  const linkRow = (l: TaskLink, kind: 'blocked_by' | 'blocks') => {
    // Redline only when the predecessor is overdue: for "blocked by" that is the other task, for "blocks" this one.
    const red = kind === 'blocked_by' ? holdsUp(l.task, today) : late && l.task.status !== 'Done';
    const caption = kind === 'blocked_by'
      ? (l.task.status === 'Done' ? 'Done' : red ? `Overdue since ${formatDate(l.task.due_date!)}, holds this task up` : `${l.task.status}${l.task.due_date ? `, due ${formatDate(l.task.due_date)}` : ''}`)
      : (detail.status === 'Done' ? 'Can start now' : red ? 'Held up until this task is done' : `${l.task.status}${l.task.start_date ? `, starts ${formatDate(l.task.start_date)}` : ''}`);
    const what = kind === 'blocked_by' ? 'blocked by' : 'blocks';
    return (
      <li key={l.dependency_id} className="tsk-dep">
        <span className={cx('marker', red ? 'marker--alert' : l.task.status === 'Done' ? 'marker--done' : 'marker--filled')} aria-hidden />
        <span className="tsk-dep__b">
          <span className="tsk-dep__n">{l.task.title}</span>
          <span className={cx('t-caption', red ? 'tsk-red' : 'ink-2')}>{caption}{l.lag_days ? `, ${l.lag_days > 0 ? '+' : ''}${l.lag_days} d lag` : ''}</span>
        </span>
        {planner && <IconButton dense label={`Remove ${what} ${l.task.title}`} icon={<X size={16} strokeWidth={1.5} />} disabled={busy === 'dep'} onClick={() => void removeDep(l)} />}
      </li>
    );
  };
  const id = (s: string) => `tsk-${s}-${detail.id}`;

  return (
    <div className="tsk-live">
      <section className="tsk-sec" aria-labelledby={id('people')}>
        <h3 id={id('people')} className="sr-only">Followers and dates</h3>
        <dl className="def-list">
          <dt>Followers</dt>
          <dd className="tsk-follow">
            <FollowerAvatars names={followers.map((f) => f.name)} />
            <span className="t-caption ink-2">{followers.length} following</span>
            <Button size="dense" aria-pressed={following} loading={busy === 'follow'} onClick={() => void toggleFollow()}>{following ? 'Following' : 'Follow'}</Button>
          </dd>
          <dt>Start</dt><dd className="t-numeric">{detail.start_date ? formatDate(detail.start_date) : 'Not set'}</dd>
          <dt>Due</dt>
          <dd className="t-numeric">{detail.due_date ? formatDate(detail.due_date) : 'Not set'}{late && <span className="t-caption tsk-red"> Past due</span>}</dd>
          <dt>Estimate</dt><dd className="t-numeric">{estimateH == null ? 'Not set' : fmtH(num(estimateH))}</dd>
        </dl>
        {planner && followers.length > 0 && (
          <ul className="tsk-chips" aria-label="Followers">
            {followers.map((f) => (
              <li key={f.id} className="tsk-chip">
                {f.name}
                <IconButton dense label={`Remove ${f.name} as a follower`} icon={<X size={14} strokeWidth={1.5} />} disabled={busy === 'follow'} onClick={() => void removeFollower(f)} />
              </li>
            ))}
          </ul>
        )}
        {planner && (
          <div className="tsk-inline">
            <PersonPicker label="Add a follower" people={followOptions} value={newFollower} onChange={setNewFollower} empty="Everyone on the team follows this task already." />
            <Button size="dense" disabled={!newFollower} loading={busy === 'follow'} onClick={addFollower}>Add follower</Button>
          </div>
        )}
        {errors.follow && <InlineAlert variant="danger" title={errors.follow} />}
      </section>

      <section className="tsk-sec" aria-labelledby={id('hours')}>
        <div className="tsk-sec__h"><h3 id={id('hours')} className="t-h3">Hours</h3><span className={cx('t-caption', bar.over ? 'tsk-red' : 'ink-2')}>{bar.note}</span></div>
        <HoursBar bar={bar} label={estimateH == null ? `${fmtH(loggedH)} logged, no estimate` : `${fmtH(loggedH)} logged of a ${fmtH(num(estimateH))} estimate`} />
        <p className="t-caption ink-2">{fmtH(loggedH)} logged{estimateH == null ? '; no estimate set.' : ` against a ${fmtH(num(estimateH))} estimate.`}</p>
      </section>

      <section className="tsk-sec" aria-labelledby={id('log')}>
        <h3 id={id('log')} className="t-h3">Log time on this task</h3>
        {!detail.phase
          ? <p className="t-body-sm ink-2">This task has no phase yet, so time cannot go on it. Ask the project manager to give it one.</p>
          : (
            <form className="tsk-form" onSubmit={logTime} aria-label="Log time on this task" noValidate>
              <div className="tsk-form__row">
                <NumberField label="Hours" value={log.hours} onChange={(e) => setLog((l) => ({ ...l, hours: e.target.value }))} error={log.tried ? hoursError : undefined} />
                <DateField label="Day" value={log.date} today={today} max={today} onChange={(d) => setLog((l) => ({ ...l, date: d }))} error={log.tried && !log.date ? 'Choose a day' : undefined} />
              </div>
              <TextField label="What you did" value={log.note} onChange={(e) => setLog((l) => ({ ...l, note: e.target.value }))} maxLength={2000} />
              <div className="toolbar toolbar--between">
                <span className="t-caption ink-2">Goes on your timesheet{log.date ? ` for ${formatDate(log.date)}` : ''}, on {detail.phase.code} {detail.phase.name}.</span>
                <Button type="submit" variant="primary" loading={busy === 'log'}>Log time</Button>
              </div>
              {logged && <p className="t-body-sm" role="status">{logged}</p>}
              {errors.log && <InlineAlert variant="danger" title={errors.log} />}
            </form>
          )}
      </section>

      <section className="tsk-sec" aria-labelledby={id('subs')}>
        <div className="tsk-sec__h"><h3 id={id('subs')} className="t-h3">Sub-tasks</h3><span className="t-caption ink-2">{subtasks.length ? `${doneSubs} of ${subtasks.length} done` : 'None yet'}</span></div>
        {subtasks.length > 0 && (
          <>
            <div className="tsk-hb" role="img" aria-label={`${doneSubs} of ${subtasks.length} sub-tasks done`}><span className="tsk-hb__seg tsk-hb__log" style={{ width: `${(doneSubs / subtasks.length) * 100}%` }} /></div>
            <ul className="tsk-chk" aria-label="Sub-tasks">
              {subtasks.map((s) => (
                <li key={s.id} className="tsk-chk__i">
                  <Checkbox
                    label={<span className={cx(s.status === 'Done' && 'tsk-chk__done')}>{s.title}</span>}
                    checked={s.status === 'Done'} disabled={!s.can_change_status || busy === `sub:${s.id}`}
                    onChange={(e) => void tick(s, e.target.checked)}
                  />
                  <span className="t-caption ink-2">{s.assignee?.name ?? 'Unassigned'}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        {Object.entries(errors).filter(([k, v]) => k.startsWith('sub:') && v).map(([k, v]) => <InlineAlert key={k} variant="danger" title={v ?? ''} />)}
        {planner && !detail.parent_task_id && (
          <form className="tsk-inline" onSubmit={addSub} aria-label="Add a sub-task" noValidate>
            <TextField label="New sub-task" value={subTitle} onChange={(e) => { setSubTitle(e.target.value); setErrors((x) => ({ ...x, sub: null })); }} maxLength={200} error={errors.sub ?? undefined} />
            {team.length > 0 && <PersonPicker label="Sub-task assignee" helper="Optional. They can tick it off." people={team} value={subAssignee} onChange={setSubAssignee} />}
            <Button type="submit" size="dense" loading={busy === 'sub'}>Add sub-task</Button>
          </form>
        )}
        {detail.parent_task_id && <p className="t-caption ink-2">This is a sub-task. Sub-tasks have no sub-tasks of their own.</p>}
      </section>

      <section className="tsk-sec" aria-labelledby={id('deps')}>
        <h3 id={id('deps')} className="t-h3">Blocked by</h3>
        {blockedBy.length ? <ul className="tsk-deps" aria-label="Blocked by">{blockedBy.map((l) => linkRow(l, 'blocked_by'))}</ul> : <p className="t-body-sm ink-2">Nothing. This task can start any time.</p>}
        <h3 className="t-h3">Blocks</h3>
        {blocks.length ? <ul className="tsk-deps" aria-label="Blocks">{blocks.map((l) => linkRow(l, 'blocks'))}</ul> : <p className="t-body-sm ink-2">No task waits for this one.</p>}
        {planner && (
          <form className="tsk-form" onSubmit={addDep} aria-label="Add a dependency" noValidate>
            <div className="tsk-form__row">
              <Select label="This task" options={[{ value: 'blocked_by', label: 'Is blocked by' }, { value: 'blocks', label: 'Blocks' }]} value={depDir} onChange={(v) => setDepDir(v as DependencyDirection)} />
              <Select label="Other task" searchable placeholder="Choose a task" options={candidates.map((t) => ({ value: t.id, label: t.title }))} value={depTask} onChange={(v) => { setDepTask(v); setErrors((x) => ({ ...x, dep: null })); }} />
            </div>
            <div className="toolbar toolbar--between">
              <span className="t-caption ink-2">Finish to start: the next task can begin once this one is done.</span>
              <Button type="submit" size="dense" loading={busy === 'dep'}>Add dependency</Button>
            </div>
          </form>
        )}
        {errors.dep && <InlineAlert variant="danger" title={errors.dep} />}
      </section>

      <section className="tsk-sec" aria-labelledby={id('time')}>
        <h3 id={id('time')} className="t-h3">Time on this task</h3>
        <dl className="def-list">
          <dt>Logged</dt><dd className="t-numeric">{fmtH(loggedH)}</dd>
          <dt>Approved</dt><dd className="t-numeric">{fmtH(num(detail.approved_hours))}</dd>
          {est && subtasks.length > 0 && <><dt>On sub-tasks</dt><dd className="t-numeric">{fmtH(num(est.subtasks.logged_hours))}{num(est.subtasks.estimate_hours) > 0 ? ` of ${fmtH(num(est.subtasks.estimate_hours))}` : ''}</dd></>}
          {est && subtasks.length > 0 && <><dt>Total</dt><dd className="t-numeric">{fmtH(num(est.total.logged_hours))}{est.total.estimate_hours != null ? ` of ${fmtH(num(est.total.estimate_hours))}` : ''}</dd></>}
        </dl>
        <p className="t-caption ink-2">Logged counts draft and submitted time; approved counts time an approver has passed.</p>
      </section>
    </div>
  );
}
