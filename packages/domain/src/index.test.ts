import { describe, expect, it } from 'vitest';
import { addDays, capabilityMap, fixedFeeClaim, fromPaise, hoursValue, InvalidTransition, levelFor, MACHINES, nteSplit, outstandingPaise, percentFee, rechargeAmount, toPaise, transition, weekStart } from './index';

describe('worked calculations (spec 15.4)', () => {
  it('fixed fee claim: 60% of 4,00,000 less 1,60,000 billed is 80,000', () => {
    const c = fixedFeeClaim(toPaise('400000'), '60', toPaise('160000'));
    expect(fromPaise(c.entitlement)).toBe('240000.00');
    expect(fromPaise(c.claim)).toBe('80000.00');
    expect(fromPaise(c.remaining)).toBe('160000.00');
  });
  it('NTE: 6 h at 1,000 with 4,000 room is eligible 4,000, excess 2,000', () => {
    const s = nteSplit(hoursValue('6.00', '1000.00'), toPaise('100000'), toPaise('96000'));
    expect(fromPaise(s.eligible)).toBe('4000.00');
    expect(fromPaise(s.excess)).toBe('2000.00');
  });
  it('NTE: an exhausted cap makes everything excess, never an error', () => {
    expect(nteSplit(toPaise('500'), toPaise('1000'), toPaise('1000'))).toEqual({ eligible: 0, excess: toPaise('500') });
  });
  it('6% of 8,00,00,000 is 48,00,000', () => {
    expect(fromPaise(percentFee(toPaise('80000000'), '6'))).toBe('4800000.00');
  });
  it('recharge: 2,50,000 plus 10% is 2,75,000', () => {
    expect(fromPaise(rechargeAmount(toPaise('250000'), '10.00'))).toBe('275000.00');
  });
  it('settlement: 1,60,000 less 1,44,000 cash and 16,000 withholding reaches 0', () => {
    expect(outstandingPaise(toPaise('160000'), toPaise('144000'), toPaise('16000'), 0)).toBe(0);
  });
});

describe('exact paise arithmetic', () => {
  it('round-trips without float drift', () => {
    expect(toPaise('0.07')).toBe(7);
    expect(toPaise('1.10')).toBe(110);
    expect(toPaise('19.99')).toBe(1999);
    expect(toPaise('-12.34')).toBe(-1234);
    expect(toPaise(0.07)).toBe(7);
    expect(fromPaise(7)).toBe('0.07');
    expect(fromPaise(-1234)).toBe('-12.34');
    expect(fromPaise(toPaise('1234567.89'))).toBe('1234567.89');
  });
  it('sums what a float would get wrong', () => {
    expect(fromPaise(toPaise('0.10') + toPaise('0.20'))).toBe('0.30');
  });
  it('hours value is exact before the final rounding', () => {
    expect(hoursValue('38.50', '900.00')).toBe(toPaise('34650'));
    expect(hoursValue('0.07', '1.10')).toBe(8);
  });
});

describe('capability matrix (5.2)', () => {
  const fenced = ['rates.cost.view', 'margin.view', 'budgets.cost.view', 'billing.prepare', 'billing.approve', 'accounting.finalize'];
  it('staff have no cost, margin or billing capability', () => {
    const m = capabilityMap(['staff']);
    for (const c of fenced) expect(m[c], c).toBeUndefined();
  });
  it('operations has no cost view', () => {
    expect(levelFor('operations', 'rates.cost.view')).toBeNull();
    expect(capabilityMap(['operations'])['rates.cost.view']).toBeUndefined();
  });
  it('finance has cost view and finalizes, but does not approve billing by default', () => {
    const m = capabilityMap(['finance']);
    expect(m['rates.cost.view']).toBe('firm');
    expect(m['accounting.finalize']).toBe('firm');
    expect(m['billing.approve']).toBeUndefined();
  });
  it('a PM is scoped and a principal is firm-wide', () => {
    expect(levelFor('pm', 'billing.prepare')).toBe('scoped');
    expect(levelFor('principal', 'billing.approve')).toBe('firm');
  });
  it('combined sets take the strongest level', () => {
    expect(capabilityMap(['operations', 'finance'])['rates.cost.view']).toBe('firm');
  });
});

describe('state machines', () => {
  it('every target is a state of its machine', () => {
    for (const [name, table] of Object.entries(MACHINES)) {
      for (const row of Object.values(table)) for (const to of Object.values(row)) expect(Object.keys(table), `${name} -> ${to}`).toContain(to);
    }
  });
  it('an invalid transition lists what is allowed', () => {
    try {
      transition('timeApproval', 'Submitted', 'submit');
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidTransition);
      expect((e as InvalidTransition).allowed).toEqual(['approve', 'return']);
    }
  });
  it('Uncertain can never go straight to submit', () => {
    expect(() => transition('draftAccounting', 'Uncertain', 'submit')).toThrow(InvalidTransition);
    expect(transition('draftAccounting', 'Uncertain', 'reconcile')).toBe('Finalized');
    expect(transition('draftAccounting', 'Failed', 'submit')).toBe('Pending');
  });
});

describe('weeks', () => {
  it('start on Monday', () => {
    expect(weekStart('2026-11-02')).toBe('2026-11-02');
    expect(weekStart('2026-11-06')).toBe('2026-11-02');
    expect(weekStart('2026-11-08')).toBe('2026-11-02');
    expect(weekStart('2026-11-09')).toBe('2026-11-09');
  });
  it('addDays crosses a month', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
  });
});
