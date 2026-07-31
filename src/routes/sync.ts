import { Hono, type Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { Env, Variables } from '../types';
import {
  MIGRATIONS,
  MIGRATIONS_VERSION,
  MIGRATIONS_CHECKSUM,
  MIGRATIONS_R2_KEY,
} from '../data/schema-migrations.generated';
import { hashLocalSyncPayload } from '../lib/local-sync-outbox';
import { isSchemaManifestArtifactCompatible } from '../lib/schema-manifest-artifact-contract';
import { supportsLocalSyncCloudApply } from '../lib/local-sync-coverage';
import {
  getSyncEntityMappingByLocal,
  persistSyncEntityMappings,
  type SyncEntityMapping,
} from '../lib/local-sync-entity-mappings';
import {
  recoverLegacyAppliedPatientMapping,
  resolveMappedCloudPatientId,
  translatePatientSnapshotRows,
  upsertMappedCloudPatient,
} from '../lib/local-sync-patient-mapping';
import { assertPatientSnapshotIdentitySafe } from '../lib/local-sync-patient-safety';
import { normalizeBangladeshMobile } from '../lib/bangladesh-phone';
import { normalizeUploadKey } from '../lib/upload-objects';

const syncRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
type SyncContext = Context<{ Bindings: Env; Variables: Variables }>;

const MAX_EVENTS_PER_BATCH = 100;

const syncEventSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(256),
  tenantId: z.string().trim().min(1).max(64),
  entityType: z.string().trim().min(1).max(80),
  entityId: z.string().trim().min(1).max(128),
  operation: z.enum(['create', 'update', 'delete', 'upsert']),
  payloadHash: z.string().regex(/^[a-fA-F0-9]{64}$/),
  payload: z.record(z.string(), z.unknown()).optional(),
});

const ingestSchema = z.object({
  serverId: z.string().trim().min(1).max(128),
  batchId: z.string().trim().min(1).max(128),
  events: z.array(syncEventSchema).min(1).max(MAX_EVENTS_PER_BATCH),
});

const syncEntityMappingSchema = z.object({
  serverId: z.string().trim().min(1).max(128),
  tenantId: z.string().trim().min(1).max(64),
  entityType: z.string().trim().min(1).max(80),
  localEntityId: z.string().trim().min(1).max(128),
  cloudEntityId: z.string().trim().min(1).max(128),
  naturalKey: z.string().trim().max(256).nullable().optional(),
});

const ingestResponseSchema = z.object({
  entityMappings: z.array(syncEntityMappingSchema).default([]),
}).passthrough();

const globalPatientLookupSchema = z.object({
  tenantId: z.string().trim().min(1).max(64),
  q: z.string().trim().min(2).max(80),
});

const uploadFetchSchema = z.object({
  key: z.string().trim().min(1).max(500),
});

const tenantSnapshotQuerySchema = z.object({
  tenantId: z.string().trim().min(1).max(64),
  tables: z.string().trim().max(2000).optional(),
  limit: z.coerce.number().int().min(1).max(50000).default(50000),
});

const tenantSnapshotTableSchema = z.object({
  name: z.string().trim().min(1).max(80),
  primaryKey: z.string().trim().min(1).max(80),
  rows: z.array(z.record(z.string(), z.unknown())).max(50000),
});

const tenantSnapshotSchema = z.object({
  tenantId: z.string().trim().min(1).max(64),
  snapshotId: z.string().trim().min(1).max(128),
  generatedAt: z.string().trim().min(1).max(80),
  tables: z.array(tenantSnapshotTableSchema).max(120),
});

type LocalOutboxRow = {
  id: number;
  tenant_id: string;
  entity_type: string;
  entity_id: string;
  operation: 'create' | 'update' | 'delete' | 'upsert';
  payload_hash: string;
  payload_json: string | null;
  idempotency_key: string;
};

type TableInfoRow = {
  name: string;
  pk?: number;
};

const DEFAULT_CLOUD_PULL_TABLES = [
  'tenants',
  'settings',
  'users',
  'doctors',
  'doctor_appointment_fees',
  'doctor_commission_rules',
  'billing_service_departments',
  'billing_service_items',
  'payment_methods',
  'patients',
  'global_patient_identity',
  'patient_health_links',
  'beds',
  'admissions',
  'visits',
  'appointments',
  'queue_entries',
  'queue_token_counters',
  'bills',
  'invoice_items',
  'payments',
  'billing_deposits',
  'billing_provisional_items',
  'ipd_doctor_rounds',
  'lab_test_categories',
  'lab_test_catalog',
  'lab_test_components',
  'lab_reference_ranges',
  'radiology_imaging_types',
  'radiology_imaging_items',
  'website_config',
  'website_gallery',
  'website_services',
  'website_blog_posts',
  'website_reviews',
  'website_departments',
] as const;

