import { AlertTriangle } from 'lucide-react';
import { TextField } from '../TextField';
import { formatHours } from '../format';

const KIND = { overallocated: 'Overallocated', unavailable: 'Unavailable', 'outside employment': 'Outside employment' } as const;

export type ConflictBannerProps = {
  kind: keyof typeof KIND;
  hoursOver: number;
  detail?: string;
  reason?: string;
  onReasonChange?: (reason: string) => void;
  reasonError?: string;
};

export function ConflictBanner({ kind, hoursOver, detail, reason, onReasonChange, reasonError }: ConflictBannerProps) {
  return (
    <div className="conflict" role="group" aria-label={`Conflict: ${KIND[kind]}`}>
      <p className="conflict__title"><AlertTriangle size={16} strokeWidth={1.5} aria-hidden />{KIND[kind]} by <span className="t-numeric">{formatHours(hoursOver)}</span></p>
      {detail && <p className="t-body-sm">{detail}</p>}
      {onReasonChange && <TextField dense label="Reason to proceed" value={reason ?? ''} onChange={(e) => onReasonChange(e.target.value)} error={reasonError} />}
    </div>
  );
}
