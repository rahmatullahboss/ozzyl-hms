import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  PREDEPLOY_COMPENSATION_BACKFILL_APPROVAL,
  buildPredeployCompensationExpectedState,
  buildPredeployCompensationRepairSql,
  executePredeployCompensationBackfill,
  type PredeployCompensationGateway,
  type PredeployCompensationState,
} from '../../scripts/canonical/execute-production-predeploy-compensation-backfill';
import {
  CDB101_PRODUCTION_DATABASE_ID,
  CDB101_PRODUCTION_DATABASE_NAME,
} from '../../scripts/canonical/production-cutover-contract';

const SOURCE_KEY = 'bill:6917:line:1:doctor_visit:101:doctor:101:rule:2:performing';
const ISSUE_PUBLIC_ID = 'canissue_2CR9CW4BCSBDA5H7XFA5QBVAKK';

function emptyState(): PredeployCompensationState {
  return {
    legacy_accrual_id: 2637,
    doctor_id: 101,
    patient_id: 1995,
    bill_id: 6917,
    source_type: 'consultation_fee',
    incentive_type: 'performer',
    gross_amount: 500,
    commission_rule_id: 2,
    commission_rate_bps: 10000,
    commission_flat_amount: 0,
    commission_amount: 400,
    earned_commission_amount: 400,
    doctor_waiver_amount: 0,
    payable_commission_amount: 400,
    paid_amount: 0,
    balance_amount: 400,
    legacy_status: 'accrued',
    accrued_date: '2026-07-22',
    created_by: 103,
    legacy_created_at: '2026-07-22 17:07:56',
    legacy_updated_at: '2026-07-22 17:07:56',
    commission_base_amount: 400,
    performer_reserve_amount: 0,
    canonical_source_key: SOURCE_KEY,
    doctor_name: 'Dr. Aminul Islam',
    doctor_specialty: 'General Medicine',
    doctor_department: null,
    doctor_registration_number: 'A-52341',
    doctor_user_id: 118,
    doctor_is_active: 1,
    doctor_created_at: '2026-03-12 08:47:51',
    doctor_updated_at: '2026-07-03 17:57:05',
    rule_service_type: 'consultation_fee',
    rule_incentive_type: 'performer',
    rule_lab_test_id: null,
    rule_category: null,
    rule_rate_type: 'percent',
    rule_rate_value: 10000,
    rule_effective_from: '2026-05-08',
    rule_effective_to: null,
    rule_is_active: 1,
    rule_created_at: '2026-05-08 23:28:51',
    rule_updated_at: '2026-05-08 23:28:51',
    invoice_public_id: 'inv_2FGFYAP12QQYKSDP340XV6HFDZ',
    invoice_line_public_id: 'invline_37XWRC6Y6VKZ6V49AF09Z4AZF5',
    invoice_line_amount_minor: 50000,
    invoice_status: 'posted',
    practitioner_public_id: 'prc_3Z76VHK75YM54ZT6HNKDTZ6J36',
    practitioner_kind: 'internal',
    practitioner_display_name: 'Dr. Aminul Islam',
    practitioner_status: 'active',
    practitioner_mapping_public_id: 'prc_3Z76VHK75YM54ZT6HNKDTZ6J36',
    practitioner_mapping_evidence_sha256: '5b9baf3124af7019e68712b30d10e921233f93a3828dc61a929be5294b6c6c69',
    rule_public_id: 'comprule_5E72KT596RPC0323S4SHVY51EM',
    rule_version: 1,
    canonical_rule_practitioner_public_id: 'prc_3Z76VHK75YM54ZT6HNKDTZ6J36',
    canonical_rule_role: 'performing',
    canonical_rule_stage: 'commission',
    canonical_rule_rate_type: 'basis_points',
    canonical_rule_rate_value: 10000,
    canonical_rule_calculation_basis: 'net_after_discount',
    canonical_rule_status: 'active',
    canonical_rule_evidence_sha256: '08b13b328f8752f0a52d7e2eaf27dccb24addd812b27f34f818cacdc6db9359d',
    rule_mapping_public_id: 'comprule_5E72KT596RPC0323S4SHVY51EM',
    rule_mapping_evidence_sha256: '08b13b328f8752f0a52d7e2eaf27dccb24addd812b27f34f818cacdc6db9359d',
    accrual_public_id: null,
    accrual_invoice_public_id: null,
    accrual_invoice_line_public_id: null,
    accrual_practitioner_public_id: null,
    accrual_rule_public_id: null,
    accrual_rule_version: null,
    accrual_gross_minor: null,
    accrual_discount_minor: null,
    accrual_eligible_base_minor: null,
    accrual_earned_minor: null,
    accrual_adjusted_minor: null,
    accrual_payable_minor: null,
    accrual_status: null,
    accrual_source_evidence_sha256: null,
    accrual_mapping_count: 0,
    accrual_mapping_public_id: null,
    accrual_mapping_evidence_sha256: null,
    issue_public_id: ISSUE_PUBLIC_ID,
    issue_status: 'open',
    issue_occurrence_count: 1,
    issue_entity_public_id: 'doctor-compensation.accrue',
    issue_source_public_id: 'doctor-compensation.accrue',
    issue_cause_message_hash: 'dc137a3ec7e700b200bfa054f1eecf70dabde24c915139cdf7a615fe20c26b7b',
    issue_first_seen_at_utc: '2026-07-22T11:07:56.900Z',
    issue_last_seen_at_utc: '2026-07-22T11:07:56.900Z',
    issue_resolved_at_utc: null,
    issue_resolution_code: null,
  };
}

