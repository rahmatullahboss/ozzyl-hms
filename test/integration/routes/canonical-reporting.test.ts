import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import canonicalReportingRoutes from '../../../src/routes/tenant/canonicalReporting';
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

function fixture(input: {
  flag?: {
    mode: 'legacy' | 'shadow' | 'canonical' | 'disabled';
    enabled?: 0 | 1;
    effectiveAtUtc?: string;
  };
  role?: string;
} = {}) {
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
    '0514_canonical_inventory_links.sql',
    '0515_canonical_accounting_outbox.sql',
  ]) sqlite.exec(readFileSync(`migrations/${name}`, 'utf8'));
  if (input.flag !== undefined) {
    sqlite.prepare(`
      INSERT INTO canonical_feature_flags(
        tenant_id,flag_key,domain,mode,is_enabled,version,effective_at_utc,updated_by_public_id
      ) VALUES ('tenant-a','canonical_reporting_v1','reporting',?,?,1,?,'test-user')
    `).run(input.flag.mode, input.flag.enabled ?? 1, input.flag.effectiveAtUtc ?? null);
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
  app.route('/canonical-reporting', canonicalReportingRoutes);
  app.onError((error, c) => {
    const status = (error as { status?: number }).status ?? 500;
    return c.json({ error: error.message }, status as 400 | 403 | 404 | 500 | 503);
  });
  return { sqlite, app, executedSql };
}

const DATE_QUERY = 'startDate=2026-07-14&endDate=2026-07-14&timeZone=Asia%2FDhaka';
const METRIC_COUNT = (JSON.parse(
  readFileSync('docs/database/metric-registry.yaml', 'utf8'),
) as { metrics: unknown[] }).metrics.length;

