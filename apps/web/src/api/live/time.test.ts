import { describe, expect, it } from 'vitest';
import { cellDate, classification, mapMyTime, periodFor, phaseOptions, rangeLabel, statusOf, type ApiMyTime } from './time';

// Shape copied from GET /me/time in apps/api/src/modules/time.ts.
const fixture: ApiMyTime = {
  period_start: '2026-11-02', period_end: '2026-11-08', timesheet_id: 'ts-1', status: 'Returned',
  lines: [
    {
      key: 'ph-1', phase_id: 'ph-1', internal_category_id: null, title: 'Concept design', subtitle: 'PRJ-01 Courtyard House',
      hours: [8, 13, 0, 0, 0, 0, 0], reason: 'Split by phase', state: 'returned',
      entries: [{ id: 'e1', service_date: '2026-11-02', duration_hours: '8.00', approval_state: 'Returned', billing_state: 'Unbilled' }],
    },
    {
      key: 'unclassified-e9', phase_id: null, internal_category_id: null, title: 'Unclassified', subtitle: 'Needs a project and phase',
      hours: [0, 0, 1.5, 0, 0, 0, 0], reason: null, state: 'unclassified',
      entries: [{ id: 'e9', service_date: '2026-11-04', duration_hours: { restricted: true }, approval_state: 'Draft', billing_state: 'Unbilled' }],
    },
  ],
  day_totals: [8, 13, 1.5, 0, 0, 0, 0],
  flags: [{ code: 'over_12h_day', date: '2026-11-03', hours: '13.00' }],
};

describe('live time mapping', () => {
  it('maps lines, state, reason and hours to the grid', () => {
    const t = mapMyTime(fixture, 0);
    expect(t.range).toBe('02 Nov to 08 Nov 2026');
    expect(t.status).toBe('Returned');
    expect(t.lines[0]).toMatchObject({ id: 'ph-1', title: 'Concept design', state: 'returned', reason: 'Split by phase', hours: [8, 13, 0, 0, 0, 0, 0] });
    expect(t.lines[1].reason).toBeUndefined();
    expect(t.meta['ph-1']).toMatchObject({ phaseId: 'ph-1', internalCategoryId: null });
    expect(t.days.map((d) => d.date)).toEqual(['02', '03', '04', '05', '06', '07', '08']);
  });

  it('keeps over-12h flags from the server and a fenced value as null, not zero', () => {
    const t = mapMyTime({ ...fixture, flags: [...fixture.flags, { code: 'over_12h_day', date: '2026-11-04', hours: { restricted: true } as unknown as string }] }, 0);
    expect(t.overDays).toEqual([{ date: '2026-11-03', hours: 13 }, { date: '2026-11-04', hours: null }]);
    expect(t.meta['unclassified-e9'].entries[0].duration_hours).toEqual({ restricted: true });
  });

  it('maps Open to Not submitted and unknown statuses safely', () => {
    expect(statusOf('Open')).toBe('Not submitted');
    expect(statusOf('Partially approved')).toBe('Partially approved');
  });

  it('computes the Monday period from an offset', () => {
    expect(periodFor(0, new Date(2026, 10, 8))).toBe('2026-11-02');
    expect(periodFor(-1, new Date(2026, 10, 2))).toBe('2026-10-26');
    expect(periodFor(1, new Date(2026, 10, 4))).toBe('2026-11-09');
    expect(cellDate('2026-10-26', 6)).toBe('2026-11-01');
    expect(rangeLabel('2026-12-28', '2027-01-03')).toBe('28 Dec to 03 Jan 2027');
  });

  it('builds picker options from real phases plus internal categories', () => {
    const opts = phaseOptions([{ id: 'p', code: 'PRJ-01', name: 'Courtyard House', phases: [{ id: 'ph-1', code: 'CD', name: 'Concept design' }] }], [{ id: 'c1', key: 'admin', name: 'Administration' }]);
    expect(opts).toEqual([
      { code: 'PRJ-01', name: 'Courtyard House', phases: [{ id: 'ph-1', name: 'Concept design' }] },
      { code: 'Internal', name: 'Internal work', phases: [{ id: 'cat:c1', name: 'Administration' }] },
    ]);
    expect(classification('cat:c1')).toEqual({ internal_category_id: 'c1' });
    expect(classification('ph-1')).toEqual({ phase_id: 'ph-1' });
  });
});