async function completeState(): Promise<PredeployCompensationState> {
  const expected = await buildPredeployCompensationExpectedState(emptyState());
  return {
    ...emptyState(),
    accrual_public_id: expected.accrualPublicId,
    accrual_invoice_public_id: expected.invoicePublicId,
    accrual_invoice_line_public_id: expected.invoiceLinePublicId,
    accrual_practitioner_public_id: expected.practitionerPublicId,
    accrual_rule_public_id: expected.rulePublicId,
    accrual_rule_version: 1,
    accrual_gross_minor: 50000,
    accrual_discount_minor: 10000,
    accrual_eligible_base_minor: 40000,
    accrual_earned_minor: 40000,
    accrual_adjusted_minor: 0,
    accrual_payable_minor: 40000,
    accrual_status: 'accrued',
    accrual_source_evidence_sha256: expected.accrualEvidenceSha256,
    accrual_mapping_count: 1,
    accrual_mapping_public_id: expected.accrualPublicId,
    accrual_mapping_evidence_sha256: expected.accrualEvidenceSha256,
    issue_status: 'resolved',
    issue_resolved_at_utc: '2026-07-22T12:00:00.000Z',
    issue_resolution_code: 'TARGETED_CANONICAL_BACKFILL',
  };
}

function createSchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE doctor_commission_accruals (
      id INTEGER PRIMARY KEY, tenant_id TEXT, doctor_id INTEGER, patient_id INTEGER, bill_id INTEGER,
      source_type TEXT, incentive_type TEXT, gross_amount REAL, commission_rule_id INTEGER,
      commission_rate_bps INTEGER, commission_flat_amount REAL, commission_amount REAL,
      earned_commission_amount REAL, doctor_waiver_amount REAL, payable_commission_amount REAL,
      paid_amount REAL, balance_amount REAL, status TEXT, accrued_date TEXT, created_by INTEGER,
      created_at TEXT, updated_at TEXT, commission_base_amount REAL, performer_reserve_amount REAL,
      canonical_source_key TEXT
    );
    CREATE TABLE canonical_invoice_lines (
      tenant_id TEXT, invoice_public_id TEXT, line_public_id TEXT,
      adjustment_code TEXT, line_amount_minor INTEGER
    );
    CREATE TABLE canonical_invoices (
      tenant_id TEXT, invoice_public_id TEXT, invoice_number TEXT, status TEXT
    );
    CREATE TABLE canonical_practitioners (
      tenant_id TEXT, practitioner_public_id TEXT, practitioner_kind TEXT, display_name TEXT, status TEXT
    );
    CREATE TABLE canonical_compensation_rules (
      tenant_id TEXT, rule_public_id TEXT, rule_version INTEGER, practitioner_public_id TEXT,
      practitioner_role TEXT, accrual_stage TEXT, rate_type TEXT, rate_value INTEGER,
      calculation_basis TEXT, status TEXT, source_evidence_sha256 TEXT
    );
    CREATE TABLE canonical_compensation_accruals (
      tenant_id TEXT, accrual_public_id TEXT, invoice_public_id TEXT, invoice_line_public_id TEXT,
      service_event_public_id TEXT, practitioner_public_id TEXT, practitioner_role TEXT,
      accrual_stage TEXT, rule_public_id TEXT, rule_version INTEGER, calculation_basis TEXT,
      rate_type TEXT, rate_value INTEGER, currency_code TEXT, gross_minor INTEGER,
      discount_minor INTEGER, tax_minor INTEGER, performer_reserve_minor INTEGER,
      eligible_base_minor INTEGER, earned_minor INTEGER, adjusted_minor INTEGER,
      settled_minor INTEGER, payable_minor INTEGER, status TEXT, accrued_at_utc TEXT,
      business_date TEXT, payable_projection_guard INTEGER, source_evidence_sha256 TEXT,
      created_at_utc TEXT, updated_at_utc TEXT, UNIQUE(tenant_id,accrual_public_id)
    );
    CREATE TABLE canonical_source_mappings (
      tenant_id TEXT, entity_type TEXT, canonical_public_id TEXT, source_type TEXT,
      source_public_id TEXT, source_table TEXT, mapping_status TEXT, mapping_version INTEGER,
      evidence_sha256 TEXT, created_at_utc TEXT, updated_at_utc TEXT,
      UNIQUE(tenant_id,entity_type,source_type,source_public_id)
    );
    CREATE TABLE canonical_processing_issues (
      tenant_id TEXT, issue_public_id TEXT, issue_type TEXT, issue_code TEXT, entity_type TEXT,
      entity_public_id TEXT, source_type TEXT, source_public_id TEXT, fingerprint TEXT,
      severity TEXT, status TEXT, occurrence_count INTEGER, summary TEXT, details_json TEXT,
      first_seen_at_utc TEXT, last_seen_at_utc TEXT, resolved_at_utc TEXT,
      resolved_by_public_id TEXT, resolution_code TEXT, created_at_utc TEXT, updated_at_utc TEXT
    );
  `);
}

function seed(database: DatabaseSync): void {
  const row = emptyState();
  database.prepare(`INSERT INTO doctor_commission_accruals VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    row.legacy_accrual_id, '100', row.doctor_id, row.patient_id, row.bill_id, row.source_type,
    row.incentive_type, row.gross_amount, row.commission_rule_id, row.commission_rate_bps,
    row.commission_flat_amount, row.commission_amount, row.earned_commission_amount,
    row.doctor_waiver_amount, row.payable_commission_amount, row.paid_amount, row.balance_amount,
    row.legacy_status, row.accrued_date, row.created_by, row.legacy_created_at,
    row.legacy_updated_at, row.commission_base_amount, row.performer_reserve_amount,
    row.canonical_source_key,
  );
  database.prepare(`INSERT INTO canonical_invoices VALUES ('100',?,?,?)`).run(
    row.invoice_public_id, 'INV-A-2026-000037', row.invoice_status,
  );
  database.prepare(`INSERT INTO canonical_invoice_lines VALUES ('100',?,?,?,?)`).run(
    row.invoice_public_id, row.invoice_line_public_id, 'LEGACY_DOCTOR_VISIT', row.invoice_line_amount_minor,
  );
  database.prepare(`INSERT INTO canonical_practitioners VALUES ('100',?,?,?,?)`).run(
    row.practitioner_public_id, row.practitioner_kind, row.practitioner_display_name, row.practitioner_status,
  );
  database.prepare(`INSERT INTO canonical_compensation_rules VALUES ('100',?,?,?,?,?,?,?,?,?,?)`).run(
    row.rule_public_id, row.rule_version, row.canonical_rule_practitioner_public_id,
    row.canonical_rule_role, row.canonical_rule_stage, row.canonical_rule_rate_type,
    row.canonical_rule_rate_value, row.canonical_rule_calculation_basis,
    row.canonical_rule_status, row.canonical_rule_evidence_sha256,
  );
  database.prepare(`INSERT INTO canonical_source_mappings VALUES ('100','practitioner',?,'legacy_doctor','101','doctors','mapped',1,?,?,?)`).run(
    row.practitioner_mapping_public_id, row.practitioner_mapping_evidence_sha256,
    '2026-07-22T11:00:00.000Z', '2026-07-22T11:00:00.000Z',
  );
  database.prepare(`INSERT INTO canonical_source_mappings VALUES ('100','compensation_rule',?,'legacy_doctor_commission_rule','2','doctor_commission_rules','mapped',1,?,?,?)`).run(
    row.rule_mapping_public_id, row.rule_mapping_evidence_sha256,
    '2026-07-22T11:00:00.000Z', '2026-07-22T11:00:00.000Z',
  );
  database.prepare(`INSERT INTO canonical_processing_issues VALUES ('100',?,'financial_shadow_write','CANONICAL_SHADOW_WRITE_FAILED','financial_boundary','doctor-compensation.accrue','runtime_shadow_write','doctor-compensation.accrue','fingerprint','error','open',1,'Canonical shadow write failed after the legacy financial mutation committed.',?,'2026-07-22T11:07:56.900Z','2026-07-22T11:07:56.900Z',NULL,NULL,NULL,'2026-07-22T11:07:56.900Z','2026-07-22T11:07:56.900Z')`).run(
    ISSUE_PUBLIC_ID,
    JSON.stringify({
      schemaVersion: 1,
      boundary: 'doctor-compensation.accrue',
      causeName: 'Error',
      causeCode: null,
      causeMessageHash: row.issue_cause_message_hash,
      legacyAuthorityCommitted: true,
    }),
  );
}

