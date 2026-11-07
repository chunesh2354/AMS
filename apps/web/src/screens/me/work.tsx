import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getMyTasks, personName, type Task, type TaskStage } from '../../api';
import { useResource } from '../../api/useResource';
import { useSession } from '../../app/session';
import { TODAY } from '../../mock/studio-meridian';
import { Button } from '../../ui/Button';
import { Form, FormSection } from '../../ui/Form';
import { KanbanBoard } from '../../ui/KanbanBoard';
import { ListStateBlock } from '../../ui/ListState';
import { PageHeader } from '../../ui/PageHeader';
import { Segmented } from '../../ui/Segmented';
import { Sheet } from '../../ui/Sheet';
import { TaskRow } from '../../ui/TaskRow';
import { TextArea } from '../../ui/TextArea';
import { useToast } from '../../ui/Toast';
import { TaskCardBody, taskStatus } from '../shared/task-bits';
import { TaskSheet } from '../shared/task-sheet';
import { GoTo } from '../shared/go-to';

const END_OF_WEEK = '2026-11-08';
const GROUPS = ['Overdue', 'Today', 'This week', 'Later'] as const;
const groupOf = (t: Task) => (t.due < TODAY ? 'Overdue' : t.due === TODAY ? 'Today' : t.due <= END_OF_WEEK ? 'This week' : 'Later');
const COLUMNS = ['Planned', 'Ready', 'In progress', 'Blocked', 'In review'];

export function MyWorkScreen() {
  const { viewer } = useSession();
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const { state, data, retry } = useResource(() => getMyTasks(viewer.id), [viewer.id]);
  const [edits, setEdits] = useState<Record<string, Partial<Task>>>({});
  const [open, setOpen] = useState<Task | null>(null);
  const [blocking, setBlocking] = useState<Task | null>(null);
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const view = params.get('view') === 'board' ? 'board' : 'list';
  const tasks = useMemo(() => (data ?? []).map((t) => ({ ...t, ...edits[t.id] })), [data, edits]);
  const update = (t: Task, patch: Partial<Task>) => setEdits((e) => ({ ...e, [t.id]: { ...e[t.id], ...patch } }));
  const moveTo = (t: Task, to: string) => {
    if (to === 'Blocked') { setBlocking(t); setReason(''); setTried(false); return; }
    update(t, { stage: to as TaskStage, blocked: undefined });
    toast({ variant: 'info', message: `${t.title} moved to ${to}.` });
  };
  const saveBlock = () => {
    if (!blocking) return;
    if (!reason.trim()) { setTried(true); return; }
    update(blocking, { blocked: reason.trim() });
    toast({ variant: 'warn', message: `${blocking.title} is blocked. ${personName(blocking.reviewerId)} can see why.` });
    setBlocking(null);
  };
  const setView = (v: string) => setParams((prev) => { const n = new URLSearchParams(prev); if (v === 'list') n.delete('view'); else n.set('view', v); return n; }, { replace: true });
  const effective = state === 'ready' && !tasks.length ? 'empty' : state;
  const actions = (t: Task) => (
    <>
      {(t.stage === 'Planned' || t.stage === 'Ready') && <Button size="dense" onClick={() => moveTo(t, 'In progress')}>Start</Button>}
      {t.stage === 'In progress' && !t.blocked && <Button size="dense" variant="ghost" onClick={() => moveTo(t, 'Blocked')}>Block</Button>}
      {t.stage === 'In progress' && !t.blocked && <Button size="dense" onClick={() => moveTo(t, 'In review')}>Submit for review</Button>}
    </>
  );
  return (
    <>
      <PageHeader
        title="My work" meta={state === 'ready' && <span className="t-numeric ink-2">{tasks.length} tasks</span>}
        secondaryActions={<Segmented label="View" value={view} onChange={setView} options={[{ value: 'list', label: 'List' }, { value: 'board', label: 'Board' }]} />}
      />
      {effective !== 'ready'
        ? <ListStateBlock state={effective} label="Your work" rows={8} onRetry={retry} capability="view your work" empty={{ message: 'No tasks are assigned to you.', action: <GoTo to="/me/schedule">See my schedule</GoTo> }} />
        : view === 'board'
          ? (
            <KanbanBoard
              label="My work board" itemKey={(t) => t.id} itemLabel={(t) => t.title} renderCard={(t) => <TaskCardBody task={t} />} onOpen={setOpen} onMove={moveTo}
              columns={COLUMNS.map((c) => ({ key: c, label: c, items: tasks.filter((t) => taskStatus(t) === c), emptyText: 'Nothing in this stage.' }))}
            />
          )
          : (
            <div className="solid-panel">
              {GROUPS.map((g) => {
                const list = tasks.filter((t) => groupOf(t) === g);
                if (!list.length) return null;
                return (
                  <section key={g} aria-label={`${g}, ${list.length}`}>
                    <h2 className="group-head"><span>{g}</span><span className="t-numeric ink-2">{list.length}</span></h2>
                    <ul className="inbox__list">
                      {list.map((t) => <TaskRow key={t.id} title={t.title} where={`${t.project} · ${t.phase}`} due={t.due} priority={t.priority} status={taskStatus(t)} reviewer={personName(t.reviewerId)} onOpen={() => setOpen(t)} actions={actions(t)} />)}
                    </ul>
                  </section>
                );
              })}
            </div>
          )}
      <TaskSheet task={open} onClose={() => setOpen(null)} onSubmitReview={(t) => update(t, { stage: 'In review' })} />
      <Sheet
        open={!!blocking} onClose={() => setBlocking(null)} title="Block task" description={blocking?.title} dirty={reason !== ''}
        footer={<><Button variant="ghost" onClick={() => setBlocking(null)}>Cancel</Button><Button variant="primary" onClick={saveBlock}>Block task</Button></>}
      >
        <Form onSubmit={(e) => { e.preventDefault(); saveBlock(); }}>
          <FormSection><TextArea label="What are you waiting for?" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} error={tried && !reason.trim() ? 'Say what is blocking this' : undefined} /></FormSection>
        </Form>
      </Sheet>
    </>
  );
}
