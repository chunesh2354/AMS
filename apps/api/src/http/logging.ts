/**
 * Production logging. Fastify's logger (pino) writes one JSON line per event to stdout, which systemd
 * hands to journald (journalctl -u ams-api). Tests stay quiet unless they pass their own stream.
 *
 * What is never logged: request bodies (Fastify does not log them and nothing here adds them),
 * cookies, authorization headers, password fields, bearer-style tokens in URLs (invite and reset links), and
 * the detail of a database error (it can quote row values).
 */
import { randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';

export type LogOptions = { stream: { write(line: string): void }; level?: string };

export const isTestRun = () => Boolean(process.env.VITEST) || process.env.NODE_ENV === 'test';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_SEGMENT = /^[A-Za-z0-9_-]{32,}$/;
const SECRET_QUERY = /([?&](?:token|password|code)=)[^&#]*/gi;

const decoded = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };
// A client can percent-encode a token and still reach the route (Fastify decodes params), so the decoded form is tested too.
const isTokenSegment = (s: string) => (TOKEN_SEGMENT.test(s) || TOKEN_SEGMENT.test(decoded(s))) && !UUID.test(decoded(s));

/** The URL with tokens masked: long opaque path segments (not record ids) and token/password query values. */
export function scrubUrl(url: string): string {
  const q = url.indexOf('?');
  const path = q === -1 ? url : url.slice(0, q);
  const query = q === -1 ? '' : url.slice(q);
  const safePath = path.split('/').map((s) => (isTokenSegment(s) ? '[REDACTED]' : s)).join('/');
  return safePath + query.replace(SECRET_QUERY, '$1[REDACTED]');
}

/** Free text (an error message or stack) with every URL-like path in it scrubbed the same way. */
export function scrubText(text: string): string {
  return text.replace(/\/[^\s"'`<>()]*/g, (m) => scrubUrl(m));
}

/**
 * Errors: the same fields pino's standard serializer gives (type, message, stack, own enumerable fields, cause),
 * with any URL inside the message or stack scrubbed. Fastify writes the raw URL into some of its own messages.
 */
export function serializeErr(err: unknown, seen: Set<unknown> = new Set()): unknown {
  if (!err || typeof err !== 'object') return err;
  if (seen.has(err)) return '[Circular]';
  seen.add(err);
  const e = err as Record<string, unknown> & { constructor?: { name?: string } };
  const out: Record<string, unknown> = {
    type: e.constructor?.name ?? 'Error',
    message: typeof e.message === 'string' ? scrubText(e.message) : e.message,
    stack: typeof e.stack === 'string' ? scrubText(e.stack) : e.stack,
  };
  for (const [k, v] of Object.entries(e)) {
    if (k in out || typeof v === 'function') continue;
    out[k] = k === 'cause' || v instanceof Error ? serializeErr(v, seen) : k === 'url' && typeof v === 'string' ? scrubUrl(v) : v;
  }
  if (e.cause !== undefined && !('cause' in out)) out.cause = serializeErr(e.cause, seen);
  return out;
}

const REDACT = [
  'req.headers.cookie',
  'req.headers.authorization',
  'res.headers["set-cookie"]',
  'password', '*.password', '*.*.password',
  'new_password', '*.new_password', 'current_password', '*.current_password',
  'token', '*.token',
  // A Postgres error's detail can quote the failing row or key, password and token hashes included.
  'err.detail',
];

/** Options for Fastify({ ... }): logger, request ids, and the request serializer. */
export function loggerOptions(opts?: LogOptions) {
  const level = opts ? (opts.level ?? 'info') : isTestRun() ? 'silent' : (process.env.LOG_LEVEL ?? 'info');
  return {
    logger: {
      level,
      ...(opts ? { stream: opts.stream } : {}),
      redact: { paths: REDACT, censor: '[REDACTED]' },
      serializers: {
        // Only these fields: no headers, no body, and never the raw URL (it can carry an invite or reset token).
        req: (req: FastifyRequest) => ({ method: req.method, url: scrubUrl(req.url), remoteAddress: req.ip }),
        res: (reply: { statusCode: number }) => ({ statusCode: reply.statusCode }),
        err: (err: Error) => serializeErr(err) as { [key: string]: unknown; type: string; message: string; stack: string },
      },
    },
    genReqId: () => randomUUID(),
    // The id is always ours; an incoming x-request-id header is not trusted.
    requestIdHeader: false as const,
  };
}
