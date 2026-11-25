import { useEffect, useMemo, useState } from 'react';
import { getProjectPhaseOptions } from '../../api';
import { failureMessage, isLive } from '../../api/live';
import { classification, getPhaseOptions, todayIn } from '../../api/live/time';
import { listProjectTasks, logTaskTime, startTaskTimer, type LiveTask } from '../../api/live/tasks';
import type { ProjectPhaseOption } from '../../ui/ProjectPhasePicker';
import { useSession, useTimer } from '../../app/session';
import { TASKS, TODAY } from '../../mock/studio-meridian';
import { Button } from '../../ui/Button';
import { DateField } from '../../ui/DateField';
import { DurationField } from '../../ui/DurationField';
import { Form, FormSection } from '../../ui/Form';
import { ProjectPhasePicker } from '../../ui/ProjectPhasePicker';
import { Select } from '../../ui/Select';
import { Sheet } from '../../ui/Sheet';
import { TextArea } from '../../ui/TextArea';
import { useToast } from '../../ui/Toast';
import { formatDuration } from '../../ui/format';

export type LogTimePrefill = { phaseId?: string; taskId?: string };

const mockProjects = getProjectPhaseOptions();

/**
 * The date the sheet opens on. Live: today in the studio's time zone (GET /me), never the mock's fixed date,
 * so a saved entry lands on the day it was worked. Mock: the sample studio's today.
 */
export const defaultLogDate = (live: boolean, timeZone?: string, now: Date = new Date()) => (live ? todayIn(timeZone, now) : TODAY);
const phaseLabelIn = (projects: ProjectPhaseOption[], id: string | null) => projects.flatMap((p) => p.phases.map((ph) => ({ id: ph.id, label: `${p.code} · ${ph.name}`, code: p.code, name: ph.name }))).find((x) => x.id === id);

/** The open tasks of one phase, for the Task picker. Done tasks stay out unless already chosen. */
export const tasksOfPhase = (tasks: LiveTask[], phaseId: string | null, keep: string | null = null) =>
  tasks.filter((t) => phaseId && t.phase?.id === phaseId && (t.status !== 'Done' || t.id === keep));

/**
 * Section 9.3. Mock: nothing is saved; saving only confirms. Live: POST /time-entries, with task_id when a task of
 * the chosen phase is picked (tasks from GET /projects/:code/tasks). Mock offers the sample tasks.
 */
