/**
 * Rate limiting for the sign-in style endpoints only: firm login, platform login, accepting an invite,
 * the password reset routes and the signed-in password change (it checks the current password).
 * Matched by method and the route Fastify dispatched to (not the raw URL, which a client can percent-encode
 * or otherwise vary while still reaching the same handler), so the route files need no changes.
 *
 * Two limits, both must pass:
 * - per client IP per endpoint: 10 requests per minute by default (AUTH_RATE_LIMIT_MAX, AUTH_RATE_LIMIT_WINDOW_MS;
 *   0 turns both limits off). The client IP comes from X-Forwarded-For only when the request arrives from loopback (Caddy).
 * - per target account per endpoint, whatever IP the attempts come from, so one account cannot be brute-forced
 *   from many addresses: the lower-cased email for firm and platform login, the token for accept-invite and the
 *   reset routes, the signed-in person for the password change. Only FAILED attempts count (any 4xx/5xx except the
 *   429 itself); a success clears the count. 30 failures per 15 minutes by default (AUTH_ACCOUNT_RATE_LIMIT_MAX,
 *   AUTH_ACCOUNT_RATE_LIMIT_WINDOW_MS; 0 turns this one off). Tokens are keyed by their hash, never kept raw.
 *   So that someone who knows an email cannot lock its owner out by sending wrong passwords, an IP that signed in
 *   successfully to that account within the last 30 days is not blocked by the account limit (the IP limit still
 *   applies to it). This memory is per process and is lost on restart.
 * Off in tests unless a test passes buildApp({ rateLimit }); the per-account limit only with rateLimit.account.
 */
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { hashToken } from '../auth/sessions';
import { ApiError } from './errors';
import { isTestRun, scrubUrl } from './logging';

type Limit = { max: number; windowMs: number };
export type RateLimitOptions = (Limit & { account?: Limit | false }) | false;

