/** Section 10: the single map from status to tone and to its marker. Chips, dots, bars and planner cells all read this.
 *
 *  The tone is the semantic group (it drives the --tone tokens a few components still read).
 *  The marker is what the approved redesign draws: an 8px square beside sentence-case text.
 *    filled   black square   active, in progress, approved, submitted
 *    outlined black outline  planned, draft, pending, not submitted
 *    alert    redline square overdue, overrun, rejected, returned, blocked, conflict, exception
 *    done     grey square    done, paid, settled, closed, withdrawn
 */
export type Tone = 'neutral' | 'info' | 'warn' | 'ok' | 'danger';
export type Marker = 'filled' | 'outlined' | 'alert' | 'done';

export const STATUS_GROUPS = {
  neutral: ['Draft', 'Planned', 'Not started', 'Not sent', 'Pending start', 'Archived', 'On hold', 'Superseded', 'Cancelled', 'Unsent', 'Not submitted', 'Not payable', 'Not eligible', 'Tentative-plan', 'New', 'Low', 'Not configured', 'CSV', 'None'],
  info: ['Submitted', 'In review', 'Internal review', 'Sent', 'Ready', 'In progress', 'Pending (accounting)', 'Reserved', 'Qualified', 'Proposal', 'Awaiting authorization', 'Identified', 'Estimated', 'Cancellation requested'],
  warn: ['Returned', 'Tentative', 'Pending (approval)', 'Part-paid', 'Uncertain', 'Scope approved', 'Partially approved', 'Expired', 'Suspended', 'Incomplete data', 'Delegated', 'Medium', 'MOCK'],
  ok: ['Approved', 'Accepted', 'Active', 'Done', 'Finalized', 'Settled', 'Paid', 'Published', 'Won', 'Enabled', 'Recorded', 'Billed', 'Eligible', 'Delivery complete', 'Live'],
  danger: ['Rejected', 'Blocked', 'Overdue', 'Disputed', 'Failed', 'Revoked', 'Ended', 'Lost', 'Declined', 'Overallocated', 'Overrun', 'Conflict', 'Excess', 'High'],
} as const;

export type Status = (typeof STATUS_GROUPS)[Tone][number];

/** Every status names its marker explicitly; the type makes a missing one a compile error. */
export const MARKER_BY_STATUS: Record<Status, Marker> = {
  // Planned, draft, pending, not submitted: outlined.
  Draft: 'outlined', Planned: 'outlined', 'Not started': 'outlined', 'Not sent': 'outlined', 'Pending start': 'outlined',
  'On hold': 'outlined', Unsent: 'outlined', 'Not submitted': 'outlined', 'Tentative-plan': 'outlined', New: 'outlined',
  Low: 'outlined', 'Not configured': 'outlined', CSV: 'outlined', 'Pending (accounting)': 'outlined',
  'Awaiting authorization': 'outlined', Identified: 'outlined', Estimated: 'outlined', 'Cancellation requested': 'outlined',
  Tentative: 'outlined', 'Pending (approval)': 'outlined', Uncertain: 'outlined', Medium: 'outlined', MOCK: 'outlined',
  // Active, in progress, approved, submitted: filled.
  Submitted: 'filled', 'In review': 'filled', 'Internal review': 'filled', Sent: 'filled', Ready: 'filled',
  'In progress': 'filled', Reserved: 'filled', Qualified: 'filled', Proposal: 'filled', 'Part-paid': 'filled',
  'Scope approved': 'filled', 'Partially approved': 'filled', Delegated: 'filled', Approved: 'filled', Accepted: 'filled',
  Active: 'filled', Published: 'filled', Won: 'filled', Enabled: 'filled', Eligible: 'filled', Live: 'filled',
  // Problems: the redline.
  Returned: 'alert', Expired: 'alert', Suspended: 'alert', 'Incomplete data': 'alert', Rejected: 'alert', Blocked: 'alert',
  Overdue: 'alert', Disputed: 'alert', Failed: 'alert', Revoked: 'alert', Declined: 'alert', Overallocated: 'alert',
  Overrun: 'alert', Conflict: 'alert', Excess: 'alert', High: 'alert',
  // Done, paid, settled, closed, withdrawn: grey.
  Archived: 'done', Superseded: 'done', Cancelled: 'done', 'Not payable': 'done', 'Not eligible': 'done', None: 'done',
  Done: 'done', Finalized: 'done', Settled: 'done', Paid: 'done', Recorded: 'done', Billed: 'done',
  'Delivery complete': 'done', Ended: 'done', Lost: 'done',
};

const TONE_BY_STATUS = new Map<string, Tone>(
  (Object.entries(STATUS_GROUPS) as [Tone, readonly string[]][]).flatMap(([tone, list]) =>
    list.map((s) => [s, tone] as [string, Tone]),
  ),
);

export function toneOf(status: Status): Tone {
  return TONE_BY_STATUS.get(status) ?? 'neutral';
}

/** The marker the redesign draws for a status. Unknown strings fall back to the outlined (pending) marker. */
export function markerOf(status: Status): Marker {
  return (MARKER_BY_STATUS as Record<string, Marker>)[status] ?? 'outlined';
}

/** The marker a tone implies when there is no status word (bars, cells, queue cards). */
export const MARKER_BY_TONE: Record<Tone, Marker> = { ok: 'filled', info: 'filled', warn: 'outlined', neutral: 'done', danger: 'alert' };

export const toneClass = (tone: Tone) => `tone-${tone}`;
export const markerClass = (marker: Marker) => `marker--${marker}`;
