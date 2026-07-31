import { describe, expect, it } from 'vitest';

describe('ClinicalRemindersPage', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./ClinicalRemindersPage');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
