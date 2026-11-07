import { useEffect, useState } from 'react';
import { PROJECTS } from '../../mock/studio-meridian';
import { personName, type Task } from '../../api';
import { useOverlays } from '../../app/overlays';
import { Avatar } from '../../ui/Avatar';
import { Button } from '../../ui/Button';
import { Checkbox } from '../../ui/Checkbox';
import { InlineAlert } from '../../ui/InlineAlert';
import { Sheet } from '../../ui/Sheet';
import { StatusChip } from '../../ui/StatusChip';
import { Thread } from '../../ui/Thread';
import { useToast } from '../../ui/Toast';
import { formatDate, formatHours } from '../../ui/format';
import { PriorityDot, taskStatus } from './task-bits';

const phaseId = (t: Task) => PROJECTS.find((p) => p.code === t.project)?.phases.find((x) => x.name === t.phase)?.id;

/** The 640 px task sheet from Project Tasks and My work. */
export function TaskSheet({ task, onClose, onSubmitReview }: { task: Task | null; onClose: () => void; onSubmitReview?: (t: Task) => void }) {
  const { openLogTime } = useOverlays();
  const toast = useToast();
  const [checks, setChecks] = useState<boolean[]>([]);
  const [replies, setReplies] = useState<Task['thread']>([]);
  useEffect(() => { setChecks(task?.checklist.map((c) => c.done) ?? []); setReplies([]); }, [task]);
  const owner = task ? personName(task.ownerId) : '';
  const reviewer = task ? personName(task.reviewerId) : '';
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
          </dl>
          <section><h3 className="t-h3">Brief</h3><p className="t-body-sm">{task.brief}</p></section>
          <section className="stack-rows">
            <h3 className="t-h3">Checklist</h3>
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
            <h3 className="t-h3">Time logged</h3>
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
