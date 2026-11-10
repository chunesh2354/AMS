import { describe, expect, it } from 'vitest';
import { MARKER_BY_STATUS, STATUS_GROUPS, markerOf, toneOf, type Status, type Tone } from './status-colors';

describe('status-colors', () => {
  it('treats On hold as neutral, a chosen state', () => expect(toneOf('On hold')).toBe('neutral'));
  it('treats Delivery complete as ok', () => expect(toneOf('Delivery complete')).toBe('ok'));
  it('splits the two Pending meanings', () => {
    expect(toneOf('Pending (approval)')).toBe('warn');
    expect(toneOf('Pending (accounting)')).toBe('info');
  });
});

describe('status markers', () => {
  it('gives every status a marker', () => {
    const all = (Object.keys(STATUS_GROUPS) as Tone[]).flatMap((t) => [...STATUS_GROUPS[t]] as Status[]);
    for (const s of all) expect(MARKER_BY_STATUS[s], s).toMatch(/^(filled|outlined|alert|done)$/);
    expect(Object.keys(MARKER_BY_STATUS).sort()).toEqual([...all].sort());
  });
  it('fills active, in-progress, approved and submitted work', () => {
    for (const s of ['Active', 'In progress', 'Approved', 'Submitted'] as Status[]) expect(markerOf(s), s).toBe('filled');
  });
  it('outlines planned, draft, pending and not submitted work', () => {
    for (const s of ['Planned', 'Draft', 'Pending (approval)', 'Pending (accounting)', 'Not submitted'] as Status[]) expect(markerOf(s), s).toBe('outlined');
  });
  it('keeps the redline for problems only', () => {
    for (const s of ['Overdue', 'Overrun', 'Rejected', 'Returned', 'Blocked', 'Conflict'] as Status[]) expect(markerOf(s), s).toBe('alert');
    for (const s of ['Approved', 'Paid', 'Draft', 'Done'] as Status[]) expect(markerOf(s), s).not.toBe('alert');
  });
  it('greys out finished and closed work', () => {
    for (const s of ['Done', 'Paid', 'Settled', 'Cancelled', 'Archived'] as Status[]) expect(markerOf(s), s).toBe('done');
  });
});
