import { describe, expect, it } from 'vitest';

describe('HealthRecordSharing', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./HealthRecordSharing');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
