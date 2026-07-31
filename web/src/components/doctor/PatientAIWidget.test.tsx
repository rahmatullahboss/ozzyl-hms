import { describe, expect, it } from 'vitest';

describe('PatientAIWidget', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./PatientAIWidget');
    expect(mod.PatientAIWidget).toBeDefined();
    expect(typeof mod.PatientAIWidget).toBe('function');
  });
});
