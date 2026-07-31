import { describe, expect, it } from 'vitest';
import { createMockDB } from './integration/helpers/mock-db';
import {
  LisInboxReviewError,
  rejectStagedLisResult,
} from '../src/services/lis-inbox-review';

const baseRow = {
  id: 80,
  disposition: 'review_required',
  state_version: 3,
  staged_by: 9,
};

function input(overrides: Partial<Parameters<typeof rejectStagedLisResult>[1]> = {}) {
  return {
    tenantId: 'tenant-1',
    inboxId: 80,
    expectedVersion: 3,
    reviewerUserId: 15,
    reviewerRole: 'pathologist',
    reason: 'Analyzer sample was assigned to the wrong patient.',
    ...overrides,
  };
}

function reviewDb(row: Record<string, unknown> | null = baseRow, changes = 1) {
  return createMockDB({
    queryOverride(sql) {
      if (sql.includes('FROM lis_analyzer_inbox') && sql.includes('SELECT')) {
        return { first: row };
      }
      if (sql.includes('UPDATE lis_analyzer_inbox')) {
        return { success: true, meta: { changes } };
      }
      return null;
    },
  });
}

describe('LIS analyzer inbox review service', () => {
  it('rejects unauthorized reviewer roles before querying the database', async () => {
    const mock = reviewDb();

    await expect(rejectStagedLisResult(mock.db, input({ reviewerRole: 'lab_tech' })))
      .rejects.toMatchObject({ code: 'review_forbidden', status: 403 });
    expect(mock.queries).toHaveLength(0);
  });

  it('requires a meaningful rejection reason', async () => {
    const mock = reviewDb();

    await expect(rejectStagedLisResult(mock.db, input({ reason: 'no' })))
      .rejects.toMatchObject({ code: 'invalid_rejection_reason', status: 400 });
  });

  it('prevents the staging user from making the final rejection decision', async () => {
    const mock = reviewDb();

    await expect(rejectStagedLisResult(mock.db, input({ reviewerUserId: 9 })))
      .rejects.toMatchObject({ code: 'self_review_forbidden', status: 409 });
    expect(mock.queries.some(query => query.method === 'run')).toBe(false);
  });

  it('does not change terminal accepted or rejected observations', async () => {
    for (const disposition of ['accepted', 'rejected']) {
      const mock = reviewDb({ ...baseRow, disposition });
      await expect(rejectStagedLisResult(mock.db, input()))
        .rejects.toMatchObject({ code: 'review_already_closed', status: 409 });
      expect(mock.queries.some(query => query.method === 'run')).toBe(false);
    }
  });

  it('records an optimistic, accountable rejection', async () => {
    const mock = reviewDb();

    await expect(rejectStagedLisResult(mock.db, input())).resolves.toEqual({
      rejected: true,
      inboxId: 80,
      nextVersion: 4,
    });

    const update = mock.queries.find(query => query.method === 'run');
    expect(update?.sql).toContain("SET disposition = 'rejected'");
    expect(update?.sql).toContain('state_version = state_version + 1');
    expect(update?.sql).toContain('state_version = ?');
    expect(update?.params).toEqual([
      'Analyzer sample was assigned to the wrong patient.',
      15,
      'Analyzer sample was assigned to the wrong patient.',
      80,
      'tenant-1',
      3,
      15,
    ]);
  });

  it('returns a conflict when another reviewer changed the row first', async () => {
    const mock = reviewDb(baseRow, 0);

    await expect(rejectStagedLisResult(mock.db, input()))
      .rejects.toBeInstanceOf(LisInboxReviewError);
    await expect(rejectStagedLisResult(mock.db, input()))
      .rejects.toMatchObject({ code: 'review_conflict', status: 409 });
  });
});
