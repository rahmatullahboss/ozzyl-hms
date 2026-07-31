export interface SchemaManifestArtifactShape {
  version?: unknown;
  checksum?: unknown;
  migrations?: unknown;
}

export function isSchemaManifestArtifactCompatible(
  manifest: SchemaManifestArtifactShape,
  expectedChecksum: string,
): boolean {
  return typeof manifest.version === 'string'
    && manifest.version.trim().length > 0
    && manifest.checksum === expectedChecksum
    && Array.isArray(manifest.migrations);
}
