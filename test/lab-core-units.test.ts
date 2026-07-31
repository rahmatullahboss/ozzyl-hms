import { describe, it, expect } from 'vitest';

// Copy of the Westgard evaluator from labQc.ts for unit testing
function evaluateWestgard(results: Array<{ result_value: number }>, mean: number, sd: number): string[] {
  if (sd === 0) return [];
  const violations: string[] = [];

  for (let i = 0; i < results.length; i++) {
    const z = (results[i].result_value - mean) / sd;
    const absZ = Math.abs(z);

    if (absZ > 3) violations.push(`1-3s at run ${i + 1}: ${z.toFixed(2)} SD`);
    if (absZ > 2 && absZ <= 3) violations.push(`1-2s at run ${i + 1}: ${z.toFixed(2)} SD`);

    if (i > 0) {
      const prevZ = (results[i - 1].result_value - mean) / sd;
      if (Math.abs(z) > 2 && Math.abs(prevZ) > 2 && z > 0 === prevZ > 0) {
        violations.push(`2-2s at runs ${i}-${i + 1}`);
      }
    }

    if (i > 0) {
      const prevZ = (results[i - 1].result_value - mean) / sd;
      if (Math.abs(z - prevZ) > 4) violations.push(`R-4s at runs ${i}-${i + 1}`);
    }

    if (i >= 3) {
      const last4 = results.slice(i - 3, i + 1);
      const allSameSide = last4.every(r => ((r.result_value - mean) / sd) > 0 === z > 0);
      const allBeyond1s = last4.every(r => Math.abs((r.result_value - mean) / sd) > 1);
      if (allSameSide && allBeyond1s && !violations.some(v => v.startsWith(`4-1s at runs ${i - 2}`))) {
        violations.push(`4-1s at runs ${i - 2}-${i + 1}`);
      }
    }

    if (i >= 9) {
      const last10 = results.slice(i - 9, i + 1);
      const allPos = last10.every(r => (r.result_value - mean) / sd > 0);
      const allNeg = last10.every(r => (r.result_value - mean) / sd < 0);
      if ((allPos || allNeg) && !violations.some(v => v.startsWith(`10-x at runs ${i - 8}`))) {
        violations.push(`10-x at runs ${i - 8}-${i + 1}`);
      }
    }
  }

  return violations;
}

