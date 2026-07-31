import { Hono, type Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';
import { requirePermission } from '../../middleware/rbac';
import { createAuditLog } from '../../lib/accounting-helpers';
import { buildAuditBillStateSelect } from '../../lib/audit-bill-state';
import {
  LOCAL_SERVER_ATOMIC_PATIENT_WRITE_PATHS,
  LOCAL_SERVER_CORE_OUTBOX_GAPS,
  LOCAL_SERVER_DURABLE_STAGED_PATIENT_WRITE_PATHS,
  LOCAL_SERVER_ENTITY_ID_MAPPING_GAPS,
  LOCAL_SERVER_EXPLICIT_OUTBOX_ENTITY_TYPES,
  LOCAL_SERVER_NON_ATOMIC_OUTBOX_ENTITY_TYPES,
  LOCAL_SERVER_PARTIAL_WRITE_PATH_COVERAGE_TYPES,
  LOCAL_SERVER_PATIENT_WRITE_PATH_GAPS,
  LOCAL_SYNC_CLOUD_APPLY_ENTITY_TYPES,
} from '../../lib/local-sync-coverage';
import type { Env, Variables } from '../../types';


const auditRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
type AuditRouteContext = Context<{ Bindings: Env; Variables: Variables }>;

const MAX_AUDIT_LIMIT = 200;
const DEFAULT_AUDIT_LIMIT = 50;
const SERVER_SYNC_RETRY_ROLES = new Set(['hospital_admin', 'director', 'md', 'manager', 'admin']);

type ServerSyncCountRow = Record<string, number | string | null>;

auditRoutes.use('/*', requirePermission('audit:read'));

function isSyncSchemaDrift(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /no such table|no such column|has no column named/i.test(message);
}

function numericCount(row: ServerSyncCountRow | null, key: string): number {
  return Number(row?.[key] ?? 0) || 0;
}

async function querySyncRows(
  statementFactory: () => D1PreparedStatement,
  warnings: string[],
  label: string,
): Promise<Record<string, unknown>[]> {
  try {
    const { results } = await statementFactory().all<Record<string, unknown>>();
    return results ?? [];
  } catch (error) {
    if (!isSyncSchemaDrift(error)) throw error;
    warnings.push(`${label} schema is not available on this deployment`);
    return [];
  }
}

async function querySyncCount(
  statementFactory: () => D1PreparedStatement,
  warnings: string[],
  label: string,
): Promise<ServerSyncCountRow | null> {
  try {
    return await statementFactory().first<ServerSyncCountRow>();
  } catch (error) {
    if (!isSyncSchemaDrift(error)) throw error;
    warnings.push(`${label} schema is not available on this deployment`);
    return null;
  }
}

function parseLimit(rawLimit?: string): number {
  if (!rawLimit) return DEFAULT_AUDIT_LIMIT;
  const limit = Number(rawLimit);
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new HTTPException(400, { message: 'Invalid audit limit' });
  }
  return Math.min(limit, MAX_AUDIT_LIMIT);
}

function assertDateParam(name: string, value?: string): void {
  if (!value) return;
  if (Number.isNaN(Date.parse(value))) {
    throw new HTTPException(400, { message: `Invalid ${name}` });
  }
}

