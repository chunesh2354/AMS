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
