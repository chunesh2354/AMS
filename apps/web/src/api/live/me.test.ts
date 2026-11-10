import { describe, expect, it } from 'vitest';
import { greetingFor, mapMyHome, mapMyWork, phaseStatus, projectStatus, roleLabel, type ApiMyHome } from './me';

describe('live me mappers', () => {
  it('greets on the studio clock, not the browser clock', () => {
    // 04:30 UTC is 10:00 in India and 04:30 in London (GMT in November).
    const at = new Date('2026-11-06T04:30:00Z');
    expect(greetingFor('Asia/Kolkata', at)).toBe('Good morning');
    expect(greetingFor('Asia/Kolkata', new Date('2026-11-06T08:30:00Z'))).toBe('Good afternoon');
    expect(greetingFor('Asia/Kolkata', new Date('2026-11-06T13:30:00Z'))).toBe('Good evening');
  });

  it('maps statuses and roles to the design system', () => {
    expect(phaseStatus('Complete')).toBe('Done');
    expect(phaseStatus('In progress')).toBe('In progress');
    expect(phaseStatus('Not started')).toBe('Not started');
    expect(projectStatus('On hold')).toBe('On hold');
    expect(roleLabel('pm')).toBe('Project manager');
    expect(roleLabel('contributor')).toBe('Contributor');
  });

  it('maps GET /me/home, keeping a fenced or missing hour as zero only in the totals and an absent queue as null', () => {
    const r: ApiMyHome = {
      today: '2026-11-06', timezone: 'Asia/Kolkata', person: { id: 'x', name: 'X' }, timer: null,
      week: { period_start: '2026-11-02', period_end: '2026-11-08', hours: '38.50', scheduled_hours: '40.00', days: [{ date: '2026-11-02', hours: '7.00', scheduled_hours: '8.00', over_12h: false }] },
      timesheets: { this_week: { period_start: '2026-11-02', status: 'Open', hours: '38.50' }, last_week: { period_start: '2026-10-26', status: 'Submitted', hours: '40.00' }, notices: [] },
      returned: [{ period_start: '2026-11-02', phase_id: null, internal_category_id: 'c1', project: null, title: 'Training', phase_code: null, hours: '2.00', entries: 1, reason: null }],
      projects: [], pending: { total: 0, by_type: {}, items: [] }, approvals: null,
    };
    const m = mapMyHome(r);
    expect(m.week.hours).toBe(38.5);
    expect(m.week.days[0]).toEqual({ key: 'Mon', date: '2026-11-02', hours: 7, scheduled: 8 });
    expect(m.thisWeek.status).toBe('Not submitted');
    expect(m.lastWeek.status).toBe('Submitted');
    expect(m.returned[0]).toMatchObject({ title: 'Training', where: 'Internal', hours: 2 });
    expect(m.approvals).toBeNull();
    expect(mapMyHome({ ...r, approvals: { total: 0, by_type: {} } }).approvals).toBe(0);
  });

  it('maps GET /me/work', () => {
    const m = mapMyWork({
      today: '2026-11-06', timezone: 'Asia/Kolkata', month: '2026-11', month_start: '2026-11-01', month_end: '2026-11-30', my_hours_month: '4.00',
      projects: [{ id: 'p', code: 'A', name: 'B', client: null, status: 'Active', role: 'pm', my_hours_month: '4.00', phases: [{ id: 'f', code: 'CD', name: 'Concept', status: 'Complete', start_date: null, end_date: null, current: false, my_hours_month: '4.00' }] }],
    });
    expect(m.hours).toBe(4);
    expect(m.projects[0].role).toBe('Project manager');
    expect(m.projects[0].phases[0]).toMatchObject({ status: 'Done', hours: 4, start: null });
  });
});
