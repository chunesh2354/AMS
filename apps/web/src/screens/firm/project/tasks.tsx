import { useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { getPeople, getTasks, personName, type Priority, type Task, type TaskStage } from '../../../api';
import { useResource } from '../../../api/useResource';
import { TODAY } from '../../../mock/studio-meridian';
import { Button } from '../../../ui/Button';
import { DataTable, type Column } from '../../../ui/DataTable';
import { DateField } from '../../../ui/DateField';
import { FilterBar, type FilterDef } from '../../../ui/FilterBar';
import { Form, FormSection } from '../../../ui/Form';
import { KanbanBoard } from '../../../ui/KanbanBoard';
import { ListStateBlock } from '../../../ui/ListState';
import { PersonPicker } from '../../../ui/PersonPicker';
import { Segmented } from '../../../ui/Segmented';
import { Select } from '../../../ui/Select';
import { Sheet } from '../../../ui/Sheet';
import { TextField } from '../../../ui/TextField';
import { useToast } from '../../../ui/Toast';
import { PriorityDot, TaskCardBody, taskStatus } from '../../shared/task-bits';
import { TaskSheet } from '../../shared/task-sheet';

const STAGES: TaskStage[] = ['Planned', 'Ready', 'In progress', 'In review', 'Done'];
const PRIORITIES: Priority[] = ['High', 'Medium', 'Low'];

function AddTaskSheet({ open, onClose, onAdd, project, phases, people }: { open: boolean; onClose: () => void; onAdd: (t: Task) => void; project: string; phases: string[]; people: { id: string; name: string; title: string }[] }) {
  const [title, setTitle] = useState('');
  const [phase, setPhase] = useState<string | null>(null);
  const [owner, setOwner] = useState<string | null>(null);
  const [due, setDue] = useState<string | null>(null);
  const [priority, setPriority] = useState<string | null>('Medium');
  const [tried, setTried] = useState(false);
  const reset = () => { setTitle(''); setPhase(null); setOwner(null); setDue(null); setPriority('Medium'); setTried(false); };
  const close = () => { reset(); onClose(); };
  const save = () => {
    if (!title.trim() || !phase || !owner || !due) { setTried(true); return; }
    onAdd({ id: `new-${title}`, project, phase, title: title.trim(), ownerId: owner, reviewerId: 'P02', due, stage: 'Planned', priority: priority as Priority, brief: 'No brief yet.', estimate: 0, logged: 0, checklist: [], dependencies: [], documents: [], thread: [] });
    close();
  };
  return (
    <Sheet
      open={open} onClose={close} title="Add task" dirty={title !== ''}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button><Button variant="primary" onClick={save}>Add task</Button></>}
    >
      <Form onSubmit={(e) => { e.preventDefault(); save(); }}>
        <FormSection>
          <TextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} error={tried && !title.trim() ? 'Name the task' : undefined} />
          <Select label="Phase" options={phases.map((p) => ({ value: p, label: p }))} value={phase} onChange={setPhase} error={tried && !phase ? 'Choose a phase' : undefined} />
          <PersonPicker label="Owner" people={people} value={owner} onChange={setOwner} error={tried && !owner ? 'Choose an owner' : undefined} />
          <DateField label="Due" value={due} onChange={setDue} today={TODAY} error={tried && !due ? 'Choose a date' : undefined} />
          <Select label="Priority" options={PRIORITIES.map((p) => ({ value: p, label: p }))} value={priority} onChange={setPriority} />
        </FormSection>
      </Form>
    </Sheet>
  );
}

