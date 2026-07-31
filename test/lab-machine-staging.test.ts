import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../src/lib/lis-ingestion';
import labMachines from '../src/routes/tenant/labMachines';
import type { Env, Variables } from '../src/types';
import { createMockDB } from './integration/helpers/mock-db';

function createApp(db: D1Database) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use('*', async (c, next) => {
    c.set('tenantId', 'tenant-1');
    c.set('userId', '9');
    c.set('role', 'lab_tech' as any);
    c.env = {
      DB: db,
      KV: { get: async () => null, put: async () => {}, delete: async () => {}, list: async () => ({ keys: [] }) } as any,
      JWT_SECRET: 'test-' + 'secret',
      ENVIRONMENT: 'development',
      UPLOADS: { put: async () => ({}), get: async () => null, delete: async () => {} } as any,
    } as any;
    await next();
  });
  app.route('/lab-machines', labMachines);
  app.onError((error, c) => c.json({ error: error.message }, (error as any).status ?? 500));
  return app;
}

const validHl7 = [
  'MSH|^~\\&|ANALYZER|LAB|HMS|OZZYL|20260710070000||ORU^R01|MSG-STAGE-1|P|2.3',
  'PID|||P-1||PATIENT^ONE',
  'OBR|1|ORD-1||CBC^Complete Blood Count',
  'SPM|1|BC-100||BLD^Blood',
  'OBX|1|NM|HGB^Hemoglobin||14.2|g/dL|12-16|N|||F',
].join('\r');

function createStagingMock(options: {
  existing?: Record<string, unknown> | null;
  candidates?: Record<string, unknown>[];
  qc?: 'pass' | 'missing' | 'fail' | 'stale';
} = {}) {
  return createMockDB({
    queryOverride(sql) {
      const normalized = sql.toLowerCase();
      if (normalized.includes('from lab_machines')) {
        return { first: { id: 1, machine_code: 'M1', protocol: 'hl7', is_active: 1 } };
      }
      if (normalized.includes('from lis_ingestion_messages')) {
        return { first: options.existing ?? null };
      }
      if (normalized.includes('from lab_machine_test_map')) {
        return {
          first: {
            lab_test_id: 10,
            component_id: null,
            machine_unit: 'g/dL',
            conversion_factor: 1,
            qualitative_map_json: null,
            normal_range: '12-16',
            critical_low: 6,
            critical_high: 22,
            unit: 'g/dL',
            code: 'HGB',
          },
        };
      }
      if (normalized.includes('from lab_order_items loi') && normalized.includes('limit 2')) {
        return {
          results: options.candidates ?? [{
            id: 11,
            lab_order_id: 21,
            specimen_id: 31,
            patient_id: 41,
          }],
        };
      }
      if (normalized.includes('from lab_qc_ranges') && normalized.includes('count(*)')) {
        return { first: { total: options.qc === 'missing' ? 0 : 1 } };
      }
      if (normalized.includes('from lab_calibrations')) {
        return { first: { total: 0 } };
      }
      if (normalized.includes('from lab_qc_results')) {
        if (options.qc === 'fail') {
          return { first: { is_out_of_range: 1, westgard_violations: '["1_3s"]', created_at: new Date().toISOString() } };
        }
        if (options.qc === 'stale') {
          return { first: { is_out_of_range: 0, westgard_violations: '[]', created_at: '2020-01-01T00:00:00.000Z' } };
        }
        return { first: { is_out_of_range: 0, westgard_violations: '[]', created_at: new Date().toISOString() } };
      }
      return null;
    },
  });
}

function hasCanonicalClinicalWrite(queries: Array<{ sql: string }>): boolean {
  return queries.some(({ sql }) => {
    const normalized = sql.toLowerCase();
    return normalized.includes('update lab_order_items set')
      || normalized.includes('insert into lab_results')
      || normalized.includes('insert into lab_observation_audit');
  });
}

