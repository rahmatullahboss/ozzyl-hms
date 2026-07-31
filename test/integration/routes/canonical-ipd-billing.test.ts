import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import canonicalIpdBillingRoutes from '../../../src/routes/tenant/canonicalIpdBilling';
import type { Env, Variables } from '../../../src/types';

type SqlValue = string | number | bigint | null | Uint8Array;

class Statement {
  constructor(
    private readonly database: DatabaseSync,
    private readonly executedSql: string[],
    readonly sql: string,
    readonly params: SqlValue[] = [],
  ) {}

  bind(...values: unknown[]): Statement {
    return new Statement(
      this.database,
      this.executedSql,
      this.sql,
      values.map((value) => value === undefined ? null : value) as SqlValue[],
    );
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    this.executedSql.push(this.sql);
    return (this.database.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    this.executedSql.push(this.sql);
    return { results: this.database.prepare(this.sql).all(...this.params) as T[] };
  }

  async run(): Promise<{ success: true; meta: { changes: number } }> {
    this.executedSql.push(this.sql);
    const result = this.database.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: Number(result.changes ?? 0) } };
  }
}

function fixture(input: { flag?: string; role?: string } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  for (const name of [
    '0505_canonical_program_foundation.sql',
    '0506_canonical_practitioners.sql',
    '0507_canonical_encounters.sql',
    '0508_canonical_service_catalog.sql',
    '0509_canonical_service_requests_events.sql',
    '0510_canonical_invoices.sql',
    '0511_canonical_payments.sql',
    '0512_canonical_adjustments.sql',
    '0513_canonical_practitioner_compensation.sql',
    '0535_canonical_invoice_encounter_links.sql',
  ]) sqlite.exec(readFileSync(`migrations/${name}`, 'utf8'));
  sqlite.exec(`
    CREATE TABLE settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      updated_at TEXT
    );
    CREATE TABLE billing_provisional_items (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      patient_id INTEGER NOT NULL,
      admission_id INTEGER,
      total_amount REAL NOT NULL,
      bill_status TEXT NOT NULL,
      is_active INTEGER NOT NULL
    );
    CREATE TABLE patient_bed_infos (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      admission_id INTEGER NOT NULL,
      charge_amount REAL NOT NULL,
      is_billed INTEGER NOT NULL
    );
    CREATE TABLE ipd_ledger_entries (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      admission_id INTEGER NOT NULL,
      debit_amount REAL NOT NULL,
      credit_amount REAL NOT NULL
    );
    INSERT INTO canonical_encounters (
      tenant_id,encounter_public_id,legacy_patient_id,encounter_type,status,
      started_at_utc,source_evidence_sha256
    ) VALUES ('tenant-a','enc-shadow-1',101,'inpatient','in_progress',
              '2026-07-10T02:00:00.000Z','${'1'.repeat(64)}');
    INSERT INTO canonical_encounter_admission_links (
      tenant_id,encounter_public_id,legacy_admission_id,admission_no,link_status,source_evidence_sha256
    ) VALUES ('tenant-a','enc-shadow-1',501,'ADM-501','active','${'2'.repeat(64)}');
    INSERT INTO canonical_service_catalog_items (
      tenant_id,service_public_id,item_kind,display_name,unit_code,status,source_evidence_sha256
    ) VALUES ('tenant-a','svc-shadow-1','procedure','Shadow Procedure','service','active','${'3'.repeat(64)}');
    INSERT INTO canonical_service_prices (
      tenant_id,price_public_id,service_public_id,price_context_type,price_context_key,
      amount_minor,currency_code,valid_from_utc,status,source_evidence_sha256
    ) VALUES ('tenant-a','price-shadow-1','svc-shadow-1','base','',1000,'BDT',
              '2026-01-01T00:00:00.000Z','active','${'4'.repeat(64)}');
    INSERT INTO canonical_service_events (
      tenant_id,event_public_id,encounter_public_id,service_public_id,event_type,quantity,
      status,occurred_at_utc,source_evidence_sha256
    ) VALUES ('tenant-a','evt-shadow-1','enc-shadow-1','svc-shadow-1','completed',1,
              'posted','2026-07-11T03:00:00.000Z','${'5'.repeat(64)}');
  `);
  if (input.flag !== undefined) {
    sqlite.prepare(`INSERT INTO settings(key,value,tenant_id) VALUES ('canonical_ipd_shadow_enabled',?,'tenant-a')`)
      .run(input.flag);
  }

  const executedSql: string[] = [];
  const db = {
    prepare(sql: string) { return new Statement(sqlite, executedSql, sql); },
  };
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use('*', async (c, next) => {
    c.set('tenantId', 'tenant-a');
    c.set('userId', '1');
    c.set('role', (input.role ?? 'hospital_admin') as Variables['role']);
    c.env = { DB: db } as unknown as Env;
    await next();
  });
  app.route('/canonical-ipd-billing', canonicalIpdBillingRoutes);
  app.onError((error, c) => {
    const status = (error as { status?: number }).status ?? 500;
    return c.json({ error: error.message }, status as 403 | 404 | 500);
  });
  return { sqlite, app, executedSql };
}

