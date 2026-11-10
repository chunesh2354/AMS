import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { failureMessage } from '../../../api/live';
import { listDirectory, type DirectoryPerson } from '../../../api/live/setup';
import { isForbidden, listProjectMembers, type ProjectMember } from '../../../api/live/project-tabs';
import {
  NO_PHASE, TASK_PRIORITIES, TASK_STATUSES, createTask, deleteTask, getTask, getTaskPhases, listProjectTasks, needsTeam, phaseLabel, statusChip, updateTask,
  type LiveTask, type LiveTaskDetail, type TaskInput, type TaskPriority, type TaskStatus,
} from '../../../api/live/tasks';
import { Avatar } from '../../../ui/Avatar';
import { Button } from '../../../ui/Button';
import { Checkbox } from '../../../ui/Checkbox';
import { DataTable, type Column } from '../../../ui/DataTable';
import { DateField } from '../../../ui/DateField';
import { Form, FormSection } from '../../../ui/Form';
import { InlineAlert } from '../../../ui/InlineAlert';
import { KanbanBoard } from '../../../ui/KanbanBoard';
import { ListStateBlock } from '../../../ui/ListState';
import { PersonPicker } from '../../../ui/PersonPicker';
import { Segmented } from '../../../ui/Segmented';
import { Select } from '../../../ui/Select';
import { Sheet } from '../../../ui/Sheet';
import { StatusChip } from '../../../ui/StatusChip';
import { TextArea } from '../../../ui/TextArea';
import { TextField } from '../../../ui/TextField';
import { useToast } from '../../../ui/Toast';
import { formatDate } from '../../../ui/format';
import { ProjectTeamPanel } from './staffing';

const STATUS_OPTIONS = TASK_STATUSES.map((s) => ({ value: s, label: s }));
const PRIORITY_OPTIONS = TASK_PRIORITIES.map((p) => ({ value: p, label: p }));

export function TaskStatusChip({ status }: { status: TaskStatus }) {
  const c = statusChip(status);
  return <StatusChip size="sm" status={c.status} label={c.label} />;
}

function TaskCard({ task }: { task: LiveTask }) {
  return (
    <>
      <span className="bcard__title">{task.title}</span>
      <span className="t-caption ink-2">{phaseLabel(task)}</span>
      <span className="bcard__meta">
        <span className="prio t-caption ink-2" role="img" aria-label={`${task.priority} priority`}>{task.priority}</span>
        {task.due_date && <span className="t-numeric ink-2">{formatDate(task.due_date)}</span>}
        {task.assignee ? <Avatar name={task.assignee.name} size={20} /> : <span className="t-caption ink-3">Unassigned</span>}
      </span>
    </>
  );
}

/**
 * The project Tasks tab in live mode, from GET /projects/:code/tasks. Planners (principal, operations, the PM or a
 * lead) add, edit, assign and delete; the assignee moves the status and adds notes. The team panel sits under the
 * tasks, so a PM can add someone without leaving the project.
 */
