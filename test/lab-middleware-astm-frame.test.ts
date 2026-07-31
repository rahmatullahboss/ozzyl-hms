import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { calculateAstmChecksum, validateAstmChecksum } = require('../tools/lab-middleware/astm-frame.cjs');

describe('local bridge ASTM checksum validation', () => {
  it('accepts only the calculated checksum', () => {
    const content = '1H|\\^&|||Analyzer';
    const terminator = 0x03;
    const checksum = calculateAstmChecksum(content, terminator);

    expect(validateAstmChecksum(content, terminator, checksum)).toEqual({
      valid: true,
      expected: checksum,
      actual: checksum,
    });
  });

  it('rejects 00 when it does not equal the calculated checksum', () => {
    const content = '1H|\\^&|||Analyzer';
    const result = validateAstmChecksum(content, 0x03, '00');

    expect(result.valid).toBe(false);
    expect(result.expected).toBe('00');
    expect(result.actual).not.toBe('00');
  });

  it('rejects malformed and mismatched checksums', () => {
    expect(validateAstmChecksum('1H|test', 0x03, 'ZZ').valid).toBe(false);
    expect(validateAstmChecksum('1H|test', 0x03, 'FF').valid).toBe(false);
  });
});
