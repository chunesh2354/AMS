import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiFailure, apiFetch, hoursOf, isLive, parseFailure, rupees } from './live';

describe('parseFailure', () => {
  it('reads code, message and details from the error body and keeps the whole body as raw', () => {
    const body = { error: { code: 'RULE_VIOLATION', message: 'Hours cannot exceed 24.', details: [{ field: 'hours', code: 'max' }], rule: 'R3' } };
    const f = parseFailure(422, JSON.stringify(body));
    expect(f).toBeInstanceOf(ApiFailure);
    expect(f).toBeInstanceOf(Error);
    expect(f.status).toBe(422);
    expect(f.code).toBe('RULE_VIOLATION');
    expect(f.message).toBe('Hours cannot exceed 24.');
    expect(f.details).toEqual([{ field: 'hours', code: 'max' }]);
    expect(f.raw).toEqual(body);
  });

  it('still gives a usable failure for an empty or non-JSON body', () => {
    expect(parseFailure(500, '')).toMatchObject({ status: 500, code: 'UNKNOWN', details: [], raw: null });
    const html = parseFailure(502, '<html>Bad gateway</html>');
    expect(html.code).toBe('UNKNOWN');
    expect(html.message).toContain('502');
    expect(html.raw).toBe('<html>Bad gateway</html>');
  });
});

describe('apiFetch', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    window.history.pushState({}, '', '/login');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.pushState({}, '', '/');
  });

  it('sends JSON under /api/v1 with the cookie and the idempotency key', async () => {
    fetchMock.mockResolvedValue(new Response('{"id":"x"}', { status: 200 }));
    await expect(apiFetch('/projects', { body: { a: 1 }, idempotencyKey: 'k1' })).resolves.toEqual({ id: 'x' });
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'k1' },
      credentials: 'same-origin',
      body: '{"a":1}',
    });
  });

  it('sends no JSON content type without a body, which Fastify would refuse', async () => {
    fetchMock.mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    await apiFetch('/auth/logout', { method: 'POST' });
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST', headers: {}, body: undefined });
  });

  it('throws the server failure when bad credentials come back on the login page', async () => {
    fetchMock.mockResolvedValue(new Response('{"error":{"code":"INVALID_CREDENTIALS","message":"That email and password do not match."}}', { status: 401 }));
    await expect(apiFetch('/auth/login', { body: {} })).rejects.toMatchObject({ status: 401, code: 'INVALID_CREDENTIALS', message: 'That email and password do not match.' });
    expect(window.location.pathname).toBe('/login');
  });

  it('turns a network failure into an ApiFailure', async () => {
    fetchMock.mockRejectedValue(new TypeError('failed'));
    await expect(apiFetch('/me')).rejects.toMatchObject({ status: 0, code: 'NETWORK' });
  });
});

describe('value helpers', () => {
  it('reads money and hours, and never turns a fenced or absent value into zero', () => {
    expect(rupees({ amount: '1234.50', currency: 'INR' })).toBe(1234.5);
    expect(rupees({ restricted: true })).toBeNull();
    expect(rupees(null)).toBeNull();
    expect(hoursOf('7.50')).toBe(7.5);
    expect(hoursOf({ restricted: true })).toBeNull();
  });

  it('stays in mock mode by default', () => {
    expect(isLive).toBe(false);
  });
});
