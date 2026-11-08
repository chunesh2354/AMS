import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import { isProduction, SESSION_COOKIE } from './config/env';
import { ApiError } from './http/errors';
import type { Api, Handler } from './http/api';
import { loadActor } from './auth/actor';
import { hashToken } from './auth/sessions';
import { redact } from './auth/redaction';
import { createPool, withFirm } from './db/pool';
import { authRoutes } from './modules/identity';
import { projectRoutes } from './modules/projects';
import { timeRoutes } from './modules/time';
import { approvalRoutes } from './modules/approvals';
import { billingRoutes } from './modules/billing';
import { receivableRoutes } from './modules/receivables';
import { integrationRoutes } from './modules/integrations';
import { accountRoutes } from './modules/accounts';
import { platformRoutes, PLATFORM_PREFIX } from './modules/platform';

const PUBLIC = new Set(['/api/v1/auth/login', '/api/v1/health', '/api/v1/auth/accept-invite']);
export { SESSION_COOKIE };
export type { Api, Ctx, Handler } from './http/api';

export function buildApp(connectionString: string, opts: { secureCookie?: boolean } = {}) {
  const pool = createPool(connectionString);
  const app = Fastify({ logger: false, bodyLimit: 1024 * 1024 });
  app.register(cookie);
  app.decorateRequest('actor', null);

  app.addHook('onRequest', async (req) => {
    const path = req.url.split('?')[0];
    if (!path.startsWith('/api/v1/') || PUBLIC.has(path) || path.startsWith('/api/v1/auth/invite/') || path.startsWith(PLATFORM_PREFIX)) return;
    const bearer = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null;
    const token = bearer ?? req.cookies?.[SESSION_COOKIE];
    if (!token) throw new ApiError(401, 'UNAUTHENTICATED', 'Please sign in.');
    const s = (await pool.query('select * from auth_find_session($1)', [hashToken(token)])).rows[0];
    if (!s) throw new ApiError(401, 'UNAUTHENTICATED', 'Please sign in.');
    req.actor = await withFirm(pool, s.firm_id, (tx) => loadActor(tx, s.person_id, s.firm_id, s.session_id));
  });

  // Section 5.3 rule 2: every JSON response passes through the fence.
  app.addHook('preSerialization', async (req, _reply, payload) => redact(payload, req.actor));

  app.setErrorHandler((err: any, _req, reply) => {
    if (err instanceof ApiError) {
      return reply.status(err.status).send({ error: { code: err.code, message: err.message, details: err.details, ...err.extra } });
    }
    if (err.code === '23505') return reply.status(409).send({ error: { code: 'CONFLICT', message: `This record already exists or is already claimed (${err.constraint ?? 'unique'}).`, details: [], constraint: err.constraint } });
    if (err.code === '23P01') return reply.status(409).send({ error: { code: 'OVERLAPPING_VERSION', message: 'This overlaps an existing version.', details: [] } });
    if (err.code === 'P0001') return reply.status(422).send({ error: { code: 'RULE_VIOLATION', message: err.message, details: [] } });
    if (err.code === '22P02' || err.code === '23514' || err.code === '22003' || err.code === '22007' || err.code === '22008') {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: 'A value is not valid.', details: [{ field: err.constraint ?? 'value', code: 'invalid' }] } });
    }
    if (err.statusCode && err.statusCode < 500) return reply.status(err.statusCode).send({ error: { code: 'BAD_REQUEST', message: err.message, details: [] } });
    app.log.error(err);
    if (!isProduction()) console.error(err);
    return reply.status(500).send({ error: { code: 'INTERNAL', message: 'Something went wrong on our side.', details: [] } });
  });

  const wrap = (h: Handler) => async (req: FastifyRequest, reply: FastifyReply) => {
    const actor = req.actor;
    if (!actor) throw new ApiError(401, 'UNAUTHENTICATED', 'Please sign in.');
    return withFirm(pool, actor.firmId, (tx) => h({ req, reply, actor, tx, firmId: actor.firmId, body: req.body ?? {}, params: req.params, query: req.query }));
  };
  const api: Api = {
    app, pool,
    get: (p, h) => { app.get(`/api/v1${p}`, wrap(h)); },
    post: (p, h) => { app.post(`/api/v1${p}`, wrap(h)); },
    put: (p, h) => { app.put(`/api/v1${p}`, wrap(h)); },
    del: (p, h) => { app.delete(`/api/v1${p}`, wrap(h)); },
  };

  app.get('/api/v1/health', async () => ({ status: 'ok' }));
  authRoutes(api, opts);
  accountRoutes(api, opts);
  projectRoutes(api);
  timeRoutes(api);
  approvalRoutes(api);
  billingRoutes(api);
  receivableRoutes(api);
  integrationRoutes(api);
  platformRoutes(app, pool, opts);
  app.addHook('onClose', async () => { await pool.end(); });
  return app;
}
