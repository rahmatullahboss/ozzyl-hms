import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { createSqliteD1Harness, type SqliteD1Harness } from '../helpers/sqlite-d1';

const migrationPath = resolve(process.cwd(), 'migrations/0516_two_person_approval_policy.sql');

type PolicyModule = typeof import('../../src/services/approvals/two-person-policy');

async function loadPolicy(): Promise<PolicyModule | null> {
  try {
    return await import('../../src/services/approvals/two-person-policy');
  } catch {
    return null;
  }
}

function createApprovalSchema(harness: SqliteD1Harness): void {
  harness.sqlite.exec(`
    CREATE TABLE approval_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      requested_by INTEGER NOT NULL,
      request_data TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending', 'approved', 'rejected')),
      required_approvals INTEGER NOT NULL DEFAULT 2,
      approval_count INTEGER NOT NULL DEFAULT 0,
      approval_revision INTEGER NOT NULL DEFAULT 1,
      first_approved_at TEXT,
      fully_approved_at TEXT
    );

    CREATE TABLE approval_decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      approval_source TEXT NOT NULL DEFAULT 'approval_requests',
      approval_request_id INTEGER NOT NULL,
      approval_revision INTEGER NOT NULL DEFAULT 1,
      approver_id INTEGER NOT NULL,
      approver_role TEXT NOT NULL,
      decision TEXT NOT NULL DEFAULT 'approve',
      notes TEXT,
      superseded_at TEXT,
      superseded_by_revision INTEGER,
      superseded_reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
      UNIQUE (tenant_id, approval_source, approval_request_id, approval_revision, approver_id)
    );
  `);
}

describe('two-person approval schema', () => {
  it('defines immutable distinct approval decisions and historical 2-of-2 compatibility', () => {
    const sql = readFileSync(migrationPath, 'utf8');

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS approval_decisions');
    expect(sql).toContain('UNIQUE (tenant_id, approval_source, approval_request_id, approver_id)');
    expect(sql).toContain('ADD COLUMN required_approvals INTEGER NOT NULL DEFAULT 2');
    expect(sql).toContain("WHERE status = 'approved' AND approval_count = 0");
    expect(sql).toContain('approval_count = 2');
  });

  it('applies cleanly to the production-compatible legacy approval table', () => {
    const harness = createSqliteD1Harness();
    harness.sqlite.exec(`
      CREATE TABLE approval_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL,
        requested_by INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK(status IN ('pending', 'approved', 'rejected')),
        reviewed_at TEXT,
        created_at TEXT DEFAULT (datetime('now', '+6 hours'))
      );
      INSERT INTO approval_requests (id, tenant_id, requested_by, status, reviewed_at, created_at)
      VALUES
        (1, '100', 501, 'approved', '2026-07-01 10:00:00', '2026-07-01 09:00:00'),
        (2, '100', 502, 'pending', NULL, '2026-07-02 09:00:00');
    `);

    harness.sqlite.exec(readFileSync(migrationPath, 'utf8'));

    expect(harness.sqlite.prepare(`
      SELECT status, required_approvals, approval_count, first_approved_at, fully_approved_at
      FROM approval_requests WHERE id = 1
    `).get()).toEqual({
      status: 'approved',
      required_approvals: 2,
      approval_count: 2,
      first_approved_at: '2026-07-01 10:00:00',
      fully_approved_at: '2026-07-01 10:00:00',
    });
    expect(harness.sqlite.prepare(`
      SELECT status, required_approvals, approval_count, first_approved_at, fully_approved_at
      FROM approval_requests WHERE id = 2
    `).get()).toEqual({
      status: 'pending',
      required_approvals: 2,
      approval_count: 0,
      first_approved_at: null,
      fully_approved_at: null,
    });
    expect(harness.sqlite.prepare(`
      SELECT COUNT(*) AS count FROM sqlite_master
      WHERE type = 'table' AND name = 'approval_decisions'
    `).get()).toEqual({ count: 1 });
  });
});