describe('canonical IPD shadow billing route', () => {
  it('is registered separately from the active IPD billing route with read-only permission', () => {
    const indexSource = readFileSync('src/index.ts', 'utf8');
    const permissionSource = readFileSync('src/lib/route-permissions.ts', 'utf8');
    expect(indexSource).toContain("app.route('/api/ip-billing', ipBillingRoutes);");
    expect(indexSource).toContain("app.route('/api/canonical-ipd-billing', canonicalIpdBillingRoutes);");
    expect(permissionSource).toContain("prefix: '/api/canonical-ipd-billing'");
    expect(permissionSource).toContain("permissions: { GET: 'ipd:report:read' }");
  });

  it('stays hidden when the tenant flag is absent', async () => {
    const { sqlite, app } = fixture();
    try {
      const response = await app.request('/canonical-ipd-billing/admissions');
      expect(response.status).toBe(404);
    } finally { sqlite.close(); }
  });

  it('stays hidden when the tenant flag is false', async () => {
    const { sqlite, app } = fixture({ flag: 'false' });
    try {
      const response = await app.request('/canonical-ipd-billing/admissions/501');
      expect(response.status).toBe(404);
    } finally { sqlite.close(); }
  });

  it('returns list and detail from the same canonical projection when enabled', async () => {
    const { sqlite, app } = fixture({ flag: 'true' });
    try {
      const listResponse = await app.request('/canonical-ipd-billing/admissions');
      const detailResponse = await app.request('/canonical-ipd-billing/admissions/501');
      expect(listResponse.status).toBe(200);
      expect(detailResponse.status).toBe(200);
      const list = await listResponse.json() as { data: Array<{ summary: unknown }> };
      const detail = await detailResponse.json() as { data: { summary: unknown; admission: { legacyAdmissionId: number } } };
      expect(list.data).toHaveLength(1);
      expect(list.data[0].summary).toEqual(detail.data.summary);
      expect(detail.data.admission.legacyAdmissionId).toBe(501);
    } finally { sqlite.close(); }
  });

  it('denies roles outside the IPD billing read boundary before projection', async () => {
    const { sqlite, app } = fixture({ flag: 'true', role: 'doctor' });
    try {
      const response = await app.request('/canonical-ipd-billing/admissions');
      expect(response.status).toBe(403);
    } finally { sqlite.close(); }
  });

  it('executes only read-only SQL', async () => {
    const { sqlite, app, executedSql } = fixture({ flag: 'true' });
    try {
      const response = await app.request('/canonical-ipd-billing/admissions/501');
      expect(response.status).toBe(200);
      expect(executedSql.length).toBeGreaterThan(0);
      for (const sql of executedSql) {
        const normalized = sql.trim().replace(/^\(+/, '').toUpperCase();
        expect(normalized.startsWith('SELECT') || normalized.startsWith('WITH') || normalized.startsWith('PRAGMA')).toBe(true);
        expect(normalized).not.toMatch(/\b(INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER)\b/);
      }
    } finally { sqlite.close(); }
  });
});
