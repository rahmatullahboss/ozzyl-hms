import { describe, expect, it } from 'vitest';
import patientPhrRoutes from '../src/routes/patient-phr';
import { generateToken } from '../src/middleware/auth';
import { createMockDB } from './integration/helpers/mock-db';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';

describe('patient PHR reported experience routes', () => {
  it('accepts current health issues separately from chronic conditions', async () => {
    const inserted: Array<{ category: string; name: string; severity: string | null; clinical_status: string }> = [];

    const mockDB = createMockDB({
      queryOverride(sql, params) {
        const normalized = sql.toLowerCase();

        if (normalized.includes('select uhid from global_patient_auth')) {
          return { first: { uhid: 'OZ-000555' }, success: true, meta: {} };
        }

        if (normalized.includes('insert into global_patient_reported_data')) {
          inserted.push({
            category: String(params?.[1] ?? ''),
            name: String(params?.[2] ?? ''),
            severity: (params?.[3] as string | null) ?? null,
            clinical_status: String(params?.[4] ?? ''),
          });
          return { success: true, meta: { last_row_id: 12, changes: 1, duration: 0 } };
        }

        if (normalized.includes('from global_patient_reported_data')) {
          return {
            results: inserted.map((entry, index) => ({
              id: index + 1,
              category: entry.category,
              name: entry.name,
              severity: entry.severity,
              clinical_status: entry.clinical_status,
              verification_status: 'unconfirmed',
              start_date: null,
              notes: null,
              created_at: '2026-04-12T00:00:00.000Z',
            })),
            success: true,
            meta: {},
          };
        }

        return null;
      },
    });

    const { app } = createTestApp({
      route: patientPhrRoutes,
      routePath: '/api/patient-phr',
      mockDB,
    });

    const token = await generateToken({
      userId: '1',
      role: 'patient',
      scope: 'global',
      permissions: [],
    }, 'test-secret-key-for-testing-only');

    const authHeaders = { Authorization: `Bearer ${token}` };

    const createIssue = await jsonRequest(app, '/api/patient-phr/reported-data', {
      method: 'POST',
      headers: authHeaders,
      body: {
        category: 'current_health_issue',
        name: 'Fever',
        severity: 'moderate',
        clinical_status: 'active',
      },
    });

    const listResponse = await app.request('/api/patient-phr/reported-data', { headers: authHeaders });

    expect(createIssue.status).toBe(201);
    expect(inserted[0]).toEqual({
      category: 'current_health_issue',
      name: 'Fever',
      severity: 'moderate',
      clinical_status: 'active',
    });
    expect((await listResponse.json() as { reported_data: Array<{ category: string; name: string }> }).reported_data).toEqual([
      expect.objectContaining({
        category: 'current_health_issue',
        name: 'Fever',
      }),
    ]);
  });

  it('allows an authenticated patient to create and list ADRs and lifestyle logs', async () => {
    const mockDB = createMockDB({
      queryOverride(sql) {
        const normalized = sql.toLowerCase();

        if (normalized.includes('select uhid from global_patient_auth')) {
          return { first: { uhid: 'OZ-000123' }, success: true, meta: {} };
        }

        if (normalized.includes('insert into global_patient_adverse_reactions')) {
          return { success: true, meta: { last_row_id: 11, changes: 1, duration: 0 } };
        }

        if (normalized.includes('insert into global_patient_lifestyle_logs')) {
          return { success: true, meta: { last_row_id: 22, changes: 1, duration: 0 } };
        }

        if (normalized.includes('from global_patient_adverse_reactions')) {
          return {
            results: [{
              id: 11,
              medication_name: 'Ibuprofen',
              reaction: 'Acidity',
              severity: 'moderate',
            }],
            success: true,
            meta: {},
          };
        }

        if (normalized.includes('from global_patient_lifestyle_logs')) {
          return {
            results: [{
              id: 22,
              sleep_hours: 4.5,
              exercise_minutes: 20,
              mood: 'low',
            }],
            success: true,
            meta: {},
          };
        }

        return null;
      },
    });

    const { app } = createTestApp({
      route: patientPhrRoutes,
      routePath: '/api/patient-phr',
      mockDB,
    });

    const token = await generateToken({
      userId: '1',
      role: 'patient',
      scope: 'global',
      permissions: [],
    }, 'test-secret-key-for-testing-only');

    const authHeaders = { Authorization: `Bearer ${token}` };

    const createAdr = await jsonRequest(app, '/api/patient-phr/adverse-reactions', {
      method: 'POST',
      headers: authHeaders,
      body: {
        medication_name: 'Ibuprofen',
        reaction: 'Acidity',
        severity: 'moderate',
      },
    });

    const createLifestyle = await jsonRequest(app, '/api/patient-phr/lifestyle-logs', {
      method: 'POST',
      headers: authHeaders,
      body: {
        logged_on: '2026-04-09',
        sleep_hours: 4.5,
        exercise_minutes: 20,
        mood: 'low',
        symptoms: 'Headache all day',
      },
    });

    const listAdr = await app.request('/api/patient-phr/adverse-reactions', { headers: authHeaders });
    const listLifestyle = await app.request('/api/patient-phr/lifestyle-logs', { headers: authHeaders });

    expect(createAdr.status).toBe(201);
    expect(createLifestyle.status).toBe(201);

    const adrBody = await listAdr.json() as { adverse_reactions: Array<{ medication_name: string }> };
    const lifestyleBody = await listLifestyle.json() as { lifestyle_logs: Array<{ sleep_hours: number }> };

    expect(adrBody.adverse_reactions[0]?.medication_name).toBe('Ibuprofen');
    expect(lifestyleBody.lifestyle_logs[0]?.sleep_hours).toBe(4.5);
  });

  it('returns empty collections when optional PHR tables are not present yet', async () => {
    const mockDB = createMockDB({
      queryOverride(sql) {
        const normalized = sql.toLowerCase();

        if (normalized.includes('select uhid from global_patient_auth')) {
          return { first: { uhid: 'OZ-000999' }, success: true, meta: {} };
        }

        if (
          normalized.includes('from global_patient_reported_data') ||
          normalized.includes('from global_patient_adverse_reactions') ||
          normalized.includes('from global_patient_lifestyle_logs') ||
          normalized.includes('from global_patient_vault_documents') ||
          normalized.includes('from global_patient_vitals')
        ) {
          throw new Error(`D1_ERROR: no such table: ${
            normalized.includes('from global_patient_reported_data')
              ? 'global_patient_reported_data'
              : normalized.includes('from global_patient_adverse_reactions')
                ? 'global_patient_adverse_reactions'
                : normalized.includes('from global_patient_lifestyle_logs')
                  ? 'global_patient_lifestyle_logs'
                  : normalized.includes('from global_patient_vault_documents')
                    ? 'global_patient_vault_documents'
                    : 'global_patient_vitals'
          }`);
        }

        return null;
      },
    });

    const { app } = createTestApp({
      route: patientPhrRoutes,
      routePath: '/api/patient-phr',
      mockDB,
    });

    const token = await generateToken({
      userId: '1',
      role: 'patient',
      scope: 'global',
      permissions: [],
    }, 'test-secret-key-for-testing-only');

    const authHeaders = { Authorization: `Bearer ${token}` };

    const [reportedRes, adverseRes, lifestyleRes, vaultRes, vitalsRes] = await Promise.all([
      app.request('/api/patient-phr/reported-data', { headers: authHeaders }),
      app.request('/api/patient-phr/adverse-reactions', { headers: authHeaders }),
      app.request('/api/patient-phr/lifestyle-logs', { headers: authHeaders }),
      app.request('/api/patient-phr/vault', { headers: authHeaders }),
      app.request('/api/patient-phr/vitals', { headers: authHeaders }),
    ]);

    expect(reportedRes.status).toBe(200);
    expect(adverseRes.status).toBe(200);
    expect(lifestyleRes.status).toBe(200);
    expect(vaultRes.status).toBe(200);
    expect(vitalsRes.status).toBe(200);

    expect((await reportedRes.json() as { reported_data: unknown[] }).reported_data).toEqual([]);
    expect((await adverseRes.json() as { adverse_reactions: unknown[] }).adverse_reactions).toEqual([]);
    expect((await lifestyleRes.json() as { lifestyle_logs: unknown[] }).lifestyle_logs).toEqual([]);
    expect((await vaultRes.json() as { documents: unknown[] }).documents).toEqual([]);
    expect((await vitalsRes.json() as { vitals: unknown[] }).vitals).toEqual([]);
  });

  it('accepts the patient phr cookie for vault reads', async () => {
    const mockDB = createMockDB({
      queryOverride(sql) {
        const normalized = sql.toLowerCase();

        if (normalized.includes('select uhid from global_patient_auth')) {
          return { first: { uhid: 'OZ-COOKIE-123' }, success: true, meta: {} };
        }

        if (normalized.includes('from global_patient_vault_documents')) {
          return {
            results: [{
              id: 71,
              title: 'Cookie-auth document',
              document_type: 'prescription',
              entered_at: '2026-04-10T00:00:00Z',
            }],
            success: true,
            meta: {},
          };
        }

        return null;
      },
    });

    const { app } = createTestApp({
      route: patientPhrRoutes,
      routePath: '/api/patient-phr',
      mockDB,
    });

    const token = await generateToken({
      userId: '1',
      role: 'patient',
      scope: 'global',
      permissions: [],
    }, 'test-secret-key-for-testing-only');

    const response = await app.request('/api/patient-phr/vault', {
      headers: {
        Cookie: `phr_token=${token}`,
      },
    });

    expect(response.status).toBe(200);
    expect((await response.json() as { documents: Array<{ title: string }> }).documents[0]?.title).toBe('Cookie-auth document');
  });

  it('uploads patient vault files to R2 and serves them back through a protected file route', async () => {
    const storedObjects = new Map<string, { body: Uint8Array; contentType: string }>();
    let insertedVaultId = 71;
    let storedKey: string | null = null;

    const mockDB = createMockDB({
      queryOverride(sql) {
        const normalized = sql.toLowerCase();

        if (normalized.includes('select uhid from global_patient_auth')) {
          return { first: { uhid: 'OZ-VAULT-123' }, success: true, meta: {} };
        }

        if (normalized.includes('insert into global_patient_vault_documents')) {
          return { success: true, meta: { last_row_id: insertedVaultId, changes: 1, duration: 0 } };
        }

        if (normalized.includes('update global_patient_vault_documents set document_url = ?')) {
          return { success: true, meta: { changes: 1, duration: 0 } };
        }

        if (normalized.includes('from global_patient_vault_documents') && normalized.includes('where uhid = ?') && normalized.includes('order by entered_at desc')) {
          return {
            results: [{
              id: insertedVaultId,
              uhid: 'OZ-VAULT-123',
              document_url: `/api/patient-phr/vault/${insertedVaultId}/file`,
              document_type: 'prescription',
              document_date: '2026-04-10',
              title: 'Compressed prescription',
              notes: 'Uploaded from browser',
              storage_key: storedKey,
              file_name: 'prescription.webp',
              mime_type: 'image/webp',
              file_size: 20480,
              source_kind: 'uploaded_file',
              entered_at: '2026-04-10T10:00:00Z',
            }],
            success: true,
            meta: {},
          };
        }

        if (normalized.includes('from global_patient_vault_documents') && normalized.includes('where id = ? and uhid = ?')) {
          return {
            first: {
              id: insertedVaultId,
              document_url: `/api/patient-phr/vault/${insertedVaultId}/file`,
              storage_key: storedKey,
              file_name: 'prescription.webp',
              mime_type: 'image/webp',
              source_kind: 'uploaded_file',
            },
            success: true,
            meta: {},
          };
        }

        return null;
      },
    });

    const { app } = createTestApp({
      route: patientPhrRoutes,
      routePath: '/api/patient-phr',
      mockDB,
      extraEnv: {
        UPLOADS: {
          async put(key: string, value: ReadableStream | ArrayBuffer | ArrayBufferView | string, options?: { httpMetadata?: { contentType?: string } }) {
            storedKey = key;
            let body = new Uint8Array();
            if (value instanceof ReadableStream) {
              const response = new Response(value);
              body = new Uint8Array(await response.arrayBuffer());
            } else if (typeof value === 'string') {
              body = new TextEncoder().encode(value);
            } else if (value instanceof ArrayBuffer) {
              body = new Uint8Array(value);
            } else {
              body = new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
            }
            storedObjects.set(key, { body, contentType: options?.httpMetadata?.contentType || 'application/octet-stream' });
          },
          async get(key: string) {
            const found = storedObjects.get(key);
            if (!found) return null;
            return {
              body: new ReadableStream({
                start(controller) {
                  controller.enqueue(found.body);
                  controller.close();
                },
              }),
              httpMetadata: { contentType: found.contentType },
            };
          },
        } as unknown as R2Bucket,
      },
    });

    const token = await generateToken({
      userId: '1',
      role: 'patient',
      scope: 'global',
      permissions: [],
    }, 'test-secret-key-for-testing-only');

    const authHeaders = { Authorization: `Bearer ${token}` };
    const formData = new FormData();
    formData.append('file', new File([new Uint8Array([1, 2, 3, 4])], 'prescription.webp', { type: 'image/webp' }));
    formData.append('title', 'Compressed prescription');
    formData.append('document_type', 'prescription');
    formData.append('document_date', '2026-04-10');
    formData.append('notes', 'Uploaded from browser');

    const uploadResponse = await app.request('/api/patient-phr/vault/upload', {
      method: 'POST',
      headers: authHeaders,
      body: formData,
    });

    const listResponse = await app.request('/api/patient-phr/vault', { headers: authHeaders });
    const fileResponse = await app.request(`/api/patient-phr/vault/${insertedVaultId}/file`, { headers: authHeaders });

    expect(uploadResponse.status).toBe(201);
    expect(storedObjects.size).toBe(1);

    const uploadBody = await uploadResponse.json() as { document?: { source_kind?: string; document_url?: string } };
    const listBody = await listResponse.json() as { documents: Array<{ source_kind?: string; document_url?: string }> };

    expect(uploadBody.document?.source_kind).toBe('uploaded_file');
    expect(uploadBody.document?.document_url).toBe(`/api/patient-phr/vault/${insertedVaultId}/file`);
    expect(listBody.documents[0]?.source_kind).toBe('uploaded_file');
    expect(fileResponse.status).toBe(200);
    expect(fileResponse.headers.get('Content-Type')).toBe('image/webp');
  });

  it('allows a patient to rename, replace, and delete a vault document', async () => {
    const storedObjects = new Map<string, { body: Uint8Array; contentType: string }>();
    let currentStorageKey = 'global-patient-vault/OZ-VAULT-123/original_report.pdf';
    const deletedKeys: string[] = [];
    const seenUpdates: Array<{ sql: string; params: unknown[] }> = [];

    const mockDB = createMockDB({
      queryOverride(sql, params) {
        const normalized = sql.toLowerCase();

        if (normalized.includes('select uhid from global_patient_auth')) {
          return { first: { uhid: 'OZ-VAULT-123' }, success: true, meta: {} };
        }

        if (normalized.includes('from global_patient_vault_documents') && normalized.includes('where id = ? and uhid = ?')) {
          return {
            first: {
              id: 71,
              document_url: '/api/patient-phr/vault/71/file',
              storage_key: currentStorageKey,
              file_name: 'report.pdf',
              mime_type: 'application/pdf',
              file_size: 40960,
              source_kind: 'uploaded_file',
              title: 'Original report',
              document_type: 'lab_report',
              document_date: '2026-04-10',
              notes: 'Original notes',
            },
            success: true,
            meta: {},
          };
        }

        if (normalized.includes('update global_patient_vault_documents')) {
          if (normalized.includes('set document_url = ?, title = ?')) {
            currentStorageKey = String(params[5]);
          }
          seenUpdates.push({ sql: normalized, params });
          return { success: true, meta: { changes: 1, duration: 0 } };
        }

        if (normalized.includes('delete from global_patient_vault_documents')) {
          seenUpdates.push({ sql: normalized, params });
          return { success: true, meta: { changes: 1, duration: 0 } };
        }

        return null;
      },
    });

    const { app } = createTestApp({
      route: patientPhrRoutes,
      routePath: '/api/patient-phr',
      mockDB,
      extraEnv: {
        UPLOADS: {
          async put(key: string, value: ReadableStream | ArrayBuffer | ArrayBufferView | string, options?: { httpMetadata?: { contentType?: string } }) {
            let body = new Uint8Array();
            if (value instanceof ReadableStream) {
              body = new Uint8Array(await new Response(value).arrayBuffer());
            } else if (typeof value === 'string') {
              body = new TextEncoder().encode(value);
            } else if (value instanceof ArrayBuffer) {
              body = new Uint8Array(value);
            } else {
              body = new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
            }
            storedObjects.set(key, { body, contentType: options?.httpMetadata?.contentType || 'application/octet-stream' });
          },
          async get(key: string) {
            const found = storedObjects.get(key);
            if (!found) return null;
            return {
              body: new ReadableStream({
                start(controller) {
                  controller.enqueue(found.body);
                  controller.close();
                },
              }),
              httpMetadata: { contentType: found.contentType },
            };
          },
          async delete(key: string) {
            deletedKeys.push(key);
            storedObjects.delete(key);
          },
        } as unknown as R2Bucket,
      },
    });

    storedObjects.set(currentStorageKey, { body: new Uint8Array([9, 9, 9]), contentType: 'application/pdf' });

    const token = await generateToken({
      userId: '1',
      role: 'patient',
      scope: 'global',
      permissions: [],
    }, 'test-secret-key-for-testing-only');
    const authHeaders = { Authorization: `Bearer ${token}` };

    const renameResponse = await jsonRequest(app, '/api/patient-phr/vault/71', {
      method: 'PATCH',
      headers: authHeaders,
      body: {
        title: 'Renamed report',
        document_type: 'discharge_summary',
        document_date: '2026-04-11',
        notes: 'Updated notes',
      },
    });

    const replacementFormData = new FormData();
    replacementFormData.append('file', new File([new Uint8Array([7, 7, 7])], 'replacement.pdf', { type: 'application/pdf' }));
    replacementFormData.append('title', 'Replacement report');
    replacementFormData.append('document_type', 'lab_report');
    replacementFormData.append('document_date', '2026-04-12');
    replacementFormData.append('notes', 'Replacement notes');

    const replaceResponse = await app.request('/api/patient-phr/vault/71/replace', {
      method: 'POST',
      headers: authHeaders,
      body: replacementFormData,
    });

    const deleteResponse = await app.request('/api/patient-phr/vault/71', {
      method: 'DELETE',
      headers: authHeaders,
    });

    expect(renameResponse.status).toBe(200);
    expect(replaceResponse.status).toBe(200);
    expect(deleteResponse.status).toBe(200);
    expect(seenUpdates.some((entry) => entry.sql.includes('update global_patient_vault_documents') && entry.sql.includes('set title = ?'))).toBe(true);
    expect(seenUpdates.some((entry) => entry.sql.includes('update global_patient_vault_documents') && entry.sql.includes('set document_url = ?, title = ?'))).toBe(true);
    expect(deletedKeys).toHaveLength(2);
    expect(deletedKeys[0]).toBe('global-patient-vault/OZ-VAULT-123/original_report.pdf');
    expect(deletedKeys[1]).toBe(currentStorageKey);
  });

  it('returns an empty vitals list when the vitals table is not available yet', async () => {
    const mockDB = createMockDB({
      queryOverride(sql) {
        const normalized = sql.toLowerCase();

        if (normalized.includes('select uhid from global_patient_auth')) {
          return { first: { uhid: 'OZ-000123' }, success: true, meta: {} };
        }

        if (normalized.includes('from global_patient_vitals')) {
          throw new Error('no such table: global_patient_vitals');
        }

        return null;
      },
    });

    const { app } = createTestApp({
      route: patientPhrRoutes,
      routePath: '/api/patient-phr',
      mockDB,
    });

    const token = await generateToken({
      userId: '1',
      role: 'patient',
      scope: 'global',
      permissions: [],
    }, 'test-secret-key-for-testing-only');

    const res = await app.request('/api/patient-phr/vitals', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ vitals: [] });
  });
});
