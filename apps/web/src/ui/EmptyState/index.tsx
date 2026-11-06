import type { ReactNode } from 'react';

export type EmptyStateProps = { icon?: ReactNode; message: string; action?: ReactNode };

/** One sentence and one primary action. */
export function EmptyState({ icon, message, action }: EmptyStateProps) {
  return (
    <div className="state">
      {icon && <span className="state__icon">{icon}</span>}
      <p className="state__body">{message}</p>
      {action}
    </div>
  );
}
