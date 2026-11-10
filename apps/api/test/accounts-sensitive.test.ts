import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshApp, type Fresh } from './helpers';

// "Any sensitive grant makes the account sensitive": an employee who holds a single sensitive capability (or a sensitive
// set) is as protected as a principal or finance account when someone changes their types, deactivates or reactivates them.
// P01 is a principal (permissions.grant.sensitive); P10 is operations + finance (people.manage, but not grant.sensitive);
// P04 is staff (no people.manage).
describe('accounts: any sensitive grant makes the account sensitive', () => {
  let f: Fresh;
  beforeAll(async () => {
    f = await freshApp();
    // P06 is an employee by type, but holds a sensitive single capability granted by a principal.
    const granted = await f.call('P01', 'POST', `/people/${f.id('P06')}/grants`, { capability: 'rates.cost.view', reason: 'Fee proposals' });
    expect(granted.status).toBe(200);
  });
  afterAll(async () => { await f?.close(); });

  const refusals = async (ref: string) =>
    (await f.owner.query(`select count(*)::int n from audit_event where action = 'grant_refused' and record_id = $1`, [f.id(ref)])).rows[0].n as number;
  const setsOf = async (ref: string) =>
    (await f.owner.query('select s.key from permission_grant g join permission_set s on s.id = g.permission_set_id where g.person_id = $1 order by s.key', [f.id(ref)])).rows.map((r) => r.key);
  const stateOf = async (ref: string) =>
    (await f.owner.query('select login_state, employment_state from person where id = $1', [f.id(ref)])).rows[0];
  const expectRefused = (res: { status: number; body: any }) => {
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN_CAPABILITY');
    expect(res.body.error.capability).toBe('permissions.grant.sensitive');
  };

  describe('PUT /accounts/:id/types', () => {
    it('a non-principal cannot change the types of an account holding a sensitive capability, and the refusal is audited', async () => {
      const before = await refusals('P06');
      const res = await f.call('P10', 'PUT', `/accounts/${f.id('P06')}/types`, { account_types: ['employee', 'pm'] });
      expectRefused(res);
      expect(res.body.error.message).toMatch(/sensitive account/);
      expect(await refusals('P06')).toBe(before + 1);
      expect(await setsOf('P06')).toEqual(['staff']);
    });

    it('a principal can change them', async () => {
      const res = await f.call('P01', 'PUT', `/accounts/${f.id('P06')}/types`, { account_types: ['employee', 'pm'] });
      expect(res.status).toBe(200);
      expect(res.body.account_types).toEqual(['pm', 'employee']);
      expect(await setsOf('P06')).toEqual(['pm', 'staff']);
    });

    it('a non-principal can still change an ordinary account', async () => {
      const res = await f.call('P10', 'PUT', `/accounts/${f.id('P07')}/types`, { account_types: ['employee', 'pm'] });
      expect(res.status).toBe(200);
      expect(await setsOf('P07')).toEqual(['pm', 'staff']);
    });

    it('staff cannot change types at all', async () => {
      expect((await f.call('P04', 'PUT', `/accounts/${f.id('P07')}/types`, { account_types: ['employee'] })).status).toBe(403);
    });

    it('validates the body, and an unknown id is 404', async () => {
      const empty = await f.call('P01', 'PUT', `/accounts/${f.id('P06')}/types`, { account_types: [] });
      expect(empty.status).toBe(400);
      expect(empty.body.error.code).toBe('VALIDATION');
      const unknown = await f.call('P01', 'PUT', `/accounts/${f.id('P06')}/types`, { account_types: ['wizard'] });
      expect(unknown.status).toBe(400);
      // A malformed id reads as an unknown account (uuidParam), never a server error.
      expect((await f.call('P01', 'PUT', '/accounts/not-a-uuid/types', { account_types: ['employee'] })).status).toBe(404);
    });
  });

  describe('POST /accounts/:id/deactivate and /reactivate', () => {
    it('a non-principal cannot deactivate an account holding a sensitive capability, and the refusal is audited', async () => {
      const before = await refusals('P06');
      const res = await f.call('P10', 'POST', `/accounts/${f.id('P06')}/deactivate`, { reason: 'Left the studio' });
      expectRefused(res);
      expect(await refusals('P06')).toBe(before + 1);
      expect(await stateOf('P06')).toEqual({ login_state: 'Enabled', employment_state: 'Active' });
    });

    it('a principal can deactivate it', async () => {
      const res = await f.call('P01', 'POST', `/accounts/${f.id('P06')}/deactivate`, { reason: 'Left the studio' });
      expect(res.status).toBe(200);
      expect(await stateOf('P06')).toEqual({ login_state: 'Revoked', employment_state: 'Ended' });
    });

    it('a non-principal cannot reactivate it: that would restore the sensitive grant', async () => {
      const before = await refusals('P06');
      const res = await f.call('P10', 'POST', `/accounts/${f.id('P06')}/reactivate`, { reason: 'Rejoined' });
      expectRefused(res);
      expect(await refusals('P06')).toBe(before + 1);
      expect(await stateOf('P06')).toEqual({ login_state: 'Revoked', employment_state: 'Ended' });
    });

    it('a principal can reactivate it', async () => {
      const res = await f.call('P01', 'POST', `/accounts/${f.id('P06')}/reactivate`, { reason: 'Rejoined' });
      expect(res.status).toBe(200);
      expect(await stateOf('P06')).toEqual({ login_state: 'Enabled', employment_state: 'Active' });
    });

    it('a sensitive permission set granted directly counts too', async () => {
      expect((await f.call('P01', 'POST', `/people/${f.id('P08')}/grants`, { permission_set: 'finance', reason: 'Covering accounts' })).status).toBe(200);
      expectRefused(await f.call('P10', 'POST', `/accounts/${f.id('P08')}/deactivate`, { reason: 'Contract ended' }));
      expect(await stateOf('P08')).toEqual({ login_state: 'Enabled', employment_state: 'Active' });
    });

    it('a non-principal can still deactivate and reactivate an ordinary account', async () => {
      expect((await f.call('P10', 'POST', `/accounts/${f.id('P09')}/deactivate`, { reason: 'Internship over' })).status).toBe(200);
      expect(await stateOf('P09')).toEqual({ login_state: 'Revoked', employment_state: 'Ended' });
      expect((await f.call('P10', 'POST', `/accounts/${f.id('P09')}/reactivate`, { reason: 'Extended' })).status).toBe(200);
      expect(await stateOf('P09')).toEqual({ login_state: 'Enabled', employment_state: 'Active' });
    });

    it('staff cannot deactivate or reactivate', async () => {
      expect((await f.call('P04', 'POST', `/accounts/${f.id('P09')}/deactivate`, { reason: 'x' })).status).toBe(403);
      expect((await f.call('P04', 'POST', `/accounts/${f.id('P09')}/reactivate`, {})).status).toBe(403);
      expect(await stateOf('P09')).toEqual({ login_state: 'Enabled', employment_state: 'Active' });
    });

    it('validates the reason, and an unknown id is 404', async () => {
      const blank = await f.call('P01', 'POST', `/accounts/${f.id('P09')}/deactivate`, { reason: '   ' });
      expect(blank.status).toBe(400);
      expect(blank.body.error.code).toBe('VALIDATION');
      expect((await f.call('P01', 'POST', `/accounts/${f.id('P09')}/deactivate`, {})).status).toBe(400);
      expect((await f.call('P01', 'POST', '/accounts/not-a-uuid/reactivate', {})).status).toBe(404);
      expect(await stateOf('P09')).toEqual({ login_state: 'Enabled', employment_state: 'Active' });
    });
  });
});
