import { describe, expect, it } from 'vitest';
import { formatDate, formatDuration, formatHours, formatINR, formatPercent, parseDuration } from './format';

describe('format', () => {
  it('groups INR in en-IN', () => {
    expect(formatINR(400000)).toBe('₹4,00,000');
    expect(formatINR(80000000)).toBe('₹8,00,00,000');
  });
  it('formats hours with two decimals', () => expect(formatHours(6.5)).toBe('6.50 h'));
  it('keeps decimals on percentages only under 10%', () => {
    expect(formatPercent(48)).toBe('48%');
    expect(formatPercent(48.6)).toBe('49%');
    expect(formatPercent(6.5)).toBe('6.5%');
  });
  it('formats dates as DD Mon YYYY', () => expect(formatDate('2026-11-06')).toBe('06 Nov 2026'));
  it('parses h:mm and decimals', () => {
    expect(parseDuration('6:30')).toBe(390);
    expect(parseDuration('6.5')).toBe(390);
    expect(parseDuration('abc')).toBeNull();
    expect(formatDuration(390)).toBe('6:30');
  });
});
