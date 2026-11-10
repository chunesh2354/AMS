import type { FastifyRequest } from 'fastify';
import type { Tx } from '../db/pool';

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
