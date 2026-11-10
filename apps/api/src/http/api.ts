import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import type { Actor } from '../auth/actor';
import type { Tx } from '../db/pool';

declare module 'fastify' {
  interface FastifyRequest { actor: Actor | null }
}

export type Ctx = { req: FastifyRequest; reply: FastifyReply; actor: Actor; tx: Tx; firmId: string; body: any; params: any; query: any };
export type Handler = (c: Ctx) => Promise<unknown>;
export type Api = {
  app: FastifyInstance;
  pool: pg.Pool;
  get: (path: string, h: Handler) => void;
  post: (path: string, h: Handler) => void;
  put: (path: string, h: Handler) => void;
  del: (path: string, h: Handler) => void;
};
