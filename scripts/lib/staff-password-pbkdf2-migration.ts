export type StaffPasswordMigrationEntry = {
  userId: number;
  tenantId: number | null;
  password: string;
};

type AtomicPasswordUpdate = {
  userId: number;
  tenantId: number | null;
  oldHash: string;
  newHash: string;
};

function requirePositiveInteger(value: unknown, field: 'userId' | 'tenantId'): number {
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new Error(`${field} must be a positive integer`);
  }
  return Number(value);
}

function requireTenantId(value: unknown): number | null {
  if (value === null) return null;
  return requirePositiveInteger(value, 'tenantId');
}

function tenantPredicate(tenantId: number | null): string {
  return tenantId === null ? 'tenant_id IS NULL' : `tenant_id = ${tenantId}`;
}

function quoteSqlText(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function parseMigrationEntries(raw: string): StaffPasswordMigrationEntry[] {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('Migration input must be a non-empty JSON array');
  }

  const seen = new Set<string>();
  return parsed.map((value, index) => {
    if (!value || typeof value !== 'object') {
      throw new Error(`Entry ${index + 1} must be an object`);
    }

    const record = value as Record<string, unknown>;
    const userId = requirePositiveInteger(record.userId, 'userId');
    const tenantId = requireTenantId(record.tenantId);
    const password = record.password;
    if (typeof password !== 'string' || password.length === 0) {
      throw new Error(`Entry ${index + 1} password must be a non-empty string`);
    }

    const key = `${tenantId}:${userId}`;
    if (seen.has(key)) {
      throw new Error(`Duplicate migration entry for tenantId ${tenantId}, userId ${userId}`);
    }
    seen.add(key);

    return { userId, tenantId, password };
  });
}

export function buildPasswordLookupSql(userId: number, tenantId: number | null): string {
  const safeUserId = requirePositiveInteger(userId, 'userId');
  const safeTenantId = requireTenantId(tenantId);
  return [
    'SELECT id, tenant_id, email, role, password_hash',
    'FROM users',
    `WHERE id = ${safeUserId} AND ${tenantPredicate(safeTenantId)}`,
    'LIMIT 1;',
  ].join(' ');
}

export function buildAtomicPasswordUpdateSql(input: AtomicPasswordUpdate): string {
  const userId = requirePositiveInteger(input.userId, 'userId');
  const tenantId = requireTenantId(input.tenantId);
  if (!input.oldHash || !input.newHash) {
    throw new Error('Both oldHash and newHash are required');
  }

  return [
    'UPDATE users',
    `SET password_hash = ${quoteSqlText(input.newHash)}, updated_at = datetime('now', '+6 hours')`,
    `WHERE id = ${userId} AND ${tenantPredicate(tenantId)}`,
    `AND password_hash = ${quoteSqlText(input.oldHash)};`,
  ].join(' ');
}