export function LogTimeSheet({ open, onClose, prefill }: { open: boolean; onClose: () => void; prefill?: LogTimePrefill }) {
  const { viewer } = useSession();
  const timer = useTimer();
  const toast = useToast();
  const [phase, setPhase] = useState<string | null>(null);
  const [task, setTask] = useState<string | null>(null);
  const [minutes, setMinutes] = useState<number | null>(null);
  const timeZone = viewer.firm?.timezone;
  const [date, setDate] = useState<string | null>(() => defaultLogDate(isLive, timeZone));
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);
  const [projects, setProjects] = useState<ProjectPhaseOption[]>(isLive ? [] : mockProjects);
  const [saving, setSaving] = useState(false);
  const [liveTasks, setLiveTasks] = useState<{ code: string; tasks: LiveTask[] } | null>(null);
  useEffect(() => { if (isLive && open) getPhaseOptions().then(setProjects, (e) => toast({ variant: 'danger', message: failureMessage(e) })); }, [open, toast]);
  const phaseLabel = (id: string | null) => phaseLabelIn(projects, id);

  useEffect(() => {
    if (!open) return;
    // Tasks are read again each time the sheet opens, so one added since shows up.
    setLiveTasks(null);
    setPhase(prefill?.phaseId ?? null); setTask(prefill?.taskId ?? null); setMinutes(null); setDate(defaultLogDate(isLive, timeZone)); setNote(''); setTried(false);
  }, [open, prefill, timeZone]);

  const current = phaseLabel(phase);
  // Live: the tasks of the chosen project, read once per project. An internal category (cat:) has no tasks.
  const code = isLive && phase && !phase.startsWith('cat:') ? current?.code ?? null : null;
  useEffect(() => {
    if (!code || liveTasks?.code === code) return;
    let live = true;
    listProjectTasks(code).then((r) => { if (live) setLiveTasks({ code, tasks: r.tasks }); }, () => { if (live) setLiveTasks({ code, tasks: [] }); });
    return () => { live = false; };
  }, [code, liveTasks?.code]);
  const liveOptions = useMemo(() => (code && liveTasks?.code === code ? tasksOfPhase(liveTasks.tasks, phase, task) : []), [code, liveTasks, phase, task]);
  const tasks = useMemo(() => (isLive ? [] : TASKS).filter((t) => current && t.project === current.code && t.phase === current.name && (t.ownerId === viewer.id || t.id === task)), [current, viewer.id, task]);
  const longDay = (minutes ?? 0) > 12 * 60;
  const errors = { phase: !phase ? 'Choose a project and phase' : undefined, minutes: !minutes ? 'Enter the time spent' : undefined, date: !date ? 'Choose a date' : undefined };
  const save = (startTimer_: boolean) => {
    if (errors.phase || errors.minutes || errors.date) { setTried(true); return; }
    if (isLive) {
      if (saving) return;
      const cls = classification(phase!);
      // A task picked for this phase goes with the time; a task left over from another phase never does.
      const onTask = task && liveOptions.some((t) => t.id === task) ? liveOptions.find((t) => t.id === task)! : null;
      const withTask = onTask ? { ...cls, task_id: onTask.id } : cls;
      const label = onTask ? `${current!.label} · ${onTask.title}` : current!.label;
      setSaving(true);
      logTaskTime({ service_date: date!, duration_hours: Number((minutes! / 60).toFixed(2)), note: note.trim() || undefined, ...withTask })
        .then(() => (startTimer_ ? startTaskTimer(withTask) : null))
        .then(() => { toast({ variant: 'success', message: `Logged ${formatDuration(minutes!)} on ${label}.` }); if (startTimer_) timer.start(label); onClose(); }, (e) => toast({ variant: 'danger', message: failureMessage(e) }))
        .finally(() => setSaving(false));
      return;
    }
    toast({ variant: 'success', message: `Logged ${formatDuration(minutes!)} on ${current!.label}. Nothing is saved in this demo.` });
    if (startTimer_) timer.start(current!.label);
    onClose();
  };
  return (
    <Sheet
      open={open} onClose={onClose} title="Log time" dirty={!!minutes || note !== ''}
      footer={(
        <>
          {tried && <span className="form__summary" role="status">Fix the highlighted fields to save</span>}
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save(true)}>Save and start timer</Button>
          <Button variant="primary" onClick={() => save(false)}>Save</Button>
        </>
      )}
    >
      <Form onSubmit={(e) => { e.preventDefault(); save(false); }}>
        <FormSection>
          <ProjectPhasePicker label="Project and phase" projects={projects} recent={isLive ? [] : ['p1-concept', 'p1-wd']} value={phase} onChange={(v) => { setPhase(v); setTask(null); }} error={tried ? errors.phase : undefined} />
          {!isLive && <Select label="Task" helper="Optional" options={tasks.map((t) => ({ value: t.id, label: t.title }))} value={task} onChange={setTask} />}
          {isLive && code && (
            <Select
              label="Task" placeholder="No task" helper={liveOptions.length ? 'Optional. The time goes on this task as well as the phase.' : 'No open tasks on this phase.'}
              options={[{ value: '', label: 'No task' }, ...liveOptions.map((t) => ({ value: t.id, label: t.title }))]} value={task ?? ''} onChange={(v) => setTask(v || null)}
            />
          )}
          <DurationField label="Duration (h:mm)" minutes={minutes} onChange={setMinutes} error={tried ? errors.minutes : undefined} helper={longDay ? 'Over 12 h goes to your approver as an exception.' : undefined} />
          <DateField label="Date" value={date} onChange={setDate} today={defaultLogDate(isLive, timeZone)} error={tried ? errors.date : undefined} />
          <TextArea label="Note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </FormSection>
      </Form>
    </Sheet>
  );
}
