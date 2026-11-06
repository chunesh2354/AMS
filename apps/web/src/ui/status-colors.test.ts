import { describe, expect, it } from 'vitest';
import { toneOf } from './status-colors';

describe('status-colors', () => {
  it('treats On hold as neutral, a chosen state', () => expect(toneOf('On hold')).toBe('neutral'));
  it('treats Delivery complete as ok', () => expect(toneOf('Delivery complete')).toBe('ok'));
  it('splits the two Pending meanings', () => {
    expect(toneOf('Pending (approval)')).toBe('warn');
    expect(toneOf('Pending (accounting)')).toBe('info');
  });
});