function generateCode128Binary(input: string): string {
  const CODE128_PATTERNS: Record<string, number[]> = {
    '11011001100': [2,1,2,2,2,2], '11001101100': [2,2,2,1,2,2], '11001100110': [2,2,2,2,2,1],
    '10010011000': [1,2,1,2,2,3], '10010001100': [1,2,1,3,2,2], '10001001100': [1,3,1,2,2,2],
    '10011001000': [1,2,2,2,1,3], '10011000100': [1,2,2,3,1,2], '10001100100': [1,3,2,2,1,2],
    '11001001000': [2,2,1,2,1,3], '11001000100': [2,2,1,3,1,2], '11000100100': [2,3,1,2,1,2],
    '10110011100': [1,1,2,2,3,2], '10011011100': [1,2,2,1,3,2], '10011001110': [1,2,2,2,3,1],
    '10111001100': [1,1,3,2,2,2], '10011101100': [1,2,3,1,2,2], '10011100110': [1,2,3,2,2,1],
    '11001110010': [2,2,1,1,3,2], '11001011100': [2,2,1,2,3,1], '11001001110': [2,2,1,3,1,2],
    '11011100100': [2,1,1,3,1,2], '11001110100': [2,2,3,1,1,2], '11101101110': [3,1,2,1,3,1],
    '11101001100': [3,1,1,2,2,2], '11100101100': [3,2,1,1,2,2], '11100100110': [3,2,1,2,2,1],
    '11101100100': [3,1,2,2,1,2], '11100110100': [3,2,2,1,1,2], '11100110010': [3,2,2,2,1,1],
    '11011011000': [2,1,2,1,2,3], '11011000110': [2,1,2,3,2,1], '11000110110': [2,3,2,1,2,1],
    '10100011000': [1,1,1,3,2,3], '10001011000': [1,3,1,1,2,3], '10001000110': [1,3,1,3,2,1],
    '10110001000': [1,1,2,3,1,3], '10001101000': [1,3,2,1,1,3], '10001100010': [1,3,2,3,1,1],
    '11010001000': [2,1,1,3,1,3], '11000101000': [2,3,1,1,1,3], '11000100010': [2,3,1,3,1,1],
    '10110111000': [1,1,2,1,3,3], '10110001110': [1,1,2,3,3,1], '10001101110': [1,3,2,1,3,1],
    '10111011000': [1,1,3,1,2,3], '10111000110': [1,1,3,3,2,1], '10001110110': [1,3,3,1,2,1],
    '11101110110': [3,1,3,1,2,1], '11010001110': [2,1,1,3,3,1], '11000101110': [2,3,1,1,3,1],
    '11011101000': [2,1,3,1,1,3], '11011100010': [2,1,3,3,1,1], '11011101110': [2,1,3,1,3,1],
    '11101011000': [3,1,1,1,2,3], '11101000110': [3,1,1,3,2,1], '11100010110': [3,3,1,1,2,1],
    '11101101000': [3,1,2,1,1,3], '11101100010': [3,1,2,3,1,1], '11100011010': [3,3,2,1,1,1],
    '11101111010': [3,1,4,1,1,1], '11001000010': [2,2,1,4,1,1], '11110001010': [4,3,1,1,1,1],
    '10100111100': [1,1,1,2,2,4], '10100001110': [1,1,1,4,2,2], '10010111100': [1,2,1,1,2,4],
    '10010000111': [1,2,1,4,2,1], '10000101110': [1,4,1,1,2,2], '10000100111': [1,4,1,2,2,1],
    '10110011110': [1,1,2,2,1,4], '10110000111': [1,1,2,4,1,2], '10011011110': [1,2,2,1,1,4],
    '10011000011': [1,2,2,4,1,1], '10000110111': [1,4,2,1,1,2], '10000110011': [1,4,2,2,1,1],
    '11000010011': [2,4,1,2,1,1], '11000010111': [2,4,1,1,1,2], '11110111010': [4,1,3,1,1,1],
    '11000111100': [2,2,1,1,1,4], '10001111010': [1,3,4,1,1,1], '10100111110': [1,1,1,2,4,2],
    '10010111110': [1,2,1,1,4,2], '10010011110': [1,2,1,2,4,1], '10111100100': [1,1,4,2,1,2],
    '10011110100': [1,2,4,1,1,2], '10011110010': [1,2,4,2,1,1], '11110100100': [4,1,1,2,1,2],
    '11110010100': [4,2,1,1,1,2], '11110010010': [4,2,1,2,1,1], '11011011110': [2,1,2,1,4,1],
    '11011110110': [2,1,4,1,2,1], '11110110110': [4,1,2,1,2,1], '10101111000': [1,1,1,1,4,3],
    '10100011110': [1,1,1,3,4,1], '10001011110': [1,3,1,1,4,1], '10111101000': [1,1,4,1,1,3],
    '10111100010': [1,1,4,3,1,1], '11110101000': [4,1,1,1,1,3], '11110100010': [4,1,1,3,1,1],
    '10111011110': [1,1,3,1,4,1], '10111101110': [1,1,4,1,3,1], '11101011110': [3,1,1,1,4,1],
    '11110101110': [4,1,1,1,3,1], '11010000100': [2,1,1,4,1,2], '11010010000': [2,1,1,2,1,4],
    '11010011110': [2,1,1,2,3,2], '11000111010': [2,3,3,1,1,1],
  };

  const START_B = '11010010000';
  const STOP = '1100011101011';
  let encoded = START_B;
  let checksum = 104;
  for (let i = 0; i < input.length; i++) {
    const value = input.charCodeAt(i) - 32;
    checksum += value * (i + 1);
    const keys = Object.keys(CODE128_PATTERNS);
    encoded += keys[value] || keys[0];
  }
  checksum = checksum % 103;
  const keys = Object.keys(CODE128_PATTERNS);
  encoded += keys[checksum] || keys[0];
  encoded += STOP;
  return encoded;
}

