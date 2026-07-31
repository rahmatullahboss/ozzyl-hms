import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  CDB101_PRODUCTION_DATABASE_ID,
  CDB101_PRODUCTION_DATABASE_NAME,
} from './production-cutover-contract';

export const LIVE_INVOICE_HEADER_REPAIR_APPROVAL = 'CDB101_LIVE_INVOICE_HEADER_REPAIR_20260720';

export interface LiveInvoiceHeaderRepairRow extends Record<string, unknown> {
  invoice_public_id: string;
  subtotal_minor: number;
  adjustment_total_minor: number;
  total_minor: number;
  paid_minor: number;
  due_minor: number;
  legacy_bill_count: number;
  expected_gross_minor: number;
  expected_adjustment_minor: number;
  expected_total_minor: number;
}

export interface LiveInvoiceHeaderRepairGateway {
  readDatabaseIdentity(): Promise<{ uuid: unknown; name: unknown }>;
  readCandidates(): Promise<LiveInvoiceHeaderRepairRow[]>;
  writeRepair(sql: string): Promise<{ changes: number; rowsWritten: number }>;
}

function safePublicId(value: string): string {
  if (!/^[A-Za-z0-9_:-]{8,128}$/.test(value)) throw new Error('Invalid canonical invoice public id');
  return value;
}

