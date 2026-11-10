/**
 * Pure domain rules shared by the API and the web app: no I/O, no framework.
 * Spec sections 5.2 (capabilities), 3.2 rule 9 (state machines) and 15.4 (worked calculations).
 */

// ---------- Capabilities (section 5.2) ----------

export const PERMISSION_SETS = ['principal', 'operations', 'pm', 'staff', 'finance'] as const;
export type PermissionSetKey = (typeof PERMISSION_SETS)[number];

/** Y firm-wide, S scoped to the person's projects, O own records, V view only, G explicit grant, N never. */
type Cell = 'Y' | 'S' | 'O' | 'V' | 'G' | 'N';

/** Columns: principal, operations, pm, staff, finance. "Authorized scope" and "As designated" are routed per record. */
const MATRIX: Record<string, [Cell, Cell, Cell, Cell, Cell]> = {
  'firm.settings.manage': ['Y', 'G', 'N', 'N', 'N'],
  'people.view': ['Y', 'Y', 'Y', 'Y', 'Y'],
  'people.manage': ['Y', 'Y', 'N', 'N', 'N'],
  'permissions.grant.ordinary': ['Y', 'Y', 'N', 'N', 'N'],
  'permissions.grant.sensitive': ['Y', 'N', 'N', 'N', 'N'],
  'capacity.manage': ['Y', 'Y', 'V', 'O', 'V'],
  'rates.bill.manage': ['Y', 'G', 'G', 'N', 'Y'],
  'rates.cost.view': ['Y', 'N', 'N', 'N', 'Y'],
  'rates.cost.manage': ['Y', 'N', 'N', 'N', 'Y'],
  'margin.view': ['Y', 'G', 'G', 'N', 'Y'],
  'leave.request': ['O', 'O', 'O', 'O', 'O'],
  'leave.approve': ['Y', 'Y', 'Y', 'N', 'Y'],
  'pipeline.manage': ['Y', 'N', 'G', 'N', 'V'],
  'projects.create': ['Y', 'G', 'G', 'N', 'N'],
  'projects.plan': ['Y', 'G', 'S', 'O', 'V'],
  'budgets.cost.view': ['Y', 'N', 'G', 'N', 'Y'],
  'budgets.hours.view': ['Y', 'Y', 'S', 'O', 'Y'],
  'time.enter': ['O', 'O', 'O', 'O', 'O'],
  'time.approve': ['Y', 'G', 'S', 'N', 'G'],
  'expenses.submit': ['O', 'O', 'O', 'O', 'O'],
  'expenses.approve.scope': ['Y', 'N', 'S', 'N', 'N'],
  'expenses.approve.finance': ['Y', 'N', 'N', 'N', 'Y'],
  'changes.manage': ['Y', 'N', 'S', 'N', 'V'],
  'changes.authorize': ['Y', 'N', 'N', 'N', 'N'],
  'billing.prepare': ['Y', 'G', 'S', 'N', 'Y'],
  'billing.approve': ['Y', 'N', 'N', 'N', 'G'],
  'accounting.finalize': ['Y', 'N', 'N', 'N', 'Y'],
  'receivables.manage': ['Y', 'N', 'S', 'N', 'Y'],
  'reports.firm': ['Y', 'G', 'N', 'N', 'Y'],
  'reports.project': ['Y', 'N', 'S', 'N', 'Y'],
  'audit.view': ['Y', 'Y', 'N', 'N', 'Y'],
  'integrations.manage': ['Y', 'N', 'N', 'N', 'Y'],
};
export type Capability = keyof typeof MATRIX & string;
export const CAPABILITIES = Object.keys(MATRIX) as Capability[];

/** Section 5.3 rule 4: these can never be self-granted, and only `permissions.grant.sensitive` may grant them. */
export const SENSITIVE_CAPABILITIES = ['permissions.grant.sensitive', 'rates.cost.view', 'rates.cost.manage', 'margin.view', 'billing.approve', 'accounting.finalize'];
export const isSensitiveCapability = (c: string) => SENSITIVE_CAPABILITIES.includes(c);

export type Level = 'firm' | 'scoped' | 'own' | 'view';
const LEVEL_OF: Partial<Record<Cell, Level>> = { Y: 'firm', S: 'scoped', O: 'own', V: 'view' };
const RANK: Record<Level, number> = { view: 0, own: 1, scoped: 2, firm: 3 };

export function levelFor(set: PermissionSetKey, capability: string): Level | null {
  const row = MATRIX[capability];
  if (!row) return null;
  return LEVEL_OF[row[PERMISSION_SETS.indexOf(set)]] ?? null;
}
export const strongest = (a: Level | null, b: Level | null): Level | null => {
  if (!a) return b;
  if (!b) return a;
  return RANK[a] >= RANK[b] ? a : b;
};
/** A set is sensitive if it carries any sensitive capability by default. */
export const isSensitiveSet = (set: PermissionSetKey) => SENSITIVE_CAPABILITIES.some((c) => levelFor(set, c) != null);
export function capabilityMap(sets: PermissionSetKey[]): Record<string, Level> {
  const out: Record<string, Level> = {};
  for (const c of CAPABILITIES) {
    const level = sets.reduce<Level | null>((best, s) => strongest(best, levelFor(s, c)), null);
    if (level) out[c] = level;
  }
  return out;
}