function buildAuditListQuery(input: {
  tenantId: string;
  userId?: string;
  tableName?: string;
  startDate?: string;
  endDate?: string;
  limit?: string;
  maxLimit?: number;
  selectClause?: string;
}): { query: string; params: (string | number)[] } {
  const maxLimit = input.maxLimit ?? MAX_AUDIT_LIMIT;
  const selectClause = input.selectClause ?? `
    a.*,
    u.name as user_name,
    ${buildAuditBillStateSelect('b')},
    e.status as expenseStatus,
    e.amount as expenseAmount,
    e.category as expenseCategory,
    e.description as expenseDescription,
    cct.transfer_no as transferNo,
    cct.status as transferStatus,
    cct.amount as transferAmount,
    cct.received_amount as transferReceivedAmount,
    cct.due_amount as transferDueAmount,
    cct.destination_type as transferDestinationType,
    cct.custody_label as transferCustodyLabel,
    sender.name as transferByName,
    receiver.name as transferToName
  `;
  let query = `
    SELECT ${selectClause}
    FROM audit_logs a
    LEFT JOIN users u ON a.user_id = u.id AND u.tenant_id = a.tenant_id
    LEFT JOIN bills b
      ON a.tenant_id = b.tenant_id
      AND a.table_name IN ('bills', 'billing')
      AND a.record_id = b.id
    LEFT JOIN expenses e
      ON a.tenant_id = e.tenant_id
      AND a.table_name = 'expenses'
      AND a.record_id = e.id
    LEFT JOIN billing_counter_cash_transfers cct
      ON a.tenant_id = cct.tenant_id
      AND a.table_name = 'billing_counter_cash_transfers'
      AND a.record_id = cct.id
    LEFT JOIN users sender
      ON cct.transfer_by = sender.id
      AND cct.tenant_id = sender.tenant_id
    LEFT JOIN users receiver
      ON cct.transfer_to = receiver.id
      AND cct.tenant_id = receiver.tenant_id
    WHERE a.tenant_id = ?
  `;
  const params: (string | number)[] = [input.tenantId];
  const limit = input.limit ? parseLimit(input.limit) : (input.maxLimit ?? DEFAULT_AUDIT_LIMIT);
  const effectiveLimit = Math.min(limit, maxLimit);

  if (input.userId) {
    const parsedUserId = Number(input.userId);
    if (!Number.isInteger(parsedUserId) || parsedUserId <= 0) {
      throw new HTTPException(400, { message: 'Invalid userId' });
    }
    query += ' AND a.user_id = ?';
    params.push(parsedUserId);
  }
  if (input.tableName) {
    if (!/^[a-zA-Z0-9_]+$/.test(input.tableName)) {
      throw new HTTPException(400, { message: 'Invalid tableName' });
    }
    query += ' AND a.table_name = ?';
    params.push(input.tableName);
  }
  assertDateParam('startDate', input.startDate);
  assertDateParam('endDate', input.endDate);
  if (input.startDate && input.endDate && Date.parse(input.startDate) > Date.parse(input.endDate)) {
    throw new HTTPException(400, { message: 'startDate must be on or before endDate' });
  }
  if (input.startDate) {
    query += ' AND a.created_at >= ?';
    params.push(input.startDate);
  }
  if (input.endDate) {
    query += ' AND a.created_at <= ?';
    params.push(input.endDate);
  }

  query += ' ORDER BY a.created_at DESC LIMIT ?';
  params.push(effectiveLimit);
  return { query, params };
}

async function listAuditLogs(c: AuditRouteContext) {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const { userId: filterUserId, tableName, startDate, endDate, limit } = c.req.query();
  const { query, params } = buildAuditListQuery({ tenantId, userId: filterUserId, tableName, startDate, endDate, limit });
  try {
    const result = await db.$client.prepare(query).bind(...params).all();
    void createAuditLog(c.env, tenantId, userId, 'VIEW', 'audit_logs', 0, null, { filterUserId, tableName, startDate, endDate });
    return c.json({ auditLogs: result.results });
  } catch (error) {
    console.error('Error fetching audit logs:', error);
    return c.json({ error: 'Failed to fetch audit logs' }, 500);
  }
}

auditRoutes.get('/', async (c) => {
  return listAuditLogs(c);
});

// Alias: GET /api/audit/logs → same as GET /api/audit/
auditRoutes.get('/logs', async (c) => {
  return listAuditLogs(c);
});

