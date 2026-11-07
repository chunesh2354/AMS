import { createHash, randomBytes } from 'node:crypto';
import pg from 'pg';
import type { FastifyRequest } from 'fastify';
import { capabilityMap, fromPaise, InvalidTransition, strongest, type Level, type PermissionSetKey } from '../../../packages/domain/src/index';

pg.types.setTypeParser(1082, (v) => v); // Keep dates as YYYY-MM-DD strings; never let a timezone shift a service date.

export type Tx = pg.PoolClient;

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details: unknown[] = [], public extra: Record<string, unknown> = {}) {
    super(message);
  }
}
export const notFound = (what: string) => new ApiError(404, 'NOT_FOUND', `${what} was not found.`);
export const conflict = (code: string, message: string, extra: Record<string, unknown> = {}) => new ApiError(409, code, message, [], extra);
/** 422 names the rule it enforces. */
export const ruleError = (rule: string, message: string, details: unknown[] = []) => new ApiError(422, 'RULE_VIOLATION', message, details, { rule });

export function rethrowTransition(e: unknown): never {
  if (e instanceof InvalidTransition) {
    throw new ApiError(409, 'INVALID_TRANSITION', e.message, [], { from: e.from, action: e.action, allowed: e.allowed });
  }
  throw e;
}

export type Actor = {
  id: string;
  firmId: string;
  refCode: string;
  name: string;
  sets: PermissionSetKey[];
  caps: Record<string, Level>;
  /** Project ids where the person is PM or lead: the scope of an S capability. */
  ledProjects: string[];
  /** Project ids where the person is any member. */
  memberProjects: string[];
  /** Capabilities granted for specific projects. */
  scopedGrants: Record<string, string[]>;
  sessionId: string;
};

/** Runs one unit of work with the firm set for row-level security. */
export async function withFirm<T>(pool: pg.Pool, firmId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const tx = await pool.connect();
  try {
    await tx.query('begin');
    await tx.query(`select set_config('app.firm_id', $1, true)`, [firmId]);
    const out = await fn(tx);
    await tx.query('commit');
    return out;
  } catch (e) {
    await tx.query('rollback').catch(() => {});
    throw e;
  } finally {
    tx.release();
  }
}

export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');

export async function loadActor(tx: Tx, personId: string, firmId: string, sessionId: string): Promise<Actor> {
  const p = (await tx.query('select id, ref_code, name from person where id = $1', [personId])).rows[0];
  const grants = (await tx.query(
    `select g.capability, g.scope_type, g.scope_id, s.key from permission_grant g left join permission_set s on s.id = g.permission_set_id where g.person_id = $1`,
    [personId],
  )).rows;
  const sets = grants.filter((g) => g.key).map((g) => g.key as PermissionSetKey);
  const caps: Record<string, Level> = capabilityMap(sets);
  const scopedGrants: Record<string, string[]> = {};
  for (const g of grants.filter((x) => x.capability)) {
    if (g.scope_type === 'firm') caps[g.capability] = strongest(caps[g.capability] ?? null, 'firm')!;
    else {
      caps[g.capability] = strongest(caps[g.capability] ?? null, 'scoped')!;
      (scopedGrants[g.capability] ??= []).push(g.scope_id);
    }
  }
  const members = (await tx.query('select project_id, project_role from project_membership where person_id = $1', [personId])).rows;
  return {
    id: personId, firmId, refCode: p.ref_code, name: p.name, sets, caps, sessionId, scopedGrants,
    ledProjects: members.filter((m) => m.project_role === 'pm' || m.project_role === 'lead').map((m) => m.project_id),
    memberProjects: members.map((m) => m.project_id),
  };
}

export const hasFirmCap = (a: Actor, cap: string) => a.caps[cap] === 'firm';

/** Section 3.2 rule 2: every operation asks this, in the service. Throws 403 naming the capability. */
export function authorize(actor: Actor, capability: string, scope: { projectId?: string; ownerId?: string; read?: boolean } = {}) {
  if (!can(actor, capability, scope)) {
    throw new ApiError(403, 'FORBIDDEN_CAPABILITY', `You need ${capability} for this.`, [], { capability });
  }
}
export function can(actor: Actor, capability: string, scope: { projectId?: string; ownerId?: string; read?: boolean } = {}) {
  const level = actor.caps[capability];
  if (level === 'firm') return true;
  if (level === 'view') return !!scope.read;
  if (level === 'scoped') {
    if (!scope.projectId) return false;
    return actor.ledProjects.includes(scope.projectId) || !!actor.scopedGrants[capability]?.includes(scope.projectId);
  }
  if (level === 'own') return !!scope.ownerId && scope.ownerId === actor.id;
  return false;
}

/** Project ids a viewer may see, or 'all'. Membership gates the workspace (AC-F06-4). */
export function visibleProjects(actor: Actor): 'all' | string[] {
  if (['firm', 'view'].includes(actor.caps['projects.plan'] ?? '') || actor.caps['budgets.hours.view'] === 'firm') return 'all';
  return actor.memberProjects;
}
export function assertProjectVisible(actor: Actor, projectId: string) {
  const v = visibleProjects(actor);
  if (v !== 'all' && !v.includes(projectId)) {
    throw new ApiError(403, 'FORBIDDEN_CAPABILITY', 'You are not a member of this project.', [], { capability: 'projects.plan' });
  }
}

