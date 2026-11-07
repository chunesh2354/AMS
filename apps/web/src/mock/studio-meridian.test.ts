import { describe, expect, it } from 'vitest';
import { APPROVALS, ATTENTION, AVAILABILITY, PEOPLE, PROJECTS, QUEUES, READY_TO_BILL } from './studio-meridian';

describe('Studio Meridian mock data', () => {
  it('has the ten people from the brief', () => {
    expect(PEOPLE.map((p) => p.id)).toEqual(['P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P07', 'P08', 'P09', 'P10']);
    expect(PEOPLE.find((p) => p.id === 'P09')?.projects).toEqual([]);
    expect(PEOPLE.find((p) => p.id === 'P07')?.daysPerWeek).toBe(4);
  });
  it('has fourteen approvals with the queue counts from the brief', () => {
    expect(APPROVALS).toHaveLength(14);
    const count = (t: string) => APPROVALS.filter((a) => a.type === t).length;
    expect([count('Time'), count('Leave'), count('Expenses'), count('Bills'), count('Changes'), count('Billing drafts')]).toEqual([6, 2, 2, 1, 1, 2]);
    expect(APPROVALS.filter((a) => a.exception)).toHaveLength(1);
    expect(QUEUES.find((q) => q.key === 'approvals')?.count).toBe(14);
  });
  it('carries the 2 h conflict for Divya Menon in the week of 16 Nov', () => {
    const w = AVAILABILITY.P05.find((x) => x.week === '16 Nov')!;
    expect([w.scheduled, w.holiday, w.leave, w.commitments, w.allocated]).toEqual([40, 8, 4, 4, 26]);
    expect(w.allocated - (w.scheduled - w.holiday - w.leave - w.commitments)).toBe(2);
  });
  it('keeps project hours consistent with their phases', () => {
    for (const p of PROJECTS) {
      expect(p.phases.reduce((s, x) => s + x.budget, 0)).toBe(p.hours.budget);
      expect(p.phases.reduce((s, x) => s + x.actual, 0)).toBe(p.hours.actual);
    }
    const lakeview = PROJECTS[0];
    expect(lakeview.phases.reduce((s, x) => s + x.fee, 0)).toBe(lakeview.entitlement.contracted);
    const wd = lakeview.phases.find((x) => x.name === 'Working drawings')!;
    expect([wd.budget, wd.actual, wd.etc]).toEqual([200, 170, 60]);
  });
  it('keeps money consistent across screens', () => {
    expect(READY_TO_BILL).toBe(80000 + 402000 + 4000);
    const outstanding = PROJECTS.reduce((s, p) => s + p.entitlement.invoiced - p.entitlement.collected, 0);
    expect(outstanding).toBe(160000);
  });
  it('points attention rows at the three brief scenarios', () => {
    const titles = ATTENTION.map((a) => a.title).join(' ');
    expect(titles).toContain('INV-DEMO-0007');
    expect(titles).toContain('Working drawings');
    expect(titles).toContain('Divya Menon');
  });
});