const CLOUD_PULL_TABLES = new Set<string>(DEFAULT_CLOUD_PULL_TABLES);

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function getBearerToken(authorization: string | undefined): string | null {
  if (!authorization?.startsWith('Bearer ')) return null;
  const token = authorization.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

function authorizeSyncRequest(c: SyncContext) {
  const configuredToken = c.env.CLOUD_SYNC_TOKEN?.trim();
  if (!configuredToken) {
    return c.json({ error: 'Cloud sync is not configured' }, 503);
  }

  const suppliedToken = getBearerToken(c.req.header('Authorization'));
  if (!suppliedToken || !constantTimeEqual(suppliedToken, configuredToken)) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  return null;
}

function buildIdPlaceholders(ids: number[]) {
  return ids.map(() => '?').join(', ');
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function parseRequestedTables(rawTables?: string): string[] {
  const requested = rawTables
    ? rawTables.split(',').map((table) => table.trim()).filter(Boolean)
    : [...DEFAULT_CLOUD_PULL_TABLES];

  const unique = [...new Set(requested)];
  return unique.filter((table) => CLOUD_PULL_TABLES.has(table));
}

async function getTableInfo(c: SyncContext, tableName: string): Promise<TableInfoRow[]> {
  const { results } = await c.env.DB
    .prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`)
    .all<TableInfoRow>();
  return results ?? [];
}

function getPrimaryKey(tableInfo: TableInfoRow[]): string {
  return tableInfo.find((column) => Number(column.pk ?? 0) > 0)?.name ?? 'id';
}

function buildTenantSnapshotWhereClause(
  tableName: string,
  tableInfo: TableInfoRow[],
  tenantId: string,
): { where: string; params: unknown[] } | null {
  const columns = new Set(tableInfo.map((column) => column.name));

  if (tableName === 'tenants' && columns.has('id')) {
    return { where: `${quoteIdentifier('id')} = ?`, params: [tenantId] };
  }

  if (columns.has('tenant_id')) {
    return { where: `${quoteIdentifier('tenant_id')} = ?`, params: [tenantId] };
  }

  if (tableName === 'global_patient_identity' && columns.has('uhid')) {
    const related = [
      `${quoteIdentifier('uhid')} IN (
        SELECT DISTINCT ${quoteIdentifier('uhid')}
        FROM ${quoteIdentifier('patient_health_links')}
        WHERE ${quoteIdentifier('tenant_id')} = ?
          AND ${quoteIdentifier('uhid')} IS NOT NULL
      )`,
    ];
    const params: unknown[] = [tenantId];
    if (columns.has('created_tenant_id')) {
      related.push(`${quoteIdentifier('created_tenant_id')} = ?`);
      params.push(tenantId);
    }
    return { where: related.join(' OR '), params };
  }

  return null;
}

function rowBelongsToTenant(tableName: string, row: Record<string, unknown>, tenantId: string): boolean {
  if (tableName === 'tenants') return String(row.id ?? '') === tenantId;
  if (row.tenant_id !== undefined && row.tenant_id !== null) return String(row.tenant_id) === tenantId;
  return tableName === 'global_patient_identity';
}

function filterRowToColumns(row: Record<string, unknown>, localColumns: Set<string>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).filter(([column, value]) => localColumns.has(column) && value !== undefined),
  );
}

async function ensureLocalCloudPullTables(c: SyncContext) {
  await c.env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS local_cloud_pull_state (
      tenant_id TEXT NOT NULL,
      table_name TEXT NOT NULL,
      last_snapshot_id TEXT,
      last_pulled_at DATETIME,
      rows_received INTEGER NOT NULL DEFAULT 0,
      rows_applied INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      last_error TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, table_name)
    )
  `).run();

  await c.env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS local_cloud_pull_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      snapshot_id TEXT,
      table_name TEXT,
      event TEXT NOT NULL,
      rows_received INTEGER NOT NULL DEFAULT 0,
      rows_applied INTEGER NOT NULL DEFAULT 0,
      message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
}

async function recordCloudPullState(
  c: SyncContext,
  tenantId: string,
  snapshotId: string,
  tableName: string,
  status: 'applied' | 'failed' | 'skipped',
  rowsReceived: number,
  rowsApplied: number,
  error?: string,
) {
  await c.env.DB.prepare(`
    INSERT OR REPLACE INTO local_cloud_pull_state (
      tenant_id,
      table_name,
      last_snapshot_id,
      last_pulled_at,
      rows_received,
      rows_applied,
      status,
      last_error,
      updated_at
    ) VALUES (?, ?, ?, datetime('now'), ?, ?, ?, ?, datetime('now'))
  `).bind(
    tenantId,
    tableName,
    snapshotId,
    rowsReceived,
    rowsApplied,
    status,
    error ? error.slice(0, 500) : null,
  ).run();

  await c.env.DB.prepare(`
    INSERT INTO local_cloud_pull_log (
      tenant_id,
      snapshot_id,
      table_name,
      event,
      rows_received,
      rows_applied,
      message
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId,
    snapshotId,
    tableName,
    status,
    rowsReceived,
    rowsApplied,
    error ? error.slice(0, 500) : null,
  ).run();
}

const IPD_ROUND_CORE_FIELDS = [
  'admission_id',
  'patient_id',
  'doctor_id',
  'rounded_at',
  'doctor_name_snapshot',
  'round_fee_snapshot',
  'entry_source',
  'entered_by',
  'idempotency_key',
  'status',
] as const;

const IPD_ROUND_SIGNED_FIELDS = [
  ...IPD_ROUND_CORE_FIELDS,
  'clinical_status',
  'signed_by',
  'signed_at',
  'round_summary',
  'patient_condition',
] as const;

function syncValuesEqual(left: unknown, right: unknown): boolean {
  if (left === null || left === undefined) return right === null || right === undefined;
  if (right === null || right === undefined) return false;
  if (typeof left === 'number' || typeof right === 'number') {
    const leftNumber = Number(left);
    const rightNumber = Number(right);
    return Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber === rightNumber;
  }
  return String(left) === String(right);
}

function fieldsMatch(
  incoming: Record<string, unknown>,
  existing: Record<string, unknown>,
  fields: readonly string[],
): boolean {
  return fields.every((field) => Object.prototype.hasOwnProperty.call(incoming, field)
    && syncValuesEqual(incoming[field], existing[field]));
}

async function findProtectedIpdRoundSnapshotRows(
  c: SyncContext,
  tenantId: string,
  rows: Record<string, unknown>[],
  localColumns: Set<string>,
): Promise<Set<string>> {
  if (!localColumns.has('id') || !localColumns.has('clinical_status') || !localColumns.has('signed_at')) {
    throw new Error('Local IPD doctor-round schema is missing signed-record safety columns');
  }

  const incomingById = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    if (!rowBelongsToTenant('ipd_doctor_rounds', row, tenantId)) continue;
    if (row.id === null || row.id === undefined) continue;
    incomingById.set(String(row.id), row);
  }
  if (incomingById.size === 0) return new Set();

  const existingById = new Map<string, Record<string, unknown>>();
  const ids = [...incomingById.keys()];
  const selectColumns = [
    'id',
    ...IPD_ROUND_SIGNED_FIELDS.filter((field) => localColumns.has(field)),
    ...(localColumns.has('clinical_note_id') ? ['clinical_note_id'] : []),
  ];

  for (let offset = 0; offset < ids.length; offset += 100) {
    const chunk = ids.slice(offset, offset + 100);
    const placeholders = chunk.map(() => '?').join(', ');
    const { results } = await c.env.DB.prepare(`
      SELECT ${selectColumns.map(quoteIdentifier).join(', ')}
      FROM ipd_doctor_rounds
      WHERE tenant_id = ? AND id IN (${placeholders})
    `).bind(tenantId, ...chunk).all<Record<string, unknown>>();
    for (const row of results ?? []) existingById.set(String(row.id), row);
  }

  const immutableNoopIds = new Set<string>();
  for (const [id, incoming] of incomingById) {
    const existing = existingById.get(id);
    const incomingClinicalStatus = coerceString(incoming.clinical_status) ?? 'billing_only';
    const incomingHasClinicalLink = incomingClinicalStatus === 'documented'
      || incomingClinicalStatus === 'signed'
      || coerceNumber(incoming.clinical_note_id) !== null
      || coerceString(incoming.signed_at) !== null;

    if (!existing) {
      if (incomingHasClinicalLink) {
        throw new Error(`Signed or documented IPD round ${id} requires explicit clinical-note reconciliation`);
      }
      continue;
    }

    const existingIsSigned = coerceString(existing.clinical_status) === 'signed'
      || coerceString(existing.signed_at) !== null;
    if (!existingIsSigned) {
      if (incomingHasClinicalLink) {
        throw new Error(`IPD round ${id} clinical state conflicts with the local unsigned round`);
      }
      continue;
    }

    const coreMatches = fieldsMatch(incoming, existing, IPD_ROUND_CORE_FIELDS);
    const stalePreSignReplay = coreMatches
      && incomingClinicalStatus === 'billing_only'
      && coerceNumber(incoming.clinical_note_id) === null
      && coerceNumber(incoming.signed_by) === null
      && coerceString(incoming.signed_at) === null
      && coerceString(incoming.round_summary) === null
      && coerceString(incoming.patient_condition) === null;
    const exactSignedReplay = incomingClinicalStatus === 'signed'
      && fieldsMatch(incoming, existing, IPD_ROUND_SIGNED_FIELDS);

    if (!stalePreSignReplay && !exactSignedReplay) {
      throw new Error(`Signed IPD round ${id} differs from the cloud snapshot and requires clinical review`);
    }
    immutableNoopIds.add(id);
  }

  return immutableNoopIds;
}

async function applyCloudSnapshot(c: SyncContext, snapshot: z.infer<typeof tenantSnapshotSchema>) {
  await ensureLocalCloudPullTables(c);

  let appliedTables = 0;
  let skippedTables = 0;
  let appliedRows = 0;
  const failures: Array<{ table: string; error: string }> = [];

  for (const table of snapshot.tables) {
    if (!CLOUD_PULL_TABLES.has(table.name)) {
      skippedTables += 1;
      await recordCloudPullState(c, snapshot.tenantId, snapshot.snapshotId, table.name, 'skipped', table.rows.length, 0, 'table is not allowed');
      continue;
    }

    try {
      const tableInfo = await getTableInfo(c, table.name);
      const localColumns = new Set(tableInfo.map((column) => column.name));
      if (localColumns.size === 0) {
        skippedTables += 1;
        await recordCloudPullState(c, snapshot.tenantId, snapshot.snapshotId, table.name, 'skipped', table.rows.length, 0, 'local table is missing');
        continue;
      }

      let sourceRows = table.rows;
      let patientMappings: SyncEntityMapping[] = [];
      if (table.name === 'patients') {
        const localServerId = c.env.LOCAL_SERVER_ID?.trim();
        if (!localServerId) throw new Error('Local server ID is required for patient snapshot mapping');
        const translated = await translatePatientSnapshotRows(c.env.DB, {
          serverId: localServerId,
          tenantId: snapshot.tenantId,
          rows: table.rows,
        });
        sourceRows = translated.rows;
        patientMappings = translated.mappings;
        await assertPatientSnapshotIdentitySafe(c.env.DB, snapshot.tenantId, sourceRows);
      }

      const protectedNoopIds = table.name === 'ipd_doctor_rounds'
        ? await findProtectedIpdRoundSnapshotRows(c, snapshot.tenantId, sourceRows, localColumns)
        : new Set<string>();

      const statements: D1PreparedStatement[] = [];
      let tableRowsApplied = 0;
      for (const rawRow of sourceRows) {
        if (!rowBelongsToTenant(table.name, rawRow, snapshot.tenantId)) continue;
        if (table.name === 'ipd_doctor_rounds' && protectedNoopIds.has(String(rawRow.id))) continue;
        const row = filterRowToColumns(rawRow, localColumns);
        if (table.name === 'ipd_doctor_rounds') delete row.clinical_note_id;
        const columns = Object.keys(row);
        if (columns.length === 0) continue;

        const columnSql = columns.map(quoteIdentifier).join(', ');
        const placeholders = columns.map(() => '?').join(', ');
        statements.push(
          c.env.DB
            .prepare(`INSERT OR REPLACE INTO ${quoteIdentifier(table.name)} (${columnSql}) VALUES (${placeholders})`)
            .bind(...columns.map((column) => row[column])),
        );
        tableRowsApplied += 1;

        if (statements.length >= 50) {
          await c.env.DB.batch(statements.splice(0, statements.length));
        }
      }

      if (statements.length > 0) {
        await c.env.DB.batch(statements);
      }
      if (patientMappings.length > 0) {
        await persistSyncEntityMappings(c.env.DB, patientMappings);
      }

      appliedTables += 1;
      appliedRows += tableRowsApplied;
      await recordCloudPullState(c, snapshot.tenantId, snapshot.snapshotId, table.name, 'applied', table.rows.length, tableRowsApplied);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ table: table.name, error: message });
      await recordCloudPullState(c, snapshot.tenantId, snapshot.snapshotId, table.name, 'failed', table.rows.length, 0, message);
    }
  }

  return {
    snapshotId: snapshot.snapshotId,
    appliedTables,
    appliedRows,
    skippedTables,
    failedTables: failures.length,
    failures,
  };
}

async function validatePayloadHash(event: z.infer<typeof syncEventSchema>): Promise<boolean> {
  if (event.payload === undefined) return true;
  const actual = await hashLocalSyncPayload(event.payload);
  return constantTimeEqual(actual.toLowerCase(), event.payloadHash.toLowerCase());
}

function coerceString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function coerceNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function buildGlobalPatientSearchParams(rawQuery: string) {
  const query = rawQuery.trim();
  const normalizedMobile = normalizeBangladeshMobile(query);
  const digits = query.replace(/\D/g, '');
  const phoneTail = digits.length >= 6 ? digits.slice(-10) : null;
  const phoneTailPattern = phoneTail ? `%${phoneTail}%` : null;
  const searchPattern = `%${query}%`;

  return {
    query,
    normalizedMobile,
    searchPattern,
    phoneTailPattern,
  };
}

async function queryGlobalPatientMatches(c: SyncContext, tenantId: string, rawQuery: string) {
  const { query, normalizedMobile, searchPattern, phoneTailPattern } = buildGlobalPatientSearchParams(rawQuery);
  const { results } = await c.env.DB.prepare(`
    SELECT
      gpi.uhid,
      gpi.primary_name,
      gpi.primary_phone,
      gpi.primary_email,
      gpi.date_of_birth,
      gpi.gender,
      gpi.claim_status,
      gpi.blood_group,
      gpi.national_id,
      phl.patient_id AS linked_patient_id
    FROM global_patient_identity gpi
    LEFT JOIN patient_health_links phl
      ON phl.uhid = gpi.uhid
     AND phl.tenant_id = ?
     AND COALESCE(phl.is_active, 1) = 1
    WHERE
      gpi.primary_phone = ?
      OR (? IS NOT NULL AND gpi.primary_phone = ?)
      OR (? IS NOT NULL AND gpi.primary_phone LIKE ?)
      OR gpi.primary_name LIKE ?
      OR gpi.uhid = ?
      OR gpi.national_id = ?
    ORDER BY
      CASE
        WHEN gpi.primary_phone = ? THEN 0
        WHEN ? IS NOT NULL AND gpi.primary_phone = ? THEN 1
        WHEN ? IS NOT NULL AND gpi.primary_phone LIKE ? THEN 2
        ELSE 3
      END,
      gpi.updated_at DESC
    LIMIT 10
  `).bind(
    tenantId,
    query,
    normalizedMobile,
    normalizedMobile,
    phoneTailPattern,
    phoneTailPattern,
    searchPattern,
    query,
    query,
    query,
    normalizedMobile,
    normalizedMobile,
    phoneTailPattern,
    phoneTailPattern,
  ).all<Record<string, unknown>>();

  return results ?? [];
}

async function applyMedicineCatalogEntry(c: SyncContext, payload: Record<string, unknown>): Promise<boolean> {
  const brandName = coerceString(payload.brand_name ?? payload.name);
  if (!brandName) return false;

  const genericName = coerceString(payload.generic_name ?? payload.generic);
  const manufacturer = coerceString(payload.manufacturer);
  const strength = coerceString(payload.strength);
  const dosageForm = coerceString(payload.dosage_form ?? payload.form);

  let genericId: number | null = null;
  if (genericName) {
    const existingGeneric = await c.env.DB.prepare('SELECT id FROM master_generics WHERE name = ? COLLATE NOCASE')
      .bind(genericName)
      .first<{ id: number }>();
    genericId = existingGeneric?.id ?? (await c.env.DB.prepare('INSERT INTO master_generics (name) VALUES (?) RETURNING id')
      .bind(genericName)
      .first<{ id: number }>())?.id ?? null;
  }

  let companyId: number | null = null;
  if (manufacturer) {
    const existingCompany = await c.env.DB.prepare('SELECT id FROM master_companies WHERE name = ? COLLATE NOCASE')
      .bind(manufacturer)
      .first<{ id: number }>();
    companyId = existingCompany?.id ?? (await c.env.DB.prepare('INSERT INTO master_companies (name) VALUES (?) RETURNING id')
      .bind(manufacturer)
      .first<{ id: number }>())?.id ?? null;
  }

  await c.env.DB.prepare(`
    INSERT INTO master_drugs (brand_name, generic_id, company_id, form, strength)
    SELECT ?, ?, ?, ?, ? WHERE NOT EXISTS (
      SELECT 1 FROM master_drugs
      WHERE brand_name = ? COLLATE NOCASE
        AND COALESCE(form, '') = COALESCE(?, '') COLLATE NOCASE
        AND COALESCE(strength, '') = COALESCE(?, '') COLLATE NOCASE
    )
  `).bind(
    brandName,
    genericId,
    companyId,
    dosageForm,
    strength,
    brandName,
    dosageForm,
    strength,
  ).run();

  return true;
}

async function decodeGzipUtf8(buffer: ArrayBuffer): Promise<string> {
  const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

async function applyKnownSyncEvent(
  c: SyncContext,
  event: z.infer<typeof syncEventSchema>,
  serverId: string,
  entityMappings: SyncEntityMapping[],
): Promise<boolean> {
  if (event.payload === undefined) return false;

  if (event.entityType === 'ipd_doctor_round') {
    const payload = event.payload;
    const tenantId = coerceString(payload.tenant_id ?? event.tenantId);
    const admissionId = coerceNumber(payload.admission_id);
    const patientId = coerceNumber(payload.patient_id);
    const doctorId = coerceNumber(payload.doctor_id);
    const roundedAt = coerceString(payload.rounded_at);
    const doctorName = coerceString(payload.doctor_name_snapshot);
    const roundFee = coerceNumber(payload.round_fee_snapshot);
    const entrySource = coerceString(payload.entry_source);
    const enteredBy = coerceNumber(payload.entered_by);
    const roundKey = coerceString(payload.idempotency_key ?? event.entityId);
    if (
      !tenantId || tenantId !== event.tenantId || !admissionId || !patientId || !doctorId
      || !roundedAt || !doctorName || !roundFee || roundFee <= 0 || !enteredBy || !roundKey
      || !['nurse_station', 'ipd_billing', 'doctor_dashboard'].includes(entrySource ?? '')
    ) return false;

    const rawClinicalStatus = coerceString(payload.clinical_status);
    const clinicalStatus = rawClinicalStatus && ['billing_only', 'documented', 'signed', 'cancelled'].includes(rawClinicalStatus)
      ? rawClinicalStatus
      : null;
    const roundStatus = coerceString(payload.status) === 'cancelled' ? 'cancelled' : 'active';
    const signedBy = coerceNumber(payload.signed_by);
    const signedAt = coerceString(payload.signed_at);
    const roundSummary = coerceString(payload.round_summary);
    const patientCondition = coerceString(payload.patient_condition);
    const clinicalNoteIdempotencyKey = coerceString(payload.clinical_note_idempotency_key);

    const existingRound = await c.env.DB.prepare(
      'SELECT id, admission_id, patient_id, doctor_id, rounded_at, ' +
      'doctor_name_snapshot, round_fee_snapshot, entry_source, entered_by, ' +
      'idempotency_key, status, clinical_status, signed_by, signed_at, ' +
      'round_summary, patient_condition ' +
      'FROM ipd_doctor_rounds WHERE tenant_id = ? AND idempotency_key = ? LIMIT 1',
    ).bind(tenantId, roundKey).first<{
      id: number;
      admission_id: number;
      patient_id: number;
      doctor_id: number;
      rounded_at: string;
      doctor_name_snapshot: string;
      round_fee_snapshot: number;
      entry_source: string;
      entered_by: number;
      idempotency_key: string;
      status: string;
      clinical_status: string | null;
      signed_by: number | null;
      signed_at: string | null;
      round_summary: string | null;
      patient_condition: string | null;
    }>();

    if (existingRound && (existingRound.clinical_status === 'signed' || existingRound.signed_at)) {
      const coreMatches = Number(existingRound.admission_id) === admissionId
        && Number(existingRound.patient_id) === patientId
        && Number(existingRound.doctor_id) === doctorId
        && String(existingRound.rounded_at) === roundedAt
        && String(existingRound.doctor_name_snapshot) === doctorName
        && Number(existingRound.round_fee_snapshot) === roundFee
        && String(existingRound.entry_source) === entrySource
        && Number(existingRound.entered_by) === enteredBy
        && String(existingRound.idempotency_key) === roundKey
        && String(existingRound.status) === roundStatus;
      const stalePreSignReplay = clinicalStatus == null
        && signedBy == null
        && signedAt == null
        && roundSummary == null
        && patientCondition == null
        && roundStatus === 'active';
      const exactSignedReplay = clinicalStatus === 'signed'
        && Number(existingRound.signed_by) === signedBy
        && String(existingRound.signed_at ?? '') === String(signedAt ?? '')
        && (existingRound.round_summary ?? null) === roundSummary
        && (existingRound.patient_condition ?? null) === patientCondition;

      if (!coreMatches || roundStatus === 'cancelled' || (!stalePreSignReplay && !exactSignedReplay)) {
        throw new HTTPException(409, {
          message: 'Signed IPD doctor round sync conflict requires clinical review',
        });
      }

      return true;
    }

    let clinicalNoteId: number | null = null;
    if (clinicalNoteIdempotencyKey) {
      const note = await c.env.DB.prepare(`
        SELECT id
        FROM clinical_notes
        WHERE tenant_id = ? AND patient_id = ? AND idempotency_key = ?
        ORDER BY id DESC
        LIMIT 1
      `).bind(
        tenantId,
        patientId,
        clinicalNoteIdempotencyKey,
      ).first<{ id: number }>();
      clinicalNoteId = note?.id ? Number(note.id) : null;
    }

    await c.env.DB.prepare(`
      INSERT INTO ipd_doctor_rounds (
        tenant_id, admission_id, patient_id, doctor_id, rounded_at,
        doctor_name_snapshot, round_fee_snapshot, entry_source, entered_by,
        idempotency_key, status,
        clinical_note_id, clinical_status, signed_by, signed_at,
        round_summary, patient_condition
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, 'billing_only'), ?, ?, ?, ?)
      ON CONFLICT(tenant_id, idempotency_key) DO UPDATE SET
        admission_id = excluded.admission_id,
        patient_id = excluded.patient_id,
        doctor_id = excluded.doctor_id,
        rounded_at = excluded.rounded_at,
        doctor_name_snapshot = excluded.doctor_name_snapshot,
        round_fee_snapshot = excluded.round_fee_snapshot,
        entry_source = excluded.entry_source,
        status = excluded.status,
        clinical_note_id = COALESCE(excluded.clinical_note_id, ipd_doctor_rounds.clinical_note_id),
        clinical_status = COALESCE(?, ipd_doctor_rounds.clinical_status),
        signed_by = COALESCE(excluded.signed_by, ipd_doctor_rounds.signed_by),
        signed_at = COALESCE(excluded.signed_at, ipd_doctor_rounds.signed_at),
        round_summary = COALESCE(excluded.round_summary, ipd_doctor_rounds.round_summary),
        patient_condition = COALESCE(excluded.patient_condition, ipd_doctor_rounds.patient_condition),
        updated_at = datetime('now', '+6 hours')
      WHERE COALESCE(ipd_doctor_rounds.clinical_status, '') <> 'signed'
        AND ipd_doctor_rounds.signed_at IS NULL
    `).bind(
      tenantId, admissionId, patientId, doctorId, roundedAt, doctorName,
      roundFee, entrySource, enteredBy, roundKey,
      roundStatus,
      clinicalNoteId, clinicalStatus, signedBy, signedAt, roundSummary, patientCondition,
      clinicalStatus,
    ).run();
    return true;
  }

  if (event.entityType === 'billing_provisional_doctor_round') {
    const payload = event.payload;
    const tenantId = coerceString(payload.tenant_id ?? event.tenantId);
    const admissionId = coerceNumber(payload.admission_id);
    const patientId = coerceNumber(payload.patient_id);
    const doctorId = coerceNumber(payload.doctor_id);
    const doctorName = coerceString(payload.doctor_name);
    const itemName = coerceString(payload.item_name);
    const unitPrice = coerceNumber(payload.unit_price);
    const roundKey = coerceString(payload.round_idempotency_key ?? event.entityId);
    if (
      !tenantId || tenantId !== event.tenantId || !admissionId || !patientId || !doctorId
      || !doctorName || !itemName || !unitPrice || unitPrice <= 0 || !roundKey
    ) return false;

    const round = await c.env.DB.prepare(`
      SELECT id FROM ipd_doctor_rounds
      WHERE tenant_id = ? AND idempotency_key = ?
    `).bind(tenantId, roundKey).first<{ id: number }>();
    if (!round) return false;

    if (coerceString(payload.bill_status) === 'cancelled') {
      await c.env.DB.batch([
        c.env.DB.prepare(`
          UPDATE ipd_doctor_rounds
          SET status = 'cancelled', cancel_reason = ?, cancelled_by = ?,
            cancelled_at = datetime('now', '+6 hours'), updated_at = datetime('now', '+6 hours')
          WHERE id = ? AND tenant_id = ?
        `).bind(
          coerceString(payload.cancel_reason) ?? 'Cancelled by local server',
          coerceNumber(payload.cancelled_by), round.id, tenantId,
        ),
        c.env.DB.prepare(`
          UPDATE billing_provisional_items
          SET bill_status = 'cancelled', cancel_reason = ?, cancelled_by = ?,
            cancelled_at = datetime('now', '+6 hours')
          WHERE tenant_id = ? AND item_category = 'doctor_round'
            AND reference_id = ? AND bill_status = 'provisional'
        `).bind(
          coerceString(payload.cancel_reason) ?? 'Cancelled by local server',
          coerceNumber(payload.cancelled_by), tenantId, round.id,
        ),
      ]);
      return true;
    }

    await c.env.DB.batch([
      c.env.DB.prepare(`
        INSERT INTO billing_provisional_items (
          tenant_id, patient_id, admission_id, item_category, item_name,
          department, unit_price, quantity, discount_percent, discount_amount,
          total_amount, doctor_id, doctor_name, reference_id, bill_status,
          is_insurance, is_active, created_by, created_at
        ) SELECT ?, ?, ?, 'doctor_round', ?, 'Doctor Round', ?, 1, 0, 0,
          ?, ?, ?, ?, 'provisional', 0, 1, ?, datetime('now', '+6 hours')
        WHERE NOT EXISTS (
          SELECT 1 FROM billing_provisional_items
          WHERE tenant_id = ? AND item_category = 'doctor_round' AND reference_id = ?
        )
      `).bind(
        tenantId, patientId, admissionId, itemName, unitPrice, unitPrice,
        doctorId, doctorName, round.id, coerceNumber(payload.created_by) ?? 0,
        tenantId, round.id,
      ),
      c.env.DB.prepare(`
        UPDATE ipd_doctor_rounds
        SET provisional_item_id = (
          SELECT id FROM billing_provisional_items
          WHERE tenant_id = ? AND item_category = 'doctor_round' AND reference_id = ?
          ORDER BY id DESC LIMIT 1
        ), updated_at = datetime('now', '+6 hours')
        WHERE id = ? AND tenant_id = ?
      `).bind(tenantId, round.id, round.id, tenantId),
    ]);
    return true;
  }

  if (event.entityType === 'patients') {
    const payload = event.payload;
    const localPatientId = coerceNumber(payload.id ?? event.entityId);
    const tenantId = coerceString(payload.tenant_id ?? event.tenantId);
    if (!localPatientId || !tenantId || tenantId !== event.tenantId) return false;

    const result = await upsertMappedCloudPatient(c.env.DB, {
      serverId,
      tenantId,
      localPatientId,
      payload: {
        name: coerceString(payload.name) ?? 'UNKNOWN',
        fatherHusband: coerceString(payload.father_husband) ?? '',
        address: coerceString(payload.address) ?? '',
        mobile: coerceString(payload.mobile),
        email: coerceString(payload.email),
        patientCode: coerceString(payload.patient_code),
        uhid: coerceString(payload.uhid),
        nationalId: coerceString(payload.national_id),
        dateOfBirth: coerceString(payload.date_of_birth),
        gender: coerceString(payload.gender),
        age: coerceNumber(payload.age),
        createdAt: coerceString(payload.created_at),
      },
    });
    entityMappings.push(result.mapping);
    return true;
  }

  if (event.entityType === 'global_patient_identity') {
    const payload = event.payload;
    const uhid = coerceString(payload.uhid ?? event.entityId);
    if (!uhid) return false;

    await c.env.DB.prepare(`
      INSERT INTO global_patient_identity (
        uhid, national_id, primary_name, primary_phone, primary_email,
        date_of_birth, gender, blood_group, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(uhid) DO UPDATE SET
        national_id = excluded.national_id,
        primary_name = excluded.primary_name,
        primary_phone = excluded.primary_phone,
        primary_email = excluded.primary_email,
        date_of_birth = excluded.date_of_birth,
        gender = excluded.gender,
        blood_group = excluded.blood_group,
        updated_at = datetime('now')
    `).bind(
      uhid,
      coerceString(payload.national_id),
      coerceString(payload.primary_name),
      coerceString(payload.primary_phone),
      coerceString(payload.primary_email),
      coerceString(payload.date_of_birth),
      coerceString(payload.gender),
      coerceString(payload.blood_group),
    ).run();
    return true;
  }

  if (event.entityType === 'patient_health_links') {
    const payload = event.payload;
    const tenantId = coerceString(payload.tenant_id ?? event.tenantId);
    const localPatientId = coerceNumber(payload.patient_id);
    const uhid = coerceString(payload.uhid);
    if (!tenantId || !localPatientId || !uhid || tenantId !== event.tenantId) return false;

    const resolved = await resolveMappedCloudPatientId(c.env.DB, {
      serverId,
      tenantId,
      localPatientId,
      uhid,
    });
    entityMappings.push(resolved.mapping);

    await c.env.DB.prepare(
      "INSERT OR IGNORE INTO patient_health_links (national_id, tenant_id, patient_id, hospital_name, uhid, is_active, linked_at) VALUES (?, ?, ?, ?, ?, 1, datetime('now'))",
    ).bind(
      coerceString(payload.national_id) ?? uhid,
      tenantId,
      resolved.cloudPatientId,
      coerceString(payload.hospital_name),
      uhid,
    ).run();
    return true;
  }

  if (event.entityType === 'medicine_catalog_entry') {
    return applyMedicineCatalogEntry(c, event.payload);
  }

  return false;
}

async function collectExistingPatientMapping(
  database: D1Database,
  serverId: string,
  event: z.infer<typeof syncEventSchema>,
  entityMappings: SyncEntityMapping[],
): Promise<void> {
  let localPatientId: number | null = null;
  if (event.entityType === 'patients') {
    localPatientId = coerceNumber(event.payload?.id ?? event.entityId);
  } else if (event.entityType === 'patient_health_links') {
    localPatientId = coerceNumber(event.payload?.patient_id);
  }
  if (!localPatientId) return;

  const mapping = await getSyncEntityMappingByLocal(
    database,
    serverId,
    event.tenantId,
    'patients',
    localPatientId,
  );
  if (mapping) {
    entityMappings.push(mapping);
    return;
  }

  if (event.entityType === 'patients' && event.payload) {
    const payload = event.payload;
    const tenantId = coerceString(payload.tenant_id ?? event.tenantId);
    if (!tenantId || tenantId !== event.tenantId) return;
    const healed = await recoverLegacyAppliedPatientMapping(database, {
      serverId,
      tenantId,
      localPatientId,
      payload: {
        name: coerceString(payload.name) ?? 'UNKNOWN',
        fatherHusband: coerceString(payload.father_husband) ?? '',
        address: coerceString(payload.address) ?? '',
        mobile: coerceString(payload.mobile),
        email: coerceString(payload.email),
        patientCode: coerceString(payload.patient_code),
        uhid: coerceString(payload.uhid),
        nationalId: coerceString(payload.national_id),
        dateOfBirth: coerceString(payload.date_of_birth),
        gender: coerceString(payload.gender),
        age: coerceNumber(payload.age),
        createdAt: coerceString(payload.created_at),
      },
    });
    entityMappings.push(healed.mapping);
    return;
  }

  if (event.entityType === 'patient_health_links' && event.payload) {
    const uhid = coerceString(event.payload.uhid);
    if (!uhid) return;
    const healed = await resolveMappedCloudPatientId(database, {
      serverId,
      tenantId: event.tenantId,
      localPatientId,
      uhid,
    });
    entityMappings.push(healed.mapping);
  }
}

function deduplicateEntityMappings(mappings: SyncEntityMapping[]): SyncEntityMapping[] {
  return [...new Map(mappings.map((mapping) => [
    [mapping.serverId, mapping.tenantId, mapping.entityType, mapping.localEntityId].join(':'),
    mapping,
  ])).values()];
}

async function markOutboxExported(c: SyncContext, ids: number[]) {
  if (ids.length === 0) return;

  await c.env.DB.prepare(`
    UPDATE local_sync_outbox
    SET status = 'exported',
        exported_at = datetime('now'),
        attempts = attempts + 1,
        locked_at = NULL,
        last_error = NULL
    WHERE id IN (${buildIdPlaceholders(ids)})
  `).bind(...ids).run();
}

async function markOutboxFailed(c: SyncContext, ids: number[], error: string) {
  if (ids.length === 0) return;

  await c.env.DB.prepare(`
    UPDATE local_sync_outbox
    SET attempts = attempts + 1,
        status = CASE WHEN attempts + 1 >= 5 THEN 'poison' ELSE 'failed' END,
        next_attempt_at = datetime('now', '+5 minutes'),
        locked_at = NULL,
        last_error = ?
    WHERE id IN (${buildIdPlaceholders(ids)})
  `).bind(error.slice(0, 500), ...ids).run();
}

async function markIngestApplyStatus(
  c: SyncContext,
  idempotencyKey: string,
  status: 'metadata_only' | 'applied' | 'failed',
  error?: string,
) {
  await c.env.DB.prepare(`
    UPDATE cloud_sync_ingest_events
    SET apply_status = ?,
        apply_error = ?
    WHERE idempotency_key = ?
  `).bind(status, error ? error.slice(0, 500) : null, idempotencyKey).run();
}

syncRoutes.use('*', async (c, next) => {
  const unauthorized = authorizeSyncRequest(c);
  if (unauthorized) return unauthorized;
  await next();
});

syncRoutes.get('/ping', (c) => {
  c.header('Cache-Control', 'no-store');
  return c.json({
    ok: true,
    mode: c.env.ENVIRONMENT,
    timestamp: new Date().toISOString(),
  });
});

syncRoutes.get('/global-patient-lookup', async (c) => {
  if (c.env.ENVIRONMENT === 'local_server') {
    return c.json({ error: 'Global patient lookup is only available on the cloud sync endpoint' }, 403);
  }

  const parsed = globalPatientLookupSchema.safeParse({
    tenantId: c.req.query('tenantId'),
    q: c.req.query('q'),
  });
  if (!parsed.success) return c.json({ error: 'Invalid global patient lookup query' }, 400);

  c.header('Cache-Control', 'no-store');
  return c.json({
    results: await queryGlobalPatientMatches(c, parsed.data.tenantId, parsed.data.q),
  });
});

syncRoutes.get('/uploads', async (c) => {
  if (c.env.ENVIRONMENT === 'local_server') {
    return c.json({ error: 'Cloud upload fetch is disabled on local servers' }, 403);
  }

  const parsed = uploadFetchSchema.safeParse({ key: c.req.query('key') });
  if (!parsed.success) return c.json({ error: 'Invalid upload key' }, 400);

  const key = normalizeUploadKey(parsed.data.key);
  if (!key) return c.json({ error: 'Invalid upload key' }, 400);

  const obj = await c.env.UPLOADS.get(key);
  if (!obj) return c.notFound();

  const headers = new Headers();
  headers.set('Content-Type', obj.httpMetadata?.contentType ?? 'application/octet-stream');
  headers.set('Cache-Control', 'private, max-age=300');
  return new Response(obj.body, { headers });
});

syncRoutes.get('/tenant-snapshot', async (c) => {
  if (c.env.ENVIRONMENT === 'local_server') {
    return c.json({ error: 'Tenant snapshot export is only available on the cloud sync endpoint' }, 403);
  }

  const parsed = tenantSnapshotQuerySchema.safeParse({
    tenantId: c.req.query('tenantId'),
    tables: c.req.query('tables'),
    limit: c.req.query('limit') ?? undefined,
  });
  if (!parsed.success) return c.json({ error: 'Invalid tenant snapshot query' }, 400);

  const requestedTables = parseRequestedTables(parsed.data.tables);
  const snapshotTables: Array<z.infer<typeof tenantSnapshotTableSchema>> = [];

  for (const tableName of requestedTables) {
    const tableInfo = await getTableInfo(c, tableName);
    if (tableInfo.length === 0) continue;

    const where = buildTenantSnapshotWhereClause(tableName, tableInfo, parsed.data.tenantId);
    if (!where) continue;

    const { results } = await c.env.DB.prepare(`
      SELECT *
      FROM ${quoteIdentifier(tableName)}
      WHERE ${where.where}
      LIMIT ?
    `).bind(...where.params, parsed.data.limit).all<Record<string, unknown>>();

    snapshotTables.push({
      name: tableName,
      primaryKey: getPrimaryKey(tableInfo),
      rows: results ?? [],
    });
  }

  c.header('Cache-Control', 'no-store');
  return c.json({
    tenantId: parsed.data.tenantId,
    snapshotId: `tenant:${parsed.data.tenantId}:${Date.now()}:${crypto.randomUUID()}`,
    generatedAt: new Date().toISOString(),
    tables: snapshotTables,
  });
});

syncRoutes.post('/cloud-pull/apply', async (c) => {
  if (c.env.ENVIRONMENT !== 'local_server') {
    return c.json({ error: 'Cloud pull apply is only available on local servers' }, 403);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = tenantSnapshotSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Invalid tenant snapshot payload' }, 400);

  const localTenantId = c.env.LOCAL_TENANT_ID?.trim();
  if (localTenantId && parsed.data.tenantId !== localTenantId) {
    return c.json({ error: 'Tenant snapshot does not match this local server' }, 403);
  }

  return c.json(await applyCloudSnapshot(c, parsed.data));
});

syncRoutes.post('/cloud-pull/run', async (c) => {
  if (c.env.ENVIRONMENT !== 'local_server') {
    return c.json({ error: 'Cloud pull is only available on local servers' }, 403);
  }

  const cloudBaseUrl = c.env.CLOUD_SYNC_BASE_URL?.trim().replace(/\/+$/, '');
  const tenantId = c.env.LOCAL_TENANT_ID?.trim();
  if (!cloudBaseUrl) return c.json({ error: 'Cloud sync base URL is not configured' }, 503);
  if (!tenantId) return c.json({ error: 'Local tenant ID is not configured' }, 503);

  const configuredTables = c.env.HMS_LOCAL_CLOUD_PULL_TABLES?.trim();
  const tableQuery = configuredTables ? `&tables=${encodeURIComponent(configuredTables)}` : '';
  const snapshotUrl = `${cloudBaseUrl}/api/sync/tenant-snapshot?tenantId=${encodeURIComponent(tenantId)}${tableQuery}`;
  const response = await fetch(snapshotUrl, {
    headers: {
      Authorization: `Bearer ${c.env.CLOUD_SYNC_TOKEN}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    return c.json({ error: `Cloud tenant snapshot returned HTTP ${response.status}` }, 502);
  }

  const body = await response.json().catch(() => null);
  const parsed = tenantSnapshotSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Cloud tenant snapshot payload is invalid' }, 502);

  return c.json(await applyCloudSnapshot(c, parsed.data));
});

