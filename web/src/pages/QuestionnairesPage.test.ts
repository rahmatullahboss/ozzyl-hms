import { describe, expect, it } from 'vitest';

describe('QuestionnairesPage', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./QuestionnairesPage');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
