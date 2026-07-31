import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  createCompensationRule,
  replaceCompensationRule,
  retireCompensationRule,
} from '../../src/lib/canonical/contracts/manage-compensation-rule';
import type {
  CanonicalBatchDatabase,
  CanonicalPreparedStatement,
} from '../../src/lib/canonical/command-batch';

 type SqlValue = string | number | bigint | null | Uint8Array;

class Statement implements CanonicalPreparedStatement {
  constructor(
    private readonly database: DatabaseSync,
    readonly sql: string,
    readonly params: SqlValue[] = [],
  ) {}

  bind(...values: unknown[]): Statement {
    return new Statement(
      this.database,
      this.sql,
      values.map((value) => value === undefined ? null : value) as SqlValue[],
    );
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.params);
    return {
      success: true,
      meta: {
        changes: Number(result.changes ?? 0),
        last_row_id: Number(result.lastInsertRowid ?? 0),
      },
    };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.database.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }
}

function harness() {
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
  ]) sqlite.exec(readFileSync(`migrations/${name}`, 'utf8'));
  sqlite.exec(`
    CREATE TABLE doctor_commission_rules (id INTEGER PRIMARY KEY);
    CREATE TABLE doctor_commission_accruals (id INTEGER PRIMARY KEY);
  `);
  sqlite.exec(readFileSync('migrations/0539_doctor_protected_commission_floor.sql', 'utf8'));
  sqlite.exec(`
    CREATE TABLE legacy_rule_projection (
      tenant_id TEXT NOT NULL,
      rule_key TEXT NOT NULL,
      PRIMARY KEY (tenant_id, rule_key)
    );
  `);

  const db: CanonicalBatchDatabase = {
    prepare(sql: string) { return new Statement(sqlite, sql); },
    async batch(statements) {
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return { sqlite, db };
}

function seedAuthority(sqlite: DatabaseSync): void {
  sqlite.exec(`
    INSERT INTO canonical_practitioners (
      tenant_id,practitioner_public_id,practitioner_kind,display_name,status
    ) VALUES
      ('tenant-a','prac-a','internal','Synthetic Practitioner','active'),
      ('tenant-b','prac-b','internal','Other Tenant Practitioner','active');

    INSERT INTO canonical_service_catalog_items (
      tenant_id,service_public_id,item_kind,display_name,unit_code,status,source_evidence_sha256
    ) VALUES
      ('tenant-a','svc-a','consultation','Consultation','service','active','${'1'.repeat(64)}'),
      ('tenant-b','svc-b','consultation','Other Consultation','service','active','${'2'.repeat(64)}');
  `);
}

function createInput(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: 'tenant-a',
    rulePublicId: 'rule-a',
    scopeType: 'service' as const,
    servicePublicId: 'svc-a',
    categoryKey: null,
    practitionerPublicId: 'prac-a',
    practitionerRole: 'performing' as const,
    accrualStage: 'commission' as const,
    rateType: 'basis_points' as const,
    rateValue: 1500,
    waiverPolicy: 'protected_floor' as const,
    protectedRateValue: 500,
    calculationBasis: 'net_after_discount' as const,
    discountTreatment: 'deduct' as const,
    taxTreatment: 'exclude' as const,
    minimumMinor: 0,
    capMinor: 500000,
    priority: 20,
    effectiveFrom: '2026-07-01',
    effectiveTo: null,
    status: 'active' as const,
    sourceType: 'doctor_commission_rule',
    sourcePublicId: 'legacy-rule-1',
    sourceTable: 'doctor_commission_rules',
    sourceEvidenceSha256: 'a'.repeat(64),
    occurredAtUtc: '2026-07-28T10:00:00.000Z',
    businessDate: '2026-07-28',
    idempotencyKey: 'comp-rule-create-1',
    outboxEventPublicId: 'outbox-comp-rule-create-1',
    ...overrides,
  };
}

function scalar(sqlite: DatabaseSync, sql: string): number {
  return Number((sqlite.prepare(sql).get() as { count: number }).count);
}

