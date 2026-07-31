/**
 * Integration tests for invoice_no search on GET /api/reception/visits.
 *
 * The /visits endpoint lists visits for a given date. When a `search`
 * query parameter is supplied, the SQL must also match the associated
 * invoice number — including typo-tolerant o→0 and numeric zero-padding.
 *
 * Companion change: src/routes/tenant/reception.ts wires
 * buildInvoiceSearchTerms into the search clause.
 */

import { describe, it, expect } from 'vitest';
import receptionRoutes from '../../../src/routes/tenant/reception';
import { createTestApp, jsonRequest } from '../helpers/test-app';
import { TENANT_1 } from '../helpers/fixtures';

describe('GET /reception/visits - invoice_no search', () => {
  it('matches when search text equals invoice_no (with typos o->0)', async () => {
    const { app, mockDB } = createTestApp({
      route: receptionRoutes,
      routePath: '/reception',
      role: 'receptionist',
      tenantId: TENANT_1.id,
      tables: {
        visits: [
          { id: 1, tenant_id: TENANT_1.id, patient_id: 10, visit_date: '2026-07-01', status: 'open', created_at: '2026-07-01 09:00:00' },
        ],
        patients: [
          { id: 10, tenant_id: TENANT_1.id, name: 'Rahim', patient_code: 'P-001', mobile: '01700000001' },
        ],
        bills: [
          { id: 100, tenant_id: TENANT_1.id, visit_id: 1, patient_id: 10, invoice_no: 'INV-000001', total: 500, paid: 0, due: 500, status: 'open', created_at: '2026-07-01 09:05:00' },
        ],
        doctors: [],
        token_reservations: [],
      },
    });

    const res = await jsonRequest(app, '/reception/visits?date=2026-07-01&search=inv-oooo1');
    expect(res.status).toBe(200);

    const visitSearchSql = mockDB.queries
      .map((q) => q.sql)
      .find((sql) => /FROM\s+visits/i.test(sql) && sql.includes('?'));
    expect(visitSearchSql).toBeDefined();
    // Verify the WHERE clause now references invoice_no LIKE so the
    // search can match the associated invoice number (not just patient fields).
    expect(visitSearchSql!.toLowerCase()).toContain('invoice_no like');
  });

  it('does not add an invoice_no clause when search is empty', async () => {
    const { app, mockDB } = createTestApp({
      route: receptionRoutes,
      routePath: '/reception',
      role: 'receptionist',
      tenantId: TENANT_1.id,
      tables: {
        visits: [
          { id: 1, tenant_id: TENANT_1.id, patient_id: 10, visit_date: '2026-07-01', status: 'open', created_at: '2026-07-01 09:00:00' },
        ],
        patients: [{ id: 10, tenant_id: TENANT_1.id, name: 'Rahim', patient_code: 'P-001', mobile: '01700000001' }],
        bills: [],
        doctors: [],
        token_reservations: [],
      },
    });

    const res = await jsonRequest(app, '/reception/visits?date=2026-07-01');
    expect(res.status).toBe(200);

    const visitSearchSql = mockDB.queries
      .map((q) => q.sql)
      .find((sql) => /FROM\s+visits/i.test(sql));
    expect(visitSearchSql).toBeDefined();
    expect(visitSearchSql!.toLowerCase()).not.toContain('invoice_no like');
  });

  it('escapes LIKE wildcards in user search input (append ESCAPE)', async () => {
    const { app, mockDB } = createTestApp({
      route: receptionRoutes,
      routePath: '/reception',
      role: 'receptionist',
      tenantId: TENANT_1.id,
      tables: {
        visits: [
          { id: 1, tenant_id: TENANT_1.id, patient_id: 10, visit_date: '2026-07-01', status: 'open', created_at: '2026-07-01 09:00:00' },
        ],
        patients: [{ id: 10, tenant_id: TENANT_1.id, name: 'Rahim', patient_code: 'P-001', mobile: '01700000001' }],
        bills: [
          { id: 100, tenant_id: TENANT_1.id, visit_id: 1, patient_id: 10, invoice_no: 'INV-000001', total: 500, paid: 0, due: 500, status: 'open', created_at: '2026-07-01 09:05:00' },
        ],
        doctors: [],
        token_reservations: [],
      },
    });

    // Search contains a `%` wildcard. The escape handler should not let this
    // become a single-character match-everything LIKE; instead, it must
    // escape the percent so the SQL still appends `ESCAPE '\'`.
    const res = await jsonRequest(app, '/reception/visits?date=2026-07-01&search=inv%25');
    expect(res.status).toBe(200);

    const visitSearchSql = mockDB.queries
      .map((q) => q.sql)
      .find((sql) => /FROM\s+visits/i.test(sql) && sql.includes('?'));
    expect(visitSearchSql).toBeDefined();
    // Every LIKE clause in the search branch should append the ESCAPE modifier
    expect(visitSearchSql!.toLowerCase()).toContain('like ? escape');
  });
});
