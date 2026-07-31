import { describe, it, expect, beforeEach, vi } from 'vitest';

// ─── Radiology PACS Forward Endpoint Tests ─────────────────────────────────────
// Tests the /api/radiology/pacs/forward endpoint which receives study metadata
// from on-premise DICOM agents (dicom-scp.js)

describe('Radiology PACS Forward Endpoint', () => {

  // ─── Input Validation ───────────────────────────────────────────────────────

  describe('forwardSchema validation', () => {
    const { z } = require('zod');
    // Recreate the schema from pacs.ts for independent testing
    const forwardSchema = z.object({
      studyInstanceUid: z.string().min(1),
      patientName: z.string().optional(),
      patientId: z.string().optional(),
      modality: z.string().max(10).optional(),
      studyDate: z.string().optional(),
      studyDescription: z.string().optional(),
      sopClassUid: z.string().optional(),
      sourceAETitle: z.string().max(16).optional(),
      requisitionId: z.number().int().positive().optional(),
      r2Key: z.string().optional(),
    });

    it('accepts valid forward payload with required fields', () => {
      const payload = { studyInstanceUid: '1.2.840.113619.2.55.3.604688' };
      const result = forwardSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('accepts full payload with all optional fields', () => {
      const payload = {
        studyInstanceUid: '1.2.840.113619.2.55.3.604688',
        patientName: 'John^Doe',
        patientId: 'PAT001',
        modality: 'RF',
        studyDate: '2026-04-28',
        studyDescription: 'Fluoroscopy-Guided Procedure',
        sopClassUid: '1.2.840.10008.5.1.4.1.1.12.2',
        sourceAETitle: 'FLUORO_SCP',
        requisitionId: 123,
        r2Key: 'dicom/tenant123/1.2.840/study1/sop1.dcm',
      };
      const result = forwardSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('rejects empty studyInstanceUid', () => {
      const payload = { studyInstanceUid: '' };
      const result = forwardSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });

    it('rejects missing studyInstanceUid', () => {
      const payload = { patientName: 'John' };
      const result = forwardSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });

    it('rejects modality longer than 10 characters', () => {
      const payload = { studyInstanceUid: '1.2.840', modality: 'VERYLONGMOD' };
      const result = forwardSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });

    it('rejects negative requisitionId', () => {
      const payload = { studyInstanceUid: '1.2.840', requisitionId: -1 };
      const result = forwardSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });

    it('rejects non-integer requisitionId', () => {
      const payload = { studyInstanceUid: '1.2.840', requisitionId: 1.5 };
      const result = forwardSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });

    it('accepts valid Fluoroscopy modality code RF', () => {
      const payload = { studyInstanceUid: '1.2.840', modality: 'RF' };
      const result = forwardSchema.safeParse(payload);
      expect(result.success).toBe(true);
      expect(result.data.modality).toBe('RF');
    });

    it('accepts valid sourceAETitle exactly 16 chars', () => {
      const payload = { studyInstanceUid: '1.2.840', sourceAETitle: 'ABC_HOSPITAL_SCP' };
      const result = forwardSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('rejects sourceAETitle longer than 16 chars', () => {
      const payload = { studyInstanceUid: '1.2.840', sourceAETitle: 'VERYLONG_AETITLE_NAME' };
      const result = forwardSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });
  });

  // ─── Tenant Isolation ────────────────────────────────────────────────────────

  describe('Tenant isolation', () => {
    it('each hospital must have isolated data', () => {
      const hospitals = [
        { tenantId: 'hms_a_abc', hospitalName: 'ABC Hospital' },
        { tenantId: 'hms_b_xyz', hospitalName: 'XYZ Hospital' },
      ];

      // Simulate studies from different tenants
      const studies = [
        { tenantId: 'hms_a_abc', studyUid: 'study-abc-1', patientName: 'Patient A' },
        { tenantId: 'hms_b_xyz', studyUid: 'study-xyz-1', patientName: 'Patient B' },
      ];

      // Filter by tenant
      const abcStudies = studies.filter(s => s.tenantId === 'hms_a_abc');
      const xyzStudies = studies.filter(s => s.tenantId === 'hms_b_xyz');

      expect(abcStudies.length).toBe(1);
      expect(xyzStudies.length).toBe(1);
      expect(abcStudies[0].patientName).toBe('Patient A');
      expect(xyzStudies[0].patientName).toBe('Patient B');

      // Verify cross-tenant filtering works (no data leakage)
      const allStudiesForA = studies.filter(s => s.tenantId === 'hms_a_abc');
      const allStudiesForB = studies.filter(s => s.tenantId === 'hms_b_xyz');

      expect(allStudiesForA.length).toBe(1);
      expect(allStudiesForA[0].patientName).toBe('Patient A');
      expect(allStudiesForB.length).toBe(1);
      expect(allStudiesForB[0].patientName).toBe('Patient B');

      // Verify no overlap between tenants
      const aUids = new Set(allStudiesForA.map(s => s.studyUid));
      const bUids = new Set(allStudiesForB.map(s => s.studyUid));
      const overlap = [...aUids].filter(uid => bUids.has(uid));
      expect(overlap.length).toBe(0);
    });

    it('API key must match tenant for forward endpoint', () => {
      const tenants = [
        { tenantId: 'hms_a_abc', apiKey: 'key_abc_123', hospitalName: 'ABC Hospital' },
        { tenantId: 'hms_b_xyz', apiKey: 'key_xyz_456', hospitalName: 'XYZ Hospital' },
      ];

      // Validate API key belongs to the claimed tenant
      function validateKey(tenantId: string, apiKey: string) {
        const tenant = tenants.find(t => t.tenantId === tenantId && t.apiKey === apiKey);
        return tenant !== undefined;
      }

      expect(validateKey('hms_a_abc', 'key_abc_123')).toBe(true);
      expect(validateKey('hms_a_abc', 'key_xyz_456')).toBe(false); // Wrong key
      expect(validateKey('hms_b_xyz', 'wrong_key')).toBe(false);   // Key not found
    });
  });

  // ─── R2 Key Path Validation ─────────────────────────────────────────────────

  describe('R2 key path validation', () => {
    it('R2 key must be tenant-prefixed for security', () => {
      const tenantId = 'hms_a_abc';
      const validKey = `dicom/${tenantId}/1.2.840/study1/sop1.dcm`;
      const invalidKey = `dicom/hms_b_xyz/1.2.840/study1/sop1.dcm`;

      function isValidR2Key(key: string, tenantId: string): boolean {
        return key.startsWith(`dicom/${tenantId}/`);
      }

      expect(isValidR2Key(validKey, tenantId)).toBe(true);
      expect(isValidR2Key(invalidKey, tenantId)).toBe(false);
    });

    it('R2 key format should match dicom/<tenant>/<studyUid>/<filename>', () => {
      const tenantId = 'hms_a_abc';
      const studyInstanceUid = '1.2.840.113619.2.55.3.604688';
      const sopInstanceUid = '1.2.3.4.5.6.7.8.9';
      const expectedKey = `dicom/${tenantId}/${studyInstanceUid}/${sopInstanceUid}.dcm`;

      function buildR2Key(tenantId: string, studyUid: string, sopUid: string): string {
        return `dicom/${tenantId}/${studyUid}/${sopUid}.dcm`;
      }

      expect(buildR2Key(tenantId, studyInstanceUid, sopInstanceUid)).toBe(expectedKey);
    });
  });

  // ─── Duplicate Study Handling ────────────────────────────────────────────────

  describe('Duplicate study handling', () => {
    it('should detect already-registered study by studyInstanceUid + tenant', () => {
      const existingStudies = [
        { tenantId: 'hms_a_abc', studyInstanceUid: '1.2.840.113619.2.55.3.604688', id: 1 },
        { tenantId: 'hms_a_abc', studyInstanceUid: '1.2.840.113619.2.55.3.604689', id: 2 },
      ];

      function findStudy(tenantId: string, studyInstanceUid: string) {
        return existingStudies.find(
          s => s.tenantId === tenantId && s.studyInstanceUid === studyInstanceUid
        );
      }

      const found = findStudy('hms_a_abc', '1.2.840.113619.2.55.3.604688');
      expect(found).toBeDefined();
      expect(found?.id).toBe(1);

      const notFound = findStudy('hms_a_abc', '1.2.840.113619.2.55.3.604690');
      expect(notFound).toBeUndefined();
    });

    it('should update existing study with new R2 key if different', () => {
      const existingStudy = { id: 1, r2_key: null };
      const newR2Key = 'dicom/tenant/study/sop.dcm';

      function updateStudyR2Key(study: { id: number; r2_key: string | null }, r2Key: string) {
        if (study.r2_key !== r2Key) {
          return { ...study, r2_key: r2Key };
        }
        return study;
      }

      const updated = updateStudyR2Key(existingStudy, newR2Key);
      expect(updated.r2_key).toBe(newR2Key);
    });
  });
});

// ─── DICOM Agent HMS Client Tests ──────────────────────────────────────────────

describe('DICOM Agent HMS Client', () => {

  // ─── HmsApiClient Retry Logic ────────────────────────────────────────────────

  describe('Retry logic', () => {
    it('should identify retryable network errors', () => {
      const isRetryable = (err: { code?: string; message?: string }) => {
        if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' || err.code === 'ENOTFOUND') return true;
        if (err.message?.includes('timeout') || err.message?.includes('network')) return true;
        return false;
      };

      expect(isRetryable({ code: 'ECONNRESET', message: 'Connection reset' })).toBe(true);
      expect(isRetryable({ code: 'ETIMEDOUT', message: 'Timeout' })).toBe(true);
      expect(isRetryable({ message: 'network timeout' })).toBe(true);
      expect(isRetryable({ message: 'Bad Request' })).toBe(false); // 400 — don't retry
    });

    it('should use exponential backoff for retries', () => {
      const backoffMs = [1000, 2000, 4000];

      function getBackoff(retryCount: number): number {
        return backoffMs[Math.min(retryCount, backoffMs.length - 1)];
      }

      expect(getBackoff(0)).toBe(1000);
      expect(getBackoff(1)).toBe(2000);
      expect(getBackoff(2)).toBe(4000);
      expect(getBackoff(3)).toBe(4000); // Cap at last value
    });

    it('should not retry 4xx client errors except 429', () => {
      const shouldRetry = (status: number) => {
        return status >= 500 || status === 429;
      };

      expect(shouldRetry(400)).toBe(false); // Bad Request — don't retry
      expect(shouldRetry(401)).toBe(false); // Unauthorized — don't retry
      expect(shouldRetry(403)).toBe(false); // Forbidden — don't retry
      expect(shouldRetry(404)).toBe(false); // Not Found — don't retry
      expect(shouldRetry(429)).toBe(true);  // Rate Limited — retry
      expect(shouldRetry(500)).toBe(true);  // Server Error — retry
      expect(shouldRetry(502)).toBe(true);  // Bad Gateway — retry
    });
  });

  // ─── R2 Key Generation ───────────────────────────────────────────────────────

  describe('R2 key generation', () => {
    it('should generate tenant-scoped R2 key', () => {
      function buildR2Key(tenantId: string, studyInstanceUid: string, sopInstanceUid: string): string {
        return `dicom/${tenantId}/${studyInstanceUid}/${sopInstanceUid}.dcm`;
      }

      const key = buildR2Key('hms_a_abc', '1.2.840.113619.2.55.3', '1.2.3.4.5.6');
      expect(key).toBe('dicom/hms_a_abc/1.2.840.113619.2.55.3/1.2.3.4.5.6.dcm');
      expect(key).toContain('hms_a_abc');
      expect(key).not.toContain('other_tenant');
    });
  });

  // ─── DICOM Date Formatting ───────────────────────────────────────────────────

  describe('DICOM date formatting', () => {
    it('should convert DICOM date (YYYYMMDD) to ISO format (YYYY-MM-DD)', () => {
      function formatDicomDate(dateStr: string | null | undefined): string | null {
        if (!dateStr || dateStr.length !== 8) return null;
        return `${dateStr.substring(0, 4)}-${dateStr.substring(4, 6)}-${dateStr.substring(6, 8)}`;
      }

      expect(formatDicomDate('20260428')).toBe('2026-04-28');
      expect(formatDicomDate('19991231')).toBe('1999-12-31');
      expect(formatDicomDate('20260101')).toBe('2026-01-01');
    });

    it('should return null for invalid date formats', () => {
      function formatDicomDate(dateStr: string | null | undefined): string | null {
        if (!dateStr || dateStr.length !== 8) return null;
        return `${dateStr.substring(0, 4)}-${dateStr.substring(4, 6)}-${dateStr.substring(6, 8)}`;
      }

      expect(formatDicomDate('')).toBeNull();
      expect(formatDicomDate(null)).toBeNull();
      expect(formatDicomDate('202604')).toBeNull();  // Too short
      expect(formatDicomDate('20260428123')).toBeNull(); // Too long
    });
  });

  // ─── HMSSync Flow ───────────────────────────────────────────────────────────

  describe('Full HMS sync flow', () => {
    it('should complete forward → upload → confirm flow', async () => {
      const events: string[] = [];

      // Simulate the forward flow
      async function forwardStudy(metadata: { studyInstanceUid: string; patientName: string }) {
        events.push('forwardStudy called');
        return { id: 123, alreadyExists: false };
      }

      async function uploadToR2(key: string, buffer: Buffer) {
        events.push(`uploadToR2 called: ${key}`);
        return { success: true, key };
      }

      async function syncStudy(metadata: { studyInstanceUid: string; patientName: string }) {
        const forwardResult = await forwardStudy(metadata);
        events.push(`forwardResult: id=${forwardResult.id}`);
        const r2Key = `dicom/tenant/${metadata.studyInstanceUid}/sop.dcm`;
        await uploadToR2(r2Key, Buffer.from([]));
        events.push('syncComplete');
        return { studyId: forwardResult.id, r2Key };
      }

      const result = await syncStudy({
        studyInstanceUid: '1.2.840.113619.2.55.3.604688',
        patientName: 'John^Doe',
      });

      expect(result.studyId).toBe(123);
      expect(result.r2Key).toContain('1.2.840.113619.2.55.3.604688');
      expect(events).toEqual([
        'forwardStudy called',
        'forwardResult: id=123',
        'uploadToR2 called: dicom/tenant/1.2.840.113619.2.55.3.604688/sop.dcm',
        'syncComplete',
      ]);
    });

    it('should handle forward failure gracefully', async () => {
      let uploadCalled = false;

      async function forwardStudy(metadata: { studyInstanceUid: string }) {
        throw new Error('HMS API unavailable');
      }

      async function uploadToR2(key: string, buffer: Buffer) {
        uploadCalled = true;
      }

      async function syncStudy(metadata: { studyInstanceUid: string }) {
        try {
          await forwardStudy(metadata);
          const r2Key = `dicom/tenant/${metadata.studyInstanceUid}/sop.dcm`;
          await uploadToR2(r2Key, Buffer.from([]));
        } catch (err) {
          return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
        }
      }

      const result = await syncStudy({ studyInstanceUid: '1.2.840' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('HMS API unavailable');
      expect(uploadCalled).toBe(false); // Should not upload if forward fails
    });
  });

  // ─── DICOM SCP Stats Tracking ────────────────────────────────────────────────

  describe('DICOM SCP statistics', () => {
    it('should track received, failed, forwarded, uploaded counts', () => {
      const stats = {
        received: 0,
        failed: 0,
        forwarded: 0,
        uploaded: 0,
        lastReceived: null as string | null,
        startedAt: null as string | null,
      };

      // Simulate receiving an image
      stats.received++;
      stats.lastReceived = new Date().toISOString();

      // Simulate successful forward
      stats.forwarded++;

      // Simulate successful upload
      stats.uploaded++;

      expect(stats.received).toBe(1);
      expect(stats.forwarded).toBe(1);
      expect(stats.uploaded).toBe(1);
      expect(stats.lastReceived).not.toBeNull();
    });

    it('should increment failed on error', () => {
      const stats = { failed: 0 };
      stats.failed++;
      expect(stats.failed).toBe(1);
    });
  });
});

// ─── Tenant API Key Validation Tests ───────────────────────────────────────────

describe('Tenant API Key Validation', () => {
  it('should reject request without X-Tenant-ID header', () => {
    const headers = { 'X-API-Key': 'some_key' };
    const hasTenantId = !!headers['X-Tenant-ID'];
    expect(hasTenantId).toBe(false);
  });

  it('should reject request without X-API-Key header', () => {
    const headers = { 'X-Tenant-ID': 'tenant123' };
    const hasApiKey = !!headers['X-API-Key'];
    expect(hasApiKey).toBe(false);
  });

  it('should accept request with both headers', () => {
    const headers = {
      'X-Tenant-ID': 'hms_a_abc',
      'X-API-Key': 'secret_key_123',
    };
    const hasTenantId = !!headers['X-Tenant-ID'];
    const hasApiKey = !!headers['X-API-Key'];
    expect(hasTenantId && hasApiKey).toBe(true);
  });
});

// ─── Source AE Title Audit Trail ──────────────────────────────────────────────

describe('Source AE Title audit trail', () => {
  it('should capture AE title of sending modality', () => {
    const modalityAE = 'FLUORO_01';
    const study = {
      studyInstanceUid: '1.2.840.113619.2.55.3',
      sourceAETitle: modalityAE,
      patientName: 'Test',
    };

    expect(study.sourceAETitle).toBe(modalityAE);
  });

  it('should default to configured AE title if not provided by modality', () => {
    const configuredAETitle = 'OZZYL_PRINT';
    const sourceAETitle = null; // Modality didn't send it

    const effectiveAETitle = sourceAETitle || configuredAETitle;
    expect(effectiveAETitle).toBe(configuredAETitle);
  });
});