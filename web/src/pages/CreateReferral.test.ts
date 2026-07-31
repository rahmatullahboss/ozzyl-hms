import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('CreateReferral patient search contract', () => {
  it('uses the tenant patient search parameter accepted by the patient API', () => {
    const source = readFileSync('src/pages/CreateReferral.tsx', 'utf8');

    expect(source).toContain('/api/patients?search=');
    expect(source).not.toContain('/api/patients?q=');
  });
});
