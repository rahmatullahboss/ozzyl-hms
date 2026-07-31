import { HTTPException } from 'hono/http-exception';

export type MasterDataAuditAction = 'CREATE' | 'UPDATE' | 'DELETE';

export interface MasterDataAuditInput {
  tenantId: string;
  userId: number | string;
  action: MasterDataAuditAction;
  tableName: string;
  recordId?: number | string | null;
  oldValue?: unknown;
  newValue?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
}

function serializeAuditValue(value: unknown): string | null {
  if (value === undefined) return null;
  return JSON.stringify(value);
}

export function requireMasterDataActorId(userId: unknown): number {
  const actorId = Number(userId);
  if (!Number.isInteger(actorId) || actorId <= 0) {
    throw new HTTPException(401, { message: 'Authentication required for master-data changes' });
  }
  return actorId;
}

export function auditRequestMetadata(c: { req: { header(name: string): string | undefined } }) {
  return {
    ipAddress: c.req.header('CF-Connecting-IP')
      ?? c.req.header('X-Forwarded-For')?.split(',')[0]?.trim()
      ?? null,
    userAgent: c.req.header('User-Agent') ?? null,
  };
}

export function prepareMasterDataAudit(
  db: D1Database,
  input: MasterDataAuditInput,
) {
  const actorId = requireMasterDataActorId(input.userId);
  return db.prepare(`
    INSERT INTO audit_logs
      (tenant_id, user_id, action, table_name, record_id, old_value, new_value, ip_address, user_agent, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).bind(
    input.tenantId,
    actorId,
    input.action,
    input.tableName,
    input.recordId ?? null,
    serializeAuditValue(input.oldValue),
    serializeAuditValue(input.newValue),
    input.ipAddress ?? null,
    input.userAgent ?? null,
  );
}
