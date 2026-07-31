import { describe, expect, it } from 'vitest';
import { buildMigrationManifestVersion } from '../../scripts/build-migration-manifest';

describe('schema migration manifest determinism', () => {
  it('derives the version only from the content checksum', () => {
    const checksum = `sha256:${'a'.repeat(64)}`;
    expect(buildMigrationManifestVersion(checksum))
      .toBe(buildMigrationManifestVersion(checksum));
    expect(buildMigrationManifestVersion(checksum))
      .not.toBe(buildMigrationManifestVersion(`sha256:${'b'.repeat(64)}`));
    expect(buildMigrationManifestVersion(checksum)).toMatch(/^manifest:[0-9a-f]{64}$/);
  });

  it('rejects a non-SHA-256 checksum', () => {
    expect(() => buildMigrationManifestVersion('not-a-checksum'))
      .toThrow(/sha-256/i);
  });
});
