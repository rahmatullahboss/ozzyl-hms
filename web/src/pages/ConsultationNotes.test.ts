import { describe, expect, it } from 'vitest';

describe('ConsultationNotes', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./ConsultationNotes');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
