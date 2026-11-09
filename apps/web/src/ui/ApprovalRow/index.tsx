import { useState } from 'react';
import { Clock, CornerUpLeft, FileDiff, FileText, Receipt, Sun, Wallet } from 'lucide-react';
import { Avatar } from '../Avatar';
import { Button } from '../Button';
import { Checkbox } from '../Checkbox';
import { TextField } from '../TextField';
import { cx } from '../cx';

export type ApprovalRowData = {
  id: string; type: string; submitter: string; project: string; period: string; amount: string; ageDays: number; approver: string; exception?: string;
  /** A sole principal's own work, routed back to them because nobody else in the studio can approve it. */
  selfApproval?: boolean;
};

/** The inbox label for work routed back to its submitter (the server audits the approval as self_approval_override). */
export const SELF_APPROVED_LABEL = 'Self-approved: no other approver in the studio';

const ICONS: Record<string, typeof Clock> = { Time: Clock, Leave: Sun, Expenses: Receipt, Bills: FileText, Changes: FileDiff, 'Billing drafts': Wallet };

export type ApprovalRowProps = {
  item: ApprovalRowData;
  selected?: boolean;
  active?: boolean;
  onSelect?: (checked: boolean) => void;
  onOpen?: () => void;
  onApprove?: () => void;
  onReturn?: (reason: string) => void;
  onDelegate?: () => void;
  defaultReturning?: boolean;
};

/**
 * Exception rows carry a warn rule and cannot join a batch. They have no row Approve either: they are approved from the
 * preview, with the exception in view. The actions sit in their own grid cell, always visible, never over the row.
 */
export function ApprovalRow({ item, selected, active, onSelect, onOpen, onApprove, onReturn, onDelegate, defaultReturning }: ApprovalRowProps) {
  const [returning, setReturning] = useState(!!defaultReturning);
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const Icon = ICONS[item.type] ?? FileText;
  const submitReturn = () => {
    if (!reason.trim()) { setTried(true); return; }
    onReturn?.(reason.trim());
  };
  return (
    <li className={cx('apr', !!item.exception && 'apr--exception', selected && 'apr--selected', active && 'apr--active')}>
      <div className="apr__row">
        <Checkbox
          hideLabel label={item.exception ? `${item.submitter}, ${item.type}: exception, approve on its own` : `Select ${item.submitter}, ${item.type}`}
          checked={!!selected} disabled={!!item.exception} onChange={(e) => onSelect?.(e.target.checked)}
        />
        <span className="apr__type" title={item.type}><Icon size={16} strokeWidth={1.5} aria-hidden /></span>
        <button type="button" className="apr__open" onClick={onOpen} aria-current={active ? 'true' : undefined}>
          <span className="apr__who">{item.submitter}<span className="t-caption ink-2">{item.type}</span>{item.exception && <span className="apr__badge">{item.exception}</span>}</span>
          <span className="t-caption ink-2">{item.project} · {item.period}</span>
          {item.selfApproval && <span className="t-caption ink-2 apr__self">{SELF_APPROVED_LABEL}</span>}
        </button>
        <span className="t-numeric apr__amount">{item.amount}</span>
        <span className="t-numeric ink-2 apr__age">{item.ageDays} d</span>
        <span className="apr__approver" title={`Approver ${item.approver}`} role="img" aria-label={`Approver ${item.approver}`}><Avatar name={item.approver} size={20} /></span>
        <span className="apr__actions">
          {!item.exception && <Button size="dense" variant="secondary" onClick={onApprove}>Approve</Button>}
          <Button size="dense" variant="ghost" icon={<CornerUpLeft size={16} strokeWidth={1.5} aria-hidden />} onClick={() => setReturning(true)}>Return</Button>
          <Button size="dense" variant="ghost" onClick={onDelegate}>Delegate</Button>
        </span>
      </div>
      {returning && (
        <div className="apr__return">
          <TextField
            dense autoFocus label="Reason for returning" value={reason} placeholder="What needs to change"
            error={tried && !reason.trim() ? 'A reason is required' : undefined} onChange={(e) => setReason(e.target.value)}
          />
          <Button size="dense" variant="primary" onClick={submitReturn}>Return</Button>
          <Button size="dense" variant="ghost" onClick={() => { setReturning(false); setTried(false); }}>Cancel</Button>
        </div>
      )}
    </li>
  );
}
