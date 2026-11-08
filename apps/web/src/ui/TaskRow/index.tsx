import type { ReactNode } from 'react';
import { Avatar } from '../Avatar';
import { StatusChip } from '../StatusChip';
import { formatDate } from '../format';
import type { Status } from '../status-colors';

export type TaskRowProps = {
  title: string;
  where: string;
  due: string;
  priority: Extract<Status, 'High' | 'Medium' | 'Low'>;
  status: Status;
  reviewer?: string;
  onOpen?: () => void;
  actions?: ReactNode;
};

/** Added for My day and My work: one task as a row that stays readable at 390 px, unlike a wide table. */
export function TaskRow({ title, where, due, priority, status, reviewer, onOpen, actions }: TaskRowProps) {
  return (
    <li className="taskline">
      <button type="button" className="taskline__open" onClick={onOpen}>
        <span className="taskline__title">{title}</span>
        <span className="t-caption ink-2">{where} · <span className="taskline__due">{formatDate(due)}</span></span>
      </button>
      <span className="taskline__meta">
        <span className="t-caption ink-2" role="img" aria-label={`${priority} priority`}>{priority}</span>
        {reviewer && <Avatar name={reviewer} size={20} />}
        <StatusChip size="sm" status={status} />
      </span>
      {actions && <span className="taskline__actions">{actions}</span>}
    </li>
  );
}