// ─── GET /api/audit/export — Export audit logs as CSV ───────────────────────
auditRoutes.get('/export', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const { userId: filterUserId, tableName, startDate, endDate } = c.req.query();

  const { query, params } = buildAuditListQuery({
    tenantId,
    userId: filterUserId,
    tableName,
    startDate,
    endDate,
    maxLimit: 10000,
    selectClause: 'a.id, a.user_id, u.name as user_name, a.action, a.table_name, a.record_id, a.old_value, a.new_value, a.ip_address, a.user_agent, a.created_at',
  });

  try {
    const { results } = await db.$client.prepare(query).bind(...params).all();

    // Build CSV
    const headers = ['ID', 'User ID', 'User Name', 'Action', 'Table', 'Record ID', 'Old Value', 'New Value', 'IP Address', 'User Agent', 'Created At'];
    const csvRows = [headers.join(',')];

    for (const row of (results || []) as any[]) {
      const escCsv = (v: string) => `"${(v || '').replace(/"/g, '""').replace(/[\r\n]/g, ' ')}"`;
      const values = [
        row.id,
        row.user_id,
        escCsv(row.user_name),
        row.action,
        row.table_name,
        row.record_id,
        escCsv(row.old_value),
        escCsv(row.new_value),
        row.ip_address || '',
        escCsv(row.user_agent),
        row.created_at,
      ];
      csvRows.push(values.join(','));
    }

    const csv = csvRows.join('\n');

    c.header('Content-Type', 'text/csv; charset=utf-8');
    c.header('Content-Disposition', `attachment; filename="audit-export-${new Date().toISOString().slice(0, 10)}.csv"`);
    void createAuditLog(c.env, tenantId, userId, 'EXPORT', 'audit_logs', 0, null, { filterUserId, tableName, startDate, endDate, recordCount: results?.length ?? 0 });
    return c.body(csv);
  } catch (error) {
    console.error('Error exporting audit logs:', error);
    return c.json({ error: 'Failed to export audit logs' }, 500);
  }
});

