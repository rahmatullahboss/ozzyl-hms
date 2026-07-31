import { describe, expect, it } from 'vitest';
import { dhakaDateInputValue } from './DailyCollectionReport';

describe('DailyCollectionReport Bangladesh date', () => {
  it('uses the next Bangladesh calendar day during the UTC midnight boundary', () => {
    const instant = new Date('2026-07-10T20:30:00.000Z');
    expect(dhakaDateInputValue(instant)).toBe('2026-07-11');
  });

  it('does not shift an early Bangladesh morning back to the prior UTC date', () => {
    const instant = new Date('2026-07-10T18:15:00.000Z');
    expect(dhakaDateInputValue(instant)).toBe('2026-07-11');
  });
});
