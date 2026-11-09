import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getProjectTab, getProjectTimeLive, mapProjectTimeRow, nameOf, savePhaseProgress, type ApiProjectTimeRow } from './project-tabs';
import type { ApiProject } from './projects';

const m = (amount: string) => ({ amount, currency: 'INR' });
const PROJECT: ApiProject = {
  id: 'uuid-1', code: 'PRJ-01', name: 'Riverside Library', client: 'City Trust', client_id: 'c1', status: 'Active', hold_reason: null, contract: 'Fixed fee',
  pm: { id: 'p2', ref_code: 'P02', name: 'Asha' },
  hours: { budget: '400.00', actual: '120.50', forecast: '450.00' },
  delivery_progress_pct: 30,
  entitlement: { restricted: true },
  contribution: { restricted: true },
  phases: [{ id: 'ph1', code: 'SD', name: 'Schematic design', start_date: '2026-04-01', end_date: '2026-06-30', owner: { id: 'p4', ref_code: 'P04', name: 'Rohan' },
    budget_hours: '200.00', actual_hours: '120.50', etc_hours: '100.00', forecast_hours: '220.50', delivery_progress_pct: 40, fee: m('300000.00'), status: 'Active' },
  { id: 'ph2', code: 'WD', name: 'Working drawings', start_date: null, end_date: null, owner: null,
    budget_hours: '200.00', actual_hours: '0.00', etc_hours: '200.00', forecast_hours: '200.00', delivery_progress_pct: 0, fee: m('100000.00'), status: 'Not started' }],
};

const calls: { url: string; init: RequestInit }[] = [];
let reply: { status: number; body: unknown } = { status: 200, body: {} };
beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(reply.body), { status: reply.status });
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe('project tab getters', () => {
  it('maps GET /projects/:code with a name for every PM and owner ref code', async () => {
    reply = { status: 200, body: PROJECT };
    const p = await getProjectTab('PRJ-01');
    expect(calls[0].url).toBe('/api/v1/projects/PRJ-01');
    expect(p?.people).toEqual({ P02: 'Asha', P04: 'Rohan' });
    expect(p?.phases.map((x) => x.ownerId)).toEqual(['P04', '']);
    expect(nameOf(p!.people, 'P04')).toBe('Rohan');
    expect(nameOf(p!.people, '')).toBe('None');
    expect(p?.entitlement).toEqual({ restricted: true });
  });

  it('returns null for a 404 and throws other failures', async () => {
    reply = { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Project not found' } } };
    expect(await getProjectTab('NOPE')).toBeNull();
    reply = { status: 403, body: { error: { code: 'FORBIDDEN_CAPABILITY', message: 'You are not a member of this project.' } } };
    await expect(getProjectTab('PRJ-02')).rejects.toMatchObject({ status: 403 });
  });

  it('sends ETC and delivery to PUT /phases/:id/progress', async () => {
    reply = { status: 200, body: { ok: true, audit_event_id: 'e1' } };
    await savePhaseProgress('ph1', { etc: 80, delivery: 55 });
    expect(calls[0].url).toBe('/api/v1/phases/ph1/progress');
    expect(calls[0].init.method).toBe('PUT');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ etc_hours: 80, delivery_progress_pct: 55 });
  });

  it('maps project time rows and derives one status per row', async () => {
    const row = (over: Partial<ApiProjectTimeRow>): ApiProjectTimeRow => ({
      person: { id: 'u1', ref_code: 'P08', name: 'Arjun Das' }, phase: { id: 'ph1', name: 'Concept design' },
      draft: '0.00', submitted: '0.00', returned: '0.00', approved: '0.00', return_reason: null, ...over,
    });
    expect(mapProjectTimeRow('PRJ-01', row({ returned: '10.00', submitted: '8.00', return_reason: 'wrong phase' }))).toMatchObject({
      id: 'u1:ph1', personId: 'P08', personName: 'Arjun Das', phase: 'Concept design', returned: 10, submitted: 8, status: 'Returned', note: 'wrong phase',
    });
    expect(mapProjectTimeRow('PRJ-01', row({ submitted: '8.00' })).status).toBe('Submitted');
    expect(mapProjectTimeRow('PRJ-01', row({ draft: '2.50' })).status).toBe('Draft');
    expect(mapProjectTimeRow('PRJ-01', row({ approved: '7.00' })).status).toBe('Approved');

    reply = { status: 200, body: { data: [row({ approved: '7.00' })], page: 1, page_size: 50, total: 1, complete: true, missing_count: 0 } };
    const rows = await getProjectTimeLive('PRJ-01');
    expect(calls[0].url).toBe('/api/v1/projects/PRJ-01/time');
    expect(rows[0]).toMatchObject({ project: 'PRJ-01', approved: 7 });
  });
});
