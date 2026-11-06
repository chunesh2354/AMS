import { Lock } from 'lucide-react';
import { Tooltip } from '../Tooltip';

export type RestrictedCellProps = { reason?: string };

/** Fenced value: hatched with a lock. Never blank, never zero. */
export function RestrictedCell({ reason = 'Requires finance permission' }: RestrictedCellProps) {
  return (
    <Tooltip text={reason}>
      <span className="restricted" role="img" tabIndex={0} aria-label={`restricted, ${reason.toLowerCase()}`}>
        <Lock size={14} strokeWidth={1.5} aria-hidden />
      </span>
    </Tooltip>
  );
}