const EXACT = new Set([
  'POST /api/v1/auth/login',
  'POST /api/v1/platform/auth/login',
  'POST /api/v1/auth/accept-invite',
  'POST /api/v1/me/password',
  // The platform admin's one-time links for a studio's people (migration 009): they hand over who sets a password.
  'POST /api/v1/platform/firms/:id/people/:personId/reset-link',
  'POST /api/v1/platform/firms/:id/people/:personId/invite-link',
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

const envLimit = (maxVar: string, windowVar: string, max: number, windowMs: number): Limit | null => {
  const m = Number(process.env[maxVar] ?? max);
  const w = Number(process.env[windowVar] ?? windowMs);
  return m > 0 && w > 0 ? { max: m, windowMs: w } : null;
};

function settings(opt?: RateLimitOptions): { ip: Limit; account: Limit | null } | null {
  if (opt === false) return null;
  if (opt) return { ip: { max: opt.max, windowMs: opt.windowMs }, account: opt.account || null };
  if (isTestRun()) return null;
  const ip = envLimit('AUTH_RATE_LIMIT_MAX', 'AUTH_RATE_LIMIT_WINDOW_MS', 10, 60_000);
  if (!ip) return null;
  return { ip, account: envLimit('AUTH_ACCOUNT_RATE_LIMIT_MAX', 'AUTH_ACCOUNT_RATE_LIMIT_WINDOW_MS', 30, 15 * 60_000) };
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);

/** The account an attempt targets, or null when the request names none (it then counts against the IP limit only). */
export function accountKey(req: Pick<FastifyRequest, 'method' | 'url' | 'body' | 'params'> & { routeOptions?: { url?: string }; actor?: { id: string } | null }): string | null {
  const bucket = limitBucket(req);
  if (!bucket) return null;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const params = (req.params ?? {}) as Record<string, unknown>;
  let key: string | null = null;
  if (bucket === '/api/v1/auth/login' || bucket === '/api/v1/platform/auth/login') {
    const email = str(body.email);
    key = email && `email:${email.trim().toLowerCase()}`;
  } else if (bucket === '/api/v1/auth/accept-invite') {
    const token = str(body.token);
    key = token && `token:${hashToken(token)}`;
  } else if (bucket === RESET) {
    const token = str(params.token) ?? str(body.token);
    key = token && `token:${hashToken(token)}`;
  } else if (bucket === '/api/v1/me/password') {
    key = req.actor?.id ? `person:${req.actor.id}` : null;
  }
  return key && `${bucket}|${key}`;
}

/** A fixed-window counter per key, kept in memory and bounded (oldest keys dropped first). */
export class WindowCounter {
  private hits = new Map<string, { n: number; start: number }>();
  constructor(private limit: Limit, private capacity = 10_000) {}
  /** The seconds to wait when this key has used up its limit, without counting anything; otherwise null. */
  wait(key: string, now = Date.now()): number | null {
    const h = this.hits.get(key);
    if (!h || now - h.start >= this.limit.windowMs || h.n < this.limit.max) return null;
    return Math.max(1, Math.ceil((h.start + this.limit.windowMs - now) / 1000));
  }
  /** Forget a key (a successful attempt). */
  clear(key: string) { this.hits.delete(key); }
  /** Count one attempt; returns the seconds to wait when the limit is used up, otherwise null. */
  hit(key: string, now = Date.now()): number | null {
    let h = this.hits.get(key);
    if (!h || now - h.start >= this.limit.windowMs) {
      this.hits.delete(key);
      h = { n: 0, start: now };
    }
    h.n += 1;
    this.hits.set(key, h);
    while (this.hits.size > this.capacity) this.hits.delete(this.hits.keys().next().value as string);
    return h.n > this.limit.max ? Math.max(1, Math.ceil((h.start + this.limit.windowMs - now) / 1000)) : null;
  }
}

/** Clients (account key + IP) that signed in successfully recently; bounded, oldest dropped first. */
export class KnownClients {
  private seen = new Map<string, number>();
  constructor(private ttlMs = 30 * 24 * 60 * 60_000, private capacity = 50_000) {}
  add(key: string, ip: string, now = Date.now()) {
    const k = `${key}|${ip}`;
    this.seen.delete(k);
    this.seen.set(k, now + this.ttlMs);
    while (this.seen.size > this.capacity) this.seen.delete(this.seen.keys().next().value as string);
  }
  has(key: string, ip: string, now = Date.now()) {
    const until = this.seen.get(`${key}|${ip}`);
    return until !== undefined && until > now;
  }
}

const tooMany = (seconds: number) => {
  const after = seconds >= 60 ? `${Math.ceil(seconds / 60)} minute${Math.ceil(seconds / 60) === 1 ? '' : 's'}` : `${seconds} second${seconds === 1 ? '' : 's'}`;
  return new ApiError(429, 'RATE_LIMITED', `Too many attempts. Please try again in ${after}.`, [], { retry_after_seconds: seconds });
};

/** Register the limiters and their hooks. Call before other onRequest hooks so the IP limit runs first. */
export function authRateLimit(app: FastifyInstance, opt?: RateLimitOptions) {
  const s = settings(opt);
  if (!s) return;
  app.register(rateLimit, {
    global: false,
    max: s.ip.max,
    timeWindow: s.ip.windowMs,
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

  // The account key needs the parsed body (email, token), so this one runs once the body is read.
  const account = s.account;
  if (!account) return;
  const counter = new WindowCounter(account);
  const known = new KnownClients();
  const keys = new WeakMap<FastifyRequest, string>();
  app.addHook('preValidation', async (req, reply) => {
    const key = accountKey(req);
    if (!key) return;
    keys.set(req, key);
    const wait = counter.wait(key);
    if (wait === null || known.has(key, req.ip)) return;
    // The key itself (an email or a token hash) is not logged.
    req.log.warn({ url: scrubUrl(req.url), bucket: limitBucket(req), limit: 'account' }, 'rate limit exceeded');
    reply.header('retry-after', String(wait));
    throw tooMany(wait);
  });
  // Count the outcome: a failure uses up the account's allowance, a success clears it and remembers the client.
  app.addHook('onResponse', async (req, reply) => {
    const key = keys.get(req);
    if (!key || reply.statusCode === 429) return;
    if (reply.statusCode >= 400) counter.hit(key);
    else { counter.clear(key); known.add(key, req.ip); }
  });
}
