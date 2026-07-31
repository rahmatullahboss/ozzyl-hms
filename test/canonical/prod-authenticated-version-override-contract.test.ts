import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('scripts/prod-authenticated-checks.mjs', 'utf8');

describe('authenticated production candidate override contract', () => {
  it('binds every API and browser request to the requested Worker version', () => {
    expect(source).toContain("const WORKER_VERSION_OVERRIDE_ID = process.env.WORKER_VERSION_OVERRIDE_ID?.trim();");
    expect(source).toContain("'Cloudflare-Workers-Version-Overrides'");
    expect(source).toContain('headers: mergeVersionOverrideHeaders(options.headers)');
    expect(source).toContain('extraHTTPHeaders: VERSION_OVERRIDE_HEADERS');
  });

  it('fails before role checks when health does not identify the requested candidate', () => {
    expect(source).toContain("const health = await jsonFetch('/api/health');");
    expect(source).toContain('health.body?.workerVersionId !== WORKER_VERSION_OVERRIDE_ID');
  });
});
