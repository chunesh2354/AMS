/**
 * Rate limiting for the sign-in style endpoints only: firm login, platform login, accepting an invite,
 * the password reset routes and the signed-in password change (it checks the current password).
 * Matched by method and the route Fastify dispatched to (not the raw URL, which a client can percent-encode
 * or otherwise vary while still reaching the same handler), so the route files need no changes.
 *
 * Defaults: 10 requests per minute per client IP per endpoint. Configure with AUTH_RATE_LIMIT_MAX and
 * AUTH_RATE_LIMIT_WINDOW_MS (0 turns it off). Off in tests unless a test passes buildApp({ rateLimit }).
 * The client IP comes from X-Forwarded-For only when the request arrives from loopback (Caddy).
 */
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ApiError } from './errors';
import { isTestRun, scrubUrl } from './logging';

export type RateLimitOptions = { max: number; windowMs: number } | false;

const EXACT = new Set([
  'POST /api/v1/auth/login',
  'POST /api/v1/platform/auth/login',
  'POST /api/v1/auth/accept-invite',
  'POST /api/v1/me/password',
]);
const RESET = '/api/v1/auth/reset';

/** Which limit a request counts against, or null when it is not limited. */
export function limitBucket(req: Pick<FastifyRequest, 'method' | 'url'> & { routeOptions?: { url?: string } }): string | null {
  // The matched route pattern (e.g. /api/v1/auth/reset/:token); the raw path only when nothing matched.
  const path = req.routeOptions?.url ?? req.url.split('?')[0];
  if (EXACT.has(`${req.method} ${path}`)) return path;
  if (path === RESET || path.startsWith(`${RESET}/`)) return RESET;
  return null;
}

function settings(opt?: RateLimitOptions): { max: number; windowMs: number } | null {
  if (opt === false) return null;
  if (opt) return opt;
  if (isTestRun()) return null;
  const max = Number(process.env.AUTH_RATE_LIMIT_MAX ?? 10);
  const windowMs = Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS ?? 60_000);
  return max > 0 && windowMs > 0 ? { max, windowMs } : null;
}

/** Register the limiter and its onRequest hook. Call before other onRequest hooks so it runs first. */
export function authRateLimit(app: FastifyInstance, opt?: RateLimitOptions) {
  const s = settings(opt);
  if (!s) return;
  app.register(rateLimit, {
    global: false,
    max: s.max,
    timeWindow: s.windowMs,
    keyGenerator: (req) => `${req.ip}|${limitBucket(req)}`,
    onExceeded: (req) => { req.log.warn({ url: scrubUrl(req.url) }, 'rate limit exceeded'); },
    errorResponseBuilder: (_req, ctx) =>
      new ApiError(429, 'RATE_LIMITED', `Too many attempts. Please try again in ${ctx.after}.`, [], { retry_after_seconds: Math.ceil(ctx.ttl / 1000) }),
  });
  let limiter: ReturnType<FastifyInstance['rateLimit']> | undefined;
  app.addHook('onRequest', async function (req, reply) {
    if (!limitBucket(req)) return;
    limiter ??= app.rateLimit();
    await limiter.call(this, req, reply);
  });
}
