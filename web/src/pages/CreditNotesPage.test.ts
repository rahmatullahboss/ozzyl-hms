import { describe, expect, it } from 'vitest';

describe('CreditNotesPage', () => {
  it('can be imported without error', async () => {
    const mod = await import('./CreditNotesPage');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
