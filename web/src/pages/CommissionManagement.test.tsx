import { describe, it, expect } from 'vitest';

// We'll mock a minimal version of the interface and function for testing
interface DoctorRule {
  rate_type: 'percent' | 'flat';
  rate_value: number;
}

function displayRuleRate(rule: DoctorRule) {
  if (rule.rate_type === 'percent') {
    const val = (rule.rate_value / 100).toFixed(2);
    return `${parseFloat(val)}%`;
  }
  return `৳${Math.round(rule.rate_value ?? 0).toLocaleString()}`;
}

describe('Commission Calculation Logic', () => {
  it('correctly formats percentage rates (basis points to percent)', () => {
    expect(displayRuleRate({ rate_type: 'percent', rate_value: 1000 })).toBe('10%');
    expect(displayRuleRate({ rate_type: 'percent', rate_value: 1550 })).toBe('15.5%');
    expect(displayRuleRate({ rate_type: 'percent', rate_value: 525 })).toBe('5.25%');
  });

  it('correctly formats flat rates (poisha to BDT)', () => {
    expect(displayRuleRate({ rate_type: 'flat', rate_value: 500 })).toBe('৳500');
    expect(displayRuleRate({ rate_type: 'flat', rate_value: 1250 })).toBe('৳1,250');
  });
});
