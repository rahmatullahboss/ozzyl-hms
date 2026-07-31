import { describe, expect, it } from 'vitest';

describe('VisualTemplateSelector', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./VisualTemplateSelector');
    const Component = mod.default || Object.values(mod)[0];
    expect(Component).toBeDefined();
    expect(typeof Component).toBe('function');
  });
});
