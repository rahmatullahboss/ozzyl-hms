import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import type {
  CanonicalBatchDatabase,
  CanonicalPreparedStatement,
} from '../../src/lib/canonical/command-batch';
import { ensureAdmissionEncounter } from '../../src/lib/canonical/commands/ensure-admission-encounter';
import { finalizeIpdDischargeBilling } from '../../src/lib/canonical/commands/finalize-ipd-discharge-billing';
import { buildIpdDischargeBillingProjection } from '../../src/lib/canonical/live-ipd-discharge-billing';
import { normalizeLegacyAdmissionStartedAtUtc } from '../../src/lib/canonical/live-admission-continuity';
import {
  createDeterministicSourceId,
  createSourceEvidenceSha256,
} from '../../src/lib/canonical/source-mapping';
import { buildProductionCanonicalBundle } from './build-production-canonical-bundle';
import {
  buildTenantFinancialSnapshotFromAggregateRow,
  TENANT_FINANCIAL_RECONCILIATION_SQL,
  type TenantFinancialAggregateRow,
} from './collect-tenant-financial-reconciliation';
import { CDB101_FINANCIAL_IMPORT_TABLES } from './tenant-financial-import-contract';
import { evaluateTenantFinancialReconciliation } from './tenant-financial-reconciliation';

const TENANT_ID = '100';
const ISSUE_CODE = 'CANONICAL_SHADOW_WRITE_FAILED';
const RESOLUTION_CODE = 'IPD_SHADOW_REPAIR_RECONCILED';

export interface Tenant100IpdShadowRepairStatement extends CanonicalPreparedStatement {
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}

export interface Tenant100IpdShadowRepairDatabase extends CanonicalBatchDatabase {
  prepare(sql: string): Tenant100IpdShadowRepairStatement;
}

type SqlValue = string | number | bigint | null | Uint8Array;

class SqliteStatement implements Tenant100IpdShadowRepairStatement {
  constructor(
    private readonly database: DatabaseSync,
    readonly sql: string,
    readonly params: SqlValue[] = [],
  ) {}

