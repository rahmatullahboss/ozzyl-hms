import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  createDeterministicSourceId,
  createSourceEvidenceSha256,
} from '../../src/lib/canonical/source-mapping';
import { toMinorUnits } from '../../src/lib/canonical/money';
import { toUtcIso } from '../../src/lib/canonical/time';
import {
  CDB101_PRODUCTION_DATABASE_ID,
  CDB101_PRODUCTION_DATABASE_NAME,
} from './production-cutover-contract';

export const ADMISSION_DEPOSIT_BACKFILL_APPROVAL = 'CDB101_ADMISSION_DEPOSIT_BACKFILL_20260722';
const TENANT_ID = '100';
const CURRENCY_CODE = 'BDT';
const SOURCE_TYPE = 'legacy_billing_deposit';
const EXPECTED_RECEIPTS = ['DEP-000048', 'DEP-000049'] as const;

export interface AdmissionDepositBackfillRow extends Record<string, unknown> {
  id: number;
  patient_id: number;
  admission_id: number | null;
  deposit_receipt_no: string;
  amount: number;
  transaction_type: string;
  payment_method: string | null;
  remarks: string | null;
  reference_bill_id: number | null;
  counter_id: number | null;
  counter_session_id: number | null;
  is_active: number | null;
  created_by: number | null;
  created_at: string | null;
  updated_at: string | null;
  receipt_public_id: string | null;
  tender_public_id: string | null;
  deposit_public_id: string | null;
  receipt_evidence_sha256: string | null;
  tender_evidence_sha256: string | null;
  deposit_evidence_sha256: string | null;
  receipt_mapping_count: number;
  tender_mapping_count: number;
  deposit_mapping_count: number;
}

export interface AdmissionDepositBackfillGateway {
  readDatabaseIdentity(): Promise<{ uuid: unknown; name: unknown }>;
  readRows(): Promise<AdmissionDepositBackfillRow[]>;
  writeRepair(sql: string): Promise<{ changes: number; rowsWritten: number }>;
}

