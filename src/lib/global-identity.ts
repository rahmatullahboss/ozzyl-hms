import type { D1Database } from '@cloudflare/workers-types';
import { validateBDNationalId } from './nid-validation';

export interface ResolveGlobalIdentityInput {
  tenantId?: string | null;
  uhid?: string | null;
  nationalId?: string | null;
  brn?: string | null;
  phone?: string | null;
  email?: string | null;
  name?: string | null;
  source?: 'hospital' | 'self_signup' | 'import' | 'family_proxy';
  dateOfBirth?: string | null;
  gender?: string | null;
}

export interface GlobalIdentityRecord {
  id: number;
  uhid: string;
  claimStatus: string;
  claimedAuthUserId?: number | null;
  createdSource: string;
  created: boolean;
}

const GLOBAL_UID_PREFIX = 'OZ';
const GLOBAL_UID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const GLOBAL_UID_REGEX = /^OZ-(?:\d{6}|[A-Z2-9]{4}-[A-Z2-9]{4})$/;

export function createReadableGlobalUid(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const chars = Array.from(bytes, (byte) => GLOBAL_UID_ALPHABET[byte % GLOBAL_UID_ALPHABET.length]);
  return `${GLOBAL_UID_PREFIX}-${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`;
}

const tableColumnCache = new WeakMap<D1Database, Map<string, Set<string>>>();
const defaultTableColumns: Record<string, string[]> = {
  global_patient_identity: [
    'id',
    'national_id',
    'uhid',
    'primary_name',
    'primary_phone',
    'primary_email',
    'brn',
    'claim_status',
    'claimed_auth_user_id',
    'claimed_at',
    'created_source',
    'created_tenant_id',
    'date_of_birth',
    'gender',
  ],
};

async function getTableColumns(db: D1Database, table: string): Promise<Set<string>> {
  let dbCache = tableColumnCache.get(db);
  if (!dbCache) {
    dbCache = new Map<string, Set<string>>();
    tableColumnCache.set(db, dbCache);
  }

  const cached = dbCache.get(table);
  if (cached) return cached;

  const { results } = await db.prepare(`PRAGMA table_info("${table.replace(/"/g, '""')}")`).all<{ name: string }>();
  const columns = new Set((results ?? []).map((row) => String(row.name)));
  if (columns.size === 0 && defaultTableColumns[table]) {
    for (const column of defaultTableColumns[table]) {
      columns.add(column);
    }
  }
  dbCache.set(table, columns);
  return columns;
}

async function findExistingIdentity(
  db: D1Database,
  input: ResolveGlobalIdentityInput,
): Promise<GlobalIdentityRecord | null> {
  const columns = await getTableColumns(db, 'global_patient_identity');
  const selectColumns = [
    'id',
    'uhid',
    columns.has('claim_status') ? 'claim_status' : "'unclaimed' AS claim_status",
    columns.has('claimed_auth_user_id') ? 'claimed_auth_user_id' : 'NULL AS claimed_auth_user_id',
    columns.has('created_source') ? 'created_source' : "'hospital' AS created_source",
  ].join(', ');

  const lookups: Array<{ sql: string; value: string | null | undefined }> = [
    {
      sql: `SELECT ${selectColumns}
            FROM global_patient_identity
            WHERE uhid = ?`,
      value: input.uhid,
    },
    {
      sql: `SELECT ${selectColumns}
            FROM global_patient_identity
            WHERE national_id = ?`,
      value: input.nationalId,
    },
    {
      sql: `SELECT ${selectColumns}
            FROM global_patient_identity
            WHERE brn = ?`,
      value: columns.has('brn') ? input.brn : null,
    },
  ];

  const activeLookups = lookups.filter(lookup => lookup.value);
  if (activeLookups.length === 0) return null;

  const statements = activeLookups.map(lookup =>
    db.prepare(lookup.sql).bind(lookup.value)
  );

  const batchResults = await db.batch<{
    id: number;
    uhid: string;
    claim_status: string | null;
    claimed_auth_user_id: number | null;
    created_source: string | null;
  }>(statements);

  for (const result of batchResults) {
    const row = result.results?.[0];
    if (row) {
      return {
        id: row.id,
        uhid: row.uhid,
        claimStatus: row.claim_status ?? 'unclaimed',
        claimedAuthUserId: row.claimed_auth_user_id ?? null,
        createdSource: row.created_source ?? 'hospital',
        created: false,
      };
    }
  }

  return null;
}

export async function createGlobalIdentity(
  db: D1Database,
  input: ResolveGlobalIdentityInput,
): Promise<GlobalIdentityRecord> {
  if (input.nationalId) {
    const validation = validateBDNationalId(input.nationalId);
    if (!validation.valid) {
      throw new Error(validation.error ?? 'Invalid National ID');
    }
  }

  const uhid = createReadableGlobalUid();
  const claimStatus = 'unclaimed';
  const createdSource = input.source ?? 'hospital';
  const columns = await getTableColumns(db, 'global_patient_identity');

  const insertColumns = [
    'national_id',
    'uhid',
    'primary_name',
    'primary_phone',
    'primary_email',
  ];
  const insertValues: Array<string | null> = [
    input.nationalId ?? null,
    uhid,
    input.name ?? null,
    input.phone ?? null,
    input.email ?? null,
  ];

  if (columns.has('brn')) {
    insertColumns.push('brn');
    insertValues.push(input.brn ?? null);
  }
  if (columns.has('claim_status')) {
    insertColumns.push('claim_status');
    insertValues.push(claimStatus);
  }
  if (columns.has('created_source')) {
    insertColumns.push('created_source');
    insertValues.push(createdSource);
  }
  if (columns.has('created_tenant_id')) {
    insertColumns.push('created_tenant_id');
    insertValues.push(input.tenantId ?? null);
  }
  if (columns.has('date_of_birth')) {
    insertColumns.push('date_of_birth');
    insertValues.push(input.dateOfBirth ?? null);
  }
  if (columns.has('gender')) {
    insertColumns.push('gender');
    insertValues.push(input.gender ?? null);
  }

  const insert = await db.prepare(`
    INSERT INTO global_patient_identity (
      ${insertColumns.join(', ')}
    ) VALUES (${insertColumns.map(() => '?').join(', ')})
  `).bind(...insertValues).run();

  return {
    id: Number(insert.meta.last_row_id),
    uhid,
    claimStatus,
    claimedAuthUserId: null,
    createdSource,
    created: true,
  };
}

export async function resolveOrCreateGlobalIdentity(
  db: D1Database,
  input: ResolveGlobalIdentityInput,
): Promise<GlobalIdentityRecord> {
  const existing = await findExistingIdentity(db, input);
  if (existing) return existing;
  return createGlobalIdentity(db, input);
}

export async function claimGlobalIdentity(
  db: D1Database,
  identityId: number,
  authUserId: number,
): Promise<void> {
  const columns = await getTableColumns(db, 'global_patient_identity');
  const updates: string[] = [];
  const values: Array<number | string> = [];

  if (columns.has('claim_status')) {
    updates.push("claim_status = 'claimed'");
  }
  if (columns.has('claimed_auth_user_id')) {
    updates.push('claimed_auth_user_id = ?');
    values.push(authUserId);
  }
  if (columns.has('claimed_at')) {
    updates.push("claimed_at = datetime('now')");
  }

  if (updates.length === 0) return;

  await db.prepare(`
    UPDATE global_patient_identity
    SET ${updates.join(', ')}
    WHERE id = ?
  `).bind(...values, identityId).run();
}
