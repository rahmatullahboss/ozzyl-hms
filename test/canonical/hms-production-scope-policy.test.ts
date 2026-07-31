import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const policyPath = 'docs/architecture/hms-production-scope-policy.md';

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('HMS canonical-first production scope policy', () => {
  it('protects the exact live core and permits canonical-first development outside it', () => {
    const policy = read(policyPath);

    for (const text of [
      'protected core envelope',
      'Reception patient registration/lookup',
      'Deployed billing, invoice and collection behaviour',
      'Deployed hospital setup/master data',
      'doctor commission configuration',
      'Every workflow outside the protected core may be substantially refactored or fully rewritten canonical-first',
      'Production observation is a later release/activation gate',
    ]) expect(policy).toContain(text);
  });

  it('keeps compatibility, retirement, ownership, local-sync and production gates explicit', () => {
    const policy = read(policyPath);

    for (const text of [
      'Canonical Data Architecture owns canonical schemas',
      'Inventory Modular Monolith owns the canonical Inventory bounded-context implementation',
      'Local sync remains disabled/deferred',
      'canonical-only cutover of a live protected flow is not authorized',
      'Verified-unused non-production legacy source may be removed only after canonical replacement',
      'production migrations/backfills',
      'separate exact authorization',
    ]) expect(policy).toContain(text);
  });
});