// ---------- State machines ----------

export class InvalidTransition extends Error {
  constructor(public machine: string, public from: string, public action: string, public allowed: string[]) {
    super(`${machine}: cannot ${action} from ${from}`);
  }
}
type Table = Record<string, Record<string, string>>;
export const MACHINES: Record<string, Table> = {
  timeApproval: {
    Draft: { submit: 'Submitted' },
    Returned: { submit: 'Submitted' },
    Submitted: { approve: 'Approved', return: 'Returned' },
    Approved: { amend: 'Amended' },
    Amended: {},
  },
  timeBilling: { Unbilled: { reserve: 'Reserved' }, Reserved: { bill: 'Billed', release: 'Unbilled' }, Billed: {}, 'Non-billable': {} },
  approvalRequest: { Pending: { approve: 'Approved', return: 'Returned', reject: 'Rejected', withdraw: 'Withdrawn' }, Approved: {}, Returned: {}, Rejected: {}, Withdrawn: {} },
  draftApproval: { Draft: { review: 'In review', reject: 'Rejected' }, 'In review': { approve: 'Approved', reject: 'Rejected', return: 'Draft' }, Approved: {}, Rejected: {} },
  draftAccounting: {
    'Not submitted': { submit: 'Pending' },
    Pending: { finalize: 'Finalized', fail: 'Failed', timeout: 'Uncertain' },
    Failed: { submit: 'Pending' },
    Uncertain: { reconcile: 'Finalized', reconcile_missing: 'Failed' },
    Finalized: {},
  },
  jobStatus: { Queued: { run: 'Running' }, Running: { succeed: 'Succeeded', fail: 'Failed', timeout: 'Uncertain' }, Failed: { run: 'Running' }, Uncertain: { reconcile: 'Succeeded', reconcile_missing: 'Failed' }, Succeeded: {} },
  settlementState: { Unpaid: { part: 'Part-paid', settle: 'Settled', dispute: 'Disputed' }, 'Part-paid': { part: 'Part-paid', settle: 'Settled', dispute: 'Disputed' }, Disputed: { resolve: 'Unpaid', part: 'Disputed', settle: 'Settled' }, Settled: {} },
};
export function transition(machine: keyof typeof MACHINES & string, from: string, action: string): string {
  const row = MACHINES[machine][from] ?? {};
  const to = row[action];
  if (!to) throw new InvalidTransition(machine, from, action, Object.keys(row));
  return to;
}

// ---------- Money and calculations. Money is held as integer paise so no float ever touches an amount. ----------

export const toPaise = (v: string | number): number => {
  const s = typeof v === 'number' ? v.toFixed(2) : v;
  const neg = s.startsWith('-');
  const [i, f = ''] = s.replace('-', '').split('.');
  const n = Number(i) * 100 + Number((f + '00').slice(0, 2));
  return neg ? -n : n;
};
export const fromPaise = (p: number): string => {
  const neg = p < 0;
  const a = Math.abs(Math.round(p));
  return `${neg ? '-' : ''}${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`;
};
export const toCenti = (hours: string | number) => toPaise(hours);

/** Value of hours at a rate, in paise. Hours and rate are both two-decimal, so this stays exact before the final rounding. */
export const hoursValue = (hours: string, rate: string): number => Math.round((toCenti(hours) * toPaise(rate)) / 100);

/** Rule R22: a value that lists what it is missing, rather than pretending a gap is zero. */
export type Computed<T> = { value: T | null; complete: boolean; missing: string[] };
export const computed = <T,>(value: T | null, missing: string[] = []): Computed<T> => ({ value: missing.length ? value : value, complete: missing.length === 0, missing });

/** Fixed-fee progress claim, section 15.4: cumulative authorized entitlement less prior net billing. */
export function fixedFeeClaim(feePaise: number, cumulativePercent: string, priorNetPaise: number) {
  const entitlement = Math.round((feePaise * toCenti(cumulativePercent)) / 10000);
  return { entitlement, claim: entitlement - priorNetPaise, remaining: feePaise - entitlement };
}

/** Rule R11: the cap limits what may be billed, never what may be recorded. */
export function nteSplit(newValuePaise: number, capPaise: number, consumedPaise: number) {
  const room = Math.max(0, capPaise - consumedPaise);
  const eligible = Math.min(newValuePaise, room);
  return { eligible, excess: newValuePaise - eligible };
}

export const percentFee = (basisPaise: number, feePercent: string) => Math.round((basisPaise * Number(feePercent)) / 100);
export const rechargeAmount = (costPaise: number, markupPercent: string | null) =>
  Math.round(costPaise + (markupPercent ? (costPaise * toCenti(markupPercent)) / 10000 : 0));

export const outstandingPaise = (gross: number, cash: number, withholding: number, credits: number, adjustments = 0) => gross + adjustments - cash - withholding - credits;

/** Monday of the week holding this date (D6: Monday to Sunday, firm-configurable later). Dates are YYYY-MM-DD. */
export function weekStart(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const back = (dt.getUTCDay() + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - back);
  return dt.toISOString().slice(0, 10);
}
export const addDays = (iso: string, n: number): string => {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
};
export const OVER_DAY_HOURS = 12;