export interface AdmissionDepositBackfillExpectedRow {
  source: AdmissionDepositBackfillRow;
  sourceId: number;
  receiptPublicId: string;
  tenderPublicId: string;
  depositPublicId: string;
  receiptEvidenceSha256: string;
  depositEvidenceSha256: string;
  amountMinor: number;
  receivedAtUtc: string;
  businessDate: string;
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function sqlNullableString(value: string | null): string {
  return value === null ? 'NULL' : sqlString(value);
}

function safeNonNegativeInteger(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${label} must be a non-negative safe integer`);
  return parsed;
}

function exactMinor(value: number): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error('Admission deposit source state is invalid');
  const minor = toMinorUnits(String(value));
  if (minor <= 0n || minor > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Admission deposit amount is unsafe');
  return Number(minor);
}

function legacyUtc(value: string | null): string {
  if (!value?.trim()) throw new Error('Admission deposit source timestamp is missing');
  const raw = value.trim();
  const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T');
  return toUtcIso(/(?:Z|[+-]\d{2}:\d{2})$/i.test(normalized) ? normalized : `${normalized}+06:00`);
}

function businessDate(value: string | null, receivedAtUtc: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value?.trim() ?? '');
  return match?.[1] ?? receivedAtUtc.slice(0, 10);
}

function validateSourceRows(rows: AdmissionDepositBackfillRow[]): void {
  if (rows.length !== EXPECTED_RECEIPTS.length) throw new Error('Admission deposit backfill requires exactly two source rows');
  const sorted = [...rows].sort((left, right) => left.deposit_receipt_no.localeCompare(right.deposit_receipt_no));
  for (const [index, expectedReceipt] of EXPECTED_RECEIPTS.entries()) {
    const row = sorted[index];
    const expectedId = index === 0 ? 108 : 109;
    const expectedPatientId = index === 0 ? 1262 : 1326;
    const expectedAdmissionId = index === 0 ? 13089 : 13090;
    const expectedRemarks = index === 0
      ? 'Admission deposit for ADM-000064'
      : 'Admission deposit for ADM-000065';
    const expectedCreatedAt = index === 0 ? '2026-07-22 08:11:24' : '2026-07-22 08:12:03';
    if (
      row.deposit_receipt_no !== expectedReceipt
      || Number(row.id) !== expectedId
      || Number(row.patient_id) !== expectedPatientId
      || Number(row.admission_id) !== expectedAdmissionId
      || Number(row.amount) !== 300
      || row.transaction_type !== 'deposit'
      || row.payment_method !== 'cash'
      || row.remarks !== expectedRemarks
      || row.reference_bill_id !== null
      || Number(row.counter_id) !== 2
      || Number(row.counter_session_id) !== 28
      || Number(row.is_active) !== 1
      || Number(row.created_by) !== 103
      || row.created_at !== expectedCreatedAt
      || row.updated_at !== null
    ) {
      throw new Error(`Admission deposit source state changed for ${expectedReceipt}`);
    }
  }
}

function canonicalStateCount(row: AdmissionDepositBackfillRow): number {
  return [
    row.receipt_public_id,
    row.tender_public_id,
    row.deposit_public_id,
  ].filter(Boolean).length
    + safeNonNegativeInteger(row.receipt_mapping_count, 'receipt_mapping_count')
    + safeNonNegativeInteger(row.tender_mapping_count, 'tender_mapping_count')
    + safeNonNegativeInteger(row.deposit_mapping_count, 'deposit_mapping_count');
}

async function receiptEvidence(row: AdmissionDepositBackfillRow): Promise<string> {
  return createSourceEvidenceSha256({
    sourceType: SOURCE_TYPE,
    sourcePublicId: String(row.id),
    patientId: row.patient_id,
    receiptNumber: row.deposit_receipt_no,
    amountMajor: row.amount,
    transactionType: row.transaction_type,
    paymentMethod: row.payment_method,
    remarks: row.remarks,
    referenceBillId: row.reference_bill_id,
    counterId: row.counter_id,
    counterSessionId: row.counter_session_id,
    isActive: row.is_active,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

async function depositEvidence(row: AdmissionDepositBackfillRow): Promise<string> {
  return createSourceEvidenceSha256({
    sourceType: SOURCE_TYPE,
    sourcePublicId: String(row.id),
    patientId: row.patient_id,
    depositReceiptNo: row.deposit_receipt_no,
    amountMajor: row.amount,
    transactionType: row.transaction_type,
    paymentMethod: row.payment_method,
    referenceBillId: row.reference_bill_id,
    counterId: row.counter_id,
    counterSessionId: row.counter_session_id,
    isActive: row.is_active,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

async function prepareRow(row: AdmissionDepositBackfillRow): Promise<AdmissionDepositBackfillExpectedRow> {
  const receivedAtUtc = legacyUtc(row.created_at);
  return {
    source: row,
    sourceId: row.id,
    receiptPublicId: await createDeterministicSourceId('payrcpt', TENANT_ID, SOURCE_TYPE, String(row.id)),
    tenderPublicId: await createDeterministicSourceId('paytnd', TENANT_ID, SOURCE_TYPE, String(row.id)),
    depositPublicId: await createDeterministicSourceId('dep', TENANT_ID, SOURCE_TYPE, String(row.id)),
    receiptEvidenceSha256: await receiptEvidence(row),
    depositEvidenceSha256: await depositEvidence(row),
    amountMinor: exactMinor(row.amount),
    receivedAtUtc,
    businessDate: businessDate(row.created_at, receivedAtUtc),
  };
}

function exactSourcePredicate(row: AdmissionDepositBackfillRow): string {
  return `CAST(bd.tenant_id AS TEXT)=${sqlString(TENANT_ID)}
  AND bd.id=${Number(row.id)}
  AND bd.patient_id=${Number(row.patient_id)}
  AND bd.admission_id=${Number(row.admission_id)}
  AND bd.deposit_receipt_no=${sqlString(row.deposit_receipt_no)}
  AND bd.amount=${Number(row.amount)}
  AND bd.transaction_type=${sqlString(row.transaction_type)}
  AND bd.payment_method=${sqlNullableString(row.payment_method)}
  AND bd.remarks=${sqlNullableString(row.remarks)}
  AND bd.reference_bill_id IS ${row.reference_bill_id === null ? 'NULL' : String(row.reference_bill_id)}
  AND bd.counter_id IS ${row.counter_id === null ? 'NULL' : String(row.counter_id)}
  AND bd.counter_session_id IS ${row.counter_session_id === null ? 'NULL' : String(row.counter_session_id)}
  AND COALESCE(bd.is_active,1)=${Number(row.is_active ?? 1)}
  AND bd.created_by IS ${row.created_by === null ? 'NULL' : String(row.created_by)}
  AND bd.created_at=${sqlNullableString(row.created_at)}
  AND bd.updated_at IS ${row.updated_at === null ? 'NULL' : sqlString(row.updated_at)}`;
}

function mappingInsert(input: {
  entityType: 'payment_receipt' | 'payment_tender' | 'deposit';
  canonicalPublicId: string;
  sourceId: number;
  evidenceSha256: string;
  nowUtc: string;
  predicate: string;
}): string {
  return `INSERT INTO canonical_source_mappings (
  tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
  source_table,mapping_status,mapping_version,evidence_sha256,created_at_utc,updated_at_utc
)
SELECT ${sqlString(TENANT_ID)},${sqlString(input.entityType)},${sqlString(input.canonicalPublicId)},
       ${sqlString(SOURCE_TYPE)},${sqlString(String(input.sourceId))},'billing_deposits','mapped',1,
       ${sqlString(input.evidenceSha256)},${sqlString(input.nowUtc)},${sqlString(input.nowUtc)}
FROM billing_deposits bd
WHERE ${input.predicate}
  AND NOT EXISTS (
    SELECT 1 FROM canonical_source_mappings m
    WHERE m.tenant_id=${sqlString(TENANT_ID)} AND m.entity_type=${sqlString(input.entityType)}
      AND m.source_type=${sqlString(SOURCE_TYPE)} AND m.source_public_id=${sqlString(String(input.sourceId))}
  );`;
}

export async function buildAdmissionDepositBackfillExpectedRows(
  rows: AdmissionDepositBackfillRow[],
): Promise<AdmissionDepositBackfillExpectedRow[]> {
  validateSourceRows(rows);
  return Promise.all(
    [...rows]
      .sort((left, right) => left.deposit_receipt_no.localeCompare(right.deposit_receipt_no))
      .map(prepareRow),
  );
}

export async function buildAdmissionDepositBackfillSql(
  rows: AdmissionDepositBackfillRow[],
  nowUtc: string = new Date().toISOString(),
): Promise<string> {
  const normalizedNow = toUtcIso(nowUtc);
  const preparedRows = await buildAdmissionDepositBackfillExpectedRows(rows);
  const statements: string[] = [];
  for (const prepared of preparedRows) {
    const row = prepared.source;
    const predicate = exactSourcePredicate(row);
    statements.push(`INSERT INTO canonical_payment_receipts (
  tenant_id,receipt_public_id,receipt_number,legacy_patient_id,currency_code,total_minor,
  allocated_total_minor,unallocated_minor,status,received_at_utc,business_date,
  legacy_collector_id,legacy_counter_id,legacy_counter_session_id,external_transaction_id,
  posted_at_utc,failed_at_utc,reversed_at_utc,reconciliation_guard,source_evidence_sha256,
  refunded_minor,net_received_minor,refund_projection_guard,created_at_utc,updated_at_utc
)
SELECT ${sqlString(TENANT_ID)},${sqlString(prepared.receiptPublicId)},bd.deposit_receipt_no,bd.patient_id,
       ${sqlString(CURRENCY_CODE)},${prepared.amountMinor},0,${prepared.amountMinor},'posted',
       ${sqlString(prepared.receivedAtUtc)},${sqlString(prepared.businessDate)},bd.created_by,
       bd.counter_id,bd.counter_session_id,NULL,${sqlString(prepared.receivedAtUtc)},NULL,NULL,1,
       ${sqlString(prepared.receiptEvidenceSha256)},0,${prepared.amountMinor},1,
       ${sqlString(normalizedNow)},${sqlString(normalizedNow)}
FROM billing_deposits bd
WHERE ${predicate}
  AND NOT EXISTS (
    SELECT 1 FROM canonical_payment_receipts r
    WHERE r.tenant_id=${sqlString(TENANT_ID)}
      AND (r.receipt_public_id=${sqlString(prepared.receiptPublicId)} OR r.receipt_number=bd.deposit_receipt_no)
  );`);
    statements.push(`INSERT INTO canonical_payment_tenders (
  tenant_id,tender_public_id,receipt_public_id,tender_type,method_code,amount_minor,status,
  external_transaction_id,captured_at_utc,failed_at_utc,reversed_at_utc,source_evidence_sha256,
  reversed_minor,remaining_minor,reversal_projection_guard,created_at_utc,updated_at_utc
)
SELECT ${sqlString(TENANT_ID)},${sqlString(prepared.tenderPublicId)},${sqlString(prepared.receiptPublicId)},
       'cash','cash',${prepared.amountMinor},'captured',NULL,${sqlString(prepared.receivedAtUtc)},NULL,NULL,
       ${sqlString(prepared.receiptEvidenceSha256)},0,${prepared.amountMinor},1,
       ${sqlString(normalizedNow)},${sqlString(normalizedNow)}
FROM billing_deposits bd
WHERE ${predicate}
  AND EXISTS (
    SELECT 1 FROM canonical_payment_receipts r
    WHERE r.tenant_id=${sqlString(TENANT_ID)} AND r.receipt_public_id=${sqlString(prepared.receiptPublicId)}
  )
  AND NOT EXISTS (
    SELECT 1 FROM canonical_payment_tenders t
    WHERE t.tenant_id=${sqlString(TENANT_ID)} AND t.tender_public_id=${sqlString(prepared.tenderPublicId)}
  );`);
    statements.push(`INSERT INTO canonical_deposits (
  tenant_id,deposit_public_id,deposit_number,receipt_public_id,legacy_patient_id,currency_code,
  amount_minor,applied_minor,refunded_minor,available_minor,status,received_at_utc,business_date,
  posted_at_utc,reversed_at_utc,reconciliation_guard,source_evidence_sha256,created_at_utc,updated_at_utc
)
SELECT ${sqlString(TENANT_ID)},${sqlString(prepared.depositPublicId)},bd.deposit_receipt_no,
       ${sqlString(prepared.receiptPublicId)},bd.patient_id,${sqlString(CURRENCY_CODE)},
       ${prepared.amountMinor},0,0,${prepared.amountMinor},'posted',${sqlString(prepared.receivedAtUtc)},
       ${sqlString(prepared.businessDate)},${sqlString(prepared.receivedAtUtc)},NULL,1,
       ${sqlString(prepared.depositEvidenceSha256)},${sqlString(normalizedNow)},${sqlString(normalizedNow)}
FROM billing_deposits bd
WHERE ${predicate}
  AND EXISTS (
    SELECT 1 FROM canonical_payment_receipts r
    WHERE r.tenant_id=${sqlString(TENANT_ID)} AND r.receipt_public_id=${sqlString(prepared.receiptPublicId)}
  )
  AND NOT EXISTS (
    SELECT 1 FROM canonical_deposits d
    WHERE d.tenant_id=${sqlString(TENANT_ID)}
      AND (d.deposit_public_id=${sqlString(prepared.depositPublicId)} OR d.deposit_number=bd.deposit_receipt_no)
  );`);
    statements.push(mappingInsert({
      entityType: 'payment_receipt',
      canonicalPublicId: prepared.receiptPublicId,
      sourceId: row.id,
      evidenceSha256: prepared.receiptEvidenceSha256,
      nowUtc: normalizedNow,
      predicate,
    }));
    statements.push(mappingInsert({
      entityType: 'payment_tender',
      canonicalPublicId: prepared.tenderPublicId,
      sourceId: row.id,
      evidenceSha256: prepared.receiptEvidenceSha256,
      nowUtc: normalizedNow,
      predicate,
    }));
    statements.push(mappingInsert({
      entityType: 'deposit',
      canonicalPublicId: prepared.depositPublicId,
      sourceId: row.id,
      evidenceSha256: prepared.depositEvidenceSha256,
      nowUtc: normalizedNow,
      predicate,
    }));
  }
  return statements.join('\n');
}

function hasEmptyCanonicalState(rows: AdmissionDepositBackfillRow[]): boolean {
  return rows.every((row) => canonicalStateCount(row) === 0);
}

function validatePostState(
  rows: AdmissionDepositBackfillRow[],
  expectedRows: AdmissionDepositBackfillExpectedRow[],
): void {
  validateSourceRows(rows);
  const expectedBySourceId = new Map(expectedRows.map((row) => [row.sourceId, row]));
  for (const row of rows) {
    const expected = expectedBySourceId.get(Number(row.id));
    if (
      !expected
      || row.receipt_public_id !== expected.receiptPublicId
      || row.tender_public_id !== expected.tenderPublicId
      || row.deposit_public_id !== expected.depositPublicId
      || row.receipt_evidence_sha256 !== expected.receiptEvidenceSha256
      || row.tender_evidence_sha256 !== expected.receiptEvidenceSha256
      || row.deposit_evidence_sha256 !== expected.depositEvidenceSha256
      || Number(row.receipt_mapping_count) !== 1
      || Number(row.tender_mapping_count) !== 1
      || Number(row.deposit_mapping_count) !== 1
    ) {
      throw new Error(`Admission deposit canonical post-state verification failed for ${row.deposit_receipt_no}`);
    }
  }
}

export async function executeAdmissionDepositBackfill(
  input: { approval: string; execute: boolean },
  gateway: AdmissionDepositBackfillGateway,
): Promise<{
  repaired: true;
  execution: 'created' | 'verified_existing';
  sourceRows: 2;
  canonicalRowsCreated: 6;
  mappingsCreated: 6;
  receiptNumbers: readonly ['DEP-000048', 'DEP-000049'];
  writeMeta: { changes: number; rowsWritten: number } | null;
}> {
  if (!input.execute) throw new Error('Explicit execute switch is required');
  if (input.approval !== ADMISSION_DEPOSIT_BACKFILL_APPROVAL) throw new Error('Admission deposit backfill approval mismatch');
  const identity = await gateway.readDatabaseIdentity();
  if (identity.uuid !== CDB101_PRODUCTION_DATABASE_ID || identity.name !== CDB101_PRODUCTION_DATABASE_NAME) {
    throw new Error('Production database identity mismatch');
  }
  const before = await gateway.readRows();
  validateSourceRows(before);
  const expectedRows = await buildAdmissionDepositBackfillExpectedRows(before);

  if (!hasEmptyCanonicalState(before)) {
    try {
      validatePostState(before, expectedRows);
    } catch (cause) {
      throw new Error('Admission deposit has partial canonical state', { cause });
    }
    return {
      repaired: true,
      execution: 'verified_existing',
      sourceRows: 2,
      canonicalRowsCreated: 6,
      mappingsCreated: 6,
      receiptNumbers: EXPECTED_RECEIPTS,
      writeMeta: null,
    };
  }

  const write = await gateway.writeRepair(await buildAdmissionDepositBackfillSql(before));
  const after = await gateway.readRows();
  validatePostState(after, expectedRows);
  return {
    repaired: true,
    execution: 'created',
    sourceRows: 2,
    canonicalRowsCreated: 6,
    mappingsCreated: 6,
    receiptNumbers: EXPECTED_RECEIPTS,
    writeMeta: write,
  };
}

interface CommandResult { stdout: string; stderr: string; status: number }
type Runner = (args: string[]) => CommandResult;

function defaultRunner(args: string[]): CommandResult {
  const result = spawnSync('pnpm', ['exec', 'wrangler', ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  });
  if (result.error) throw result.error;
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', status: result.status ?? 1 };
}

function run(runner: Runner, args: string[], label: string): CommandResult {
  const result = runner(args);
  if (result.status !== 0) throw new Error(`${label} failed: ${result.stderr.trim()}`);
  return result;
}

function extractJson(text: string): unknown {
  const arrayStart = text.indexOf('[');
  const arrayEnd = text.lastIndexOf(']');
  if (arrayStart >= 0 && arrayEnd > arrayStart) return JSON.parse(text.slice(arrayStart, arrayEnd + 1));
  const objectStart = text.indexOf('{');
  const objectEnd = text.lastIndexOf('}');
  if (objectStart >= 0 && objectEnd > objectStart) return JSON.parse(text.slice(objectStart, objectEnd + 1));
  throw new Error('Wrangler output did not contain JSON');
}

interface D1Envelope {
  success?: unknown;
  results?: Array<Record<string, unknown>>;
  meta?: Record<string, unknown>;
}

function envelopes(text: string): D1Envelope[] {
  const parsed = extractJson(text);
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('D1 output was not a non-empty array');
  const rows = parsed as D1Envelope[];
  if (rows.some((row) => row.success !== true)) throw new Error('D1 output contained an unsuccessful envelope');
  return rows;
}

export const ADMISSION_DEPOSIT_BACKFILL_READ_SQL = `
SELECT bd.id,bd.patient_id,bd.admission_id,bd.deposit_receipt_no,bd.amount,
       bd.transaction_type,bd.payment_method,bd.remarks,bd.reference_bill_id,
       bd.counter_id,bd.counter_session_id,bd.is_active,bd.created_by,bd.created_at,bd.updated_at,
       (SELECT r.receipt_public_id FROM canonical_payment_receipts r
        WHERE r.tenant_id='100' AND r.receipt_number=bd.deposit_receipt_no LIMIT 1) AS receipt_public_id,
       (SELECT t.tender_public_id FROM canonical_payment_tenders t
        JOIN canonical_payment_receipts r ON r.tenant_id=t.tenant_id AND r.receipt_public_id=t.receipt_public_id
        WHERE r.tenant_id='100' AND r.receipt_number=bd.deposit_receipt_no LIMIT 1) AS tender_public_id,
       (SELECT d.deposit_public_id FROM canonical_deposits d
        WHERE d.tenant_id='100' AND d.deposit_number=bd.deposit_receipt_no LIMIT 1) AS deposit_public_id,
       (SELECT r.source_evidence_sha256 FROM canonical_payment_receipts r
        WHERE r.tenant_id='100' AND r.receipt_number=bd.deposit_receipt_no LIMIT 1) AS receipt_evidence_sha256,
       (SELECT t.source_evidence_sha256 FROM canonical_payment_tenders t
        JOIN canonical_payment_receipts r ON r.tenant_id=t.tenant_id AND r.receipt_public_id=t.receipt_public_id
        WHERE r.tenant_id='100' AND r.receipt_number=bd.deposit_receipt_no LIMIT 1) AS tender_evidence_sha256,
       (SELECT d.source_evidence_sha256 FROM canonical_deposits d
        WHERE d.tenant_id='100' AND d.deposit_number=bd.deposit_receipt_no LIMIT 1) AS deposit_evidence_sha256,
       (SELECT COUNT(*) FROM canonical_source_mappings m
        WHERE m.tenant_id='100' AND m.entity_type='payment_receipt'
          AND m.source_type='legacy_billing_deposit' AND m.source_public_id=CAST(bd.id AS TEXT)) AS receipt_mapping_count,
       (SELECT COUNT(*) FROM canonical_source_mappings m
        WHERE m.tenant_id='100' AND m.entity_type='payment_tender'
          AND m.source_type='legacy_billing_deposit' AND m.source_public_id=CAST(bd.id AS TEXT)) AS tender_mapping_count,
       (SELECT COUNT(*) FROM canonical_source_mappings m
        WHERE m.tenant_id='100' AND m.entity_type='deposit'
          AND m.source_type='legacy_billing_deposit' AND m.source_public_id=CAST(bd.id AS TEXT)) AS deposit_mapping_count
FROM billing_deposits bd
WHERE CAST(bd.tenant_id AS TEXT)='100'
  AND bd.deposit_receipt_no IN ('DEP-000048','DEP-000049')
ORDER BY bd.deposit_receipt_no;
`.trim();

export function createProductionGateway(runner: Runner = defaultRunner): AdmissionDepositBackfillGateway {
  return {
    async readDatabaseIdentity() {
      const result = run(runner, [
        'd1', 'info', CDB101_PRODUCTION_DATABASE_NAME, '--env', 'production', '--json',
      ], 'production database identity');
      return extractJson(result.stdout) as { uuid: unknown; name: unknown };
    },
    async readRows() {
      const result = run(runner, [
        'd1', 'execute', CDB101_PRODUCTION_DATABASE_NAME,
        '--env', 'production', '--remote', '--json', '--command', ADMISSION_DEPOSIT_BACKFILL_READ_SQL,
      ], 'admission deposit backfill read');
      return envelopes(result.stdout).flatMap((row) => row.results ?? []) as AdmissionDepositBackfillRow[];
    },
    async writeRepair(sql: string) {
      const result = run(runner, [
        'd1', 'execute', CDB101_PRODUCTION_DATABASE_NAME,
        '--env', 'production', '--remote', '--json', '--yes', '--command', sql,
      ], 'admission deposit backfill write');
      const rows = envelopes(result.stdout);
      return {
        changes: rows.reduce((sum, row) => sum + Number(row.meta?.changes ?? 0), 0),
        rowsWritten: rows.reduce((sum, row) => sum + Number(row.meta?.rows_written ?? 0), 0),
      };
    },
  };
}

function outsideRepository(path: string, root: string): string {
  const absolute = resolve(path);
  const repository = resolve(root);
  if (absolute === repository || absolute.startsWith(`${repository}${sep}`)) {
    throw new Error('Admission deposit backfill receipt must remain outside repository');
  }
  return absolute;
}

function protectedDirectory(path: string, root: string): string {
  const absolute = outsideRepository(path, root);
  if (!existsSync(absolute)) throw new Error(`Protected directory missing: ${absolute}`);
  const stat = lstatSync(absolute);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o700) {
    throw new Error('Protected directory must be mode 700');
  }
  return absolute;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((arg) => arg !== '--');
  const outputIndex = args.indexOf('--output');
  const approvalIndex = args.indexOf('--approval');
  const execute = args.includes('--execute');
  if (outputIndex < 0 || !args[outputIndex + 1] || approvalIndex < 0 || !args[approvalIndex + 1]) {
    throw new Error('--output and --approval are required');
  }
  const output = outsideRepository(args[outputIndex + 1], process.cwd());
  protectedDirectory(dirname(output), process.cwd());
  if (existsSync(output)) throw new Error('Admission deposit backfill receipt already exists');
  const result = await executeAdmissionDepositBackfill({
    approval: args[approvalIndex + 1],
    execute,
  }, createProductionGateway());
  writeFileSync(output, `${JSON.stringify({
    schemaVersion: 1,
    executedAtUtc: new Date().toISOString(),
    productionDatabase: {
      name: CDB101_PRODUCTION_DATABASE_NAME,
      id: CDB101_PRODUCTION_DATABASE_ID,
    },
    result,
  }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  chmodSync(output, 0o600);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
