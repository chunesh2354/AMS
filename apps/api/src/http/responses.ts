import type { FastifyRequest } from 'fastify';
import { fromPaise } from '@ams/domain';

// ---------- Response conventions (section 11) ----------

export const money = (amount: string | number | null | undefined, currency = 'INR') => (amount == null ? null : { amount: typeof amount === 'number' ? fromPaise(amount) : Number(amount).toFixed(2), currency });
export const hours = (h: string | number | null | undefined) => (h == null ? null : Number(h).toFixed(2));

export function list<T>(req: FastifyRequest, rows: T[], extra: { complete?: boolean; missing_count?: number } = {}) {
  const q = req.query as Record<string, string | undefined>;
  const page = Math.max(1, Number(q.page ?? 1) || 1);
  const size = Math.min(200, Math.max(1, Number(q.page_size ?? 200) || 200));
  return { data: rows.slice((page - 1) * size, page * size), page, page_size: size, total: rows.length, complete: extra.complete ?? true, missing_count: extra.missing_count ?? 0 };
}
