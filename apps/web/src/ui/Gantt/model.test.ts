import { describe, expect, it } from 'vitest';
import { barBox, daysBetween, moveWords, rangeText, shiftRange, ticksFor, windowFor } from './model';

describe('Gantt model', () => {
  it('builds zoom windows around today and the plan', () => {
    expect(windowFor('week', '2026-11-25')).toEqual({ start: '2026-11-02', end: '2026-12-28' });
    expect(windowFor('month', '2026-11-25')).toEqual({ start: '2026-09-01', end: '2027-03-01' });
    expect(windowFor('quarter', '2026-11-25', { start: '2026-02-02', end: '2027-11-26' })).toEqual({ start: '2026-01-01', end: '2028-01-01' });
    expect(windowFor('year', '2026-11-25', { start: '2026-02-02', end: '2027-11-26' })).toEqual({ start: '2026-01-01', end: '2029-01-01' });
  });

  it('labels ticks by week, month and quarter', () => {
    expect(ticksFor('week', windowFor('week', '2026-11-25')).map((t) => t.label)).toEqual(['2 Nov', '9 Nov', '16 Nov', '23 Nov', '30 Nov', '7 Dec', '14 Dec', '21 Dec']);
    expect(ticksFor('month', { start: '2026-09-01', end: '2027-03-01' })[0]).toEqual({ date: '2026-09-01', label: 'Sep 2026', x: 0 });
    expect(ticksFor('quarter', { start: '2026-01-01', end: '2027-01-01' }).map((t) => t.label)).toEqual(['Q1 2026', 'Q2 2026', 'Q3 2026', 'Q4 2026']);
  });

  it('places whole-day bars and clips them to the window', () => {
    const w = { start: '2026-11-02', end: '2026-12-28' };
    expect(barBox(w, '2026-11-02', '2026-11-08')).toEqual({ left: 0, width: 12.5 });
    expect(barBox(w, '2026-10-01', '2026-11-08')).toEqual({ left: 0, width: 12.5 });
    expect(barBox(w, '2027-01-01', '2027-01-08')).toBeNull();
  });

  it('moves and resizes a range, never letting the end pass the start', () => {
    const r = { start: '2026-11-23', end: '2026-12-11' };
    expect(shiftRange(r, 'move', 7)).toEqual({ start: '2026-11-30', end: '2026-12-18' });
    expect(shiftRange(r, 'end', -3)).toEqual({ start: '2026-11-23', end: '2026-12-08' });
    expect(shiftRange(r, 'start', 30)).toBeNull();
    expect(shiftRange({ start: null, end: '2027-01-15' }, 'move', 3)).toEqual({ start: null, end: '2027-01-18' });
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
  });

  it('words a change and a range', () => {
    expect(moveWords(3, 3)).toBe('moved 3 days later');
    expect(moveWords(0, -1)).toBe('ends 1 day earlier');
    expect(rangeText('2026-12-28', '2027-01-08')).toBe('28 Dec 2026 to 8 Jan 2027');
    expect(rangeText(null, '2027-01-15')).toBe('15 Jan 2027');
  });
});
