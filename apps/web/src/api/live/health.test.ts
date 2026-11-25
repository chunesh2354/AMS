import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compactINR, feeShares, getProjectHealth, healthCounts, hoursPct, mockProjectHealth, slipText, sortHealth, whyLine, type HealthRow } from './health';

const base = mockProjectHealth().rows;
const row = (over: Partial<HealthRow>, from = base[1]): HealthRow => ({ ...from, ...over });

describe('project health helpers', () => {
  it('sorts by risk first, then slip; and by slip, hours and name on request', () => {
    const a = row({ id: 'a', code: 'A', name: 'Alpha', health: { status: 'Watch', reasons: ['x'], signals: [] }, schedule: { ...base[1].schedule, slip_days: 2 } });
    const b = row({ id: 'b', code: 'B', name: 'Beta', health: { status: 'At risk', reasons: ['y'], signals: [] }, schedule: { ...base[1].schedule, slip_days: 0 } });
    const c = row({ id: 'c', code: 'C', name: 'Gamma', health: { status: 'Watch', reasons: ['z'], signals: [] }, schedule: { ...base[1].schedule, slip_days: 9 } });
    const d = row({ id: 'd', code: 'D', name: 'Delta', health: { status: 'On track', reasons: [], signals: [] }, hours: { ...base[1].hours, forecast_pct: 120 }, schedule: { ...base[1].schedule, slip_days: null } });
    expect(sortHealth([a, b, c, d], 'risk').map((r) => r.id)).toEqual(['b', 'c', 'a', 'd']);
    expect(sortHealth([a, b, c, d], 'slip').map((r) => r.id)).toEqual(['c', 'a', 'b', 'd']);
    expect(sortHealth([a, b, c, d], 'hours').map((r) => r.id)).toEqual(['d', 'a', 'b', 'c']);
    expect(sortHealth([a, b, c, d], 'name').map((r) => r.id)).toEqual(['a', 'b', 'd', 'c']);
  });

  it('counts by status worst first, and never divides by a zero budget', () => {
    expect(healthCounts(base)).toEqual([{ status: 'At risk', count: 1 }, { status: 'Watch', count: 2 }, { status: 'On track', count: 0 }]);
    expect(hoursPct(row({ hours: { budget: '0.00', actual: '4.00', etc: '0.00', forecast: '4.00', forecast_pct: null } }))).toBeNull();
    expect(hoursPct(row({ hours: { budget: '100.00', actual: '40.00', etc: '10.00', forecast: '50.00', forecast_pct: null } }))).toBe(50);
  });

  it('reads the why line from the API reasons, and says what an On track project reads', () => {
    expect(whyLine(base[0])).toMatch(/^Hours forecast 1830 h is 101.7% of the 1800 h budget\. 1 overdue task blocks other work/);
    expect(whyLine(row({ health: { status: 'On track', reasons: [], signals: [] } }))).toBe('Hours forecast at 94% of budget; schedule and tasks on plan.');
  });

  it('fee shares are fenced as null, and are measured against the fee authorized', () => {
    expect(feeShares({ restricted: true })).toBeNull();
    const f = feeShares(base[0].fee)!;
    expect(f.billedPct).toBeCloseTo(65);
    expect(f.collectedPct).toBeCloseTo(50);
    expect(compactINR(2730000)).toBe('₹27.3 L');
    expect(compactINR(42000)).toBe('₹42,000');
  });

  it('slip text reads On hold, None, No dates or days with the driver', () => {
    expect(slipText(base[2]).value).toBe('On hold');
    expect(slipText(base[1])).toEqual({ value: 'None', sub: 'on plan', late: false });
    expect(slipText(base[0])).toEqual({ value: '5 days', sub: 'Working drawings', late: true });
    expect(slipText(row({ schedule: { ...base[1].schedule, slip_days: null } })).value).toBe('No dates');
  });
});

describe('GET /projects/health', () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({
    data: base, page: 1, page_size: 200, total: 5, complete: true, missing_count: 0,
    today: '2026-11-25', timezone: 'Asia/Kolkata', as_of: null, rule: ['r1'], thresholds: { hours_watch_pct: 90, hours_at_risk_above_pct: 100, slip_watch_days: 1, slip_at_risk_above_days: 7 }, margin_definition: 'def',
  }), { status: 200 }));
  beforeEach(() => vi.stubGlobal('fetch', fetchMock));
  afterEach(() => vi.unstubAllGlobals());

  it('reads the rows, the rule and the thresholds, and notices a paged list', async () => {
    const r = await getProjectHealth();
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe('/api/v1/projects/health?page_size=200');
    expect(r.rows).toHaveLength(3);
    expect(r.rule).toEqual(['r1']);
    expect(r.thresholds?.slip_at_risk_above_days).toBe(7);
    expect(r.marginDefinition).toBe('def');
    expect(r.complete).toBe(false);
  });
});
