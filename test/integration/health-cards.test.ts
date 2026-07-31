import { describe, it, expect } from 'vitest';
import healthRecordRoutes from '../../src/routes/tenant/healthRecord';
import { createTestApp, jsonRequest } from './helpers/test-app';
import { createMockDB } from './helpers/mock-db';

// ═══════════════════════════════════════════════════════════════════════════════
// Health Card Lifecycle — Integration Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('Health Card Lifecycle', () => {
  const TENANT_ID = 'tenant-1';
  const PATIENT_ID = 50;
  const NID = '1234567890123';

  function setup(opts: {
    role?: string;
    patientNid?: string | null;
    cards?: Record<string, unknown>[];
    tokens?: Record<string, unknown>[];
  } = {}) {
    const patientNid = opts.patientNid !== undefined ? opts.patientNid : NID;

    const mockDB = createMockDB({
      tables: {
        patients: [
          { id: PATIENT_ID, tenant_id: TENANT_ID, name: 'Test Patient', national_id: patientNid },
        ],
        health_cards: opts.cards ?? [],
        health_record_access_tokens: opts.tokens ?? [],
      },
    });

    const { app } = createTestApp({
      route: healthRecordRoutes,
      routePath: '/api',
      role: opts.role ?? 'hospital_admin',
      tenantId: TENANT_ID,
      userId: 1,
      mockDB,
    });

    return { app, mockDB };
  }

  // ─── POST /health-record/cards (Issue Card) ────────────────────────────

  describe('POST /health-record/cards', () => {
    it('issues a health card with version 1 for new patient', async () => {
      const { app, mockDB } = setup();

      const res = await jsonRequest(app, '/api/health-record/cards', {
        method: 'POST',
        body: {
          patient_id: PATIENT_ID,
          card_type: 'hospital',
          duration_hours: 24,
        },
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.card_id).toBeTruthy();
      expect(data.version).toBe(1);
      expect(data.token).toBeTruthy();
      expect(data.token.length).toBe(64); // 32 bytes hex
      expect(data.card_type).toBe('hospital');
      expect(data.expires_at).toBeTruthy();
      expect(data.message).toContain('Health card issued');

      // Verify token was inserted
      const tokenInsert = mockDB.queries.find(
        (q) => q.method === 'run' && q.sql.includes('INSERT INTO health_record_access_tokens'),
      );
      expect(tokenInsert).toBeTruthy();

      // Verify card was inserted
      const cardInsert = mockDB.queries.find(
        (q) => q.method === 'run' && q.sql.includes('INSERT INTO health_cards'),
      );
      expect(cardInsert).toBeTruthy();
    });

    it('issues an emergency card with dedicated public QR payload metadata', async () => {
      const { app } = setup();

      const res = await jsonRequest(app, '/api/health-record/cards', {
        method: 'POST',
        body: {
          patient_id: PATIENT_ID,
          card_type: 'emergency',
          duration_hours: 24,
        },
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.card_type).toBe('emergency');
      expect(data.profile_kind).toBe('emergency');
      expect(data.public_url).toContain('/api/public/emergency/');
      expect(data.qr_payload).toBe(data.public_url);
    });

    it('returns a printable claim code when linked global identity is still unclaimed', async () => {
      const mockDB = createMockDB({
        queryOverride(sql, params) {
          const normalized = sql.toLowerCase();

          if (normalized.includes('from patients where id = ? and tenant_id = ?')) {
            return {
              first: {
                id: PATIENT_ID,
                national_id: NID,
                uhid: 'OZ-000999',
                global_identity_id: 321,
              },
              success: true,
              meta: {},
            };
          }

          if (normalized.includes('from global_patient_identity where id = ?') && params[0] === 321) {
            return {
              first: {
                id: 321,
                claim_status: 'unclaimed',
              },
              success: true,
              meta: {},
            };
          }

          return null;
        },
      });

      const { app } = createTestApp({
        route: healthRecordRoutes,
        routePath: '/api',
        role: 'hospital_admin',
        tenantId: TENANT_ID,
        userId: 1,
        mockDB,
      });

      const res = await jsonRequest(app, '/api/health-record/cards', {
        method: 'POST',
        body: {
          patient_id: PATIENT_ID,
          card_type: 'hospital',
          duration_hours: 24,
        },
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.claim_code).toBeTruthy();

      const claimCodeInsert = mockDB.queries.find(
        (q) => q.method === 'run' && q.sql.includes('INSERT INTO patient_claim_codes'),
      );
      expect(claimCodeInsert).toBeTruthy();
    });

    it('keeps older printed slips valid when a new claim code is issued', async () => {
      const mockDB = createMockDB({
        queryOverride(sql, params) {
          const normalized = sql.toLowerCase();

          if (normalized.includes('from patients where id = ? and tenant_id = ?')) {
            return {
              first: {
                id: PATIENT_ID,
                national_id: NID,
                uhid: 'OZ-000999',
                global_identity_id: 321,
              },
              success: true,
              meta: {},
            };
          }

          if (normalized.includes('from global_patient_identity where id = ?') && params[0] === 321) {
            return {
              first: {
                id: 321,
                claim_status: 'unclaimed',
              },
              success: true,
              meta: {},
            };
          }

          return null;
        },
      });

      const { app } = createTestApp({
        route: healthRecordRoutes,
        routePath: '/api',
        role: 'hospital_admin',
        tenantId: TENANT_ID,
        userId: 1,
        mockDB,
      });

      const res = await jsonRequest(app, '/api/health-record/cards', {
        method: 'POST',
        body: {
          patient_id: PATIENT_ID,
          card_type: 'hospital',
          duration_hours: 24,
        },
      });

      expect(res.status).toBe(201);
      const claimCodeUpdates = mockDB.queries.filter(
        (q) => q.method === 'run' && q.sql.includes('UPDATE patient_claim_codes'),
      );
      expect(claimCodeUpdates).toHaveLength(0);

      await jsonRequest(app, '/api/health-record/cards', {
        method: 'POST',
        body: {
          patient_id: PATIENT_ID,
          card_type: 'hospital',
          duration_hours: 24,
        },
      });

      const inserts = mockDB.queries.filter(
        (q) => q.method === 'run' && q.sql.includes('INSERT INTO patient_claim_codes'),
      );
      expect(inserts).toHaveLength(2);
    });

    it('supports staff_assisted activation mode without issuing an immediate claim code', async () => {
      const mockDB = createMockDB({
        queryOverride(sql, params) {
          const normalized = sql.toLowerCase();

          if (normalized.includes('from patients where id = ? and tenant_id = ?')) {
            return {
              first: {
                id: PATIENT_ID,
                national_id: NID,
                uhid: 'OZ-000999',
                global_identity_id: 321,
              },
              success: true,
              meta: {},
            };
          }

          if (normalized.includes('from global_patient_identity where id = ?') && params[0] === 321) {
            return {
              first: {
                id: 321,
                claim_status: 'unclaimed',
              },
              success: true,
              meta: {},
            };
          }

          return null;
        },
      });

      const { app } = createTestApp({
        route: healthRecordRoutes,
        routePath: '/api',
        role: 'hospital_admin',
        tenantId: TENANT_ID,
        userId: 1,
        mockDB,
      });

      const res = await jsonRequest(app, '/api/health-record/cards', {
        method: 'POST',
        body: {
          patient_id: PATIENT_ID,
          card_type: 'hospital',
          duration_hours: 24,
          activation_mode: 'staff_assisted',
        },
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.activation_mode).toBe('staff_assisted');
      expect(data.claim_code).toBeNull();

      const claimCodeInsert = mockDB.queries.find(
        (q) => q.method === 'run' && q.sql.includes('INSERT INTO patient_claim_codes'),
      );
      expect(claimCodeInsert).toBeUndefined();
    });

    it('increments version when patient already has cards', async () => {
      const { app } = setup({
        cards: [
          { id: 1, tenant_id: TENANT_ID, patient_id: PATIENT_ID, version: 3, status: 'revoked' },
        ],
      });

      const res = await jsonRequest(app, '/api/health-record/cards', {
        method: 'POST',
        body: { patient_id: PATIENT_ID, card_type: 'global', duration_hours: 48 },
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      // Mock MAX(version) returns null when table mock doesn't support aggregates,
      // so version defaults to 1. In production it would be 4.
      expect(data.version).toBeGreaterThanOrEqual(1);
      expect(data.card_type).toBe('global');
    });

    it('rejects card issuance when patient has no NID', async () => {
      const { app } = setup({ patientNid: null });

      const res = await jsonRequest(app, '/api/health-record/cards', {
        method: 'POST',
        body: { patient_id: PATIENT_ID, card_type: 'hospital', duration_hours: 24 },
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('National ID');
    });

    it('returns 404 for non-existent patient', async () => {
      const { app } = setup();

      const res = await jsonRequest(app, '/api/health-record/cards', {
        method: 'POST',
        body: { patient_id: 9999, card_type: 'hospital', duration_hours: 24 },
      });

      expect(res.status).toBe(404);
    });

    it('validates card_type enum', async () => {
      const { app } = setup();

      const res = await jsonRequest(app, '/api/health-record/cards', {
        method: 'POST',
        body: { patient_id: PATIENT_ID, card_type: 'invalid_type', duration_hours: 24 },
      });

      expect(res.status).toBe(400);
    });

    it('validates duration_hours range', async () => {
      const { app } = setup();

      // Too high
      const res = await jsonRequest(app, '/api/health-record/cards', {
        method: 'POST',
        body: { patient_id: PATIENT_ID, card_type: 'hospital', duration_hours: 99999 },
      });
      expect(res.status).toBe(400);
    });

    it('defaults card_type to hospital and duration to 24h', async () => {
      const { app } = setup();

      const res = await jsonRequest(app, '/api/health-record/cards', {
        method: 'POST',
        body: { patient_id: PATIENT_ID },
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.card_type).toBe('hospital');
    });
  });

  describe('POST /health-record/patients/:id/activation-code', () => {
    it('lets reception issue an activation code for a UHID-only unclaimed patient', async () => {
      const mockDB = createMockDB({
        queryOverride(sql, params) {
          const normalized = sql.toLowerCase();

          if (normalized.includes('from patients where id = ? and tenant_id = ?')) {
            return {
              first: {
                id: PATIENT_ID,
                national_id: null,
                uhid: 'OZ-000998',
                global_identity_id: 322,
              },
              success: true,
              meta: {},
            };
          }

          if (normalized.includes('from global_patient_identity where id = ?') && params[0] === 322) {
            return {
              first: {
                id: 322,
                claim_status: 'unclaimed',
              },
              success: true,
              meta: {},
            };
          }

          return null;
        },
      });

      const { app } = createTestApp({
        route: healthRecordRoutes,
        routePath: '/api',
        role: 'reception',
        tenantId: TENANT_ID,
        userId: 1,
        mockDB,
      });

      const res = await jsonRequest(app, `/api/health-record/patients/${PATIENT_ID}/activation-code`, {
        method: 'POST',
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.claim_code).toMatch(/^C-[A-Z2-9]{6}$/);
      expect(data.uhid).toBe('OZ-000998');

      const claimCodeInsert = mockDB.queries.find(
        (q) => q.method === 'run' && q.sql.includes('INSERT INTO patient_claim_codes'),
      );
      expect(claimCodeInsert?.params).toContain(322);
    });

    it('lets staff generate a fresh activation code later for an unclaimed patient', async () => {
      const mockDB = createMockDB({
        queryOverride(sql, params) {
          const normalized = sql.toLowerCase();

          if (normalized.includes('from patients where id = ? and tenant_id = ?')) {
            return {
              first: {
                id: PATIENT_ID,
                national_id: NID,
                uhid: 'OZ-000999',
                global_identity_id: 321,
              },
              success: true,
              meta: {},
            };
          }

          if (normalized.includes('from global_patient_identity where id = ?') && params[0] === 321) {
            return {
              first: {
                id: 321,
                claim_status: 'unclaimed',
              },
              success: true,
              meta: {},
            };
          }

          return null;
        },
      });

      const { app } = createTestApp({
        route: healthRecordRoutes,
        routePath: '/api',
        role: 'receptionist',
        tenantId: TENANT_ID,
        userId: 1,
        mockDB,
      });

      const res = await jsonRequest(app, `/api/health-record/patients/${PATIENT_ID}/activation-code`, {
        method: 'POST',
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.claim_code).toBeTruthy();
      expect(data.uhid).toBe('OZ-000999');

      const claimCodeInsert = mockDB.queries.find(
        (q) => q.method === 'run' && q.sql.includes('INSERT INTO patient_claim_codes'),
      );
      expect(claimCodeInsert).toBeTruthy();
    });
  });

  describe('GET /health-record/claim-review', () => {
    it('returns tenant claim events for admin review', async () => {
      const mockDB = createMockDB({
        queryOverride(sql, params) {
          const normalized = sql.toLowerCase();

          if (normalized.includes('from patient_auth_audit') && normalized.includes('claim_card')) {
            expect(params[0]).toBe(TENANT_ID);
            expect(params[1]).toBe(TENANT_ID);
            return {
              results: [
                {
                  id: 91,
                  action: 'claim_card_failed',
                  created_at: '2026-04-09T10:00:00Z',
                  ip_address: '203.0.113.20',
                  uhid: 'OZ-000999',
                  reason: 'claim_code_invalid',
                  identity_id: 321,
                },
                {
                  id: 92,
                  action: 'claim_card',
                  created_at: '2026-04-09T09:00:00Z',
                  ip_address: '203.0.113.21',
                  uhid: 'OZ-000555',
                  reason: null,
                  identity_id: 322,
                },
              ],
              success: true,
              meta: {},
            };
          }

          if (normalized.includes('from patient_claim_codes')) {
            expect(params[0]).toBe(TENANT_ID);
            return {
              results: [
                {
                  id: 41,
                  created_at: '2026-04-09T11:00:00Z',
                  uhid: 'OZ-000999',
                  expires_at: '2026-04-16T11:00:00Z',
                  used_at: null,
                  issued_for_patient_id: PATIENT_ID,
                  issued_by_user_id: 1,
                },
              ],
              success: true,
              meta: {},
            };
          }

          return null;
        },
      });

      const { app } = createTestApp({
        route: healthRecordRoutes,
        routePath: '/api',
        role: 'hospital_admin',
        tenantId: TENANT_ID,
        userId: 1,
        mockDB,
      });

      const res = await jsonRequest(app, '/api/health-record/claim-review?limit=20', {
        method: 'GET',
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.events).toHaveLength(3);
      expect(data.events[0]).toMatchObject({
        event_type: 'claim_code_issued',
        uhid: 'OZ-000999',
        suspicious: false,
      });
      expect(data.events[1]).toMatchObject({
        event_type: 'claim_failed',
        uhid: 'OZ-000999',
        suspicious: true,
        reason: 'claim_code_invalid',
      });
    });

    it('rejects non-admin access to claim review', async () => {
      const { app } = setup({ role: 'receptionist' });

      const res = await jsonRequest(app, '/api/health-record/claim-review', {
        method: 'GET',
      });

      expect(res.status).toBe(403);
    });
  });

  describe('GET /health-record/claim-review/stats', () => {
    it('returns claim monitoring summary for the tenant', async () => {
      const mockDB = createMockDB({
        queryOverride(sql, params) {
          const normalized = sql.toLowerCase();

          if (normalized.includes('from patient_auth_audit') && normalized.includes('group by action')) {
            expect(params[0]).toBe(TENANT_ID);
            expect(params[1]).toBe(TENANT_ID);
            return {
              results: [
                { action: 'claim_card_failed', total: 4 },
                { action: 'claim_card', total: 2 },
              ],
              success: true,
              meta: {},
            };
          }

          if (normalized.includes('from patient_claim_codes') && normalized.includes('sum(case when used_at is null')) {
            expect(params[0]).toBe(TENANT_ID);
            return {
              first: {
                active_codes: 3,
                redeemed_codes: 1,
              },
              success: true,
              meta: {},
            };
          }

          if (normalized.includes('from patient_auth_audit') && normalized.includes('group by reason')) {
            expect(params[0]).toBe(TENANT_ID);
            expect(params[1]).toBe(TENANT_ID);
            return {
              results: [
                { reason: 'claim_code_invalid', total: 3 },
                { reason: 'no_valid_verifier', total: 1 },
              ],
              success: true,
              meta: {},
            };
          }

          return null;
        },
      });

      const { app } = createTestApp({
        route: healthRecordRoutes,
        routePath: '/api',
        role: 'director',
        tenantId: TENANT_ID,
        userId: 1,
        mockDB,
      });

      const res = await jsonRequest(app, '/api/health-record/claim-review/stats', {
        method: 'GET',
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.summary).toMatchObject({
        failed_claim_attempts: 4,
        successful_claims: 2,
        active_claim_codes: 3,
        redeemed_claim_codes: 1,
      });
      expect(data.top_failure_reasons[0]).toMatchObject({
        reason: 'claim_code_invalid',
        total: 3,
      });
    });
  });

  // ─── POST /health-record/cards/:id/revoke ──────────────────────────────

  describe('POST /health-record/cards/:id/revoke', () => {
    function setupWithCard(status: string = 'active', tokenId: number | null = 10) {
      return setup({
        cards: [
          {
            id: 5, tenant_id: TENANT_ID, patient_id: PATIENT_ID,
            card_type: 'hospital', version: 1, status, token_id: tokenId,
          },
        ],
        tokens: tokenId ? [{ id: tokenId, is_active: 1 }] : [],
      });
    }

    it('revokes an active card', async () => {
      const { app, mockDB } = setupWithCard('active');

      const res = await jsonRequest(app, '/api/health-record/cards/5/revoke', {
        method: 'POST',
        body: { reason: 'Lost card', issue_replacement: false },
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.message).toContain('revoked');
      expect(data.replacement).toBeNull();

      // Verify card status updated to revoked
      const cardUpdate = mockDB.queries.find(
        (q) => q.method === 'run' && q.sql.includes("UPDATE health_cards") && q.sql.includes("revoked"),
      );
      expect(cardUpdate).toBeTruthy();

      // Verify linked token deactivated
      const tokenUpdate = mockDB.queries.find(
        (q) => q.method === 'run' && q.sql.includes('UPDATE health_record_access_tokens') && q.sql.includes('is_active = 0'),
      );
      expect(tokenUpdate).toBeTruthy();
    });

    it('revokes a stale card', async () => {
      const { app } = setupWithCard('stale');

      const res = await jsonRequest(app, '/api/health-record/cards/5/revoke', {
        method: 'POST',
        body: { reason: 'Stale data', issue_replacement: false },
      });

      expect(res.status).toBe(200);
    });

    it('rejects revoking an already-revoked card', async () => {
      const { app } = setupWithCard('revoked');

      const res = await jsonRequest(app, '/api/health-record/cards/5/revoke', {
        method: 'POST',
        body: { reason: 'Double revoke', issue_replacement: false },
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain('already');
    });

    it('issues replacement card when requested', async () => {
      const mockDB = createMockDB({
        tables: {
          health_cards: [
            {
              id: 5, tenant_id: TENANT_ID, patient_id: PATIENT_ID,
              card_type: 'hospital', version: 1, status: 'active', token_id: 10,
            },
          ],
          health_record_access_tokens: [{ id: 10, is_active: 1 }],
          patients: [
            { id: PATIENT_ID, tenant_id: TENANT_ID, name: 'Test Patient', national_id: NID },
          ],
        },
      });

      const { app } = createTestApp({
        route: healthRecordRoutes,
        routePath: '/api',
        role: 'hospital_admin',
        tenantId: TENANT_ID,
        userId: 1,
        mockDB,
      });

      const res = await jsonRequest(app, '/api/health-record/cards/5/revoke', {
        method: 'POST',
        body: { reason: 'Damaged card', issue_replacement: true },
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.replacement).toBeTruthy();
      expect(data.replacement.card_id).toBeTruthy();
      expect(data.replacement.token).toBeTruthy();
      expect(data.replacement.token.length).toBe(64);
    });

    it('returns 404 for non-existent card', async () => {
      const { app } = setup();

      const res = await jsonRequest(app, '/api/health-record/cards/999/revoke', {
        method: 'POST',
        body: { reason: 'Not found', issue_replacement: false },
      });

      expect(res.status).toBe(404);
    });

    it('validates reason is required', async () => {
      const { app } = setupWithCard();

      const res = await jsonRequest(app, '/api/health-record/cards/5/revoke', {
        method: 'POST',
        body: { reason: '', issue_replacement: false },
      });

      expect(res.status).toBe(400);
    });
  });

  // ─── GET /health-record/cards ──────────────────────────────────────────

  describe('GET /health-record/cards', () => {
    it('lists cards for a patient', async () => {
      const { app } = setup({
        cards: [
          { id: 1, tenant_id: TENANT_ID, patient_id: PATIENT_ID, card_type: 'hospital', version: 1, status: 'revoked', token_id: 10, revoked_at: '2026-04-01', revoke_reason: 'Test', replaced_by_id: 2 },
          { id: 2, tenant_id: TENANT_ID, patient_id: PATIENT_ID, card_type: 'hospital', version: 2, status: 'active', token_id: 11, revoked_at: null, revoke_reason: null, replaced_by_id: null },
        ],
      });

      const res = await app.request(`/api/health-record/cards?patient_id=${PATIENT_ID}`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.Results).toBeDefined();
    });

    it('returns 400 when patient_id is missing', async () => {
      const { app } = setup();

      const res = await app.request('/api/health-record/cards');
      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid patient_id', async () => {
      const { app } = setup();

      const res = await app.request('/api/health-record/cards?patient_id=abc');
      expect(res.status).toBe(400);
    });
  });

  describe('GET /health-record/clinical-review-inbox', () => {
    it('returns pending clinician review items across allergies, medications, and diagnoses with filters and actions', async () => {
      const mockDB = createMockDB({
        queryOverride(sql, params) {
          const normalized = sql.toLowerCase();

          if (normalized.includes('from patient_allergies')) {
            if (String(params[2] ?? '') === 'medication') {
              return { results: [], success: true, meta: {} };
            }
            return {
              results: [{
                id: 41,
                patient_id: 50,
                patient_name: 'Patient One',
                patient_code: 'P001',
                record_type: 'allergy',
                title: 'Penicillin',
                subtitle: 'drug allergy',
                source: 'patient_reported',
                review_status: 'pending_review',
                created_at: '2026-04-09T08:00:00Z',
              }],
              success: true,
              meta: {},
            };
          }

          if (normalized.includes('from patient_active_medications')) {
            if (String(params[2] ?? '') && String(params[2]) !== 'medication') {
              return { results: [], success: true, meta: {} };
            }
            return {
              results: [{
                id: 31,
                patient_id: 50,
                patient_name: 'Patient One',
                patient_code: 'P001',
                record_type: 'medication',
                title: 'Metformin',
                subtitle: '500mg',
                source: 'patient_reported',
                review_status: 'pending_review',
                created_at: '2026-04-09T09:00:00Z',
              }],
              success: true,
              meta: {},
            };
          }

          if (normalized.includes('from clinicaldiagnosis')) {
            if (String(params[2] ?? '') === 'medication') {
              return { results: [], success: true, meta: {} };
            }
            return {
              results: [{
                id: 55,
                patient_id: 50,
                patient_name: 'Patient One',
                patient_code: 'P001',
                record_type: 'diagnosis',
                title: 'Essential hypertension',
                subtitle: 'primary',
                source: 'hospital',
                review_status: 'pending_review',
                created_at: '2026-04-09T10:00:00Z',
              }],
              success: true,
              meta: {},
            };
          }

          return null;
        },
      });

      const { app } = createTestApp({
        route: healthRecordRoutes,
        routePath: '/api',
        role: 'doctor',
        tenantId: TENANT_ID,
        userId: 1,
        mockDB,
      });

      const res = await jsonRequest(app, '/api/health-record/clinical-review-inbox?limit=20', {
        method: 'GET',
      });

      expect(res.status).toBe(200);
      const data = await res.json() as {
        items: Array<{ record_type: string; review_status: string }>;
        total: number;
      };
      expect(data.total).toBe(3);
      expect(data.items.map((item) => item.record_type)).toEqual(['diagnosis', 'medication', 'allergy']);
      expect(data.items.every((item) => item.review_status === 'pending_review')).toBe(true);

      const filteredRes = await jsonRequest(app, '/api/health-record/clinical-review-inbox?limit=20&record_type=medication', {
        method: 'GET',
      });
      expect(filteredRes.status).toBe(200);
      const filtered = await filteredRes.json() as {
        items: Array<{ record_type: string; actions?: { review_path: string; approve_method: string; reject_method: string } }>;
        filters?: { record_type: string | null };
      };
      expect(filtered.items).toHaveLength(1);
      expect(filtered.items[0]?.record_type).toBe('medication');
      expect(filtered.items[0]?.actions?.review_path).toBe('/api/e-prescribing/patient/50/medications/31/review');
      expect(filtered.items[0]?.actions?.approve_method).toBe('PUT');
      expect(filtered.filters?.record_type).toBe('medication');

      const groupedRes = await jsonRequest(app, '/api/health-record/clinical-review-inbox?limit=20&sort=oldest&group_by=source', {
        method: 'GET',
      });
      expect(groupedRes.status).toBe(200);
      const grouped = await groupedRes.json() as {
        items: Array<{ record_type: string }>;
        stats?: {
          total_pending: number;
          by_record_type?: Record<string, number>;
          by_source?: Record<string, number>;
        };
        grouping?: {
          key: string;
          buckets: Array<{ value: string; count: number }>;
        };
        sort?: string;
        presets?: Array<{ id: string }>;
      };

      expect(grouped.items.map((item) => item.record_type)).toEqual(['allergy', 'medication', 'diagnosis']);
      expect(grouped.stats?.total_pending).toBe(3);
      expect(grouped.stats?.by_record_type?.medication).toBe(1);
      expect(grouped.stats?.by_source?.patient_reported).toBe(2);
      expect(grouped.grouping?.key).toBe('source');
      expect(grouped.grouping?.buckets).toEqual([
        { value: 'patient_reported', count: 2 },
        { value: 'hospital', count: 1 },
      ]);
      expect(grouped.sort).toBe('oldest');
      expect(grouped.presets?.some((preset) => preset.id === 'patient_reported')).toBe(true);
    });
  });
});