syncRoutes.get('/cloud-pull/status', async (c) => {
  if (c.env.ENVIRONMENT !== 'local_server') {
    return c.json({ error: 'Cloud pull status is only available on local servers' }, 403);
  }

  const tenantId = c.env.LOCAL_TENANT_ID?.trim() ?? c.req.query('tenantId')?.trim();
  if (!tenantId) return c.json({ error: 'Local tenant ID is not configured' }, 503);

  await ensureLocalCloudPullTables(c);
  const { results } = await c.env.DB.prepare(`
    SELECT
      table_name,
      last_snapshot_id,
      last_pulled_at,
      rows_received,
      rows_applied,
      status,
      last_error
    FROM local_cloud_pull_state
    WHERE tenant_id = ?
    ORDER BY table_name
  `).bind(tenantId).all<{
    table_name: string;
    last_snapshot_id: string | null;
    last_pulled_at: string | null;
    rows_received: number;
    rows_applied: number;
    status: string;
    last_error: string | null;
  }>();

  return c.json({
    tenantId,
    tables: (results ?? []).map((row) => ({
      tableName: row.table_name,
      lastSnapshotId: row.last_snapshot_id,
      lastPulledAt: row.last_pulled_at,
      rowsReceived: Number(row.rows_received ?? 0),
      rowsApplied: Number(row.rows_applied ?? 0),
      status: row.status,
      lastError: row.last_error,
    })),
  });
});