// ═══════════════════════════════════════════════════════════════════════════════
// QC Westgard Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('Westgard Rules', () => {
  const mean = 100;
  const sd = 10;

  it('1-3s: fires when result > 3SD above mean', () => {
    const v = evaluateWestgard([{ result_value: 135 }], mean, sd);
    expect(v.some(x => x.includes('1-3s'))).toBe(true);
  });

  it('1-2s: fires when result > 2SD above mean', () => {
    const v = evaluateWestgard([{ result_value: 125 }], mean, sd);
    expect(v.some(x => x.includes('1-2s'))).toBe(true);
  });

  it('1-3s: fires when result < -3SD', () => {
    const v = evaluateWestgard([{ result_value: 65 }], mean, sd);
    expect(v.some(x => x.includes('1-3s'))).toBe(true);
  });

  it('no violations within 1SD', () => {
    const v = evaluateWestgard([{ result_value: 105 }], mean, sd);
    expect(v).toEqual([]);
  });

  it('2-2s: fires when 2 consecutive > 2SD same side', () => {
    const v = evaluateWestgard([{ result_value: 125 }, { result_value: 128 }], mean, sd);
    expect(v.some(x => x.includes('2-2s'))).toBe(true);
  });

  it('R-4s: fires when consecutive range > 4SD', () => {
    const v = evaluateWestgard([{ result_value: 120 }, { result_value: 162 }], mean, sd);
    expect(v.some(x => x.includes('R-4s'))).toBe(true);
  });

  it('4-1s: fires when 4 consecutive > 1SD same side', () => {
    const v = evaluateWestgard([
      { result_value: 112 }, { result_value: 115 }, { result_value: 113 }, { result_value: 118 },
    ], mean, sd);
    expect(v.some(x => x.includes('4-1s'))).toBe(true);
  });

  it('10-x: fires when 10 consecutive on same side', () => {
    const v = evaluateWestgard(
      Array.from({ length: 10 }, () => ({ result_value: mean + 2 })),
      mean, sd
    );
    expect(v.some(x => x.includes('10-x'))).toBe(true);
  });

  it('10-x: does NOT fire with only 9 values', () => {
    const v = evaluateWestgard(
      Array.from({ length: 9 }, () => ({ result_value: mean + 2 })),
      mean, sd
    );
    expect(v.some(x => x.includes('10-x'))).toBe(false);
  });

  it('handles empty array', () => {
    expect(evaluateWestgard([], mean, sd)).toEqual([]);
  });

  it('handles zero SD', () => {
    expect(evaluateWestgard([{ result_value: 100 }], 100, 0)).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Barcode Generation Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('Barcode Generation', () => {
  it('generates Code128 binary for simple string', () => {
    const binary = generateCode128Binary('A');
    expect(binary).toBeTruthy();
    expect(binary.length).toBeGreaterThan(20);
    expect(binary.startsWith('11010010000')).toBe(true); // START_B
    expect(binary.endsWith('1100011101011')).toBe(true);  // STOP pattern
  });

  it('generates increasing length for longer strings', () => {
    const short = generateCode128Binary('AB');
    const long = generateCode128Binary('ABCDEF');
    expect(long.length).toBeGreaterThan(short.length);
  });

  it('generates only 0 and 1 characters', () => {
    const binary = generateCode128Binary('TEST123');
    expect(binary).toMatch(/^[01]+$/);
  });

  it('handles empty string gracefully', () => {
    const binary = generateCode128Binary('');
    expect(binary).toBeTruthy();
    expect(binary.startsWith('11010010000')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Delta Check Tests
// ═══════════════════════════════════════════════════════════════════════════════

function calculateDelta(current: number, previous: number | null | undefined, threshold = 20): string {
  if (previous === null || previous === undefined || previous === 0) return 'new';
  const change = ((current - previous) / Math.abs(previous)) * 100;
  if (Math.abs(change) <= threshold) return 'stable';
  return change > 0 ? 'increased' : 'decreased';
}

describe('Delta Check', () => {
  it('returns new for null previous', () => {
    expect(calculateDelta(100, null)).toBe('new');
  });

  it('returns stable for small change', () => {
    expect(calculateDelta(100, 98)).toBe('stable');
  });

  it('returns increased for +25% change', () => {
    expect(calculateDelta(125, 100)).toBe('increased');
  });

  it('returns decreased for -25% change', () => {
    expect(calculateDelta(75, 100)).toBe('decreased');
  });

  it('handles zero previous', () => {
    expect(calculateDelta(10, 0)).toBe('new');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Abnormal Flag Detection
// ═══════════════════════════════════════════════════════════════════════════════

function determineAbnormalFlag(value: number, low: number, high: number, cLow?: number | null, cHigh?: number | null): string {
  if (cLow != null && value <= cLow) return 'critical';
  if (cHigh != null && value >= cHigh) return 'critical';
  if (value < low) return 'low';
  if (value > high) return 'high';
  return 'normal';
}

describe('Abnormal Flag Detection', () => {
  it('returns normal', () => {
    expect(determineAbnormalFlag(15, 13.5, 17.5)).toBe('normal');
  });
  it('returns high', () => {
    expect(determineAbnormalFlag(20, 13.5, 17.5)).toBe('high');
  });
  it('returns low', () => {
    expect(determineAbnormalFlag(10, 13.5, 17.5)).toBe('low');
  });
  it('returns critical with explicit thresholds', () => {
    expect(determineAbnormalFlag(5, 13.5, 17.5, 7, 20)).toBe('critical');
  });
});
