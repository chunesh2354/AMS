import { Avatar } from '../../ui/Avatar';
import { StatusChip } from '../../ui/StatusChip';
import { formatDate } from '../../ui/format';
import { personName, type Task } from '../../api';

export function PriorityDot({ priority }: { priority: Task['priority']; withLabel?: boolean }) {
  return <span className="prio t-caption ink-2" role="img" aria-label={`${priority} priority`}>{priority}</span>;
}

export function TaskCardBody({ task }: { task: Task }) {
  const owner = personName(task.ownerId);
  return (
    <>
      <span className="bcard__title">{task.title}</span>
      {task.blocked && <StatusChip size="sm" status="Blocked" />}
      <span className="bcard__meta">
        <PriorityDot priority={task.priority} />
        <span className="t-numeric ink-2">{formatDate(task.due)}</span>
        <Avatar name={owner} size={20} />
      </span>
    </>
  );
}
export const taskStatus = (t: Task) => (t.blocked ? 'Blocked' as const : t.stage);