auditRoutes.get('/server-sync', async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const limit = parseLimit(c.req.query('limit'));
  const warnings: string[] = [];

  const [outboxCount, outboxRows, ingestCount, ingestRows, pullCount, pullRows] = await Promise.all([
    querySyncCount(
      () => c.env.DB.prepare(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
          SUM(CASE WHEN status = 'exporting' THEN 1 ELSE 0 END) AS exporting,
          SUM(CASE WHEN status = 'exported' THEN 1 ELSE 0 END) AS exported,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
          SUM(CASE WHEN status = 'poison' THEN 1 ELSE 0 END) AS poison
        FROM local_sync_outbox
        WHERE tenant_id = ?
      `).bind(tenantId),
      warnings,
      'Local-server outbox',
    ),
    querySyncRows(
      () => c.env.DB.prepare(`
        SELECT id,
               entity_type AS entityType,
               entity_id AS entityId,
               operation,
               status,
               attempts,
               next_attempt_at AS nextAttemptAt,
               last_error AS lastError,
               created_at AS createdAt,
               exported_at AS exportedAt
        FROM local_sync_outbox
        WHERE tenant_id = ?
        ORDER BY CASE status
          WHEN 'poison' THEN 0
          WHEN 'failed' THEN 1
          WHEN 'exporting' THEN 2
          WHEN 'pending' THEN 3
          ELSE 4
        END, created_at DESC
        LIMIT ?
      `).bind(tenantId, limit),
      warnings,
      'Local-server outbox',
    ),
    querySyncCount(
      () => c.env.DB.prepare(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN apply_status = 'metadata_only' AND COALESCE(apply_error, '') NOT LIKE 'PROCESSING:%' THEN 1 ELSE 0 END) AS metadataOnly,
          SUM(CASE WHEN apply_status = 'metadata_only' AND COALESCE(apply_error, '') LIKE 'PROCESSING:%' THEN 1 ELSE 0 END) AS processing,
          SUM(CASE WHEN apply_status = 'applied' THEN 1 ELSE 0 END) AS applied,
          SUM(CASE WHEN apply_status = 'failed' THEN 1 ELSE 0 END) AS failed
        FROM cloud_sync_ingest_events
        WHERE tenant_id = ?
      `).bind(tenantId),
      warnings,
      'Cloud ingest receipt',
    ),
    querySyncRows(
      () => c.env.DB.prepare(`
        SELECT id,
               server_id AS serverId,
               batch_id AS batchId,
               entity_type AS entityType,
               entity_id AS entityId,
               operation,
               CASE
                 WHEN apply_status = 'metadata_only' AND COALESCE(apply_error, '') LIKE 'PROCESSING:%' THEN 'processing'
                 ELSE apply_status
               END AS applyStatus,
               CASE
                 WHEN apply_status = 'metadata_only' AND COALESCE(apply_error, '') LIKE 'PROCESSING:%' THEN NULL
                 ELSE apply_error
               END AS applyError,
               received_at AS receivedAt
        FROM cloud_sync_ingest_events
        WHERE tenant_id = ?
        ORDER BY CASE apply_status
          WHEN 'failed' THEN 0
          WHEN 'metadata_only' THEN 1
          ELSE 2
        END, received_at DESC
        LIMIT ?
      `).bind(tenantId, limit),
      warnings,
      'Cloud ingest receipt',
    ),
    querySyncCount(
      () => c.env.DB.prepare(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
          SUM(CASE WHEN status = 'applied' THEN 1 ELSE 0 END) AS applied,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
          SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) AS skipped
        FROM local_cloud_pull_state
        WHERE tenant_id = ?
      `).bind(tenantId),
      warnings,
      'Cloud-to-local pull state',
    ),
    querySyncRows(
      () => c.env.DB.prepare(`
        SELECT table_name AS tableName,
               last_snapshot_id AS lastSnapshotId,
               last_pulled_at AS lastPulledAt,
               rows_received AS rowsReceived,
               rows_applied AS rowsApplied,
               status,
               last_error AS lastError,
               updated_at AS updatedAt
        FROM local_cloud_pull_state
        WHERE tenant_id = ?
        ORDER BY CASE status
          WHEN 'failed' THEN 0
          WHEN 'pending' THEN 1
          WHEN 'skipped' THEN 2
          ELSE 3
        END, updated_at DESC
        LIMIT ?
      `).bind(tenantId, limit),
      warnings,
      'Cloud-to-local pull state',
    ),
  ]);

  const outboxSummary = {
    total: numericCount(outboxCount, 'total'),
    pending: numericCount(outboxCount, 'pending'),
    exporting: numericCount(outboxCount, 'exporting'),
    exported: numericCount(outboxCount, 'exported'),
    failed: numericCount(outboxCount, 'failed'),
    poison: numericCount(outboxCount, 'poison'),
  };
  const ingestSummary = {
    total: numericCount(ingestCount, 'total'),
    metadataOnly: numericCount(ingestCount, 'metadataOnly'),
    processing: numericCount(ingestCount, 'processing'),
    applied: numericCount(ingestCount, 'applied'),
    failed: numericCount(ingestCount, 'failed'),
  };
  const pullSummary = {
    total: numericCount(pullCount, 'total'),
    pending: numericCount(pullCount, 'pending'),
    applied: numericCount(pullCount, 'applied'),
    failed: numericCount(pullCount, 'failed'),
    skipped: numericCount(pullCount, 'skipped'),
  };

  void createAuditLog(c.env, tenantId, userId, 'VIEW', 'server_sync_review', 0, null, {
    deploymentMode: c.env.ENVIRONMENT === 'local_server' ? 'local_server' : 'cloud',
    limit,
    reviewCount: outboxSummary.failed + outboxSummary.poison + ingestSummary.failed + pullSummary.failed,
  });

  return c.json({
    deploymentMode: c.env.ENVIRONMENT === 'local_server' ? 'local_server' : 'cloud',
    localServerId: c.env.LOCAL_SERVER_ID ?? null,
    generatedAt: new Date().toISOString(),
    warnings: [...new Set(warnings)],
    coverage: {
      mode: 'explicit_outbox',
      fullDatabaseReplication: false,
      explicitLocalEmitterTypes: [...LOCAL_SERVER_EXPLICIT_OUTBOX_ENTITY_TYPES],
      nonAtomicEmitterTypes: [...LOCAL_SERVER_NON_ATOMIC_OUTBOX_ENTITY_TYPES],
      partialWritePathCoverageTypes: [...LOCAL_SERVER_PARTIAL_WRITE_PATH_COVERAGE_TYPES],
      atomicPatientWritePaths: [...LOCAL_SERVER_ATOMIC_PATIENT_WRITE_PATHS],
      durableStagedPatientWritePaths: [...LOCAL_SERVER_DURABLE_STAGED_PATIENT_WRITE_PATHS],
      patientWritePathGaps: [...LOCAL_SERVER_PATIENT_WRITE_PATH_GAPS],
      entityIdMappingGaps: [...LOCAL_SERVER_ENTITY_ID_MAPPING_GAPS],
      cloudApplyTypes: [...LOCAL_SYNC_CLOUD_APPLY_ENTITY_TYPES],
      coreOutboxGaps: [...LOCAL_SERVER_CORE_OUTBOX_GAPS],
    },
    localOutbox: { summary: outboxSummary, rows: outboxRows },
    cloudIngest: { summary: ingestSummary, rows: ingestRows },
    cloudPull: { summary: pullSummary, rows: pullRows },
  });
});

auditRoutes.post('/server-sync/outbox/:id/retry', async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  if (c.env.ENVIRONMENT !== 'local_server') {
    throw new HTTPException(409, { message: 'Server sync outbox retry must be requested from the hospital local server' });
  }
  const role = String(c.get('role') ?? '');
  if (!SERVER_SYNC_RETRY_ROLES.has(role)) {
    throw new HTTPException(403, { message: 'Hospital admin or manager role is required to retry server sync' });
  }

  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) {
    throw new HTTPException(400, { message: 'Invalid server sync outbox id' });
  }

  const row = await c.env.DB.prepare(`
    SELECT id, entity_type, entity_id, status, attempts
    FROM local_sync_outbox
    WHERE id = ? AND tenant_id = ?
    LIMIT 1
  `).bind(id, tenantId).first<{
    id: number;
    entity_type: string;
    entity_id: string;
    status: string;
    attempts: number;
  }>();

  if (!row) throw new HTTPException(404, { message: 'Server sync outbox item not found' });
  if (!['failed', 'poison'].includes(String(row.status))) {
    throw new HTTPException(409, { message: 'Only failed or blocked server sync items can be retried' });
  }

  const updated = await c.env.DB.prepare(`
    UPDATE local_sync_outbox
    SET status = 'pending',
        next_attempt_at = datetime('now'),
        locked_at = NULL,
        last_error = NULL
    WHERE id = ? AND tenant_id = ? AND status IN ('failed', 'poison')
    RETURNING id, status, attempts, next_attempt_at AS nextAttemptAt
  `).bind(id, tenantId).first<Record<string, unknown>>();

  if (!updated) {
    throw new HTTPException(409, { message: 'Server sync item changed before retry could be queued' });
  }

  await createAuditLog(c.env, tenantId, userId, 'UPDATE', 'local_sync_outbox', id, {
    status: row.status,
  }, {
    action: 'manual_retry_requested',
    status: 'pending',
    entityType: row.entity_type,
    attempts: Number(row.attempts ?? 0),
  });

  return c.json({
    message: 'Server sync retry queued',
    item: updated,
  });
});

auditRoutes.get('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = c.req.param('id');

  try {
    const result = await db.$client.prepare(`
      SELECT a.*, u.name as user_name 
      FROM audit_logs a 
      LEFT JOIN users u ON a.user_id = u.id AND u.tenant_id = a.tenant_id 
      WHERE a.id = ? AND a.tenant_id = ?
    `).bind(id, tenantId).first();

    if (!result) {
      return c.json({ error: 'Audit log not found' }, 404);
    }

    return c.json({ auditLog: result });
  } catch (error) {
    console.error('Error fetching audit log:', error);
    return c.json({ error: 'Failed to fetch audit log' }, 500);
  }
});

export default auditRoutes;