export function ProjectTasksScreen() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const { state, data, retry } = useResource(() => getTasks(id), [id]);
  const people = useResource(getPeople, []);
  const [added, setAdded] = useState<Task[]>([]);
  const [moved, setMoved] = useState<Record<string, TaskStage>>({});
  const [open, setOpen] = useState<Task | null>(null);
  const [adding, setAdding] = useState(false);
  const view = params.get('view') === 'list' ? 'list' : 'board';

  const tasks = useMemo(() => [...(data ?? []), ...added].map((t) => (moved[t.id] ? { ...t, stage: moved[t.id] } : t)), [data, added, moved]);
  const filters: FilterDef[] = useMemo(() => [
    { type: 'select', key: 'owner', label: 'Owner', options: [...new Set(tasks.map((t) => t.ownerId))].map((o) => ({ value: o, label: personName(o) })) },
    { type: 'select', key: 'phase', label: 'Phase', options: [...new Set(tasks.map((t) => t.phase))].map((p) => ({ value: p, label: p })) },
    { type: 'select', key: 'priority', label: 'Priority', options: PRIORITIES.map((p) => ({ value: p, label: p })) },
  ], [tasks]);
  const shown = tasks.filter((t) =>
    (!params.get('owner') || t.ownerId === params.get('owner')) &&
    (!params.get('phase') || t.phase === params.get('phase')) &&
    (!params.get('priority') || t.priority === params.get('priority')));

  const columns: Column<Task>[] = [
    { key: 'title', header: 'Task', value: (t) => t.title, sortable: true },
    { key: 'owner', header: 'Owner', type: 'person', value: (t) => personName(t.ownerId), sortable: true },
    { key: 'status', header: 'Stage', type: 'status', value: (t) => taskStatus(t), sortable: true },
    { key: 'due', header: 'Due', type: 'date', value: (t) => t.due, sortable: true },
    { key: 'priority', header: 'Priority', value: (t) => t.priority, render: (t) => <PriorityDot priority={t.priority} withLabel /> },
  ];
  const setView = (v: string) => setParams((prev) => { const n = new URLSearchParams(prev); if (v === 'board') n.delete('view'); else n.set('view', v); return n; }, { replace: true });
  const effective = state === 'ready' && !shown.length ? 'empty' : state;
  const blocked = tasks.filter((t) => t.blocked).length;
  const addButton = <Button variant="primary" onClick={() => setAdding(true)}>Add task</Button>;
  return (
    <>
      <div className="toolbar toolbar--between">
        <div className="toolbar">
          <h2 className="t-h2">Tasks</h2>
          {state === 'ready' && <span className="t-numeric ink-2">{tasks.length} tasks, {blocked} blocked</span>}
        </div>
        <div className="toolbar">
          <Segmented label="View" value={view} onChange={setView} options={[{ value: 'board', label: 'Board' }, { value: 'list', label: 'List' }]} />
          {addButton}
        </div>
      </div>
      <FilterBar filters={filters} />
      {effective !== 'ready'
        ? <ListStateBlock state={effective} label="Tasks" rows={8} onRetry={retry} capability="view project tasks" empty={{ message: 'No task matches here yet.', action: addButton }} />
        : view === 'board'
          ? (
            <KanbanBoard
              label="Task board" itemKey={(t) => t.id} itemLabel={(t) => t.title} renderCard={(t) => <TaskCardBody task={t} />} onOpen={setOpen}
              onMove={(t, to) => { setMoved((m) => ({ ...m, [t.id]: to as TaskStage })); toast({ variant: 'info', message: `${t.title} moved to ${to}.` }); }}
              columns={STAGES.map((s) => ({ key: s, label: s, items: shown.filter((t) => t.stage === s), emptyText: s === 'Done' ? 'Nothing done in this period.' : 'Nothing in this stage.' }))}
            />
          )
          : <DataTable label="Tasks" columns={columns} rows={shown} rowKey={(t) => t.id} onRowClick={setOpen} density="dense" />}
      <TaskSheet task={open} onClose={() => setOpen(null)} onSubmitReview={(t) => setMoved((m) => ({ ...m, [t.id]: 'In review' }))} />
      <AddTaskSheet
        open={adding} onClose={() => setAdding(false)} project={id}
        phases={[...new Set((data ?? []).map((t) => t.phase))]}
        people={(people.data ?? []).map((p) => ({ id: p.id, name: p.name, title: p.title }))}
        onAdd={(t) => { setAdded((a) => [...a, t]); toast({ variant: 'success', message: `${t.title} added in this view.` }); }}
      />
    </>
  );
}
