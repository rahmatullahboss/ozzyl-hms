import { describe, expect, it } from 'vitest';
import auditRoutes from '../../../src/routes/tenant/audit';
import { createTestApp, jsonRequest } from '../helpers/test-app';

describe('server-side local/cloud sync review', () => {
  it('returns tenant-scoped local outbox, cloud ingest, and pull-state metadata without payload bodies', async () => {
    const { app, mockDB } = createTestApp({
      route: auditRoutes,
      routePath: '/audit',
      role: 'hospital_admin',
      tenantId: 'tenant-sync-1',
      extraEnv: {
        ENVIRONMENT: 'local_server',
        LOCAL_SERVER_ID: 'hospital-lan-01',
      },
      queryOverride: (sql) => {
        const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
        if (normalized.includes('count(*) as total') && normalized.includes('from local_sync_outbox')) {
          return { first: { total: 5, pending: 1, exporting: 0, exported: 2, failed: 1, poison: 1 } };
        }
        if (normalized.includes('select id,') && normalized.includes('from local_sync_outbox')) {
          return {
            results: [{
              id: 91,
              entityType: 'ipd_doctor_round',
              entityId: 'round-91',
              operation: 'upsert',
              status: 'poison',
              attempts: 5,
              nextAttemptAt: '2026-07-11 08:00:00',
              lastError: 'Signed IPD doctor round sync conflict requires clinical review',
              createdAt: '2026-07-11 07:00:00',
              exportedAt: null,
            }],
          };
        }
        if (normalized.includes('count(*) as total') && normalized.includes('from cloud_sync_ingest_events')) {
          return { first: { total: 9, metadataOnly: 1, processing: 1, applied: 6, failed: 1 } };
        }
        if (normalized.includes('server_id as serverid') && normalized.includes('from cloud_sync_ingest_events')) {
          return {
            results: [{
              id: 71,
              serverId: 'hospital-lan-01',
              batchId: 'batch-71',
              entityType: 'ipd_doctor_round',
              entityId: 'round-91',
              operation: 'upsert',
              applyStatus: 'failed',
              applyError: 'Signed IPD doctor round sync conflict requires clinical review',
              receivedAt: '2026-07-11 07:01:00',
            }],
          };
        }
        if (normalized.includes('count(*) as total') && normalized.includes('from local_cloud_pull_state')) {
          return { first: { total: 3, pending: 0, applied: 2, failed: 1, skipped: 0 } };
        }
        if (normalized.includes('table_name as tablename') && normalized.includes('from local_cloud_pull_state')) {
          return {
            results: [{
              tableName: 'appointments',
              lastSnapshotId: 'snapshot-7',
              lastPulledAt: '2026-07-11 06:30:00',
              rowsReceived: 12,
              rowsApplied: 0,
              status: 'failed',
              lastError: 'local write conflict',
              updatedAt: '2026-07-11 06:31:00',
            }],
          };
        }
        return null;
      },
    });

    const response = await app.request('/audit/server-sync?limit=25');
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, any>;

    expect(body).toMatchObject({
      deploymentMode: 'local_server',
      localServerId: 'hospital-lan-01',
      coverage: {
        mode: 'explicit_outbox',
        fullDatabaseReplication: false,
        explicitLocalEmitterTypes: ['ipd_doctor_round', 'billing_provisional_doctor_round', 'patients', 'global_patient_identity', 'patient_health_links', 'medicine_catalog_entry'],
        nonAtomicEmitterTypes: ['patients', 'global_patient_identity', 'patient_health_links'],
        partialWritePathCoverageTypes: ['patients'],
        atomicPatientWritePaths: expect.arrayContaining(['patients:update', 'emergency:create-patient', 'reception:quick-admit']),
        durableStagedPatientWritePaths: ['patients:link-global', 'referrals:accept-health-link'],
        patientWritePathGaps: expect.arrayContaining(['patients:create-global-link', 'marketplace-patient:create', 'fhir:patient-import']),
        entityIdMappingGaps: expect.arrayContaining(['appointments', 'bills', 'payments']),
        coreOutboxGaps: expect.arrayContaining(['appointments', 'bills', 'payments']),
      },
      localOutbox: {
        summary: { total: 5, failed: 1, poison: 1 },
        rows: [{ id: 91, status: 'poison', entityType: 'ipd_doctor_round' }],
      },
      cloudIngest: {
        summary: { total: 9, processing: 1, applied: 6, failed: 1 },
        rows: [{ serverId: 'hospital-lan-01', applyStatus: 'failed' }],
      },
      cloudPull: {
        summary: { total: 3, applied: 2, failed: 1 },
        rows: [{ tableName: 'appointments', status: 'failed' }],
      },
    });
    expect(JSON.stringify(body)).not.toContain('payload_json');
    expect(JSON.stringify(body)).not.toContain('clinical_note_idempotency_key');

    const syncQueries = mockDB.queries.filter((query) =>
      /local_sync_outbox|cloud_sync_ingest_events|local_cloud_pull_state/i.test(query.sql),
    );
    expect(syncQueries.length).toBe(6);
    expect(syncQueries.every((query) => query.params[0] === 'tenant-sync-1')).toBe(true);
    expect(syncQueries.every((query) => !/payload_json/i.test(query.sql))).toBe(true);
    expect(syncQueries.filter((query) => /limit \?/i.test(query.sql)).every((query) => query.params[1] === 25)).toBe(true);
    const ingestRowsQuery = syncQueries.find((query) => /server_id AS serverId/i.test(query.sql));
    expect(ingestRowsQuery?.sql).toContain("THEN 'processing'");
    expect(ingestRowsQuery?.sql).toContain('THEN NULL');
    expect(JSON.stringify(body)).not.toContain('PROCESSING:');
  });

  it('returns schema warnings instead of failing the whole review when an older deployment lacks sync tables', async () => {
    const { app } = createTestApp({
      route: auditRoutes,
      routePath: '/audit',
      role: 'hospital_admin',
      tenantId: 'tenant-legacy',
      queryOverride: (sql) => {
        if (/local_sync_outbox|cloud_sync_ingest_events|local_cloud_pull_state/i.test(sql)) {
          throw new Error('no such table: local_sync_outbox');
        }
        return null;
      },
    });

    const response = await app.request('/audit/server-sync');
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, any>;
    expect(body.localOutbox.summary.total).toBe(0);
    expect(body.cloudIngest.rows).toEqual([]);
    expect(body.cloudPull.rows).toEqual([]);
    expect(body.warnings).toEqual(expect.arrayContaining([
      expect.stringMatching(/local-server outbox schema/i),
      expect.stringMatching(/cloud ingest receipt schema/i),
      expect.stringMatching(/cloud-to-local pull state schema/i),
    ]));
  });

  it('queues a tenant-scoped manual retry for failed or poison local-server outbox items and writes an audit record', async () => {
    const { app, mockDB } = createTestApp({
      route: auditRoutes,
      routePath: '/audit',
      role: 'hospital_admin',
      tenantId: 'tenant-sync-1',
      userId: 41,
      extraEnv: { ENVIRONMENT: 'local_server' },
      queryOverride: (sql) => {
        const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
        if (normalized.startsWith('select id, entity_type') && normalized.includes('from local_sync_outbox')) {
          return {
            first: {
              id: 91,
              entity_type: 'ipd_doctor_round',
              entity_id: 'round-91',
              status: 'poison',
              attempts: 5,
            },
          };
        }
        if (normalized.startsWith('update local_sync_outbox')) {
          return { first: { id: 91, status: 'pending', attempts: 5, nextAttemptAt: '2026-07-11 08:00:00' } };
        }
        return null;
      },
    });

    const response = await jsonRequest(app, '/audit/server-sync/outbox/91/retry', { method: 'POST' });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      message: 'Server sync retry queued',
      item: { id: 91, status: 'pending', attempts: 5 },
    });

    const select = mockDB.queries.find((query) => /select id, entity_type/i.test(query.sql));
    const update = mockDB.queries.find((query) => /update local_sync_outbox/i.test(query.sql));
    expect(select?.params).toEqual([91, 'tenant-sync-1']);
    expect(update?.params).toEqual([91, 'tenant-sync-1']);
    expect(update?.sql).toContain("status IN ('failed', 'poison')");
    expect(update?.sql).not.toMatch(/attempts\s*=\s*0/i);
    expect(mockDB.queries.some((query) =>
      /insert into audit_logs/i.test(query.sql)
      && query.params.some((param) => String(param).includes('manual_retry_requested')),
    )).toBe(true);
  });

  it('rejects local outbox retry from a cloud deployment before touching the outbox table', async () => {
    const { app, mockDB } = createTestApp({
      route: auditRoutes,
      routePath: '/audit',
      role: 'hospital_admin',
      tenantId: 'tenant-sync-1',
      extraEnv: { ENVIRONMENT: 'production' },
    });

    const response = await jsonRequest(app, '/audit/server-sync/outbox/91/retry', { method: 'POST' });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringMatching(/hospital local server/i),
    });
    expect(mockDB.queries.some((query) => /local_sync_outbox/i.test(query.sql))).toBe(false);
  });

  it('rejects retry when the outbox item is not in a failed review state', async () => {
    const { app } = createTestApp({
      route: auditRoutes,
      routePath: '/audit',
      role: 'hospital_admin',
      tenantId: 'tenant-sync-1',
      extraEnv: { ENVIRONMENT: 'local_server' },
      queryOverride: (sql) => {
        if (/select id, entity_type/i.test(sql)) {
          return {
            first: {
              id: 92,
              entity_type: 'patients',
              entity_id: 'patient-92',
              status: 'exported',
              attempts: 1,
            },
          };
        }
        return null;
      },
    });

    const response = await jsonRequest(app, '/audit/server-sync/outbox/92/retry', { method: 'POST' });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringMatching(/only failed or blocked/i),
    });
  });
});