/** Section 3.2 rule 7. Runs in the caller's transaction, so an action and its audit row commit together. */
export async function audit(tx: Tx, actor: { id: string; firmId: string } | null, firmId: string, e: { recordType: string; recordId?: string | null; action: string; previous?: unknown; next?: unknown; reason?: string; approvalRef?: string; sensitive?: boolean }) {
  const r = await tx.query(
    `insert into audit_event (firm_id, actor_id, created_by, record_type, record_id, action, previous, new, reason, approval_ref, sensitive)
     values ($1,$2,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
    [firmId, actor?.id ?? null, e.recordType, e.recordId ?? null, e.action, e.previous === undefined ? null : JSON.stringify(e.previous), e.next === undefined ? null : JSON.stringify(e.next), e.reason ?? null, e.approvalRef ?? null, !!e.sensitive],
  );
  return r.rows[0].id as string;
}

export async function notify(tx: Tx, firmId: string, personId: string, eventType: string, text: string, record?: { type: string; id: string }) {
  await tx.query(
    `insert into notification (firm_id, person_id, event_type, text, record_type, record_id) values ($1,$2,$3,$4,$5,$6)`,
    [firmId, personId, eventType, text, record?.type ?? null, record?.id ?? null],
  );
}

// ---------- Response conventions (section 11) ----------

export const money = (amount: string | number | null | undefined, currency = 'INR') => (amount == null ? null : { amount: typeof amount === 'number' ? fromPaise(amount) : Number(amount).toFixed(2), currency });
export const hours = (h: string | number | null | undefined) => (h == null ? null : Number(h).toFixed(2));

export function list<T>(req: FastifyRequest, rows: T[], extra: { complete?: boolean; missing_count?: number } = {}) {
  const q = req.query as Record<string, string | undefined>;
  const page = Math.max(1, Number(q.page ?? 1) || 1);
  const size = Math.min(200, Math.max(1, Number(q.page_size ?? 200) || 200));
  return { data: rows.slice((page - 1) * size, page * size), page, page_size: size, total: rows.length, complete: extra.complete ?? true, missing_count: extra.missing_count ?? 0 };
}

/** Section 5.3 rule 2: which capability unlocks each fenced field. */
export const FENCED: Record<string, string> = {
  cost_rate: 'rates.cost.view', cost_amount: 'rates.cost.view', labour_cost: 'rates.cost.view',
  margin: 'margin.view', contribution: 'margin.view', estimated_revenue_share: 'margin.view',
};

/** Runs on every JSON response. A fenced value is replaced with {restricted:true}: never blank, never zero. */
export function redact(payload: unknown, actor: Actor | null): unknown {
  if (Array.isArray(payload)) return payload.map((x) => redact(x, actor));
  if (!payload || typeof payload !== 'object' || payload instanceof Date) return payload;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    const cap = FENCED[k];
    if (cap && !(actor && actor.caps[cap] === 'firm')) out[k] = { restricted: true };
    else out[k] = redact(v, actor);
  }
  return out;
}

/** Section 5.3 rule 3: a cost figure over fewer than three people could reveal one person's rate. */
export const fenceAggregate = <T,>(actor: Actor, groupSize: number, value: T): T | { restricted: true } =>
  actor.caps['rates.cost.view'] === 'firm' || groupSize >= 3 ? value : { restricted: true };

export function required<T extends Record<string, unknown>>(body: T, fields: (keyof T & string)[]) {
  const missing = fields.filter((f) => body?.[f] == null || body[f] === '');
  if (missing.length) throw new ApiError(400, 'VALIDATION', 'Some required fields are missing.', missing.map((field) => ({ field, code: 'required' })));
}
export const isoDate = (v: unknown, field: string) => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) throw new ApiError(400, 'VALIDATION', `${field} must be a date as YYYY-MM-DD.`, [{ field, code: 'date' }]);
  return v;
};
export const isUuid = (v: unknown) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export const uuidParam = (v: unknown, what: string) => {
  if (!isUuid(v)) throw notFound(what);
  return v as string;
};

/** Replays the original response when the same Idempotency-Key is used again (section 11). */
export async function idempotent<T>(tx: Tx, req: FastifyRequest, firmId: string, route: string, fn: () => Promise<T>): Promise<T> {
  const key = req.headers['idempotency-key'];
  if (typeof key !== 'string' || !key) return fn();
  const hit = await tx.query('select response from idempotency_record where route = $1 and key = $2', [route, key]);
  if (hit.rows[0]) return hit.rows[0].response as T;
  const out = await fn();
  await tx.query('insert into idempotency_record (firm_id, route, key, status, response) values ($1,$2,$3,200,$4)', [firmId, route, key, JSON.stringify(out)]);
  return out;
}
