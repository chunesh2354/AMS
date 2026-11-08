import { InvalidTransition } from '@ams/domain';

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
