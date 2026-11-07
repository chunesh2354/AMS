import type { ReactNode } from 'react';
import { EmptyState } from '../EmptyState';
import { ErrorState } from '../ErrorState';
import { PermissionDenied } from '../PermissionDenied';
import { Skeleton } from '../Skeleton';

export type ListState = 'ready' | 'loading' | 'empty' | 'error' | 'denied';

export type ListStateBlockProps = {
  state: Exclude<ListState, 'ready'>;
  label: string;
  empty?: { message: string; action?: ReactNode; icon?: ReactNode };
  errorMessage?: string;
  onRetry?: () => void;
  capability?: string;
  rows?: number;
};

/** The four non-ready list states on a solid surface, for lists that are not a DataTable. */
export function ListStateBlock({ state, label, empty, errorMessage, onRetry, capability = 'view this list', rows = 4 }: ListStateBlockProps) {
  if (state === 'loading') return <Skeleton kind="table" rows={rows} />;
  const body = state === 'error'
    ? <ErrorState message={errorMessage ?? `${label} could not be loaded.`} onRetry={onRetry} />
    : state === 'denied'
      ? <PermissionDenied capability={capability} />
      : <EmptyState message={empty?.message ?? 'Nothing to show yet.'} action={empty?.action} icon={empty?.icon} />;
  return <div className="solid-panel">{body}</div>;
}