function exactInteger(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${label} must be a non-negative safe integer`);
  return parsed;
}

export function buildLiveInvoiceHeaderRepairSql(row: LiveInvoiceHeaderRepairRow): string {
  const invoicePublicId = safePublicId(row.invoice_public_id);
  const currentSubtotal = exactInteger(row.subtotal_minor, 'subtotal_minor');
  const currentAdjustment = exactInteger(row.adjustment_total_minor, 'adjustment_total_minor');
  const total = exactInteger(row.total_minor, 'total_minor');
  const paid = exactInteger(row.paid_minor, 'paid_minor');
  const due = exactInteger(row.due_minor, 'due_minor');
  const expectedGross = exactInteger(row.expected_gross_minor, 'expected_gross_minor');
  const expectedAdjustment = exactInteger(row.expected_adjustment_minor, 'expected_adjustment_minor');
  const expectedTotal = exactInteger(row.expected_total_minor, 'expected_total_minor');
  if (Number(row.legacy_bill_count) !== 1) throw new Error('Repair requires exactly one matching legacy bill');
  if (total !== expectedTotal || expectedGross + expectedAdjustment !== expectedTotal) {
    throw new Error('Legacy and canonical invoice totals are incompatible');
  }
  if (currentSubtotal === expectedGross && currentAdjustment === expectedAdjustment) {
    throw new Error('Live invoice header is already normalized');
  }
  return `UPDATE canonical_invoices
SET subtotal_minor=${expectedGross},
    adjustment_total_minor=${expectedAdjustment},
    updated_at_utc=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE tenant_id='100'
  AND invoice_public_id='${invoicePublicId}'
  AND subtotal_minor=${currentSubtotal}
  AND adjustment_total_minor=${currentAdjustment}
  AND total_minor=${total}
  AND paid_minor=${paid}
  AND due_minor=${due}
  AND EXISTS (
    SELECT 1 FROM canonical_source_mappings m
    WHERE m.tenant_id=canonical_invoices.tenant_id
      AND m.entity_type='invoice'
      AND m.canonical_public_id=canonical_invoices.invoice_public_id
      AND m.source_type='legacy_live_bill'
      AND m.source_public_id=canonical_invoices.invoice_number
      AND m.mapping_status='mapped'
  )
  AND 1=(
    SELECT COUNT(*) FROM bills b
    WHERE CAST(b.tenant_id AS TEXT)=canonical_invoices.tenant_id
      AND COALESCE(b.invoice_no,b.invoice_code)=canonical_invoices.invoice_number
      AND b.patient_id=canonical_invoices.legacy_patient_id
      AND ROUND((COALESCE(b.total,0)+COALESCE(b.discount,0)-COALESCE(b.tax_total,0))*100)=${expectedGross}
      AND ROUND((COALESCE(b.tax_total,0)-COALESCE(b.discount,0))*100)=${expectedAdjustment}
      AND ROUND(COALESCE(b.total,0)*100)=${expectedTotal}
  );`;
}

export async function executeLiveInvoiceHeaderRepair(input: {
  approval: string;
  execute: boolean;
}, gateway: LiveInvoiceHeaderRepairGateway): Promise<{
  repaired: true;
  invoicePublicId: string;
  previousSubtotalMinor: number;
  currentSubtotalMinor: number;
  previousAdjustmentMinor: number;
  currentAdjustmentMinor: number;
}> {
  if (!input.execute) throw new Error('Explicit execute switch is required');
  if (input.approval !== LIVE_INVOICE_HEADER_REPAIR_APPROVAL) throw new Error('Live invoice repair approval mismatch');
  const identity = await gateway.readDatabaseIdentity();
  if (identity.uuid !== CDB101_PRODUCTION_DATABASE_ID || identity.name !== CDB101_PRODUCTION_DATABASE_NAME) {
    throw new Error('Production database identity mismatch');
  }
  const before = await gateway.readCandidates();
  if (before.length !== 1) throw new Error('Repair requires exactly one live invoice header candidate');
  const row = before[0];
  const write = await gateway.writeRepair(buildLiveInvoiceHeaderRepairSql(row));
  if (write.changes !== 1 || write.rowsWritten < 1) throw new Error('Live invoice header repair did not update exactly one row');
  const after = await gateway.readCandidates();
  if (after.length !== 1) throw new Error('Live invoice repair post-state candidate count mismatch');
  const current = after[0];
  if (
    current.invoice_public_id !== row.invoice_public_id
    || Number(current.subtotal_minor) !== Number(row.expected_gross_minor)
    || Number(current.adjustment_total_minor) !== Number(row.expected_adjustment_minor)
    || Number(current.total_minor) !== Number(row.expected_total_minor)
  ) throw new Error('Live invoice header repair post-state verification failed');
  return {
    repaired: true,
    invoicePublicId: row.invoice_public_id,
    previousSubtotalMinor: Number(row.subtotal_minor),
    currentSubtotalMinor: Number(current.subtotal_minor),
    previousAdjustmentMinor: Number(row.adjustment_total_minor),
    currentAdjustmentMinor: Number(current.adjustment_total_minor),
  };
}

interface CommandResult { stdout: string; stderr: string; status: number }
type Runner = (args: string[]) => CommandResult;

function defaultRunner(args: string[]): CommandResult {
  const result = spawnSync('pnpm', ['exec', 'wrangler', ...args], {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
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
  const arrayStart = text.indexOf('['); const arrayEnd = text.lastIndexOf(']');
  if (arrayStart >= 0 && arrayEnd > arrayStart) return JSON.parse(text.slice(arrayStart, arrayEnd + 1));
  const objectStart = text.indexOf('{'); const objectEnd = text.lastIndexOf('}');
  if (objectStart >= 0 && objectEnd > objectStart) return JSON.parse(text.slice(objectStart, objectEnd + 1));
  throw new Error('Wrangler output did not contain JSON');
}

interface D1Envelope { success?: unknown; results?: Array<Record<string, unknown>>; meta?: Record<string, unknown> }
function envelopes(text: string): D1Envelope[] {
  const parsed = extractJson(text);
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('D1 output was not a non-empty array');
  const rows = parsed as D1Envelope[];
  if (rows.some((row) => row.success !== true)) throw new Error('D1 output contained an unsuccessful envelope');
  return rows;
}

const READ_SQL = `SELECT ci.invoice_public_id,ci.subtotal_minor,ci.adjustment_total_minor,
ci.total_minor,ci.paid_minor,ci.due_minor,COUNT(DISTINCT b.id) AS legacy_bill_count,
COALESCE(MAX(ROUND((COALESCE(b.total,0)+COALESCE(b.discount,0)-COALESCE(b.tax_total,0))*100)),0) AS expected_gross_minor,
COALESCE(MAX(ROUND((COALESCE(b.tax_total,0)-COALESCE(b.discount,0))*100)),0) AS expected_adjustment_minor,
COALESCE(MAX(ROUND(COALESCE(b.total,0)*100)),0) AS expected_total_minor
FROM canonical_invoices ci
JOIN canonical_source_mappings m ON m.tenant_id=ci.tenant_id AND m.entity_type='invoice'
 AND m.canonical_public_id=ci.invoice_public_id AND m.source_type='legacy_live_bill'
 AND m.source_public_id=ci.invoice_number AND m.mapping_status='mapped'
LEFT JOIN bills b ON CAST(b.tenant_id AS TEXT)=ci.tenant_id
 AND COALESCE(b.invoice_no,b.invoice_code)=ci.invoice_number AND b.patient_id=ci.legacy_patient_id
WHERE ci.tenant_id='100'
GROUP BY ci.invoice_public_id,ci.subtotal_minor,ci.adjustment_total_minor,ci.total_minor,ci.paid_minor,ci.due_minor;`;

export function createProductionGateway(runner: Runner = defaultRunner): LiveInvoiceHeaderRepairGateway {
  return {
    async readDatabaseIdentity() {
      const result = run(runner, ['d1','info',CDB101_PRODUCTION_DATABASE_NAME,'--env','production','--json'], 'database identity');
      return extractJson(result.stdout) as { uuid: unknown; name: unknown };
    },
    async readCandidates() {
      const result = run(runner, ['d1','execute',CDB101_PRODUCTION_DATABASE_NAME,'--env','production','--remote','--json','--command',READ_SQL], 'live invoice candidates');
      return envelopes(result.stdout).flatMap((row) => row.results ?? []) as LiveInvoiceHeaderRepairRow[];
    },
    async writeRepair(sql: string) {
      const result = run(runner, ['d1','execute',CDB101_PRODUCTION_DATABASE_NAME,'--env','production','--remote','--json','--yes','--command',sql], 'live invoice header repair');
      const rows = envelopes(result.stdout);
      return {
        changes: rows.reduce((sum, row) => sum + Number(row.meta?.changes ?? 0), 0),
        rowsWritten: rows.reduce((sum, row) => sum + Number(row.meta?.rows_written ?? 0), 0),
      };
    },
  };
}

function outsideRepository(path: string, root: string): string {
  const absolute = resolve(path); const repository = resolve(root);
  if (absolute === repository || absolute.startsWith(`${repository}${sep}`)) throw new Error('Repair receipt must remain outside repository');
  return absolute;
}
function protectedDirectory(path: string, root: string): string {
  const absolute = outsideRepository(path, root);
  if (!existsSync(absolute)) throw new Error(`Protected directory missing: ${absolute}`);
  const stat = lstatSync(absolute);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o700) throw new Error('Protected directory must be mode 700');
  return absolute;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((arg) => arg !== '--');
  const outputIndex = args.indexOf('--output'); const approvalIndex = args.indexOf('--approval');
  const execute = args.includes('--execute');
  if (outputIndex < 0 || !args[outputIndex + 1] || approvalIndex < 0 || !args[approvalIndex + 1]) throw new Error('--output and --approval are required');
  const output = outsideRepository(args[outputIndex + 1], process.cwd());
  protectedDirectory(dirname(output), process.cwd());
  if (existsSync(output)) throw new Error('Repair receipt already exists');
  const result = await executeLiveInvoiceHeaderRepair({ approval: args[approvalIndex + 1], execute }, createProductionGateway());
  writeFileSync(output, `${JSON.stringify({ schemaVersion: 1, executedAtUtc: new Date().toISOString(), result }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  chmodSync(output, 0o600);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
}
