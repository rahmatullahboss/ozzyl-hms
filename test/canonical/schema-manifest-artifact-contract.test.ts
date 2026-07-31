import { describe, expect, it } from 'vitest';
import { isSchemaManifestArtifactCompatible } from '../../src/lib/schema-manifest-artifact-contract';

const CHECKSUM = `sha256:${'a'.repeat(64)}`;

describe('schema manifest artifact compatibility', () => {
  it('accepts a legacy timestamp version when the content checksum matches', () => {
    expect(isSchemaManifestArtifactCompatible({
      version: '2026-07-18T01:01:26.862Z',
      checksum: CHECKSUM,
      migrations: [],
    }, CHECKSUM)).toBe(true);
  });

  it('accepts a deterministic content-derived version', () => {
    expect(isSchemaManifestArtifactCompatible({
      version: `manifest:${'a'.repeat(64)}`,
      checksum: CHECKSUM,
      migrations: [],
    }, CHECKSUM)).toBe(true);
  });

  it('rejects checksum mismatch, missing version, and malformed migrations', () => {
    expect(isSchemaManifestArtifactCompatible({
      version: '2026-07-18T01:01:26.862Z',
      checksum: `sha256:${'b'.repeat(64)}`,
      migrations: [],
    }, CHECKSUM)).toBe(false);
    expect(isSchemaManifestArtifactCompatible({
      version: '',
      checksum: CHECKSUM,
      migrations: [],
    }, CHECKSUM)).toBe(false);
    expect(isSchemaManifestArtifactCompatible({
      version: `manifest:${'a'.repeat(64)}`,
      checksum: CHECKSUM,
      migrations: null,
    }, CHECKSUM)).toBe(false);
  });
});
