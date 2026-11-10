import { describe, expect, it } from 'vitest';
import { mapContribution, mapProject, riskOf, type ApiProject } from './projects';

const m = (amount: string) => ({ amount, currency: 'INR' });
const base: ApiProject = {
  id: 'uuid-1', code: 'PRJ-01', name: 'Riverside Library', client: 'City Trust', client_id: 'c1', status: 'Active', hold_reason: null, contract: 'Fixed fee',
  pm: { id: 'p2', ref_code: 'P02', name: 'Asha' },
  hours: { budget: '400.00', actual: '120.50', forecast: '450.00' },
  delivery_progress_pct: 30,
  entitlement: { contracted: m('1000000.00'), entitled: m('250000.00'), drafted: m('0.00'), invoiced: m('100000.00'), collected: m('50000.00') },
  contribution: { value: m('180000.00'), complete: false, missing: ['Rohan cost rate'], label: 'Management estimate' },
  phases: [{ id: 'ph1', code: 'SD', name: 'Schematic design', start_date: '2026-04-01', end_date: '2026-06-30', owner: { id: 'p4', ref_code: 'P04', name: 'Rohan' },
    budget_hours: '200.00', actual_hours: '120.50', etc_hours: '100.00', forecast_hours: '220.50', delivery_progress_pct: 40, fee: m('300000.00'), status: 'Active' }],
};

describe('live project mapping', () => {
  it('maps numbers, refs and phases', () => {
    const v = mapProject(base);
    expect(v.pmId).toBe('P02');
    expect(v.hours).toEqual({ budget: 400, actual: 120.5, forecast: 450 });
    expect(v.entitlement).toEqual({ restricted: false, value: { contracted: 1000000, entitled: 250000, drafted: 0, invoiced: 100000, collected: 50000 } });
    expect(v.phases[0]).toMatchObject({ ownerId: 'P04', budget: 200, actual: 120.5, etc: 100, delivery: 40, fee: 300000 });
    expect(v.risk).toEqual({ label: 'At risk', status: 'Overrun' });
    expect(v.live.id).toBe('uuid-1');
  });

  it('keeps an incomplete contribution with its missing list', () => {
    expect(mapContribution(base.contribution)).toEqual({ value: { restricted: false, value: 180000 }, missing: ['Rohan cost rate'] });
  });

  it('renders fenced values as restricted, never zero', () => {
    const v = mapProject({ ...base, entitlement: { restricted: true }, contribution: { restricted: true }, phases: [{ ...base.phases[0], fee: { restricted: true } }] });
    expect(v.entitlement).toEqual({ restricted: true });
    expect(v.contribution).toEqual({ restricted: true });
    expect(v.phases[0].fee).toBeNaN();
  });

  it('does not invent task or conflict counts', () => {
    const v = mapProject(base);
    expect(v.openTasks).toBeNaN();
    expect(v.conflicts).toBeNaN();
  });

  it('derives risk from hold and real overrun only', () => {
    expect(riskOf('On hold', 10, 20).label).toBe('On hold');
    expect(riskOf('Active', 100, 90).label).toBe('On track');
    expect(riskOf('Active', null, 90).label).toBe('No budget');
  });
});