  bind(...values: unknown[]): SqliteStatement {
    return new SqliteStatement(
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

  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    return { results: this.database.prepare(this.sql).all(...this.params) as T[] };
  }
}

function sqliteDatabase(database: DatabaseSync): Tenant100IpdShadowRepairDatabase {
  return {
    prepare(sql: string) { return new SqliteStatement(database, sql); },
    async batch(statements) {
      database.exec('BEGIN IMMEDIATE');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        database.exec('COMMIT');
        return results;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

interface RepairContract {
  billId: number;
  invoiceNo: string;
  admissionId: number;
  admissionNo: string;
  patientId: number;
  admissionType: 'planned' | 'emergency';
  total: number;
  provisionalItemId: number;
  bedInfoId: number;
  bedId: number;
  depositReceiptNo: string;
  adjustmentReceiptNo: string;
  refundReceiptNo: string | null;
  refundAmount: number;
}

const CONTRACTS: readonly RepairContract[] = [
  { billId: 7065, invoiceNo: 'BL-000025', admissionId: 13090, admissionNo: 'ADM-000065', patientId: 1326, admissionType: 'planned', total: 300, provisionalItemId: 1608, bedInfoId: 58, bedId: 12023, depositReceiptNo: 'DEP-000049', adjustmentReceiptNo: 'DAD-000014', refundReceiptNo: null, refundAmount: 0 },
  { billId: 7069, invoiceNo: 'BL-000026', admissionId: 13099, admissionNo: 'ADM-000068', patientId: 1186, admissionType: 'planned', total: 300, provisionalItemId: 1745, bedInfoId: 67, bedId: 12025, depositReceiptNo: 'DEP-000052', adjustmentReceiptNo: 'DAD-000015', refundReceiptNo: null, refundAmount: 0 },
  { billId: 7070, invoiceNo: 'BL-000027', admissionId: 13089, admissionNo: 'ADM-000064', patientId: 1262, admissionType: 'planned', total: 300, provisionalItemId: 1607, bedInfoId: 57, bedId: 12021, depositReceiptNo: 'DEP-000048', adjustmentReceiptNo: 'DAD-000016', refundReceiptNo: null, refundAmount: 0 },
  { billId: 7071, invoiceNo: 'BL-000028', admissionId: 13087, admissionNo: 'ADM-000063', patientId: 2263, admissionType: 'emergency', total: 40000, provisionalItemId: 1541, bedInfoId: 55, bedId: 12014, depositReceiptNo: 'DEP-000046', adjustmentReceiptNo: 'DAD-000017', refundReceiptNo: 'DRF-000005', refundAmount: 10000 },
] as const;

interface SourceRow {
  bill_id: number;
  invoice_no: string;
  patient_id: number;
  admission_id: number;
  subtotal: number;
  discount: number;
  total: number;
  paid: number;
  due: number;
  bill_status: string;
  bill_created_at: string;
  admission_no: string;
  admission_type: string;
  admission_status: string;
  admission_date: string;
  discharge_date: string;
  provisional_item_id: number;
  item_category: string;
  item_name: string;
  department: string | null;
  unit_price: number;
  quantity: number;
  discount_amount: number;
  total_amount: number;
  doctor_id: number | null;
  doctor_name: string | null;
  reference_id: number | null;
  item_status: string;
  item_bill_id: number;
  bed_info_id: number;
  bed_id: number;
  ward_name: string | null;
  bed_number: string | null;
  bed_type: string | null;
  bed_started_on: string;
  bed_ended_on: string | null;
  bed_charge_amount: number;
  bed_is_billed: number;
  bed_bill_id: number;
  deposit_receipt_no: string;
  deposit_amount: number;
  adjustment_receipt_no: string;
  adjustment_amount: number;
  refund_receipt_no: string | null;
  refund_amount: number;
  direct_payment_count: number;
}

interface EncounterAuthorityRow {
  encounter_public_id: string;
  legacy_patient_id: number;
  encounter_type: string;
  status: string;
  ended_at_utc: string | null;
}

interface ExistingInvoiceRow {
  invoice_public_id: string;
  legacy_patient_id: number;
  total_minor: number;
  paid_minor: number;
  due_minor: number;
  status: string;
}

function exactUtc(value: string): string {
  return normalizeLegacyAdmissionStartedAtUtc(value);
}

async function sourceRows(db: Tenant100IpdShadowRepairDatabase): Promise<SourceRow[]> {
  const { results } = await db.prepare(`
    SELECT
      b.id AS bill_id,b.invoice_no,b.patient_id,b.admission_id,b.subtotal,b.discount,
      b.total,b.paid,b.due,b.status AS bill_status,b.created_at AS bill_created_at,
      a.admission_no,a.admission_type,a.status AS admission_status,a.admission_date,a.discharge_date,
      p.id AS provisional_item_id,p.item_category,p.item_name,p.department,p.unit_price,
      p.quantity,p.discount_amount,p.total_amount,p.doctor_id,p.doctor_name,p.reference_id,
      p.bill_status AS item_status,p.billed_bill_id AS item_bill_id,
      bed.id AS bed_info_id,bed.bed_id,bed.ward_name,bed.bed_number,bed.bed_type,
      bed.started_on AS bed_started_on,bed.ended_on AS bed_ended_on,
      bed.charge_amount AS bed_charge_amount,bed.is_billed AS bed_is_billed,
      bed.billed_bill_id AS bed_bill_id,
      dep.deposit_receipt_no,dep.amount AS deposit_amount,
      adj.deposit_receipt_no AS adjustment_receipt_no,adj.amount AS adjustment_amount,
      ref.deposit_receipt_no AS refund_receipt_no,COALESCE(ref.amount,0) AS refund_amount,
      (SELECT COUNT(*) FROM payments pay
       WHERE CAST(pay.tenant_id AS TEXT)=? AND pay.bill_id=b.id) AS direct_payment_count
    FROM bills b
    JOIN admissions a
      ON CAST(a.tenant_id AS TEXT)=CAST(b.tenant_id AS TEXT) AND a.id=b.admission_id
    JOIN billing_provisional_items p
      ON CAST(p.tenant_id AS TEXT)=CAST(b.tenant_id AS TEXT)
      AND p.billed_bill_id=b.id AND p.total_amount>0
    JOIN patient_bed_infos bed
      ON CAST(bed.tenant_id AS TEXT)=CAST(b.tenant_id AS TEXT)
      AND bed.billed_bill_id=b.id
    JOIN billing_deposits adj
      ON CAST(adj.tenant_id AS TEXT)=CAST(b.tenant_id AS TEXT)
      AND adj.reference_bill_id=b.id AND adj.transaction_type='adjustment' AND adj.is_active=1
    JOIN billing_deposits dep
      ON CAST(dep.tenant_id AS TEXT)=CAST(b.tenant_id AS TEXT)
      AND dep.patient_id=b.patient_id AND dep.transaction_type='deposit' AND dep.is_active=1
      AND dep.deposit_receipt_no IN ('DEP-000049','DEP-000052','DEP-000048','DEP-000046')
    LEFT JOIN billing_deposits ref
      ON CAST(ref.tenant_id AS TEXT)=CAST(b.tenant_id AS TEXT)
      AND ref.patient_id=b.patient_id AND ref.transaction_type='refund' AND ref.is_active=1
      AND ref.deposit_receipt_no='DRF-000005'
    WHERE CAST(b.tenant_id AS TEXT)=?
      AND b.id IN (7065,7069,7070,7071)
    ORDER BY b.id
  `).bind(TENANT_ID, TENANT_ID).all<SourceRow>();
  return results;
}

function validateSourceContract(rows: readonly SourceRow[]): void {
  if (rows.length !== CONTRACTS.length) throw new Error('Tenant 100 IPD repair source contract row count changed');
  for (let index = 0; index < CONTRACTS.length; index += 1) {
    const expected = CONTRACTS[index];
    const row = rows[index];
    const requestedDeposit = expected.total + expected.refundAmount;
    const valid = row.bill_id === expected.billId
      && row.invoice_no === expected.invoiceNo
      && row.patient_id === expected.patientId
      && row.admission_id === expected.admissionId
      && row.admission_no === expected.admissionNo
      && row.admission_type === expected.admissionType
      && row.admission_status === 'discharged'
      && row.bill_status === 'paid'
      && Number(row.subtotal) === expected.total
      && Number(row.discount) === 0
      && Number(row.total) === expected.total
      && Number(row.paid) === 0
      && Number(row.due) === 0
      && row.provisional_item_id === expected.provisionalItemId
      && row.item_status === 'finalized'
      && row.item_bill_id === expected.billId
      && Number(row.total_amount) === expected.total
      && row.bed_info_id === expected.bedInfoId
      && row.bed_id === expected.bedId
      && row.bed_is_billed === 1
      && row.bed_bill_id === expected.billId
      && row.deposit_receipt_no === expected.depositReceiptNo
      && Number(row.deposit_amount) === requestedDeposit
      && row.adjustment_receipt_no === expected.adjustmentReceiptNo
      && Number(row.adjustment_amount) === expected.total
      && row.refund_receipt_no === expected.refundReceiptNo
      && Number(row.refund_amount) === expected.refundAmount
      && Number(row.direct_payment_count) === 0;
    if (!valid) throw new Error(`Tenant 100 IPD repair source contract changed for ${expected.invoiceNo}`);
  }
}

async function readEncounterAuthority(
  db: Tenant100IpdShadowRepairDatabase,
  admissionId: number,
): Promise<EncounterAuthorityRow | null> {
  return db.prepare(`
    SELECT l.encounter_public_id,e.legacy_patient_id,e.encounter_type,e.status,e.ended_at_utc
    FROM canonical_encounter_admission_links l
    JOIN canonical_encounters e
      ON e.tenant_id=l.tenant_id AND e.encounter_public_id=l.encounter_public_id
    WHERE l.tenant_id=? AND l.legacy_admission_id=? AND l.link_status='active'
    LIMIT 1
  `).bind(TENANT_ID, admissionId).first<EncounterAuthorityRow>();
}

async function ensureEncounterAuthority(
  db: Tenant100IpdShadowRepairDatabase,
  row: SourceRow,
): Promise<EncounterAuthorityRow> {
  let authority = await readEncounterAuthority(db, row.admission_id);
  if (!authority) {
    await ensureAdmissionEncounter(db, {
      tenantId: TENANT_ID,
      legacyAdmissionId: row.admission_id,
      admissionNo: row.admission_no,
      legacyPatientId: row.patient_id,
      admissionType: row.admission_type as 'planned' | 'emergency',
      startedAtUtc: exactUtc(row.admission_date),
    });
    authority = await readEncounterAuthority(db, row.admission_id);
  }
  if (!authority) throw new Error(`Canonical encounter authority was not created for ${row.invoice_no}`);
  const expectedType = row.admission_type === 'emergency' ? 'emergency' : 'inpatient';
  if (
    Number(authority.legacy_patient_id) !== row.patient_id
    || authority.encounter_type !== expectedType
    || (authority.status !== 'in_progress' && authority.status !== 'completed')
  ) {
    throw new Error(`Canonical encounter authority conflicts for ${row.invoice_no}`);
  }
  return authority;
}

async function ensureBedStay(
  db: Tenant100IpdShadowRepairDatabase,
  row: SourceRow,
  encounterPublicId: string,
): Promise<void> {
  const mapping = await db.prepare(`
    SELECT canonical_public_id,mapping_status
    FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type='bed_stay'
      AND source_type='legacy_patient_bed_info' AND source_public_id=?
    LIMIT 1
  `).bind(TENANT_ID, String(row.bed_info_id)).first<{ canonical_public_id: string | null; mapping_status: string }>();
  if (mapping) {
    if (mapping.mapping_status !== 'mapped' || !mapping.canonical_public_id) {
      throw new Error(`Canonical bed stay mapping conflicts for ${row.invoice_no}`);
    }
    const existing = await db.prepare(`
      SELECT encounter_public_id,legacy_admission_id,legacy_bed_id,status
      FROM canonical_bed_stays WHERE tenant_id=? AND bed_stay_public_id=? LIMIT 1
    `).bind(TENANT_ID, mapping.canonical_public_id).first<Record<string, unknown>>();
    if (
      !existing
      || existing.encounter_public_id !== encounterPublicId
      || Number(existing.legacy_admission_id) !== row.admission_id
      || Number(existing.legacy_bed_id) !== row.bed_id
    ) {
      throw new Error(`Canonical bed stay authority conflicts for ${row.invoice_no}`);
    }
    return;
  }

  const sourceType = 'legacy_patient_bed_info';
  const sourcePublicId = String(row.bed_info_id);
  const bedStayPublicId = await createDeterministicSourceId('bed', TENANT_ID, sourceType, sourcePublicId);
  const evidence = await createSourceEvidenceSha256({
    sourceType,
    sourcePublicId,
    patientId: row.patient_id,
    admissionId: row.admission_id,
    bedId: row.bed_id,
    startedOn: row.bed_started_on,
  });
  const startedAtUtc = exactUtc(row.bed_started_on);
  await db.batch([
    db.prepare(`
      INSERT INTO canonical_bed_stays (
        tenant_id,bed_stay_public_id,encounter_public_id,legacy_patient_bed_info_id,
        legacy_admission_id,legacy_bed_id,started_at_utc,status,source_evidence_sha256
      ) VALUES (?,?,?,?,?,?,?,'active',?)
    `).bind(
      TENANT_ID,bedStayPublicId,encounterPublicId,row.bed_info_id,row.admission_id,row.bed_id,startedAtUtc,evidence,
    ),
    db.prepare(`
      INSERT INTO canonical_source_mappings (
        tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
        source_table,mapping_status,mapping_version,evidence_sha256
      ) VALUES (?,'bed_stay',?,?,?,'patient_bed_infos','mapped',1,?)
    `).bind(TENANT_ID,bedStayPublicId,sourceType,sourcePublicId,evidence),
  ]);
}

async function readExistingInvoice(
  db: Tenant100IpdShadowRepairDatabase,
  invoiceNo: string,
): Promise<ExistingInvoiceRow | null> {
  return db.prepare(`
    SELECT invoice_public_id,legacy_patient_id,total_minor,paid_minor,due_minor,status
    FROM canonical_invoices WHERE tenant_id=? AND invoice_number=? LIMIT 1
  `).bind(TENANT_ID, invoiceNo).first<ExistingInvoiceRow>();
}

async function verifyCompletedRepair(
  db: Tenant100IpdShadowRepairDatabase,
  row: SourceRow,
  invoice: ExistingInvoiceRow,
): Promise<void> {
  const expectedMinor = Math.round(row.total * 100);
  if (
    invoice.legacy_patient_id !== row.patient_id
    || invoice.total_minor !== expectedMinor
    || invoice.paid_minor !== expectedMinor
    || invoice.due_minor !== 0
    || invoice.status !== 'posted'
  ) {
    throw new Error(`Canonical invoice partial state conflicts for ${row.invoice_no}`);
  }
  const linked = await db.prepare(`
    SELECT COUNT(*) AS count FROM canonical_invoice_encounter_links
    WHERE tenant_id=? AND invoice_public_id=? AND legacy_admission_id=? AND link_type='discharge_invoice'
  `).bind(TENANT_ID, invoice.invoice_public_id, row.admission_id).first<{ count: number }>();
  const applied = await db.prepare(`
    SELECT COALESCE(SUM(amount_minor),0) AS amount
    FROM canonical_deposit_applications
    WHERE tenant_id=? AND invoice_public_id=? AND status='active'
  `).bind(TENANT_ID, invoice.invoice_public_id).first<{ amount: number }>();
  const refunded = await db.prepare(`
    SELECT COALESCE(SUM(r.amount_minor),0) AS amount
    FROM canonical_refunds r
    JOIN canonical_source_mappings m
      ON m.tenant_id=r.tenant_id AND m.canonical_public_id=r.refund_public_id
      AND m.entity_type='refund' AND m.mapping_status='mapped'
    WHERE r.tenant_id=? AND m.source_type='legacy_live_deposit_refund'
      AND m.source_public_id LIKE ?
  `).bind(TENANT_ID, `${row.refund_receipt_no ?? '__none__'}:%`).first<{ amount: number }>();
  if (
    Number(linked?.count ?? 0) !== 1
    || Number(applied?.amount ?? 0) !== expectedMinor
    || Number(refunded?.amount ?? 0) !== Math.round(row.refund_amount * 100)
  ) {
    throw new Error(`Canonical invoice partial state is incomplete for ${row.invoice_no}`);
  }
}

async function repairInvoice(
  db: Tenant100IpdShadowRepairDatabase,
  row: SourceRow,
): Promise<{ invoiceApplied: boolean; refundApplied: boolean }> {
  const existing = await readExistingInvoice(db, row.invoice_no);
  if (existing) {
    await verifyCompletedRepair(db, row, existing);
    return { invoiceApplied: false, refundApplied: false };
  }

  const authority = await ensureEncounterAuthority(db, row);
  if (authority.status !== 'in_progress' || authority.ended_at_utc != null) {
    throw new Error(`Canonical encounter partial state prevents repair for ${row.invoice_no}`);
  }
  await ensureBedStay(db, row, authority.encounter_public_id);

  const projection = await buildIpdDischargeBillingProjection({
    tenantId: TENANT_ID,
    patientId: row.patient_id,
    admissionId: row.admission_id,
    invoiceNo: row.invoice_no,
    issuedAtUtc: exactUtc(row.discharge_date),
    businessDate: row.discharge_date.slice(0, 10),
    dischargeMode: 'settled',
    finalTotal: Number(row.total),
    globalDiscount: Number(row.discount),
    provisionalItems: [{
      id: row.provisional_item_id,
      patientId: row.patient_id,
      category: row.item_category,
      description: row.item_name,
      department: row.department,
      quantity: Number(row.quantity),
      unitPrice: Number(row.unit_price),
      discountAmount: Number(row.discount_amount),
      totalAmount: Number(row.total_amount),
      doctorId: row.doctor_id,
      doctorName: row.doctor_name,
      referenceId: row.reference_id,
    }],
    package: null,
    bedSegments: [{
      patientBedInfoId: row.bed_info_id,
      bedId: row.bed_id,
      description: `${row.ward_name ?? ''} - Bed ${row.bed_number ?? ''} (${row.bed_type ?? ''})`,
      amount: Number(row.bed_charge_amount),
    }],
    requestedDepositAmount: Number(row.adjustment_amount) + Number(row.refund_amount),
    depositAppliedAmount: Number(row.adjustment_amount),
    depositRefundAmount: Number(row.refund_amount),
    paymentAmount: 0,
    paymentMethod: 'cash',
    receiptNo: null,
    depositAdjustmentNo: row.adjustment_receipt_no,
    refundReceiptNo: row.refund_receipt_no,
    externalTransactionId: null,
    collectorId: null,
    counterId: null,
    counterSessionId: null,
  });
  const result = await finalizeIpdDischargeBilling(db, projection);
  if (result.status !== 'applied') throw new Error(`Unexpected IPD repair replay for ${row.invoice_no}`);
  return { invoiceApplied: true, refundApplied: row.refund_amount > 0 };
}

async function resolveShadowIssue(
  db: Tenant100IpdShadowRepairDatabase,
  nowUtc: string,
): Promise<number> {
  const result = await db.prepare(`
    UPDATE canonical_processing_issues
    SET status='resolved',resolved_at_utc=?,resolved_by_public_id='tenant100-ipd-shadow-repair',
        resolution_code=?,updated_at_utc=?
    WHERE tenant_id=? AND issue_type='financial_shadow_write'
      AND issue_code=? AND entity_public_id='ipd-discharge.billing.finalize'
      AND source_public_id='ipd-discharge.billing.finalize'
      AND status='open' AND occurrence_count=4
  `).bind(nowUtc, RESOLUTION_CODE, nowUtc, TENANT_ID, ISSUE_CODE).run();
  return Number((result as { meta?: { changes?: number } }).meta?.changes ?? 0);
}

export interface Tenant100IpdShadowRepairPassReceipt {
  repairedInvoices: number;
  repairedRefunds: number;
  resolvedIssues: number;
}

export async function applyTenant100IpdShadowRepair(
  db: Tenant100IpdShadowRepairDatabase,
  nowUtc: string,
): Promise<Tenant100IpdShadowRepairPassReceipt> {
  const rows = await sourceRows(db);
  validateSourceContract(rows);
  let repairedInvoices = 0;
  let repairedRefunds = 0;
  for (const row of rows) {
    const result = await repairInvoice(db, row);
    if (result.invoiceApplied) repairedInvoices += 1;
    if (result.refundApplied) repairedRefunds += 1;
  }
  const resolvedIssues = repairedInvoices === 4 ? await resolveShadowIssue(db, nowUtc) : 0;
  return { repairedInvoices, repairedRefunds, resolvedIssues };
}

function requireProtectedFile(path: string, label: string): string {
  const absolute = resolve(path);
  const file = lstatSync(absolute);
  if (!file.isFile() || file.isSymbolicLink() || file.nlink !== 1 || (file.mode & 0o777) !== 0o600) {
    throw new Error(`${label} must be one mode-600 protected regular file`);
  }
  const parent = lstatSync(dirname(absolute));
  if (!parent.isDirectory() || parent.isSymbolicLink() || (parent.mode & 0o777) !== 0o700) {
    throw new Error(`${label} parent must be a mode-700 protected directory`);
  }
  return absolute;
}

function prepareProtectedDirectory(path: string): string {
  const absolute = resolve(path);
  const repository = resolve(process.cwd());
  if (absolute === repository || absolute.startsWith(`${repository}${sep}`)) {
    throw new Error('IPD shadow repair artifacts must remain outside the repository');
  }
  if (existsSync(absolute)) throw new Error('IPD shadow repair output directory must not already exist');
  const parent = lstatSync(dirname(absolute));
  if (!parent.isDirectory() || parent.isSymbolicLink() || (parent.mode & 0o777) !== 0o700) {
    throw new Error('IPD shadow repair output parent must be a mode-700 protected directory');
  }
  mkdirSync(absolute, { mode: 0o700 });
  chmodSync(absolute, 0o700);
  return absolute;
}

function writeProtectedJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  chmodSync(path, 0o600);
}

export interface PrepareTenant100IpdShadowRepairOptions {
  sourceDatabase: string;
  sourceExport: string;
  outputDirectory: string;
  authorizationId: string;
  deterministicRunId: string;
  nowUtc: string;
}

export interface PrepareTenant100IpdShadowRepairReceipt {
  schemaVersion: 1;
  bundleReady: true;
  tenantId: '100';
  firstPass: Tenant100IpdShadowRepairPassReceipt;
  secondPass: Tenant100IpdShadowRepairPassReceipt;
  localReconciliationActivationReady: true;
  localIssueCount: 0;
  bundleSha256: string;
  sourceExportSha256: string;
  bundlePath: string;
  manifestPath: string;
  localReconciliationPath: string;
  workDatabasePath: string;
  legacyRowsMutated: 0;
}

export async function prepareTenant100IpdShadowRepair(
  options: PrepareTenant100IpdShadowRepairOptions,
): Promise<PrepareTenant100IpdShadowRepairReceipt> {
  const sourceDatabase = requireProtectedFile(options.sourceDatabase, 'Source database');
  const sourceExport = requireProtectedFile(options.sourceExport, 'Source export');
  if (!/^[a-z0-9][a-z0-9_-]{7,127}$/i.test(options.authorizationId)) {
    throw new Error('authorizationId is invalid');
  }
  if (!/^[a-z0-9][a-z0-9_-]{7,127}$/i.test(options.deterministicRunId)) {
    throw new Error('deterministicRunId is invalid');
  }
  if (!options.nowUtc.endsWith('Z') || !Number.isFinite(Date.parse(options.nowUtc))) {
    throw new Error('nowUtc must be a valid UTC timestamp');
  }

  const outputDirectory = prepareProtectedDirectory(options.outputDirectory);
  const workDatabasePath = resolve(outputDirectory, 'tenant-100-ipd-shadow-repair.sqlite');
  const localReconciliationPath = resolve(outputDirectory, 'tenant-100-ipd-shadow-repair-reconciliation.json');
  copyFileSync(sourceDatabase, workDatabasePath);
  chmodSync(workDatabasePath, 0o600);

  const database = new DatabaseSync(workDatabasePath);
  let firstPass: Tenant100IpdShadowRepairPassReceipt;
  let secondPass: Tenant100IpdShadowRepairPassReceipt;
  let snapshot: ReturnType<typeof buildTenantFinancialSnapshotFromAggregateRow>;
  let reconciliation: ReturnType<typeof evaluateTenantFinancialReconciliation>;
  try {
    database.exec('PRAGMA foreign_keys=ON');
    const adapter = sqliteDatabase(database);
    firstPass = await applyTenant100IpdShadowRepair(adapter, options.nowUtc);
    secondPass = await applyTenant100IpdShadowRepair(adapter, options.nowUtc);
    if (
      firstPass.repairedInvoices !== 4
      || firstPass.repairedRefunds !== 1
      || firstPass.resolvedIssues !== 1
      || secondPass.repairedInvoices !== 0
      || secondPass.repairedRefunds !== 0
      || secondPass.resolvedIssues !== 0
    ) {
      throw new Error('Tenant 100 IPD shadow repair did not satisfy first/second-pass contract');
    }
    const aggregate = database.prepare(TENANT_FINANCIAL_RECONCILIATION_SQL).get() as TenantFinancialAggregateRow | undefined;
    if (!aggregate) throw new Error('Tenant 100 IPD repair reconciliation returned no aggregate row');
    snapshot = buildTenantFinancialSnapshotFromAggregateRow(aggregate, options.nowUtc, 0, TENANT_ID);
    reconciliation = evaluateTenantFinancialReconciliation(snapshot);
    if (!reconciliation.evidenceReady || !reconciliation.activationReady || reconciliation.issues.length !== 0) {
      throw new Error(`Tenant 100 IPD repair reconciliation is not zero: ${reconciliation.issues.join(',')}`);
    }
  } finally {
    database.close();
  }

  writeProtectedJson(localReconciliationPath, { snapshot, reconciliation });
  const bundleDirectory = resolve(outputDirectory, 'bundle');
  const bundle = buildProductionCanonicalBundle({
    sourceDatabase: workDatabasePath,
    baselineDatabase: sourceDatabase,
    sourceExportPath: sourceExport,
    outputDirectory: bundleDirectory,
    authorizationId: options.authorizationId,
    deterministicRunId: options.deterministicRunId,
    allowedTables: [...CDB101_FINANCIAL_IMPORT_TABLES],
  });
  const bundlePath = resolve(bundleDirectory, 'tenant-100-canonical-import.sql');
  const manifestPath = resolve(bundleDirectory, 'tenant-100-canonical-import-manifest.json');
  requireProtectedFile(bundlePath, 'Repair bundle');
  requireProtectedFile(manifestPath, 'Repair manifest');
  return {
    schemaVersion: 1,
    bundleReady: true,
    tenantId: TENANT_ID,
    firstPass,
    secondPass,
    localReconciliationActivationReady: true,
    localIssueCount: 0,
    bundleSha256: bundle.bundleSha256,
    sourceExportSha256: bundle.sourceExportSha256,
    bundlePath,
    manifestPath,
    localReconciliationPath,
    workDatabasePath,
    legacyRowsMutated: 0,
  };
}

function required(args: Map<string, string>, key: string): string {
  const value = args.get(key);
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function parseArgs(argv: string[]): PrepareTenant100IpdShadowRepairOptions {
  const values = new Map<string, string>();
  const normalized = argv.filter((arg) => arg !== '--');
  for (let index = 0; index < normalized.length; index += 2) {
    const key = normalized[index];
    const value = normalized[index + 1];
    if (!key?.startsWith('--') || !value) throw new Error(`Invalid argument near ${key ?? '<end>'}`);
    values.set(key, value);
  }
  return {
    sourceDatabase: required(values, '--source-database'),
    sourceExport: required(values, '--source-export'),
    outputDirectory: required(values, '--output-directory'),
    authorizationId: required(values, '--authorization-id'),
    deterministicRunId: required(values, '--deterministic-run-id'),
    nowUtc: required(values, '--now-utc'),
  };
}

async function main(): Promise<void> {
  try {
    const receipt = await prepareTenant100IpdShadowRepair(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
