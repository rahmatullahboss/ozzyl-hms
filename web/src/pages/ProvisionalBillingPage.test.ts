import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('ProvisionalBillingPage', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./ProvisionalBillingPage');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });

  it('wires optional scheme benefit preview into provisional invoice conversion', () => {
    const source = readFileSync('src/pages/ProvisionalBillingPage.tsx', 'utf8');
    expect(source).toContain('checkPaySchemePreviewMutation');
    expect(source).toContain("service_category: 'provisional_bill'");
    expect(source).toContain("serviceCategory: paySchemePreview.service_category ?? 'provisional_bill'");
    expect(source).toContain('schemeApplication: paySchemePreview?.eligible');
    expect(source).toContain('Optional: leave empty for normal provisional conversion.');
  });
});
