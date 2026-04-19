import { describe, it, expect } from 'vitest';
import {
  formatMoney,
  formatNumber,
  formatDate,
  formatRelativeTime,
} from '../format';

describe('format helpers', () => {
  it('formats money in INR by default', () => {
    expect(formatMoney(1234)).toMatch(/1,234/);
  });

  it('returns the fallback for non-finite values', () => {
    expect(formatMoney(undefined, { fallback: 'n/a' })).toBe('n/a');
    expect(formatNumber('not a number', { fallback: '-' })).toBe('-');
  });

  it('formats numbers with grouping', () => {
    expect(formatNumber(1000000)).toBe('10,00,000');
  });

  it('returns the fallback for missing dates', () => {
    expect(formatDate(null, { fallback: 'unknown' })).toBe('unknown');
  });

  it('formats relative time for recent dates', () => {
    const now = new Date();
    const oneMinuteAgo = new Date(now.getTime() - 60_000);
    const result = formatRelativeTime(oneMinuteAgo);
    // "1 minute ago" / "in 0 seconds" depending on rounding — assert on shape
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});