describe('lab machine stage-only receive path', () => {
  it('rejects an empty HL7 ORU before clinical writes', async () => {
    const mock = createStagingMock();
    const response = await createApp(mock.db).request('/lab-machines/hl7/receive', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        machineCode: 'M1',
        message: 'MSH|^~\\&|ANALYZER|LAB|HMS|OZZYL|20260710070000||ORU^R01|EMPTY-1|P|2.3',
      }),
    });

    expect(response.status).toBe(400);
    expect(hasCanonicalClinicalWrite(mock.queries)).toBe(false);
  });

  it('rejects an HL7 ORU without MSH-10 before staging observations', async () => {
    const mock = createStagingMock();
    const message = [
      'MSH|^~\\&|ANALYZER|LAB|HMS|OZZYL|20260710070000||ORU^R01||P|2.3',
      'OBR|1|ORD-1||CBC^Complete Blood Count',
      'OBX|1|NM|HGB^Hemoglobin||14.2|g/dL|12-16|N|||F',
    ].join('\r');
    const response = await createApp(mock.db).request('/lab-machines/hl7/receive', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ machineCode: 'M1', message }),
    });

    expect(response.status).toBe(400);
    expect(mock.queries.some(({ sql }) => sql.includes('INSERT INTO lis_analyzer_inbox'))).toBe(false);
    expect(hasCanonicalClinicalWrite(mock.queries)).toBe(false);
  });

  it('stages an exact HL7 observation without changing canonical results', async () => {
    const mock = createStagingMock();
    const response = await createApp(mock.db).request('/lab-machines/hl7/receive', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ machineCode: 'M1', message: validHl7 }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      message: 'HL7 message staged',
      disposition: 'staged',
      outcomes: [{ staged: true, matched: true, disposition: 'review_required' }],
    });
    expect(mock.queries.some(({ sql }) => sql.includes('INSERT INTO lis_ingestion_messages'))).toBe(true);
    const inboxInsert = mock.queries.find(({ sql }) => sql.includes('INSERT INTO lis_analyzer_inbox'));
    expect(inboxInsert?.sql).toContain('staged_by');
    expect(inboxInsert?.params).toContain('9');
    expect(hasCanonicalClinicalWrite(mock.queries)).toBe(false);
  });

  it('uses the clinical order number instead of MSH-10 when no specimen barcode is present', async () => {
    const mock = createStagingMock();
    const message = [
      'MSH|^~\\&|ANALYZER|LAB|HMS|OZZYL|20260710070000||ORU^R01|MSG-CONTROL-77|P|2.3',
      'PID|||P-1||PATIENT^ONE',
      'OBR|1|ORD-ONLY-77||CBC^Complete Blood Count',
      'OBX|1|NM|HGB^Hemoglobin||14.2|g/dL|12-16|N|||F',
    ].join('\r');

    const response = await createApp(mock.db).request('/lab-machines/hl7/receive', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ machineCode: 'M1', message }),
    });

    expect(response.status).toBe(200);
    const candidateQuery = mock.queries.find(({ sql }) => (
      sql.includes('FROM lab_order_items loi') && sql.includes('LIMIT 2')
    ));
    expect(candidateQuery?.sql).toContain('lo.order_no');
    expect(candidateQuery?.params).toContain('ORD-ONLY-77');
    expect(candidateQuery?.params).not.toContain('MSG-CONTROL-77');
  });

  it('persists the signed bridge delivery id in the ingestion audit record', async () => {
    const mock = createStagingMock();
    const response = await createApp(mock.db).request('/lab-machines/hl7/receive', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-LIS-Delivery-Id': 'delivery-audit-1',
      },
      body: JSON.stringify({ machineCode: 'M1', message: validHl7 }),
    });

    expect(response.status).toBe(200);
    const ingestionInsert = mock.queries.find(({ sql }) => sql.includes('INSERT INTO lis_ingestion_messages'));
    expect(ingestionInsert?.params).toContain('delivery-audit-1');
  });

  it('uses the stable JSON delivery id as the replay identity', async () => {
    const mock = createStagingMock();
    const response = await createApp(mock.db).request('/lab-machines/1/receive', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-LIS-Delivery-Id': 'json-delivery-identity-1',
      },
      body: JSON.stringify({
        barcode: 'BC-100',
        results: [{ testCode: 'HGB', value: '14.2', resultStatus: 'F' }],
      }),
    });

    expect(response.status).toBe(200);
    const replayLookup = mock.queries.find(({ sql }) => sql.includes('FROM lis_ingestion_messages'));
    expect(replayLookup?.params).toContain('tenant-1:1:json:json-delivery-identity-1');
  });

  it('returns a retryable response while an exact duplicate is still being staged', async () => {
    const payloadHash = await sha256Hex(validHl7);
    const mock = createStagingMock({
      existing: {
        id: 76,
        payload_sha256: payloadHash,
        status: 'received',
        outcome_json: null,
      },
    });

    const response = await createApp(mock.db).request('/lab-machines/hl7/receive', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ machineCode: 'M1', message: validHl7 }),
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: 'ingestion_in_progress',
      messageId: 76,
    });
  });

  it('returns the prior disposition for an exact duplicate delivery', async () => {
    const payloadHash = await sha256Hex(validHl7);
    const mock = createStagingMock({
      existing: {
        id: 77,
        payload_sha256: payloadHash,
        status: 'completed',
        outcome_json: JSON.stringify({ outcomes: [{ disposition: 'review_required' }] }),
      },
    });

    const response = await createApp(mock.db).request('/lab-machines/hl7/receive', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ machineCode: 'M1', message: validHl7 }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      disposition: 'duplicate',
      messageId: 77,
    });
    expect(mock.queries.some(({ sql }) => sql.includes('INSERT INTO lis_analyzer_inbox'))).toBe(false);
    expect(hasCanonicalClinicalWrite(mock.queries)).toBe(false);
  });

  it('does not acknowledge an exact duplicate that was previously rejected', async () => {
    const payloadHash = await sha256Hex(validHl7);
    const mock = createStagingMock({
      existing: {
        id: 78,
        payload_sha256: payloadHash,
        status: 'rejected',
        outcome_json: JSON.stringify({ validationErrors: ['invalid clinical message'] }),
      },
    });

    const response = await createApp(mock.db).request('/lab-machines/hl7/receive', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ machineCode: 'M1', message: validHl7 }),
    });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: 'previously_rejected',
      messageId: 78,
    });
    expect(mock.queries.some(({ sql }) => sql.includes('INSERT INTO lis_analyzer_inbox'))).toBe(false);
  });

  it('quarantines an identity collision and returns 409', async () => {
    const mock = createStagingMock({
      existing: {
        id: 77,
        payload_sha256: 'different-hash',
        status: 'completed',
        outcome_json: null,
      },
    });

    const response = await createApp(mock.db).request('/lab-machines/hl7/receive', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ machineCode: 'M1', message: validHl7 }),
    });

    expect(response.status).toBe(409);
    expect(mock.queries.some(({ sql }) => sql.includes('INSERT INTO lis_ingestion_collisions'))).toBe(true);
    expect(hasCanonicalClinicalWrite(mock.queries)).toBe(false);
  });

  it('quarantines ambiguous candidate matches instead of selecting the newest row', async () => {
    const mock = createStagingMock({
      candidates: [
        { id: 11, lab_order_id: 21, specimen_id: 31, patient_id: 41 },
        { id: 12, lab_order_id: 22, specimen_id: 32, patient_id: 42 },
      ],
    });

    const response = await createApp(mock.db).request('/lab-machines/hl7/receive', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ machineCode: 'M1', message: validHl7 }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      outcomes: [{ staged: true, matched: false, disposition: 'ambiguous', reason: 'ambiguous_match' }],
    });
    const inboxInsert = mock.queries.find(({ sql }) => sql.includes('INSERT INTO lis_analyzer_inbox'));
    expect(inboxInsert?.params).toContain('ambiguous');
    expect(hasCanonicalClinicalWrite(mock.queries)).toBe(false);
  });

  it('stages an exact result as QC-blocked when QC configuration is missing', async () => {
    const mock = createStagingMock({ qc: 'missing' });
    const response = await createApp(mock.db).request('/lab-machines/hl7/receive', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ machineCode: 'M1', message: validHl7 }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      outcomes: [{
        staged: true,
        matched: true,
        disposition: 'qc_blocked',
        reason: 'qc_not_configured',
        qcState: 'config_missing',
      }],
    });
    expect(hasCanonicalClinicalWrite(mock.queries)).toBe(false);
  });

  it('stages parsed JSON middleware results without canonical writes', async () => {
    const mock = createStagingMock();
    const response = await createApp(mock.db).request('/lab-machines/1/receive', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        barcode: 'BC-100',
        results: [{ testCode: 'HGB', value: '14.2', units: 'g/dL', referenceRange: '12-16', abnormalFlag: 'N', resultStatus: 'F' }],
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      message: 'Results staged',
      disposition: 'staged',
      outcomes: [{ staged: true, matched: true, disposition: 'review_required' }],
    });
    expect(mock.queries.some(({ sql }) => sql.includes('INSERT INTO lis_ingestion_messages'))).toBe(true);
    expect(mock.queries.some(({ sql }) => sql.includes('INSERT INTO lis_analyzer_inbox'))).toBe(true);
    expect(hasCanonicalClinicalWrite(mock.queries)).toBe(false);
  });

  it('stages ASTM observations without canonical writes', async () => {
    const mock = createStagingMock();
    const astm = [
      'H|\\^&|||Mindray^BC-5000^001|||||||P|LIS2-A2|20260710070000',
      'P|1|PAT-001|LAB-001||Patient^One|||19900101|M',
      'O|1|BC-100||^^^HGB|||20260710070000',
      'R|1|^^^HGB^Hemoglobin|14.2|g/dL|12-16|N||F',
      'L|1|N',
    ].join('\r');
    const response = await createApp(mock.db).request('/lab-machines/astm/receive', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ machineCode: 'M1', message: astm }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      message: 'ASTM message staged',
      disposition: 'staged',
      outcomes: [{ staged: true, matched: true, disposition: 'review_required' }],
    });
    expect(mock.queries.some(({ sql }) => sql.includes('INSERT INTO lis_ingestion_messages'))).toBe(true);
    expect(mock.queries.some(({ sql }) => sql.includes('INSERT INTO lis_analyzer_inbox'))).toBe(true);
    expect(hasCanonicalClinicalWrite(mock.queries)).toBe(false);
  });
});
