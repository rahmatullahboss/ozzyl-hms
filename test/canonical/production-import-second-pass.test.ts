import { describe, expect, it } from 'vitest';
import { verifyCanonicalImportSecondPassOutput } from '../../scripts/canonical/import-production-canonical-bundle';

function wranglerOutput(changedDb: boolean, changes: number, rowsWritten: number): string {
  return JSON.stringify([{
    results: [],
    meta: { changed_db: changedDb, changes, rows_written: rowsWritten },
  }]);
}

function wranglerFileImportOutput(changes: number, rowsWritten: number): string {
  return JSON.stringify([{
    success: true,
    results: [{
      'Total queries executed': 8799,
      'Rows read': 2169354,
      'Rows written': rowsWritten,
    }],
    meta: { changed_db: true, changes, rows_written: rowsWritten },
  }]);
}

describe('CDB-101 production import second pass', () => {
  it('accepts a zero-write second pass and returns its aggregate metadata', () => {
    expect(verifyCanonicalImportSecondPassOutput(wranglerOutput(false, 0, 0))).toEqual({
      envelopeCount: 1,
      changedDbTrueCount: 0,
      changes: 0,
      rowsWritten: 0,
    });
  });

  it('accepts changed_db=true when D1 reports zero changed and written rows', () => {
    expect(verifyCanonicalImportSecondPassOutput(wranglerOutput(true, 0, 0))).toMatchObject({
      changedDbTrueCount: 1,
      changes: 0,
      rowsWritten: 0,
    });
  });

  it('accepts D1 file-import bookkeeping changes only when both write counters are zero', () => {
    expect(verifyCanonicalImportSecondPassOutput(wranglerFileImportOutput(1, 0))).toEqual({
      envelopeCount: 1,
      changedDbTrueCount: 1,
      changes: 1,
      rowsWritten: 0,
    });
  });

  it('rejects any second-pass mutation or incomplete metadata', () => {
    expect(() => verifyCanonicalImportSecondPassOutput(wranglerOutput(false, 1, 0))).toThrow(/second pass/i);
    expect(() => verifyCanonicalImportSecondPassOutput(wranglerOutput(false, 0, 1))).toThrow(/second pass/i);
    expect(() => verifyCanonicalImportSecondPassOutput(wranglerFileImportOutput(1, 1))).toThrow(/second pass/i);
    expect(() => verifyCanonicalImportSecondPassOutput(JSON.stringify([{ results: [] }]))).toThrow(/second pass/i);
    expect(() => verifyCanonicalImportSecondPassOutput('not-json')).toThrow(/JSON/i);
  });

  it('requires every returned execution envelope to prove zero writes', () => {
    const mixed = JSON.stringify([
      { results: [], meta: { changed_db: false, changes: 0, rows_written: 0 } },
      { results: [], meta: { changed_db: true, changes: 1, rows_written: 2 } },
    ]);
    expect(() => verifyCanonicalImportSecondPassOutput(mixed)).toThrow(/second pass/i);
  });
});
