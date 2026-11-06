import type { ReactNode } from 'react';
import { Tooltip } from '../Tooltip';

export type IncompleteIndicatorProps = { missing: string[]; children: ReactNode };

/** Dotted amber ring around a metric with missing inputs. */
export function IncompleteIndicator({ missing, children }: IncompleteIndicatorProps) {
  const list = missing.join(', ');
  return (
    <Tooltip text={`Missing: ${list}`}>
      <span className="incomplete" tabIndex={0} role="group" aria-label={`Incomplete data. Missing: ${list}`}>{children}</span>
    </Tooltip>
  );
}
