import { describe, it, expect } from 'vitest';
import { issueTokenSchema } from '../src/routes/tenant/queue';

describe('issueTokenSchema — flexible serial', () => {
  const base = { patientId: 1, priority: 'normal' as const };

  it('accepts payload without tokenNumber (auto)', () => {
    const r = issueTokenSchema.parse(base);
    expect(r.tokenNumber).toBeUndefined();
  });

  it('accepts a valid positive integer', () => {
    const r = issueTokenSchema.parse({ ...base, tokenNumber: 50 });
    expect(r.tokenNumber).toBe(50);
  });

  it('accepts the upper bound 99999', () => {
    const r = issueTokenSchema.parse({ ...base, tokenNumber: 99999 });
    expect(r.tokenNumber).toBe(99999);
  });

  it('rejects 0', () => {
    expect(() => issueTokenSchema.parse({ ...base, tokenNumber: 0 })).toThrow();
  });

  it('rejects negative', () => {
    expect(() => issueTokenSchema.parse({ ...base, tokenNumber: -5 })).toThrow();
  });

  it('rejects decimal', () => {
    expect(() => issueTokenSchema.parse({ ...base, tokenNumber: 1.5 })).toThrow();
  });

  it('rejects > 99999', () => {
    expect(() => issueTokenSchema.parse({ ...base, tokenNumber: 100000 })).toThrow();
  });

  it('rejects string', () => {
    expect(() => issueTokenSchema.parse({ ...base, tokenNumber: '5' })).toThrow();
  });
});
