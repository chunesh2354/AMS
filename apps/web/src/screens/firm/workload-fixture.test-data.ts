/** A GET /workload reply in the server's shapes (apps/api planning.routes.ts weekView and allocationView), for live-mode tests. */
export const WEEKS = ['2026-11-23', '2026-11-30', '2026-12-07', '2026-12-14', '2026-12-21', '2026-12-28', '2027-01-04', '2027-01-11'];
const end = (ws: string) => new Date(Date.parse(`${ws}T00:00:00Z`) + 6 * 86400000).toISOString().slice(0, 10);
const PRJ = { id: 'prj-uuid', code: 'LV-77', name: 'Harbour Pavilion', status: 'Active' };
const PHASE = { id: 'ph-b', code: 'MS', name: 'Massing studies' };
export const INES = { id: 'u-ines', ref_code: 'Q07', name: 'Ines Kuruvilla' };
export const NILA = { id: 'u-pm', ref_code: 'Q02', name: 'Nila Varma' };

export const alloc = (id: string, person: typeof INES | null, week: string, hours: string, state: 'confirmed' | 'tentative', extra: Record<string, unknown> = {}) => ({
  id, project: PRJ, phase: PHASE, person, week_start: week, hours, state, note: null, on_hold: false,
  published: true, unpublished_change: false, overallocation_reason: null, can_edit: true, ...extra,
});

type W = { allocated?: number; confirmed?: number; available?: number; holiday?: { date: string; name: string }; leave?: boolean; allocations?: unknown[]; other?: number };
const week = (ws: string, o: W = {}) => {
  const scheduled = 40;
  const available = o.available ?? 40;
  const allocated = o.allocated ?? 0;
  const confirmed = o.confirmed ?? 0;
  const over = Math.max(0, confirmed - available);
  return {
    week_start: ws, week_end: end(ws), capacity: '40.00', scheduled: `${scheduled}.00`, holiday_hours: o.holiday ? '8.00' : '0.00',
    holidays: o.holiday ? [{ ...o.holiday, half_day: false }] : [],
    leave_approved: o.leave ? '8.00' : '0.00', leave_pending: '0.00', on_leave: !!o.leave,
    leave: o.leave ? [{ id: null, status: 'Approved', start_date: '2026-12-18', end_date: '2026-12-18', half_day: false, leave_type: null, label: 'On leave' }] : [],
    available: `${available}.00`, allocated: `${allocated}.00`, confirmed_allocations: `${confirmed}.00`, tentative_allocations: `${allocated - confirmed}.00`,
    remaining: `${available - allocated}.00`, load_pct: available ? Math.round((allocated / available) * 100) : null,
    conflict: over > 0, over_hours: `${over}.00`, other_hours: `${o.other ?? 0}.00`, allocations: o.allocations ?? [],
  };
};

export function workload(extra: Record<string, unknown> = {}) {
  const a1 = alloc('a1', INES, WEEKS[0], '44.00', 'confirmed', { unpublished_change: true, overallocation_reason: 'Competition deadline' });
  const a2 = alloc('a2', INES, WEEKS[1], '24.00', 'tentative', { published: false, unpublished_change: true });
  const a3 = alloc('a3', INES, WEEKS[2], '36.00', 'confirmed');
  const u1 = alloc('u1', null, WEEKS[0], '5.00', 'tentative', { published: false, unpublished_change: true });
  const ines = WEEKS.map((ws, i) => {
    if (i === 0) return week(ws, { allocated: 44, confirmed: 44, allocations: [a1] });
    if (i === 1) return week(ws, { allocated: 24, allocations: [a2] });
    if (i === 2) return week(ws, { allocated: 36, confirmed: 36, allocations: [a3] });
    if (i === 3) return week(ws, { available: 32, leave: true, allocated: 6, confirmed: 6, other: 6 });
    if (i === 4) return week(ws, { available: 32, holiday: { date: '2026-12-25', name: 'Christmas' } });
    return week(ws);
  });
  const nila = WEEKS.map((ws, i) => (i === 4 ? week(ws, { available: 32, holiday: { date: '2026-12-25', name: 'Christmas' } }) : week(ws)));
  return {
    from: WEEKS[0], to: end(WEEKS[7]), weeks: WEEKS, today: '2026-11-25', timezone: 'Asia/Kolkata', view: 'draft', project: null,
    can_plan: true, pending_changes: 3, last_published: null,
    unassigned: [{ project: PRJ, phase: PHASE, total_hours: '5.00', weeks: WEEKS.map((ws, i) => ({ week_start: ws, hours: i === 0 ? '5.00' : '0.00', allocations: i === 0 ? [u1] : [] })) }],
    people: [
      { person: { ...NILA, job_title: 'Project lead' }, inactive: false, weeks: nila },
      { person: { ...INES, job_title: 'Architect' }, inactive: false, weeks: ines },
    ],
    conflicts: [{ person: INES, week_start: WEEKS[0], available: '40.00', confirmed_allocations: '44.00', over_hours: '4.00' }],
    ...extra,
  };
}

export const PROJECT = {
  id: 'prj-uuid', code: 'LV-77', name: 'Harbour Pavilion', client: 'Port Trust', client_id: 'c1', status: 'Active', hold_reason: null, contract: null,
  pm: { id: 'u-pm', ref_code: 'Q02', name: 'Nila Varma' }, hours: { budget: '0', actual: '0', forecast: '0' }, delivery_progress_pct: 0,
  entitlement: { restricted: true }, contribution: { restricted: true },
  phases: [{ id: 'ph-b', code: 'MS', name: 'Massing studies', start_date: null, end_date: null, owner: null, budget_hours: '0', actual_hours: '0', etc_hours: '0', forecast_hours: '0', delivery_progress_pct: 0, fee: { restricted: true }, status: 'Not started' }],
};
export const DIRECTORY = [
  { id: 'u-pm', ref_code: 'Q02', name: 'Nila Varma', job_title: 'Project lead', manager_id: null, employment_state: 'Active', login_state: 'Enabled' },
  { id: 'u-ines', ref_code: 'Q07', name: 'Ines Kuruvilla', job_title: 'Architect', manager_id: null, employment_state: 'Active', login_state: 'Enabled' },
  { id: 'u-omar', ref_code: 'Q09', name: 'Omar Siddiqui', job_title: 'Designer', manager_id: null, employment_state: 'Active', login_state: 'Enabled' },
];
export const ME = (caps: Record<string, string>) => ({
  person: { id: 'u-pm', ref_code: 'Q02', name: 'Nila Varma', work_email: 'x@firm.test', job_title: 'Project lead', manager_id: null },
  firm: { id: 'f', trading_name: 'Test Studio', legal_name: 'x', currency: 'INR', timezone: 'Asia/Kolkata', accounting_adapter: 'mock' },
  permission_sets: ['principal'], capabilities: caps, led_projects: ['prj-uuid'], member_projects: ['prj-uuid'],
});