describe('Canonical compensation rule commands', () => {
  it('creates one exact rule version with mapping/outbox and supports exact replay', async () => {
    const { sqlite, db } = harness();
    seedAuthority(sqlite);
    try {
      const input = createInput();
      await expect(createCompensationRule(db, input)).resolves.toEqual({
        status: 'applied',
        result: { rulePublicId: 'rule-a', ruleVersion: 1, status: 'active' },
      });
      await expect(createCompensationRule(db, input)).resolves.toEqual({
        status: 'replayed',
        result: { rulePublicId: 'rule-a', ruleVersion: 1, status: 'active' },
      });
      await expect(createCompensationRule(db, { ...input, rateValue: 1600 })).rejects.toThrow(/idempotency/i);

      expect(scalar(sqlite, "SELECT COUNT(*) count FROM canonical_compensation_rules WHERE tenant_id='tenant-a' AND rule_public_id='rule-a'")).toBe(1);
      expect(scalar(sqlite, "SELECT COUNT(*) count FROM canonical_source_mappings WHERE entity_type='compensation_rule' AND canonical_public_id='rule-a'")).toBe(1);
      expect(scalar(sqlite, "SELECT COUNT(*) count FROM canonical_outbox_events WHERE event_type='canonical.compensation-rule.created'")).toBe(1);
      const row = sqlite.prepare(`
        SELECT rule_version,rate_type,rate_value,waiver_policy,protected_rate_value,status
        FROM canonical_compensation_rules
        WHERE tenant_id='tenant-a' AND rule_public_id='rule-a'
      `).get() as Record<string, unknown>;
      expect(row).toMatchObject({
        rule_version: 1,
        rate_type: 'basis_points',
        rate_value: 1500,
        waiver_policy: 'protected_floor',
        protected_rate_value: 500,
        status: 'active',
      });
    } finally {
      sqlite.close();
    }
  });

  it('replaces and retires by appending immutable versions', async () => {
    const { sqlite, db } = harness();
    seedAuthority(sqlite);
    try {
      await createCompensationRule(db, createInput());
      await expect(replaceCompensationRule(db, {
        ...createInput({
          expectedVersion: 1,
          rateValue: 1750,
          sourceEvidenceSha256: 'b'.repeat(64),
          occurredAtUtc: '2026-07-28T11:00:00.000Z',
          idempotencyKey: 'comp-rule-replace-1',
          outboxEventPublicId: 'outbox-comp-rule-replace-1',
        }),
      })).resolves.toEqual({
        status: 'applied',
        result: { rulePublicId: 'rule-a', ruleVersion: 2, status: 'active' },
      });
      await expect(retireCompensationRule(db, {
        tenantId: 'tenant-a',
        rulePublicId: 'rule-a',
        expectedVersion: 2,
        reasonCode: 'contract-retired',
        sourceType: 'doctor_commission_rule',
        sourcePublicId: 'legacy-rule-1',
        sourceTable: 'doctor_commission_rules',
        sourceEvidenceSha256: 'c'.repeat(64),
        occurredAtUtc: '2026-07-28T12:00:00.000Z',
        businessDate: '2026-07-28',
        idempotencyKey: 'comp-rule-retire-1',
        outboxEventPublicId: 'outbox-comp-rule-retire-1',
      })).resolves.toEqual({
        status: 'applied',
        result: { rulePublicId: 'rule-a', ruleVersion: 3, status: 'retired' },
      });

      const versions = sqlite.prepare(`
        SELECT rule_version,rate_value,status,source_evidence_sha256
        FROM canonical_compensation_rules
        WHERE tenant_id='tenant-a' AND rule_public_id='rule-a'
        ORDER BY rule_version
      `).all() as Record<string, unknown>[];
      expect(versions).toEqual([
        expect.objectContaining({ rule_version: 1, rate_value: 1500, status: 'active', source_evidence_sha256: 'a'.repeat(64) }),
        expect.objectContaining({ rule_version: 2, rate_value: 1750, status: 'active', source_evidence_sha256: 'b'.repeat(64) }),
        expect.objectContaining({ rule_version: 3, rate_value: 1750, status: 'retired', source_evidence_sha256: 'c'.repeat(64) }),
      ]);
      expect(scalar(sqlite, "SELECT COUNT(*) count FROM canonical_outbox_events WHERE aggregate_public_id='rule-a'")).toBe(3);
    } finally {
      sqlite.close();
    }
  });

  it('fails closed on stale versions, invalid money/scope and cross-tenant references', async () => {
    const { sqlite, db } = harness();
    seedAuthority(sqlite);
    try {
      await expect(createCompensationRule(db, createInput({ rateValue: 10001 }))).rejects.toThrow(/basis points/i);
      await expect(createCompensationRule(db, createInput({ scopeType: 'service', servicePublicId: null, categoryKey: null }))).rejects.toThrow(/servicePublicId/i);
      await expect(createCompensationRule(db, createInput({ practitionerPublicId: 'prac-b' }))).rejects.toThrow(/practitioner/i);
      await expect(createCompensationRule(db, createInput({ servicePublicId: 'svc-b' }))).rejects.toThrow(/service/i);

      await createCompensationRule(db, createInput());
      await expect(replaceCompensationRule(db, {
        ...createInput({
          expectedVersion: 2,
          sourceEvidenceSha256: 'd'.repeat(64),
          idempotencyKey: 'replace-stale',
          outboxEventPublicId: 'outbox-replace-stale',
        }),
      })).rejects.toThrow(/expectedVersion/i);
      expect(scalar(sqlite, "SELECT COUNT(*) count FROM canonical_compensation_rules WHERE rule_public_id='rule-a'")).toBe(1);
    } finally {
      sqlite.close();
    }
  });

  it('bootstraps exact practitioner and service references in the same command batch', async () => {
    const { sqlite, db } = harness();
    try {
      await expect(createCompensationRule(db, createInput({
        practitionerPublicId: 'prac-bootstrap',
        servicePublicId: 'svc-bootstrap',
        idempotencyKey: 'comp-rule-bootstrap-references',
        outboxEventPublicId: 'outbox-comp-rule-bootstrap-references',
      }), {
        referenceBootstrap: {
          practitioners: [{
            practitionerPublicId: 'prac-bootstrap',
            displayName: 'Bootstrap Practitioner',
            practitionerKind: 'internal',
            sourceType: 'legacy_doctor',
            sourcePublicId: '71',
            sourceTable: 'doctors',
            sourceEvidenceSha256: '3'.repeat(64),
          }],
          services: [{
            servicePublicId: 'svc-bootstrap',
            itemKind: 'laboratory',
            canonicalCode: null,
            displayName: 'Bootstrap CBC',
            unitCode: 'service',
            sourceType: 'legacy_lab_test',
            sourcePublicId: '81',
            sourceTable: 'lab_test_catalog',
            sourceEvidenceSha256: '4'.repeat(64),
          }],
        },
      })).resolves.toEqual({
        status: 'applied',
        result: { rulePublicId: 'rule-a', ruleVersion: 1, status: 'active' },
      });

      expect(scalar(sqlite, "SELECT COUNT(*) count FROM canonical_practitioners WHERE practitioner_public_id='prac-bootstrap'")).toBe(1);
      expect(scalar(sqlite, "SELECT COUNT(*) count FROM canonical_service_catalog_items WHERE service_public_id='svc-bootstrap'")).toBe(1);
      expect(scalar(sqlite, "SELECT COUNT(*) count FROM canonical_source_mappings WHERE entity_type='practitioner' AND source_public_id='71'")).toBe(1);
      expect(scalar(sqlite, "SELECT COUNT(*) count FROM canonical_source_mappings WHERE entity_type='service_catalog_item' AND source_public_id='81'")).toBe(1);
      expect(scalar(sqlite, "SELECT COUNT(*) count FROM canonical_compensation_rules WHERE rule_public_id='rule-a'")).toBe(1);
    } finally {
      sqlite.close();
    }
  });

  it('bootstraps an immutable legacy snapshot before replace or retire when Canonical history is absent', async () => {
    const bootstrapCurrent = {
      scopeType: 'all' as const,
      servicePublicId: null,
      categoryKey: null,
      practitionerPublicId: null,
      practitionerRole: 'performing' as const,
      accrualStage: 'performer_reserve' as const,
      rateType: 'fixed' as const,
      rateValue: 20_000,
      waiverPolicy: 'full_earned' as const,
      protectedRateValue: 0,
      calculationBasis: 'net_after_discount' as const,
      discountTreatment: 'deduct' as const,
      taxTreatment: 'exclude' as const,
      minimumMinor: 0,
      capMinor: null,
      priority: 10,
      effectiveFrom: '2026-07-01',
      effectiveTo: null,
      status: 'active' as const,
      sourceEvidenceSha256: '5'.repeat(64),
    };

    {
      const { sqlite, db } = harness();
      try {
        await expect(replaceCompensationRule(db, {
          ...createInput({
            rulePublicId: 'rule-bootstrap-replace',
            sourcePublicId: 'legacy-bootstrap-replace',
            scopeType: 'all',
            servicePublicId: null,
            practitionerPublicId: null,
            accrualStage: 'performer_reserve',
            rateType: 'fixed',
            rateValue: 25_000,
            waiverPolicy: 'full_earned',
            protectedRateValue: 0,
            priority: 10,
            expectedVersion: 0,
            sourceEvidenceSha256: '6'.repeat(64),
            idempotencyKey: 'bootstrap-replace',
            outboxEventPublicId: 'outbox-bootstrap-replace',
          }),
          bootstrapCurrent,
        })).resolves.toEqual({
          status: 'applied',
          result: { rulePublicId: 'rule-bootstrap-replace', ruleVersion: 2, status: 'active' },
        });
        const rows = sqlite.prepare(`
          SELECT rule_version,rate_value,status FROM canonical_compensation_rules
          WHERE rule_public_id='rule-bootstrap-replace' ORDER BY rule_version
        `).all() as Array<Record<string, unknown>>;
        expect(rows).toEqual([
          expect.objectContaining({ rule_version: 1, rate_value: 20_000, status: 'active' }),
          expect.objectContaining({ rule_version: 2, rate_value: 25_000, status: 'active' }),
        ]);
      } finally {
        sqlite.close();
      }
    }

    {
      const { sqlite, db } = harness();
      try {
        await expect(retireCompensationRule(db, {
          tenantId: 'tenant-a',
          rulePublicId: 'rule-bootstrap-retire',
          expectedVersion: 0,
          reasonCode: 'legacy-route-disable',
          sourceType: 'diagnostic_performer_rule',
          sourcePublicId: 'service-92',
          sourceTable: 'diagnostic_performer_payout_rules',
          sourceEvidenceSha256: '7'.repeat(64),
          occurredAtUtc: '2026-07-28T13:00:00.000Z',
          businessDate: '2026-07-28',
          idempotencyKey: 'bootstrap-retire',
          outboxEventPublicId: 'outbox-bootstrap-retire',
          bootstrapCurrent,
        })).resolves.toEqual({
          status: 'applied',
          result: { rulePublicId: 'rule-bootstrap-retire', ruleVersion: 2, status: 'retired' },
        });
        const rows = sqlite.prepare(`
          SELECT rule_version,rate_value,status FROM canonical_compensation_rules
          WHERE rule_public_id='rule-bootstrap-retire' ORDER BY rule_version
        `).all() as Array<Record<string, unknown>>;
        expect(rows).toEqual([
          expect.objectContaining({ rule_version: 1, rate_value: 20_000, status: 'active' }),
          expect.objectContaining({ rule_version: 2, rate_value: 20_000, status: 'retired' }),
        ]);
      } finally {
        sqlite.close();
      }
    }
  });

  it('rolls back compatibility and Canonical writes when any authoritative statement fails', async () => {
    const { sqlite, db } = harness();
    seedAuthority(sqlite);
    try {
      await expect(createCompensationRule(db, createInput(), {
        authoritativeStatements: [
          db.prepare('INSERT INTO legacy_rule_projection (tenant_id,rule_key) VALUES (?,?)').bind('tenant-a', 'legacy-rule-1'),
          db.prepare('INSERT INTO missing_rule_projection (tenant_id) VALUES (?)').bind('tenant-a'),
        ],
      })).rejects.toThrow();

      expect(scalar(sqlite, 'SELECT COUNT(*) count FROM legacy_rule_projection')).toBe(0);
      expect(scalar(sqlite, 'SELECT COUNT(*) count FROM canonical_compensation_rules')).toBe(0);
      expect(scalar(sqlite, 'SELECT COUNT(*) count FROM canonical_source_mappings')).toBe(0);
      expect(scalar(sqlite, 'SELECT COUNT(*) count FROM canonical_outbox_events')).toBe(0);
    } finally {
      sqlite.close();
    }
  });
});