syncRoutes.post('/ingest', async (c) => {
  if (c.env.ENVIRONMENT === 'local_server') {
    return c.json({ error: 'Cloud sync ingest is disabled on local servers' }, 403);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = ingestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid sync batch' }, 400);
  }

  for (const event of parsed.data.events) {
    if (!(await validatePayloadHash(event))) {
      return c.json({ error: 'Invalid sync batch payload' }, 400);
    }
  }

  let accepted = 0;
  let duplicates = 0;
  let retried = 0;
  let applied = 0;
  const entityMappings: SyncEntityMapping[] = [];

  for (const event of parsed.data.events) {
    const normalizedPayloadHash = event.payloadHash.toLowerCase();
    const processingOwner = `PROCESSING:${Date.now()}:${crypto.randomUUID()}`;
    const result = await c.env.DB.prepare(`
      INSERT OR IGNORE INTO cloud_sync_ingest_events (
        server_id,
        batch_id,
        tenant_id,
        entity_type,
        entity_id,
        operation,
        payload_hash,
        idempotency_key,
        apply_status,
        apply_error,
        received_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'metadata_only', ?, datetime('now'))
    `).bind(
      parsed.data.serverId,
      parsed.data.batchId,
      event.tenantId,
      event.entityType,
      event.entityId,
      event.operation,
      normalizedPayloadHash,
      event.idempotencyKey,
      processingOwner,
    ).run();

    let shouldApply = (result.meta?.changes ?? 0) > 0;
    let retryingFailedReceipt = false;
    let recoveringStaleProcessing = false;
    if (shouldApply) {
      accepted += 1;
    } else {
      duplicates += 1;
      const existing = await c.env.DB.prepare(`
        SELECT server_id, tenant_id, entity_type, entity_id, operation,
               payload_hash, apply_status, apply_error
        FROM cloud_sync_ingest_events
        WHERE idempotency_key = ?
        LIMIT 1
      `).bind(event.idempotencyKey).first<{
        server_id: string;
        tenant_id: string;
        entity_type: string;
        entity_id: string;
        operation: string;
        payload_hash: string;
        apply_status: string;
        apply_error: string | null;
      }>();

      if (!existing) {
        throw new HTTPException(409, { message: 'Sync idempotency receipt could not be verified' });
      }
      const sameEvent = existing.server_id === parsed.data.serverId
        && existing.tenant_id === event.tenantId
        && existing.entity_type === event.entityType
        && existing.entity_id === event.entityId
        && existing.operation === event.operation
        && existing.payload_hash.toLowerCase() === normalizedPayloadHash;
      if (!sameEvent) {
        throw new HTTPException(409, {
          message: 'Sync idempotency key is already used by a different event',
        });
      }

      const processingMatch = /^PROCESSING:(\d+):/.exec(existing.apply_error ?? '');
      const processingStartedAt = processingMatch ? Number(processingMatch[1]) : 0;
      const processingIsActive = processingStartedAt > 0
        && Date.now() - processingStartedAt < 5 * 60 * 1000;
      if (processingIsActive) {
        throw new HTTPException(409, { message: 'Sync event is already being applied' });
      }

      const retryableFailed = existing.apply_status === 'failed';
      const retryableStaleProcessing = existing.apply_status === 'metadata_only' && Boolean(processingMatch);
      if (retryableFailed || retryableStaleProcessing) {
        const claimed = await c.env.DB.prepare(`
          UPDATE cloud_sync_ingest_events
          SET apply_error = ?
          WHERE idempotency_key = ?
            AND apply_status = ?
            AND COALESCE(apply_error, '') = COALESCE(?, '')
          RETURNING id
        `).bind(
          processingOwner,
          event.idempotencyKey,
          existing.apply_status,
          existing.apply_error,
        ).first<{ id: number }>();
        if (!claimed?.id) {
          throw new HTTPException(409, { message: 'Sync event retry is already being claimed' });
        }

        retried += 1;
        retryingFailedReceipt = retryableFailed;
        recoveringStaleProcessing = retryableStaleProcessing;
        shouldApply = true;
      }
    }

    if (!shouldApply) {
      await collectExistingPatientMapping(c.env.DB, parsed.data.serverId, event, entityMappings);
      continue;
    }

    try {
      if (event.payload !== undefined && !supportsLocalSyncCloudApply(event.entityType)) {
        throw new HTTPException(409, {
          message: 'Local sync payload has no supported cloud apply mapper',
        });
      }
      const eventApplied = await applyKnownSyncEvent(c, event, parsed.data.serverId, entityMappings);
      if (eventApplied) {
        applied += 1;
        await markIngestApplyStatus(c, event.idempotencyKey, 'applied');
      } else if (event.payload !== undefined) {
        throw new HTTPException(409, {
          message: retryingFailedReceipt
            ? 'Failed sync event no longer has a supported apply mapper'
            : 'Local sync payload has no supported cloud apply mapper',
        });
      } else {
        await markIngestApplyStatus(c, event.idempotencyKey, 'metadata_only');
        if (recoveringStaleProcessing) {
          console.warn('Recovered stale metadata-only sync receipt', event.idempotencyKey);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await markIngestApplyStatus(c, event.idempotencyKey, 'failed', message);
      throw error;
    }
  }

  return c.json({
    accepted,
    duplicates,
    retried,
    applied,
    batchId: parsed.data.batchId,
    entityMappings: deduplicateEntityMappings(entityMappings).map(({ naturalKey: _naturalKey, ...mapping }) => mapping),
  }, 202);
});

syncRoutes.post('/outbox/flush', async (c) => {
  if (c.env.ENVIRONMENT !== 'local_server') {
    return c.json({ error: 'Outbox flush is only available on local servers' }, 403);
  }

  const cloudBaseUrl = c.env.CLOUD_SYNC_BASE_URL?.trim().replace(/\/+$/, '');
  if (!cloudBaseUrl) {
    return c.json({ error: 'Cloud sync base URL is not configured' }, 503);
  }

  const { results } = await c.env.DB.prepare(`
    SELECT
      id,
      tenant_id,
      entity_type,
      entity_id,
      operation,
      payload_hash,
      payload_json,
      idempotency_key
    FROM local_sync_outbox
    WHERE status IN ('pending', 'failed')
      AND (next_attempt_at IS NULL OR next_attempt_at <= datetime('now'))
    ORDER BY created_at ASC
    LIMIT ?
  `).bind(MAX_EVENTS_PER_BATCH).all<LocalOutboxRow>();

  if (results.length === 0) {
    return c.json({ attempted: 0, exported: 0, failed: 0 });
  }

  const ids = results.map((row) => Number(row.id));
  const localServerId = c.env.LOCAL_SERVER_ID ?? 'local-server';
  const batchId = `${localServerId}:${Date.now()}:${crypto.randomUUID()}`;
  const outboundEvents = results.map((row) => ({
    tenantId: row.tenant_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    operation: row.operation,
    payloadHash: row.payload_hash,
    idempotencyKey: row.idempotency_key,
    ...(row.payload_json ? { payload: JSON.parse(row.payload_json) as Record<string, unknown> } : {}),
  }));
  const response = await fetch(`${cloudBaseUrl}/api/sync/ingest`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${c.env.CLOUD_SYNC_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      serverId: localServerId,
      batchId,
      events: outboundEvents,
    }),
  });

  if (!response.ok) {
    await markOutboxFailed(c, ids, `cloud ingest returned HTTP ${response.status}`);
    return c.json({ attempted: results.length, exported: 0, failed: results.length }, 502);
  }

  const responseBody = await response.json().catch(() => null);
  const parsedResponse = ingestResponseSchema.safeParse(responseBody);
  if (!parsedResponse.success) {
    await markOutboxFailed(c, ids, 'cloud ingest returned an invalid mapping response');
    return c.json({ attempted: results.length, exported: 0, failed: results.length }, 502);
  }

  const tenantIds = new Set(results.map((row) => row.tenant_id));
  const returnedMappings = parsedResponse.data.entityMappings;
  const invalidMapping = returnedMappings.find((mapping) =>
    mapping.serverId !== localServerId || !tenantIds.has(mapping.tenantId),
  );
  if (invalidMapping) {
    await markOutboxFailed(c, ids, 'cloud ingest returned an out-of-scope entity mapping');
    return c.json({ attempted: results.length, exported: 0, failed: results.length }, 502);
  }

  try {
    await persistSyncEntityMappings(c.env.DB, returnedMappings);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markOutboxFailed(c, ids, `entity mapping persistence failed: ${message}`);
    return c.json({ attempted: results.length, exported: 0, failed: results.length }, 502);
  }

  const expectedPatientMappings = new Map<string, { tenantId: string; localPatientId: number }>();
  for (const event of outboundEvents) {
    let localPatientId: number | null = null;
    if (event.entityType === 'patients') {
      localPatientId = coerceNumber(event.payload?.id ?? event.entityId);
    } else if (event.entityType === 'patient_health_links') {
      localPatientId = coerceNumber(event.payload?.patient_id);
    }
    if (!localPatientId) continue;
    const key = `${event.tenantId}:${localPatientId}`;
    expectedPatientMappings.set(key, { tenantId: event.tenantId, localPatientId });
  }

  for (const expected of expectedPatientMappings.values()) {
    const mapping = await getSyncEntityMappingByLocal(
      c.env.DB,
      localServerId,
      expected.tenantId,
      'patients',
      expected.localPatientId,
    );
    if (!mapping) {
      await markOutboxFailed(c, ids, 'cloud ingest did not confirm a required patient entity mapping');
      return c.json({ attempted: results.length, exported: 0, failed: results.length }, 502);
    }
  }

  await markOutboxExported(c, ids);
  return c.json({
    attempted: results.length,
    exported: results.length,
    failed: 0,
    entityMappings: returnedMappings.length,
  });
});

syncRoutes.get('/schema/manifest/checksum', (c) => {
  c.header('Cache-Control', 'no-store');
  return c.json({
    version: MIGRATIONS_VERSION,
    checksum: MIGRATIONS_CHECKSUM,
    migrationCount: MIGRATIONS.length,
  });
});

syncRoutes.get('/schema/manifest', async (c) => {
  c.header('Cache-Control', 'no-store');
  const object = await c.env.UPLOADS.get(MIGRATIONS_R2_KEY);
  if (!object) {
    return c.json({ error: 'Schema migration manifest artifact is not available' }, 503);
  }

  const manifestText = await decodeGzipUtf8(await object.arrayBuffer());
  const manifest = JSON.parse(manifestText) as {
    version?: string;
    checksum?: string;
    migrations?: unknown[];
  };
  if (!isSchemaManifestArtifactCompatible(manifest, MIGRATIONS_CHECKSUM)) {
    return c.json({ error: 'Schema migration manifest artifact is invalid' }, 503);
  }

  return c.json({
    version: manifest.version,
    migrations: manifest.migrations,
  });
});

export default syncRoutes;
