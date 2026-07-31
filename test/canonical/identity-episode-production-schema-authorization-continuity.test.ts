import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const receiptPath =
  'docs/database/migration-runs/production/CDB-113H3-production-schema-authorization-contract.md';
const readinessPath =
  'docs/database/identity-episode-production-schema-authorization-readiness.json';
const trackerPath = 'task-progress.yaml';
const controlPath = 'docs/architecture/canonical-program-control-center.md';
const handoffPath = '.ai-bridge/current-plan.md';

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('CDB-113H3 production schema authorization contract continuity', () => {
  it('records a fail-closed schema-only contract without claiming authorization or execution', () => {
    expect(existsSync(receiptPath)).toBe(true);
    expect(existsSync(readinessPath)).toBe(true);
    const receipt = read(receiptPath);
    const readiness = JSON.parse(read(readinessPath)) as Record<string, unknown>;

    for (const text of [
      'CDB-113H3-PRODUCTION-SCHEMA-AUTHORIZATION-CONTRACT-READY',
      'production_schema_migrations_only',
      '0541_canonical_local_sync_protocol.sql',
      '0550_canonical_credit_note_cash_refund_reversals.sql',
      'migration count: **10**',
      'protected receipts: **3**',
      'authorization present: **no**',
      'execution ready: **no**',
      'production rows written: **0**',
      'production mutation performed: **no**',
      'CDB-113H3-PRODUCTION-SCHEMA-EXACT-AUTHORIZATION-REQUIRED',
    ]) expect(receipt).toContain(text);

    expect(readiness).toMatchObject({
      version: 1,
      checkpoint: 'CDB-113H3-PRODUCTION-SCHEMA-AUTHORIZATION-CONTRACT-READY',
      contractReady: true,
      authorizationPresent: false,
      executionReady: false,
      migrationCount: 10,
      protectedReceiptCount: 3,
      productionRowsWritten: 0,
      productionMutationPerformed: false,
      nextCheckpoint: 'CDB-113H3-PRODUCTION-SCHEMA-EXACT-AUTHORIZATION-REQUIRED',
    });
  });

  it('keeps tracker, control center, and handoff aligned with the exact authorization stop gate', () => {
    const combined = [trackerPath, controlPath, handoffPath].map(read).join('\n');
    for (const text of [
      'CDB-113H3-PRODUCTION-SCHEMA-AUTHORIZATION-CONTRACT-READY',
      'CDB-113H3-PRODUCTION-SCHEMA-EXACT-AUTHORIZATION-REQUIRED',
      receiptPath,
      readinessPath,
      'h3_contract_ready: true',
      'h3_authorization_present: false',
      'h3_execution_ready: false',
      'h3_bound_migration_count: 10',
      'h3_bound_receipt_count: 3',
      'h3_schema_migration_authorized: false',
      'h3_production_backfill_authorized: false',
      'production_rows_written: 0',
      'production_mutation_performed: false',
    ]) expect(combined).toContain(text);
  });
});
