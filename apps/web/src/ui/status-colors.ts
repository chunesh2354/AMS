/** Section 10: the single map from status to tone. Chips, dots, bars and planner cells all read this. */
export type Tone = 'neutral' | 'info' | 'warn' | 'ok' | 'danger';

export const STATUS_GROUPS = {
  neutral: ['Draft', 'Planned', 'Not started', 'Not sent', 'Pending start', 'Archived', 'On hold', 'Superseded', 'Cancelled', 'Unsent', 'Not submitted', 'Not payable', 'Not eligible', 'Tentative-plan', 'New', 'Low', 'Not configured', 'CSV', 'None'],
  info: ['Submitted', 'In review', 'Internal review', 'Sent', 'Ready', 'In progress', 'Pending (accounting)', 'Reserved', 'Qualified', 'Proposal', 'Awaiting authorization', 'Identified', 'Estimated', 'Cancellation requested'],
  warn: ['Returned', 'Tentative', 'Pending (approval)', 'Part-paid', 'Uncertain', 'Scope approved', 'Partially approved', 'Expired', 'Suspended', 'Incomplete data', 'Delegated', 'Medium', 'MOCK'],
  ok: ['Approved', 'Accepted', 'Active', 'Done', 'Finalized', 'Settled', 'Paid', 'Published', 'Won', 'Enabled', 'Recorded', 'Billed', 'Eligible', 'Delivery complete', 'Live'],
  danger: ['Rejected', 'Blocked', 'Overdue', 'Disputed', 'Failed', 'Revoked', 'Ended', 'Lost', 'Declined', 'Overallocated', 'Overrun', 'Conflict', 'Excess', 'High'],
} as const;

export type Status = (typeof STATUS_GROUPS)[Tone][number];

const TONE_BY_STATUS = new Map<string, Tone>(
  (Object.entries(STATUS_GROUPS) as [Tone, readonly string[]][]).flatMap(([tone, list]) =>
    list.map((s) => [s, tone] as [string, Tone]),
  ),
);

export function toneOf(status: Status): Tone {
  return TONE_BY_STATUS.get(status) ?? 'neutral';
}

export const toneClass = (tone: Tone) => `tone-${tone}`;