describe('production pre-deploy compensation backfill', () => {
  it('creates the exact accrual, mapping, and resolves the matching shadow issue', async () => {
    let state = emptyState();
    let writes = 0;
    const gateway: PredeployCompensationGateway = {
      async readDatabaseIdentity() {
        return { uuid: CDB101_PRODUCTION_DATABASE_ID, name: CDB101_PRODUCTION_DATABASE_NAME };
      },
      async readState() {
        return state;
      },
      async writeRepair(sql) {
        writes += 1;
        expect(sql).toContain('doctor_commission_accruals');
        expect(sql).toContain(SOURCE_KEY);
        expect(sql).toContain(ISSUE_PUBLIC_ID);
        state = await completeState();
        return { changes: 3, rowsWritten: 3 };
      },
    };

    await expect(executePredeployCompensationBackfill({
      approval: PREDEPLOY_COMPENSATION_BACKFILL_APPROVAL,
      execute: true,
    }, gateway)).resolves.toMatchObject({ repaired: true, execution: 'created', canonicalRowsCreated: 2, issuesResolved: 1 });
    expect(writes).toBe(1);
  });

  it('executes guarded SQL against SQLite', async () => {
    const database = new DatabaseSync(':memory:');
    createSchema(database);
    seed(database);
    database.exec(await buildPredeployCompensationRepairSql(emptyState(), '2026-07-22T12:00:00.000Z'));

    expect(database.prepare('SELECT gross_minor,discount_minor,eligible_base_minor,earned_minor,payable_minor,status FROM canonical_compensation_accruals').get()).toMatchObject({
      gross_minor: 50000,
      discount_minor: 10000,
      eligible_base_minor: 40000,
      earned_minor: 40000,
      payable_minor: 40000,
      status: 'accrued',
    });
    expect(database.prepare("SELECT COUNT(*) count FROM canonical_source_mappings WHERE entity_type='compensation_accrual'").get()).toMatchObject({ count: 1 });
    expect(database.prepare('SELECT status,resolution_code FROM canonical_processing_issues').get()).toMatchObject({
      status: 'resolved',
      resolution_code: 'TARGETED_CANONICAL_BACKFILL',
    });
    database.close();
  });

  it('verifies exact existing state without a second write and rejects partial state', async () => {
    let writes = 0;
    const exactGateway: PredeployCompensationGateway = {
      async readDatabaseIdentity() {
        return { uuid: CDB101_PRODUCTION_DATABASE_ID, name: CDB101_PRODUCTION_DATABASE_NAME };
      },
      async readState() {
        return completeState();
      },
      async writeRepair() {
        writes += 1;
        return { changes: 0, rowsWritten: 0 };
      },
    };
    await expect(executePredeployCompensationBackfill({
      approval: PREDEPLOY_COMPENSATION_BACKFILL_APPROVAL,
      execute: true,
    }, exactGateway)).resolves.toMatchObject({ execution: 'verified_existing' });
    expect(writes).toBe(0);

    const partialGateway: PredeployCompensationGateway = {
      ...exactGateway,
      async readState() {
        return { ...emptyState(), accrual_mapping_count: 1 };
      },
    };
    await expect(executePredeployCompensationBackfill({
      approval: PREDEPLOY_COMPENSATION_BACKFILL_APPROVAL,
      execute: true,
    }, partialGateway)).rejects.toThrow(/partial canonical state/i);
  });

  it('fails before write for wrong approval or source drift', async () => {
    let writes = 0;
    const gateway: PredeployCompensationGateway = {
      async readDatabaseIdentity() {
        return { uuid: CDB101_PRODUCTION_DATABASE_ID, name: CDB101_PRODUCTION_DATABASE_NAME };
      },
      async readState() {
        return { ...emptyState(), payable_commission_amount: 399 };
      },
      async writeRepair() {
        writes += 1;
        return { changes: 3, rowsWritten: 3 };
      },
    };
    await expect(executePredeployCompensationBackfill({ approval: 'wrong', execute: true }, gateway)).rejects.toThrow(/approval/i);
    await expect(executePredeployCompensationBackfill({
      approval: PREDEPLOY_COMPENSATION_BACKFILL_APPROVAL,
      execute: true,
    }, gateway)).rejects.toThrow(/source state/i);
    expect(writes).toBe(0);
  });
});
