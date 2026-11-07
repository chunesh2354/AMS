import { useEffect, useMemo, useState } from 'react';
import { getProjectPhaseOptions } from '../../api';
import { failureMessage, isLive } from '../../api/live';
import { classification, getPhaseOptions, logEntry, startTimer } from '../../api/live/time';
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
const phaseLabelIn = (projects: ProjectPhaseOption[], id: string | null) => projects.flatMap((p) => p.phases.map((ph) => ({ id: ph.id, label: `${p.code} · ${ph.name}`, code: p.code, name: ph.name }))).find((x) => x.id === id);

/** Section 9.3. Nothing is saved in this build; saving only confirms. */
export function LogTimeSheet({ open, onClose, prefill }: { open: boolean; onClose: () => void; prefill?: LogTimePrefill }) {
  const { viewer } = useSession();
  const timer = useTimer();
  const toast = useToast();
  const [phase, setPhase] = useState<string | null>(null);
  const [task, setTask] = useState<string | null>(null);
  const [minutes, setMinutes] = useState<number | null>(null);
  const [date, setDate] = useState<string | null>(TODAY);
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);
  const [projects, setProjects] = useState<ProjectPhaseOption[]>(isLive ? [] : mockProjects);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (isLive && open) getPhaseOptions().then(setProjects, (e) => toast({ variant: 'danger', message: failureMessage(e) })); }, [open, toast]);
  const phaseLabel = (id: string | null) => phaseLabelIn(projects, id);

  useEffect(() => {
    if (!open) return;
    setPhase(prefill?.phaseId ?? null); setTask(prefill?.taskId ?? null); setMinutes(null); setDate(TODAY); setNote(''); setTried(false);
  }, [open, prefill]);

  const current = phaseLabel(phase);
  const tasks = useMemo(() => TASKS.filter((t) => current && t.project === current.code && t.phase === current.name && (t.ownerId === viewer.id || t.id === task)), [current, viewer.id, task]);
  const longDay = (minutes ?? 0) > 12 * 60;
  const errors = { phase: !phase ? 'Choose a project and phase' : undefined, minutes: !minutes ? 'Enter the time spent' : undefined, date: !date ? 'Choose a date' : undefined };
  const save = (startTimer_: boolean) => {
    if (errors.phase || errors.minutes || errors.date) { setTried(true); return; }
    if (isLive) {
      if (saving) return;
      const cls = classification(phase!);
      setSaving(true);
      logEntry({ service_date: date!, duration_hours: Number((minutes! / 60).toFixed(2)), note: note.trim() || undefined, ...cls })
        .then(() => (startTimer_ ? startTimer(cls) : null))
        .then(() => { toast({ variant: 'success', message: `Logged ${formatDuration(minutes!)} on ${current!.label}.` }); if (startTimer_) timer.start(current!.label); onClose(); }, (e) => toast({ variant: 'danger', message: failureMessage(e) }))
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
          <Select label="Task" helper="Optional" options={tasks.map((t) => ({ value: t.id, label: t.title }))} value={task} onChange={setTask} />
          <DurationField label="Duration (h:mm)" minutes={minutes} onChange={setMinutes} error={tried ? errors.minutes : undefined} helper={longDay ? 'Over 12 h goes to your approver as an exception.' : undefined} />
          <DateField label="Date" value={date} onChange={setDate} today={TODAY} error={tried ? errors.date : undefined} />
          <TextArea label="Note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </FormSection>
      </Form>
    </Sheet>
  );
}