describe('two-person approval policy', () => {
  let harness: SqliteD1Harness;

  beforeEach(() => {
    harness = createSqliteD1Harness();
    createApprovalSchema(harness);
    harness.sqlite.prepare(`
      INSERT INTO approval_requests (id, tenant_id, requested_by, status)
      VALUES (10, '100', 501, 'pending')
    `).run();
  });

  it('authorizes only privileged two-person reviewer roles and formats progress', async () => {
    const policy = await loadPolicy();
    expect(policy).not.toBeNull();
    if (!policy) return;

    expect(policy.isTwoPersonApproverRole('hospital_admin')).toBe(true);
    expect(policy.isTwoPersonApproverRole('md')).toBe(true);
    expect(policy.isTwoPersonApproverRole('director')).toBe(true);
    expect(policy.isTwoPersonApproverRole('ceo')).toBe(true);
    expect(policy.isTwoPersonApproverRole('manager')).toBe(false);
    expect(policy.approvalStage('pending', 0, 2).label).toBe('Pending (0/2)');
    expect(policy.approvalStage('partially_approved', 1, 2).label).toBe('Partially Approved (1/2)');
    expect(policy.approvalStage('approved', 2, 2).label).toBe('Fully Approved (2/2)');
  });

  it('records the first approval without fully approving the request', async () => {
    const policy = await loadPolicy();
    expect(policy).not.toBeNull();
    if (!policy) return;

    const result = await policy.recordApprovalDecision(harness.db, {
      tenantId: '100',
      approvalRequestId: 10,
      actorId: 601,
      actorRole: 'hospital_admin',
      notes: 'First independent review',
    });

    expect(result).toMatchObject({
      status: 'partially_approved',
      approvalCount: 1,
      requiredApprovals: 2,
      becameFullyApproved: false,
      alreadyApprovedByActor: false,
    });
    expect(harness.sqlite.prepare('SELECT COUNT(*) AS count FROM approval_decisions').get()).toEqual({ count: 1 });
    expect(harness.sqlite.prepare('SELECT status, approval_count FROM approval_requests WHERE id = 10').get())
      .toEqual({ status: 'pending', approval_count: 1 });
  });

  it('fully approves only after a second distinct approver', async () => {
    const policy = await loadPolicy();
    expect(policy).not.toBeNull();
    if (!policy) return;

    await policy.recordApprovalDecision(harness.db, {
      tenantId: '100', approvalRequestId: 10, actorId: 601, actorRole: 'hospital_admin',
    });
    const result = await policy.recordApprovalDecision(harness.db, {
      tenantId: '100', approvalRequestId: 10, actorId: 602, actorRole: 'director',
    });

    expect(result).toMatchObject({
      status: 'approved',
      approvalCount: 2,
      requiredApprovals: 2,
      becameFullyApproved: true,
    });
    expect(harness.sqlite.prepare('SELECT status, approval_count FROM approval_requests WHERE id = 10').get())
      .toEqual({ status: 'approved', approval_count: 2 });
  });

  it('blocks requester self-approval, duplicate approvers, unauthorized roles, and cross-tenant access', async () => {
    const policy = await loadPolicy();
    expect(policy).not.toBeNull();
    if (!policy) return;

    await expect(policy.recordApprovalDecision(harness.db, {
      tenantId: '100', approvalRequestId: 10, actorId: 501, actorRole: 'hospital_admin',
    })).rejects.toMatchObject({ code: 'SELF_APPROVAL_BLOCKED' });

    await policy.recordApprovalDecision(harness.db, {
      tenantId: '100', approvalRequestId: 10, actorId: 601, actorRole: 'md',
    });
    await expect(policy.recordApprovalDecision(harness.db, {
      tenantId: '100', approvalRequestId: 10, actorId: 601, actorRole: 'md',
    })).rejects.toMatchObject({ code: 'DUPLICATE_APPROVER' });

    await expect(policy.recordApprovalDecision(harness.db, {
      tenantId: '100', approvalRequestId: 10, actorId: 603, actorRole: 'manager',
    })).rejects.toMatchObject({ code: 'UNAUTHORIZED_APPROVER' });

    await expect(policy.recordApprovalDecision(harness.db, {
      tenantId: '101', approvalRequestId: 10, actorId: 604, actorRole: 'director',
    })).rejects.toMatchObject({ code: 'APPROVAL_NOT_FOUND' });
  });

  it('records source-generic expense and handover approvals without a single-review bypass', async () => {
    const policy = await loadPolicy();
    expect(policy).not.toBeNull();
    if (!policy) return;

    const first = await policy.recordSourceApprovalDecision(harness.db, {
      tenantId: '100',
      approvalSource: 'expenses',
      approvalRequestId: 77,
      requesterId: 501,
      subjectStatus: 'pending',
      actorId: 601,
      actorRole: 'hospital_admin',
    });
    expect(first).toMatchObject({ status: 'partially_approved', approvalCount: 1, becameFullyApproved: false });

    await expect(policy.recordSourceApprovalDecision(harness.db, {
      tenantId: '100',
      approvalSource: 'expenses',
      approvalRequestId: 77,
      requesterId: 501,
      subjectStatus: 'pending',
      actorId: 601,
      actorRole: 'hospital_admin',
    })).rejects.toMatchObject({ code: 'DUPLICATE_APPROVER' });

    const second = await policy.recordSourceApprovalDecision(harness.db, {
      tenantId: '100',
      approvalSource: 'expenses',
      approvalRequestId: 77,
      requesterId: 501,
      subjectStatus: 'pending',
      actorId: 602,
      actorRole: 'director',
    });
    expect(second).toMatchObject({ status: 'approved', approvalCount: 2, becameFullyApproved: true });

    await expect(policy.recordSourceApprovalDecision(harness.db, {
      tenantId: '100',
      approvalSource: 'expenses',
      approvalRequestId: 77,
      requesterId: 501,
      subjectStatus: 'pending',
      actorId: 603,
      actorRole: 'md',
    })).rejects.toMatchObject({ code: 'APPROVAL_TERMINAL' });
  });

  it('allows only one final transition when distinct second approvals race', async () => {
    const policy = await loadPolicy();
    expect(policy).not.toBeNull();
    if (!policy) return;

    await policy.recordApprovalDecision(harness.db, {
      tenantId: '100', approvalRequestId: 10, actorId: 601, actorRole: 'md',
    });

    const outcomes = await Promise.allSettled([
      policy.recordApprovalDecision(harness.db, {
        tenantId: '100', approvalRequestId: 10, actorId: 602, actorRole: 'director',
      }),
      policy.recordApprovalDecision(harness.db, {
        tenantId: '100', approvalRequestId: 10, actorId: 603, actorRole: 'hospital_admin',
      }),
    ]);

    const fulfilled = outcomes.filter((outcome): outcome is PromiseFulfilledResult<Awaited<ReturnType<PolicyModule['recordApprovalDecision']>>> => outcome.status === 'fulfilled');
    expect(fulfilled).toHaveLength(1);
    expect(fulfilled[0].value.becameFullyApproved).toBe(true);
    expect(harness.sqlite.prepare('SELECT COUNT(*) AS count FROM approval_decisions').get()).toEqual({ count: 2 });
  });

  it('counts only unsuperseded decisions from the current revision', async () => {
    const policy = await loadPolicy();
    expect(policy).not.toBeNull();
    if (!policy) return;

    harness.sqlite.prepare(`
      INSERT INTO approval_decisions (
        tenant_id, approval_source, approval_request_id, approval_revision,
        approver_id, approver_role, decision,
        superseded_at, superseded_by_revision, superseded_reason
      ) VALUES (
        '100', 'approval_requests', 10, 1,
        601, 'hospital_admin', 'approve',
        '2026-07-26 12:00:00', 2, 'Evidence correction requested'
      )
    `).run();
    harness.sqlite.prepare(`
      UPDATE approval_requests
      SET approval_revision = 2, approval_count = 0,
          first_approved_at = NULL, fully_approved_at = NULL
      WHERE id = 10
    `).run();

    const result = await policy.recordApprovalDecision(harness.db, {
      tenantId: '100',
      approvalRequestId: 10,
      actorId: 602,
      actorRole: 'director',
    });

    expect(result).toMatchObject({
      status: 'partially_approved',
      approvalRevision: 2,
      approvalCount: 1,
      requiredApprovals: 2,
    });
    expect(harness.sqlite.prepare(`
      SELECT approval_revision, approval_count, status
      FROM approval_requests WHERE id = 10
    `).get()).toEqual({ approval_revision: 2, approval_count: 1, status: 'pending' });
  });

  it('allows a prior-revision approver once in the new revision and blocks a duplicate there', async () => {
    const policy = await loadPolicy();
    expect(policy).not.toBeNull();
    if (!policy) return;

    harness.sqlite.prepare(`
      INSERT INTO approval_decisions (
        tenant_id, approval_source, approval_request_id, approval_revision,
        approver_id, approver_role, decision,
        superseded_at, superseded_by_revision, superseded_reason
      ) VALUES (
        '100', 'approval_requests', 10, 1,
        601, 'hospital_admin', 'approve',
        '2026-07-26 12:00:00', 2, 'Evidence correction requested'
      )
    `).run();
    harness.sqlite.prepare(`
      UPDATE approval_requests
      SET approval_revision = 2, approval_count = 0
      WHERE id = 10
    `).run();

    await expect(policy.recordApprovalDecision(harness.db, {
      tenantId: '100',
      approvalRequestId: 10,
      actorId: 601,
      actorRole: 'hospital_admin',
    })).resolves.toMatchObject({ approvalCount: 1 });

    await expect(policy.recordApprovalDecision(harness.db, {
      tenantId: '100',
      approvalRequestId: 10,
      actorId: 601,
      actorRole: 'hospital_admin',
    })).rejects.toMatchObject({ code: 'DUPLICATE_APPROVER' });
  });

  it('returns a one-of-two request to a new revision without deleting decision history', async () => {
    const policy = await loadPolicy();
    expect(policy).not.toBeNull();
    if (!policy) return;

    await policy.recordApprovalDecision(harness.db, {
      tenantId: '100',
      approvalRequestId: 10,
      actorId: 601,
      actorRole: 'hospital_admin',
      notes: 'Initial review',
    });

    const result = await policy.returnApprovalForCorrection(harness.db, {
      tenantId: '100',
      approvalRequestId: 10,
      actorId: 602,
      reason: 'Attach cashier acknowledgement',
      missingItems: ['Cashier acknowledgement'],
    });

    expect(result).toEqual({
      previousRevision: 1,
      approvalRevision: 2,
      approvalCount: 0,
      requiredApprovals: 2,
    });
    expect(harness.sqlite.prepare(`
      SELECT approval_revision, approval_count, status,
             first_approved_at, fully_approved_at
      FROM approval_requests WHERE id = 10
    `).get()).toEqual({
      approval_revision: 2,
      approval_count: 0,
      status: 'pending',
      first_approved_at: null,
      fully_approved_at: null,
    });
    expect(harness.sqlite.prepare(`
      SELECT approval_revision, approver_id, superseded_by_revision,
             superseded_reason, superseded_at IS NOT NULL AS is_superseded
      FROM approval_decisions WHERE approval_request_id = 10
    `).get()).toEqual({
      approval_revision: 1,
      approver_id: 601,
      superseded_by_revision: 2,
      superseded_reason: 'Attach cashier acknowledgement',
      is_superseded: 1,
    });
  });
});
