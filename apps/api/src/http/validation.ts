import { ApiError, notFound } from './errors';

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

/**
 * True when n has at most two decimals. n * 100 is not exact in floating point (1.1 * 100 = 110.00000000000001),
 * so an exact comparison would refuse about one in nine valid two-decimal values.
 */
export const hasTwoDecimals = (n: number) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;

/** The largest amount a numeric(14,2) money column holds. Anything above it would be a database error, not a 400. */
export const MONEY_MAX = 999_999_999_999.99;

/**
 * A money amount in rupees: a number (or numeric string), at most two decimals, within the money columns' range,
 * and at least zero (or above zero with `positive`). 400 VALIDATION naming the field otherwise.
 */
export function moneyAmount(v: unknown, field: string, what: string, opts: { positive?: boolean } = {}): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isFinite(n)) throw new ApiError(400, 'VALIDATION', `${what} must be a number.`, [{ field, code: 'number' }]);
  if (opts.positive ? n <= 0 : n < 0) throw new ApiError(400, 'VALIDATION', `${what} must be ${opts.positive ? 'above zero' : 'zero or more'}.`, [{ field, code: 'range' }]);
  if (n > MONEY_MAX) throw new ApiError(400, 'VALIDATION', `${what} is too large.`, [{ field, code: 'range' }]);
  if (!hasTwoDecimals(n)) throw new ApiError(400, 'VALIDATION', `${what} can have at most two decimals.`, [{ field, code: 'precision' }]);
  return n;
}