export function LiveProjectTasksScreen() {
  const { id: code = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const [tasks, setTasks] = useState<LiveTask[]>([]);
  const [canPlan, setCanPlan] = useState(false);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'denied'>('loading');
  const [attempt, setAttempt] = useState(0);
  const [editing, setEditing] = useState<LiveTask | 'new' | null>(null);
  const [teamVersion, setTeamVersion] = useState(0);
  const view = params.get('view') === 'list' ? 'list' : 'board';
  const group = params.get('group') === 'phase' ? 'phase' : 'status';

  useEffect(() => {
    let live = true;
    setState('loading');
    listProjectTasks(code).then(
      (r) => { if (live) { setTasks(r.tasks); setCanPlan(r.canPlan); setState('ready'); } },
      (e: unknown) => { if (live) setState(isForbidden(e) ? 'denied' : 'error'); },
    );
    return () => { live = false; };
  }, [code, attempt]);

  const replace = useCallback((t: LiveTask) => setTasks((all) => (all.some((x) => x.id === t.id) ? all.map((x) => (x.id === t.id ? t : x)) : [...all, t])), []);
  const changeStatus = async (t: LiveTask, to: string) => {
    if (to === t.status) return;
    if (!t.can_change_status) { toast({ variant: 'danger', message: 'Only the assignee or a planner of this project can move this task.' }); return; }
    try {
      replace(await updateTask(t.id, { status: to as TaskStatus }));
      toast({ variant: 'info', message: `${t.title} moved to ${to}.` });
    } catch (e) {
      toast({ variant: 'danger', message: failureMessage(e) });
    }
  };
  const setParam = (key: string, value: string, fallback: string) => setParams((prev) => {
    const n = new URLSearchParams(prev);
    if (value === fallback) n.delete(key); else n.set(key, value);
    return n;
  }, { replace: true });

  const blocked = tasks.filter((t) => t.status === 'Blocked').length;
  const addButton = canPlan ? <Button variant="primary" onClick={() => setEditing('new')}>New task</Button> : undefined;
  const columns: Column<LiveTask>[] = [
    { key: 'title', header: 'Task', value: (t) => t.title, sortable: true },
    { key: 'assignee', header: 'Assignee', type: 'person', value: (t) => t.assignee?.name ?? 'Unassigned', sortable: true },
    ...(group === 'status' ? [{ key: 'phase', header: 'Phase', value: (t: LiveTask) => phaseLabel(t), sortable: true }] : []),
    { key: 'due', header: 'Due', type: 'date', value: (t) => t.due_date ?? '', render: (t) => (t.due_date ? formatDate(t.due_date) : <span className="ink-3">None</span>), sortable: true },
    { key: 'priority', header: 'Priority', value: (t) => t.priority },
    {
      key: 'status', header: 'Status', value: (t) => t.status,
      render: (t) => (t.can_change_status
        ? <span onClick={(e) => e.stopPropagation()}><Select label={`Status of ${t.title}`} options={STATUS_OPTIONS} value={t.status} onChange={(s) => void changeStatus(t, s)} dense /></span>
        : <TaskStatusChip status={t.status} />),
    },
  ];
  const effective = state === 'ready' && !tasks.length ? 'empty' : state;

  return (
    <>
      <div className="toolbar toolbar--between">
        <div className="toolbar">
          <h2 className="t-h2">Tasks</h2>
          {state === 'ready' && <span className="t-numeric ink-2">{tasks.length} {tasks.length === 1 ? 'task' : 'tasks'}, {blocked} blocked</span>}
        </div>
        <div className="toolbar">
          {view === 'list' && <Segmented label="Group by" value={group} onChange={(v) => setParam('group', v, 'status')} options={[{ value: 'status', label: 'Status' }, { value: 'phase', label: 'Phase' }]} />}
          <Segmented label="View" value={view} onChange={(v) => setParam('view', v, 'board')} options={[{ value: 'board', label: 'Board' }, { value: 'list', label: 'List' }]} />
          {addButton}
        </div>
      </div>
      {effective !== 'ready'
        ? <ListStateBlock state={effective} label="Tasks" rows={8} onRetry={() => setAttempt((a) => a + 1)} capability="view project tasks" empty={{ message: canPlan ? 'No tasks yet. Add the first one and assign it to someone on the team.' : 'No tasks on this project yet.', action: addButton }} />
        : view === 'board'
          ? (
            <KanbanBoard
              label="Task board" itemKey={(t) => t.id} itemLabel={(t) => t.title} renderCard={(t) => <TaskCard task={t} />} onOpen={setEditing}
              onMove={(t, to) => void changeStatus(t, to)}
              columns={TASK_STATUSES.map((s) => ({ key: s, label: s, items: tasks.filter((t) => t.status === s), emptyText: 'Nothing here.' }))}
            />
          )
          : (
            <DataTable
              label="Tasks" columns={columns} rows={tasks} rowKey={(t) => t.id} onRowClick={setEditing} density="dense"
              groupBy={group === 'phase' ? phaseLabel : (t) => t.status}
            />
          )}
      {canPlan && <ProjectTeamPanel key={teamVersion} code={code} />}
      <TaskSheet
        code={code} task={editing} canPlan={canPlan} teamVersion={teamVersion}
        onClose={() => setEditing(null)}
        onSaved={(t, isNew) => {
          replace(t);
          if (t.added_to_team) setTeamVersion((v) => v + 1);
          toast({ variant: 'success', message: isNew ? `${t.title} added${t.assignee ? ` for ${t.assignee.name}` : ''}.${t.added_to_team ? ` ${t.assignee?.name} joined the team.` : ''}` : `${t.title} saved.` });
          setEditing(null);
        }}
        onDeleted={(t) => { setTasks((all) => all.filter((x) => x.id !== t.id)); toast({ variant: 'success', message: `${t.title} deleted.` }); setEditing(null); }}
      />
    </>
  );
}

export type TaskSheetProps = {
  code: string; task: LiveTask | 'new' | null; canPlan: boolean; teamVersion: number;
  onClose: () => void; onSaved: (t: LiveTaskDetail, isNew: boolean) => void; onDeleted: (t: LiveTask) => void;
};

/** New task, edit (planners) or status and notes (the assignee). Everyone else reads it. */
export function TaskSheet({ code, task, canPlan, teamVersion, onClose, onSaved, onDeleted }: TaskSheetProps) {
  const isNew = task === 'new';
  const existing = task && task !== 'new' ? task : null;
  const planner = isNew ? canPlan : !!existing?.can_edit;
  const [form, setForm] = useState<{ title: string; phase: string | null; assignee: string | null; due: string | null; priority: TaskPriority; status: TaskStatus; description: string }>(
    { title: '', phase: null, assignee: null, due: null, priority: 'Normal', status: 'To do', description: '' },
  );
  const [note, setNote] = useState('');
  const [detail, setDetail] = useState<LiveTaskDetail | null>(null);
  const [team, setTeam] = useState<ProjectMember[]>([]);
  const [everyone, setEveryone] = useState<DirectoryPerson[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [phases, setPhases] = useState<{ id: string; code: string; name: string }[]>([]);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState<'save' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!task) return;
    let live = true;
    setTried(false); setError(null); setNote(''); setShowAll(false); setConfirmDelete(false); setDetail(null);
    setForm(existing
      ? { title: existing.title, phase: existing.phase?.id ?? null, assignee: existing.assignee?.id ?? null, due: existing.due_date, priority: existing.priority, status: existing.status, description: existing.description ?? '' }
      : { title: '', phase: null, assignee: null, due: null, priority: 'Normal', status: 'To do', description: '' });
    if (existing) getTask(existing.id).then((d) => { if (live) setDetail(d); }, () => {});
    if (planner) {
      // The team is read each time the sheet opens, so someone just added on the team panel is in the picker.
      listProjectMembers(code).then((m) => { if (live) setTeam(m); }, () => {});
      getTaskPhases(code).then((p) => { if (live) setPhases(p); }, () => {});
      listDirectory().then((p) => { if (live) setEveryone(p); }, () => {});
    }
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task, code, planner, teamVersion]);

  const teamIds = useMemo(() => new Set(team.map((m) => m.person.id)), [team]);
  const people = useMemo(() => {
    const onTeam = team.map((m) => ({ id: m.person.id, name: m.person.name, title: m.is_pm ? 'Project manager' : m.person.job_title ?? undefined }));
    if (!showAll) return onTeam;
    const others = everyone
      .filter((p) => p.employment_state === 'Active' && p.login_state !== 'Revoked' && !teamIds.has(p.id))
      .map((p) => ({ id: p.id, name: p.name, title: `Not on the team${p.job_title ? ` · ${p.job_title}` : ''}` }));
    return [...onTeam, ...others];
  }, [team, everyone, showAll, teamIds]);
  // The current assignee stays choosable even if they have since left the team list.
  const assigneeOptions = existing?.assignee && !people.some((p) => p.id === existing.assignee!.id)
    ? [...people, { id: existing.assignee.id, name: existing.assignee.name, title: existing.assignee.job_title ?? undefined }]
    : people;
  const joining = planner && needsTeam(form.assignee, teamIds) && form.assignee !== existing?.assignee?.id;
  const joiningName = assigneeOptions.find((p) => p.id === form.assignee)?.name;

  if (!task) return <Sheet open={false} onClose={onClose} title="Task">{null}</Sheet>;
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const canStatus = isNew ? canPlan : !!existing?.can_change_status;

  const save = async () => {
    if (planner && !form.title.trim()) { setTried(true); return; }
    setBusy('save'); setError(null);
    try {
      let body: TaskInput;
      if (planner) {
        body = {
          title: form.title.trim(), phase_id: form.phase, assignee_id: form.assignee, due_date: form.due, priority: form.priority,
          description: form.description.trim() || null, status: form.status, ...(joining ? { add_to_team: true } : {}),
        };
        if (note.trim()) body.note = note.trim();
      } else {
        body = { status: form.status, ...(note.trim() ? { note: note.trim() } : {}) };
      }
      const saved = isNew ? await createTask(code, body) : await updateTask(existing!.id, body);
      onSaved(saved, isNew);
    } catch (e) {
      setError(failureMessage(e));
    } finally { setBusy(null); }
  };
  const remove = async () => {
    if (!existing) return;
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setBusy('delete'); setError(null);
    try {
      await deleteTask(existing.id);
      onDeleted(existing);
    } catch (e) {
      setError(failureMessage(e));
    } finally { setBusy(null); }
  };

  const title = isNew ? 'New task' : existing!.title;
  const editable = planner || canStatus;
  const footer = (
    <>
      {!isNew && planner && <Button variant="danger" loading={busy === 'delete'} onClick={() => void remove()}>{confirmDelete ? 'Confirm delete' : 'Delete'}</Button>}
      <Button variant="ghost" onClick={onClose}>{editable ? 'Cancel' : 'Close'}</Button>
      {editable && <Button variant="primary" loading={busy === 'save'} onClick={() => void save()}>{isNew ? 'Add task' : 'Save'}</Button>}
    </>
  );
  const notes = detail?.notes ?? [];
  return (
    <Sheet open onClose={onClose} title={title} description={existing ? `${existing.project.code} · ${phaseLabel(existing)}` : undefined} footer={footer} dirty={isNew ? form.title !== '' : note !== ''}>
      <Form onSubmit={(e) => { e.preventDefault(); void save(); }}>
        {error && <InlineAlert variant="danger" title={error} />}
        {confirmDelete && <InlineAlert variant="warn" title="Delete this task? Its notes go with it. Select Confirm delete to go ahead." />}
        {planner
          ? (
            <FormSection>
              <TextField label="Title" value={form.title} onChange={(e) => set('title', e.target.value)} error={tried && !form.title.trim() ? 'Name the task' : undefined} maxLength={200} />
              <Select label="Phase" options={[{ value: '', label: NO_PHASE }, ...phases.map((p) => ({ value: p.id, label: `${p.code} ${p.name}` }))]} value={form.phase ?? ''} onChange={(v) => set('phase', v || null)} />
              <PersonPicker
                label="Assignee" people={assigneeOptions} value={form.assignee} onChange={(v) => set('assignee', v)}
                helper={joining && joiningName ? `${joiningName} is not on the team. Saving adds them as a contributor.` : 'People on the project team.'}
                empty={showAll ? 'Nobody matches.' : 'Nobody on the team matches. Tick "Include people not on the team".'}
              />
              <Checkbox label="Include people not on the team" description="Anyone you assign from outside the team is added to it as a contributor." checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
              <DateField label="Due" value={form.due} onChange={(v) => set('due', v)} />
              <Select label="Priority" options={PRIORITY_OPTIONS} value={form.priority} onChange={(v) => set('priority', v as TaskPriority)} />
              <Select label="Status" options={STATUS_OPTIONS} value={form.status} onChange={(v) => set('status', v as TaskStatus)} />
              <TextArea label="Description" rows={3} value={form.description} onChange={(e) => set('description', e.target.value)} maxLength={4000} />
            </FormSection>
          )
          : (
            <FormSection>
              <dl className="def-list">
                <dt>Assignee</dt><dd>{existing?.assignee?.name ?? 'Unassigned'}</dd>
                <dt>Due</dt><dd>{existing?.due_date ? formatDate(existing.due_date) : 'None'}</dd>
                <dt>Priority</dt><dd>{existing?.priority}</dd>
                {!canStatus && <><dt>Status</dt><dd>{existing && <TaskStatusChip status={existing.status} />}</dd></>}
              </dl>
              {existing?.description && <p className="t-body-sm">{existing.description}</p>}
              {canStatus && <Select label="Status" options={STATUS_OPTIONS} value={form.status} onChange={(v) => set('status', v as TaskStatus)} />}
            </FormSection>
          )}
        {!isNew && (
          <FormSection>
            <h3 className="t-h3">Progress notes</h3>
            {notes.length
              ? <ul className="link-list" aria-label="Progress notes">{notes.map((n) => <li key={n.id} style={{ flexDirection: 'column', alignItems: 'stretch' }}><span className="t-body-sm">{n.body}</span><span className="t-caption ink-2">{n.author.name} · {formatDate(n.created_at.slice(0, 10))}</span></li>)}</ul>
              : <p className="t-body-sm ink-2">No notes yet.</p>}
            {canStatus && <TextArea label="Add a note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />}
          </FormSection>
        )}
      </Form>
    </Sheet>
  );
}
