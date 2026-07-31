import { describe, expect, it } from 'vitest';
import { validateBDNationalId } from '../src/lib/nid-validation';

describe('validateBDNationalId', () => {
  it('accepts a 10-digit legacy NID', () => {
    expect(validateBDNationalId('1234567890')).toMatchObject({ valid: true, format: '10-digit' });
  });

  it('rejects non-digit characters', () => {
    expect(validateBDNationalId('12345ABCDE')).toMatchObject({ valid: false, format: 'invalid' });
  });

  it('rejects impossible month values in 17-digit smart NIDs', () => {
    const result = validateBDNationalId('12345678913256780');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/month/i);
  });

  it('rejects invalid smart NID checksum', () => {
    const result = validateBDNationalId('12345678904256789');
    expect(result.valid).toBe(false);
    expect(result.format).toBe('17-digit');
    expect(result.error).toMatch(/checksum/i);
  });
});
