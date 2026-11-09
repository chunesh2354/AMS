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

/** The URL with tokens masked: long opaque path segments (not record ids) and token/password query values. */
export function scrubUrl(url: string): string {
  const q = url.indexOf('?');
  const path = q === -1 ? url : url.slice(0, q);
  const query = q === -1 ? '' : url.slice(q);
  const safePath = path.split('/').map((s) => (TOKEN_SEGMENT.test(s) && !UUID.test(s) ? '[REDACTED]' : s)).join('/');
  return safePath + query.replace(SECRET_QUERY, '$1[REDACTED]');
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
        // Only these fields: no headers, no body.
        req: (req: FastifyRequest) => ({ method: req.method, url: scrubUrl(req.url), remoteAddress: req.ip }),
      },
    },
    genReqId: () => randomUUID(),
    // The id is always ours; an incoming x-request-id header is not trusted.
    requestIdHeader: false as const,
  };
}
