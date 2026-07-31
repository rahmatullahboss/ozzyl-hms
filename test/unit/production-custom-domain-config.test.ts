import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('production custom-domain configuration', () => {
  it('keeps production browser origins and patient links on Ozzyl domains only', () => {
    const config = readFileSync('wrangler.toml', 'utf8');
    const productionVars = config
      .split('[env.production.vars]')[1]
      ?.split('[env.production.assets]')[0] ?? '';

    expect(productionVars).toContain('ALLOWED_ORIGINS = "https://hms.ozzyl.com,https://app.ozzyl.com,https://admin.ozzyl.com,https://*.ozzyl.com"');
    expect(productionVars).toContain('PATIENT_PORTAL_URL = "https://app.ozzyl.com/patient-portal"');
    expect(productionVars).not.toContain('workers.dev');
    expect(productionVars).not.toContain('pages.dev');
  });
});
