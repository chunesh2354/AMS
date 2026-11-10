import type { Actor } from './actor';

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
