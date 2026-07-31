import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const receiptPath =
  'docs/database/migration-runs/production/CDB-113H1-protected-local-clone-migration-rehearsal.md';
const trackerPath = 'task-progress.yaml';
const controlPath = 'docs/architecture/canonical-program-control-center.md';
const handoffPath = '.ai-bridge/current-plan.md';

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('CDB-113H1 protected local clone migration rehearsal continuity', () => {
  it('records the verified local clone fallback without claiming remote clone or production execution', () => {
    expect(existsSync(receiptPath)).toBe(true);
    const receipt = read(receiptPath);
    for (const text of [
      'CDB-113H1-PROTECTED-LOCAL-CLONE-MIGRATION-REHEARSAL-VERIFIED',
      'remote D1 clone creation was blocked by the account database quota',
      'protected local SQLite/D1-equivalent clone',
      '10/10 migrations',
      '487 → 497',
      '`0547` schema and row no-op',
      '`0548` preserved 234 tenant-100 canonical encounters and 28 canonical bed stays',
      '`0549` preserved approval request, decision, and event row counts',
      '`0550` created 5 explicit indexes and 3 composite foreign-key constraints',
      'foreign-key violations: **0**',
      'complete canonical suite: **217 files / 1,507 tests**',
      'migration manifest: **483** migrations',
      'access governance: **191** governed tables, **869** writers, **2,088** readers, 0 issues',
      'legacy retirement: 0/66 eligible, 66 blocked',
      'production migration ledger remained **487**',
      'production rows written: **0**',
      'production mutation performed: **no**',
      'CDB-113H2-PROTECTED-CLONE-BACKFILL-RECONCILIATION-AUTHORIZATION-REQUIRED',
    ]) expect(receipt).toContain(text);
    expect(receipt).not.toContain('.hms-canonical-rehearsals');
    expect(receipt).not.toMatch(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i);
  });

  it('keeps tracker, control center, and handoff aligned with the exact next authorization gate', () => {
    const combined = [trackerPath, controlPath, handoffPath].map(read).join('\n');
    for (const text of [
      'CDB-113H1-PROTECTED-LOCAL-CLONE-MIGRATION-REHEARSAL-VERIFIED',
      'CDB-113H2-PROTECTED-CLONE-BACKFILL-RECONCILIATION-AUTHORIZATION-REQUIRED',
      receiptPath,
      'remote_clone_created: false',
      'remote_clone_blocked_by_d1_quota: true',
      'local_clone_migrations_applied: 10',
      'local_clone_migration_ledger_before: 487',
      'local_clone_migration_ledger_after: 497',
      'local_clone_foreign_key_violations: 0',
      'focused_test_files: 3',
      'focused_tests: 12',
      'canonical_test_files: 217',
      'canonical_tests: 1507',
      'migrations_generated: 483',
      'governed_tables: 191',
      'writer_access_pairs: 869',
      'reader_access_pairs: 2088',
      'legacy_retirement_blocked_allowances: 66',
      'production_migration_ledger_after_rehearsal: 487',
      'production_rows_written: 0',
      'production_mutation_performed: false',
    ]) expect(combined).toContain(text);
  });
});
