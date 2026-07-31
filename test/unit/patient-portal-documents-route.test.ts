import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const routeFile = resolve(__dirname, '../../src/routes/tenant/patientPortal.ts');

describe('tenant patient portal documents route', () => {
  it('defines the documents endpoint only once', () => {
    const source = readFileSync(routeFile, 'utf8');
    const matches = source.match(/patientPortalRoutes\.get\('\/documents'/g) ?? [];
    expect(matches).toHaveLength(1);
  });

  it('normalizes documents to one canonical patient-facing contract with compatibility aliases', () => {
    const source = readFileSync(routeFile, 'utf8');
    expect(source).toContain('function normalizePatientDocumentContract');
    expect(source).toContain('document_type: documentType');
    expect(source).toContain('type: documentType');
    expect(source).toContain('file_size: Number.isFinite(fileSize) ? fileSize : 0');
    expect(source).toContain('fileSize: Number.isFinite(fileSize) ? fileSize : 0');
    expect(source).toContain('mime_type: row.mime_type ?? null');
    expect(source).toContain('mimeType: row.mime_type ?? null');
    expect(source).toContain('download_url: downloadUrl');
    expect(source).toContain('downloadUrl');
    expect(source).toContain("source = uploadedByPatient ? 'patient_upload' : 'hospital_record'");
  });

  it('returns normalized document objects for list and upload responses without exposing storage keys', () => {
    const source = readFileSync(routeFile, 'utf8');
    expect(source).toContain('const documents = (results ?? []).map((row) => normalizePatientDocumentContract');
    expect(source).toContain('return c.json(paginatedResponse(documents');
    expect(source).toContain('const document = normalizePatientDocumentContract({');
    expect(source).toContain('return c.json({\n    ...document,\n    document,');
    expect(source).not.toContain('file_key: key');
    expect(source).not.toContain('url: `/api/uploads/${key}`');
  });
});
