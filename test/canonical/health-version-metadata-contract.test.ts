import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('production health version metadata contract', () => {
  it('binds Worker version metadata in production', () => {
    const wrangler = source('wrangler.toml');

    expect(wrangler).toContain('[env.production.version_metadata]');
    expect(wrangler).toContain('binding = "CF_VERSION_METADATA"');
  });

  it('exposes optional Worker version identity from the public health response', () => {
    const types = source('src/types.ts');
    const index = source('src/index.ts');

    expect(types).toContain('CF_VERSION_METADATA?: WorkerVersionMetadata');
    expect(index).toContain('workerVersionId: c.env.CF_VERSION_METADATA?.id ?? null');
    expect(index).toContain('workerVersionTag: c.env.CF_VERSION_METADATA?.tag ?? null');
  });
});
