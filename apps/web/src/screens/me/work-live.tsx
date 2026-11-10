import { useEffect, useMemo, useState } from 'react';
import { failureMessage } from '../../api/live';
import { useResource } from '../../api/useResource';
import { getMyWork, type LiveMyWork } from '../../api/live/me';
import { DUE_GROUPS, TASK_STATUSES, dueGroup, getMyTasksLive, phaseLabel, updateTask, type LiveTask, type MyTasks, type TaskStatus } from '../../api/live/tasks';
import { useSession } from '../../app/session';
import { DataTable, type Column } from '../../ui/DataTable';
import { PageHeader } from '../../ui/PageHeader';
import { StatusChip } from '../../ui/StatusChip';
import { ListStateBlock } from '../../ui/ListState';
import { Select } from '../../ui/Select';
import { useToast } from '../../ui/Toast';
import { formatDate, formatHours, formatMonth, parseISO } from '../../ui/format';
import { GoTo } from '../shared/go-to';
import { TaskSheet, TaskStatusChip } from '../firm/project/tasks-live';

type PhaseRow = LiveMyWork['projects'][number]['phases'][number] & { project: string };

/** "PRJ-01 Lakeview Residence · Contributor · Active · Lakeview Trust": the group heading over a project's phases. */
export const projectHeading = (p: LiveMyWork['projects'][number]) => `${p.code} ${p.name} · ${p.role} · ${p.status}${p.client ? ` · ${p.client}` : ''}`;

export function workRows(data: LiveMyWork | null): PhaseRow[] {
  return (data?.projects ?? []).flatMap((p) => p.phases.map((ph) => ({ ...ph, project: projectHeading(p) })));
}

/**
 * My work in live mode, from GET /me/work: the projects the person is on, their phases with status and dates, and
 * the person's own hours on each phase this month. Above them, My tasks from GET /me/tasks: the open tasks assigned to
 * the person across projects, grouped by when they are due, with the status changed in place.
 */
export function LiveMyWorkScreen() {
  const { viewer } = useSession();
  const { state, data, retry } = useResource(getMyWork, [viewer.id]);
  const rows = useMemo(() => workRows(data), [data]);
  const month = data ? formatMonth(parseISO(`${data.month}-01`)) : '';
  const columns: Column<PhaseRow>[] = [
    { key: 'phase', header: 'Phase', value: (r) => r.name, render: (r) => <span>{r.name} <span className="ink-2">{r.code}</span>{r.current && <span className="t-caption ink-2"> · Now</span>}</span> },
    { key: 'status', header: 'Status', type: 'status', value: (r) => r.status, render: (r) => <StatusChip status={r.status} size="sm" /> },
    { key: 'start', header: 'Start', type: 'date', value: (r) => r.start },
    { key: 'end', header: 'End', type: 'date', value: (r) => r.end },
    { key: 'hours', header: `My hours, ${month || 'this month'}`, type: 'hours', value: (r) => r.hours, total: (all) => all.reduce((s, r) => s + r.hours, 0) },
  ];
  const tableState = state === 'ready' && !rows.length ? 'empty' : state;
  return (
    <>
      <PageHeader
        title="My work"
        meta={state === 'ready' && data && <span className="t-numeric ink-2">{data.projects.length} {data.projects.length === 1 ? 'project' : 'projects'} · {formatHours(data.hours)} in {month}</span>}
      />
      <MyTasksPanel />
      <h2 className="t-h2">My projects</h2>
      <DataTable
        label="My projects and phases" columns={columns} rows={rows} rowKey={(r) => r.id} state={tableState} onRetry={retry} capability="view your work"
        groupBy={(r) => r.project}
        empty={{ message: 'You are not on any project team yet.', action: <GoTo to="/me/time">Open my time</GoTo> }}
      />
    </>
  );
}

const STATUS_OPTIONS = TASK_STATUSES.map((s) => ({ value: s, label: s }));

/** My open tasks, grouped Overdue, Today, This week, Later and No due date, against the studio's today. */
export function MyTasksPanel() {
  const { viewer } = useSession();
  const toast = useToast();
  const { state, data, retry } = useResource(getMyTasksLive, [viewer.id]);
  const [mine, setMine] = useState<MyTasks | null>(null);
  const [open, setOpen] = useState<LiveTask | null>(null);
  useEffect(() => { setMine(data); }, [data]);

  const tasks = mine?.tasks ?? [];
  const apply = (t: LiveTask) => setMine((m) => (m ? { ...m, tasks: t.status === 'Done' || t.assignee?.id !== viewer.id ? m.tasks.filter((x) => x.id !== t.id) : m.tasks.map((x) => (x.id === t.id ? t : x)) } : m));
  const move = async (t: LiveTask, to: TaskStatus) => {
    if (to === t.status) return;
    try {
      apply(await updateTask(t.id, { status: to }));
      toast({ variant: to === 'Done' ? 'success' : 'info', message: to === 'Done' ? `${t.title} is done.` : `${t.title} moved to ${to}.` });
    } catch (e) {
      toast({ variant: 'danger', message: failureMessage(e) });
    }
  };
  const effective = state === 'ready' && !tasks.length ? 'empty' : state;
  return (
    <section className="stack-4" aria-labelledby="my-tasks">
      <div className="toolbar toolbar--between">
        <h2 id="my-tasks" className="t-h2">My tasks</h2>
        {state === 'ready' && mine && <span className="t-numeric ink-2">{tasks.length} open{mine.overdue ? ` · ${mine.overdue} overdue` : ''}</span>}
      </div>
      {effective !== 'ready' || !mine
        ? <ListStateBlock state={effective === 'ready' ? 'loading' : effective} label="My tasks" rows={3} onRetry={retry} capability="view your tasks" empty={{ message: 'No open tasks are assigned to you.' }} />
        : (
          <div className="solid-panel">
            {DUE_GROUPS.map((g) => {
              const list = tasks.filter((t) => dueGroup(t.due_date, mine.today) === g);
              if (!list.length) return null;
              return (
                <section key={g} aria-label={`${g}, ${list.length}`}>
                  <h3 className="group-head"><span>{g}</span><span className="t-numeric ink-2">{list.length}</span></h3>
                  <ul className="inbox__list">
                    {list.map((t) => (
                      <li key={t.id} className="taskline">
                        <button type="button" className="taskline__open" onClick={() => setOpen(t)}>
                          <span className="taskline__title">{t.title}</span>
                          <span className="t-caption ink-2">{t.project.code} · {phaseLabel(t)}{t.due_date ? <> · <span className="taskline__due">{formatDate(t.due_date)}</span></> : null}</span>
                        </button>
                        <span className="taskline__meta">
                          <span className="t-caption ink-2" role="img" aria-label={`${t.priority} priority`}>{t.priority}</span>
                          <TaskStatusChip status={t.status} />
                        </span>
                        <span className="taskline__actions">
                          <Select label={`Status of ${t.title}`} options={STATUS_OPTIONS} value={t.status} onChange={(s) => void move(t, s as TaskStatus)} dense />
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      <TaskSheet
        code={open?.project.code ?? ''} task={open} canPlan={!!open?.can_edit} teamVersion={0}
        onClose={() => setOpen(null)}
        onSaved={(t) => { apply(t); toast({ variant: 'success', message: `${t.title} saved.` }); setOpen(null); }}
        onDeleted={(t) => { setMine((m) => (m ? { ...m, tasks: m.tasks.filter((x) => x.id !== t.id) } : m)); setOpen(null); }}
      />
    </section>
  );
}
