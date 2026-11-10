import { describe, expect, it } from 'vitest';
import { mapDirectoryPerson, mapProfile, type ApiDirectoryPerson, type ApiProfile } from './people';

const R = { restricted: true } as const;
const row: ApiDirectoryPerson = {
  id: 'u1', ref_code: 'P04', name: 'Rohan', job_title: 'Senior architect', employment_state: 'Active', login_state: 'Enabled', invitation_state: 'Accepted',
  account_types: ['employee'], manager: { id: 'u2', ref_code: 'P02', name: 'Vikram' }, projects_count: 2,
  this_week: { week_start: '2026-11-02', logged_hours: '38.50' },
};
const profile: ApiProfile = {
  id: 'u1', ref_code: 'P04', name: 'Rohan', work_email: 'r@x.test', job_title: 'Senior architect', employment_state: 'Active', login_state: 'Enabled', invitation_state: 'Accepted',
  account_types: ['employee'], manager: null, projects: [], hidden_projects: 1,
  time: { week_start: '2026-11-02', weeks: [{ week_start: '2026-11-02', logged_hours: '38.50', approved_hours: '0.00' }] },
  rates: { bill_rate: { amount: '2200.00', currency: 'INR' }, bill_effective_from: '2026-04-01', cost_rate: null, cost_effective_from: null },
};

describe('live people mapping', () => {
  it('maps a directory row with its hours', () => {
    expect(mapDirectoryPerson(row)).toEqual({
      id: 'u1', ref: 'P04', name: 'Rohan', title: 'Senior architect', employment: 'Active', login: 'Enabled', invitation: 'Accepted',
      accountTypes: ['employee'], manager: 'Vikram', projects: 2, weekHours: { restricted: false, value: 38.5 },
    });
  });

  it('keeps fenced hours restricted, never zero', () => {
    expect(mapDirectoryPerson({ ...row, this_week: { week_start: '2026-11-02', logged_hours: R } }).weekHours).toEqual(R);
  });

  it('maps a profile: a missing rate is null inside the fence, a fenced one is restricted', () => {
    const p = mapProfile(profile);
    expect(p.billRate).toEqual({ restricted: false, value: 2200 });
    expect(p.costRate).toEqual({ restricted: false, value: null });
    expect(p.time).toEqual({ restricted: false, value: { week: '2026-11-02', weeks: [{ week: '2026-11-02', logged: 38.5, approved: 0 }] } });
    const fenced = mapProfile({ ...profile, time: R, rates: { bill_rate: R, bill_effective_from: null, cost_rate: R, cost_effective_from: null } });
    expect(fenced.time).toEqual(R);
    expect(fenced.billRate).toEqual(R);
    expect(fenced.costRate).toEqual(R);
    expect(fenced.hiddenProjects).toBe(1);
  });
});
