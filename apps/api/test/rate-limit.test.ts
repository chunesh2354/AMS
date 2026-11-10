import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appUrl, ownerUrl } from '../src/dev/db';
import { buildApp } from '../src/app';
import { limitBucket } from '../src/http/rate-limit';
import { freshApp, type Fresh } from './helpers';

const PORT = 54331;

async function freshDb() {
  const name = `t_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const admin = new pg.Client({ connectionString: ownerUrl(PORT, 'postgres') });
  await admin.connect();
  await admin.query(`create database ${name} template ams_template`);
  await admin.end();
  return appUrl(PORT, name);
}

const badLogin = { email: 'nobody@meridian.demo', password: 'wrong-password-123' };

describe('rate limiting on sign-in endpoints', () => {
  let app: ReturnType<typeof buildApp>;
  beforeAll(async () => {
    app = buildApp(await freshDb(), { rateLimit: { max: 3, windowMs: 60_000 } });
    await app.ready();
  });
  afterAll(async () => { await app?.close(); });

  const login = (ip?: string) =>
    app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: badLogin, headers: ip ? { 'x-forwarded-for': ip } : {} });

  it('answers 429 in the standard error shape once the limit is used up', async () => {
    for (let i = 0; i < 3; i++) expect((await login()).statusCode).toBe(401);
    const res = await login();
    expect(res.statusCode).toBe(429);
    const body = res.json();
    expect(body.error.code).toBe('RATE_LIMITED');
    expect(typeof body.error.message).toBe('string');
    expect(body.error.details).toEqual([]);
    expect(body.error.retry_after_seconds).toBeGreaterThan(0);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('counts per client IP (taken from X-Forwarded-For only behind the local proxy)', async () => {
    expect((await login('203.0.113.7')).statusCode).toBe(401);
  });

  it('counts each endpoint separately and leaves other routes alone', async () => {
    const platform = await app.inject({ method: 'POST', url: '/api/v1/platform/auth/login', payload: badLogin });
    expect(platform.statusCode).not.toBe(429);
    const accept = await app.inject({ method: 'POST', url: '/api/v1/auth/accept-invite', payload: {} });
    expect(accept.statusCode).not.toBe(429);
    for (let i = 0; i < 5; i++) expect((await app.inject({ method: 'GET', url: '/api/v1/health' })).statusCode).toBe(200);
  });

  it('limits accept-invite and the reset routes too', async () => {
    let last = 0;
    for (let i = 0; i < 4; i++) last = (await app.inject({ method: 'POST', url: '/api/v1/auth/accept-invite', payload: {}, headers: { 'x-forwarded-for': '198.51.100.9' } })).statusCode;
    expect(last).toBe(429);
    for (let i = 0; i < 4; i++) last = (await app.inject({ method: 'POST', url: '/api/v1/auth/reset/request', payload: {}, headers: { 'x-forwarded-for': '198.51.100.9' } })).statusCode;
    expect(last).toBe(429);
  });

  it('counts a percent-encoded path against the endpoint it reaches (no bypass of the platform login)', async () => {
    const ip = { 'x-forwarded-for': '192.0.2.44' };
    const codes: number[] = [];
    for (const url of ['/api/v1/platform/auth/login', '/api/v1/platform/auth/%6Cogin', '/api/v1/platform/auth/logi%6E', '/api/v1/platform/auth/%6cogin']) {
      codes.push((await app.inject({ method: 'POST', url, payload: badLogin, headers: ip })).statusCode);
    }
    expect(codes.slice(0, 3)).toEqual([401, 401, 401]);
    expect(codes[3]).toBe(429);
  });

  it('limits the signed-in password change, which checks the current password', async () => {
    const ip = { 'x-forwarded-for': '192.0.2.45' };
    let last = 0;
    for (let i = 0; i < 4; i++) {
      last = (await app.inject({ method: 'POST', url: '/api/v1/me/password', payload: { current_password: 'guess-guess-guess', new_password: 'another-long-password' }, headers: ip })).statusCode;
    }
    expect(last).toBe(429);
  });
});

describe('which requests are limited', () => {
  it('matches only the sign-in style endpoints', () => {
    expect(limitBucket({ method: 'POST', url: '/api/v1/auth/login' })).toBe('/api/v1/auth/login');
    expect(limitBucket({ method: 'POST', url: '/api/v1/auth/login?next=/' })).toBe('/api/v1/auth/login');
    expect(limitBucket({ method: 'POST', url: '/api/v1/platform/auth/login' })).toBe('/api/v1/platform/auth/login');
    expect(limitBucket({ method: 'POST', url: '/api/v1/auth/accept-invite' })).toBe('/api/v1/auth/accept-invite');
    expect(limitBucket({ method: 'POST', url: '/api/v1/auth/reset/confirm' })).toBe('/api/v1/auth/reset');
    expect(limitBucket({ method: 'GET', url: '/api/v1/auth/reset/abc' })).toBe('/api/v1/auth/reset');
    expect(limitBucket({ method: 'GET', url: '/api/v1/auth/login' })).toBeNull();
    expect(limitBucket({ method: 'POST', url: '/api/v1/auth/logout' })).toBeNull();
    expect(limitBucket({ method: 'GET', url: '/api/v1/projects' })).toBeNull();
    expect(limitBucket({ method: 'POST', url: '/api/v1/auth/resetx' })).toBeNull();
    expect(limitBucket({ method: 'POST', url: '/api/v1/me/password' })).toBe('/api/v1/me/password');
    expect(limitBucket({ method: 'GET', url: '/api/v1/me' })).toBeNull();
  });

  it('uses the route Fastify matched, so an encoded or varied URL counts against the same endpoint', () => {
    expect(limitBucket({ method: 'POST', url: '/api/v1/platform/auth/%6Cogin', routeOptions: { url: '/api/v1/platform/auth/login' } })).toBe('/api/v1/platform/auth/login');
    expect(limitBucket({ method: 'POST', url: '/api/v1/auth/rese%74/abc', routeOptions: { url: '/api/v1/auth/reset/:token' } })).toBe('/api/v1/auth/reset');
    expect(limitBucket({ method: 'POST', url: '/api/v1/projects', routeOptions: { url: '/api/v1/projects' } })).toBeNull();
  });
});

describe('off by default in tests', () => {
  let f: Fresh;
  beforeAll(async () => { f = await freshApp(); });
  afterAll(async () => { await f?.close(); });

  it('never answers 429 without an explicit rateLimit option', async () => {
    for (let i = 0; i < 12; i++) expect((await f.rawLogin(badLogin.email, badLogin.password)).statusCode).toBe(401);
  });
});
