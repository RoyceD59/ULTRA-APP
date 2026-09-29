import { describe, it, expect } from 'vitest';
import { parseFixedUnits } from './refill-input';

describe('refill preview amounts', () => {
  it('converts displayed money and volume into exact integers', () => {
    expect(parseFixedUnits('1.01', 2)).toBe(101);
    expect(parseFixedUnits('1.001', 3)).toBe(1001);
    expect(parseFixedUnits('0', 2)).toBe(0);
    expect(parseFixedUnits('0.29', 2)).toBe(29);
  });
  it('rejects unknowns, negative values, unsupported precision and unsafe values', () => {
    for (const value of ['', '-1', '1.001', '1e2', 'NaN', '9007199254740992']) expect(() => parseFixedUnits(value, 2)).toThrow();
  });
});