describe('canonical reporting canary route', () => {
  it('is registered separately from active reports with a read-only route permission', () => {
    const indexSource = readFileSync('src/index.ts', 'utf8');
    const permissionSource = readFileSync('src/lib/route-permissions.ts', 'utf8');
    expect(indexSource).toContain("app.route('/api/canonical-reporting', canonicalReportingRoutes);");
    expect(permissionSource).toContain("prefix: '/api/canonical-reporting'");
    expect(permissionSource).toContain("permissions: { GET: 'reporting:canonical:read' }");
  });

  it('stays hidden when the tenant flag is absent, disabled, or legacy', async () => {
    for (const flag of [
      undefined,
      { mode: 'legacy' as const, enabled: 1 as const },
      { mode: 'disabled' as const, enabled: 0 as const },
    ]) {
      const { sqlite, app } = fixture({ flag });
      try {
        const response = await app.request('/canonical-reporting/status');
        expect(response.status).toBe(404);
      } finally {
        sqlite.close();
      }
    }
  });

  it.each(['shadow', 'canonical'] as const)('exposes aggregate status in %s mode without switching active routes', async (mode) => {
    const { sqlite, app } = fixture({ flag: { mode, enabled: 1 } });
    try {
      const response = await app.request('/canonical-reporting/status');
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        data: {
          mode,
          metricCount: METRIC_COUNT,
          readOnly: true,
          activeRouteSwitched: false,
        },
      });
    } finally {
      sqlite.close();
    }
  });

  it('keeps a future-effective shadow flag hidden', async () => {
    const { sqlite, app } = fixture({
      flag: {
        mode: 'shadow',
        effectiveAtUtc: '2999-01-01T00:00:00.000Z',
      },
    });
    try {
      const response = await app.request('/canonical-reporting/status');
      expect(response.status).toBe(404);
    } finally {
      sqlite.close();
    }
  });

  it('returns empty doctor, compensation, diagnostic, and collection reports from canonical facts when shadow-enabled', async () => {
    const { sqlite, app } = fixture({ flag: { mode: 'shadow', enabled: 1 } });
    try {
      const doctor = await app.request(
        `/canonical-reporting/doctor-performance?${DATE_QUERY}&role=performing`,
      );
      const compensation = await app.request(
        `/canonical-reporting/doctor-compensation?${DATE_QUERY}`,
      );
      const diagnostics = await app.request(
        `/canonical-reporting/test-performance?${DATE_QUERY}`,
      );
      const collections = await app.request(
        `/canonical-reporting/collections?${DATE_QUERY}&currencyCode=BDT`,
      );
      const ipdFinance = await app.request(
        `/canonical-reporting/ipd-finance?${DATE_QUERY}&currencyCode=BDT`,
      );
      expect(doctor.status).toBe(200);
      expect(compensation.status).toBe(200);
      expect(diagnostics.status).toBe(200);
      expect(collections.status).toBe(200);
      expect(ipdFinance.status).toBe(200);
      const doctorBody = await doctor.json() as { data: { rows: unknown[]; summary: { eventCount: number } } };
      const compensationBody = await compensation.json() as {
        data: { rows: unknown[]; summary: { accrualCount: number; payableByCurrency: Record<string, number> } };
      };
      const diagnosticBody = await diagnostics.json() as { data: { rows: unknown[]; summary: { eventCount: number } } };
      const collectionBody = await collections.json() as { data: { rows: unknown[]; summary: { grossReceivedMinor: number } } };
      const ipdBody = await ipdFinance.json() as { data: { rows: unknown[]; summary: { admissionCount: number } } };
      expect(doctorBody.data.rows).toEqual([]);
      expect(doctorBody.data.summary.eventCount).toBe(0);
      expect(compensationBody.data.rows).toEqual([]);
      expect(compensationBody.data.summary.accrualCount).toBe(0);
      expect(compensationBody.data.summary.payableByCurrency).toEqual({});
      expect(diagnosticBody.data.rows).toEqual([]);
      expect(diagnosticBody.data.summary.eventCount).toBe(0);
      expect(collectionBody.data.rows).toEqual([]);
      expect(collectionBody.data.summary.grossReceivedMinor).toBe(0);
      expect(ipdBody.data.rows).toEqual([]);
      expect(ipdBody.data.summary.admissionCount).toBe(0);
    } finally {
      sqlite.close();
    }
  });

  it('validates dates, timezone, role, and currency before querying report facts', async () => {
    const { sqlite, app } = fixture({ flag: { mode: 'shadow', enabled: 1 } });
    try {
      const invalidDate = await app.request(
        '/canonical-reporting/test-performance?startDate=2026-07-15&endDate=2026-07-14&timeZone=Asia%2FDhaka',
      );
      const missingTimezone = await app.request(
        '/canonical-reporting/test-performance?startDate=2026-07-14&endDate=2026-07-14',
      );
      const invalidRole = await app.request(
        `/canonical-reporting/doctor-performance?${DATE_QUERY}&role=treating`,
      );
      const invalidCurrency = await app.request(
        `/canonical-reporting/collections?${DATE_QUERY}&currencyCode=bdt`,
      );
      expect(invalidDate.status).toBe(400);
      expect(missingTimezone.status).toBe(400);
      expect(invalidRole.status).toBe(400);
      expect(invalidCurrency.status).toBe(400);
    } finally {
      sqlite.close();
    }
  });

  it('denies roles outside the canonical reporting boundary before fact queries', async () => {
    const { sqlite, app } = fixture({ flag: { mode: 'shadow', enabled: 1 }, role: 'doctor' });
    try {
      const response = await app.request('/canonical-reporting/status');
      expect(response.status).toBe(403);
    } finally {
      sqlite.close();
    }
  });

  it('executes only read-only SQL', async () => {
    const { sqlite, app, executedSql } = fixture({ flag: { mode: 'shadow', enabled: 1 } });
    try {
      const response = await app.request(
        `/canonical-reporting/collections?${DATE_QUERY}&currencyCode=BDT`,
      );
      expect(response.status).toBe(200);
      expect(executedSql.length).toBeGreaterThan(0);
      for (const sql of executedSql) {
        const normalized = sql.trim().replace(/^\(+/, '').toUpperCase();
        expect(normalized.startsWith('SELECT') || normalized.startsWith('WITH')).toBe(true);
        expect(normalized).not.toMatch(/\b(INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER)\b/);
      }
    } finally {
      sqlite.close();
    }
  });
});
