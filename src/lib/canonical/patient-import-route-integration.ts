import type {
  CanonicalBatchDatabase,
  CanonicalCommandExecutionOptions,
  CanonicalCommandResult,
} from './command-batch';
import {
  registerOrLinkPatient,
  type RegisterOrLinkPatientResult,
} from './commands/register-or-link-patient';
import { createSourceEvidenceSha256 } from './source-mapping';

const PATIENT_IMPORT_SOURCE_TYPE = 'settings_patient_import';
const PATIENT_SOURCE_TABLE = 'patients';

export interface PatientImportRowSnapshot {
  name: string;
  mobile: string;
  fatherHusband: string;
  address: string;
  gender: string;
  dateOfBirth: string | null;
}

export interface PatientImportRouteContext {
  tenantId: string;
  sourcePublicId: string;
  legacyPatientId: number;
  row: PatientImportRowSnapshot;
  sourceEvidenceSha256: string;
}

export interface PatientImportRouteExecution extends CanonicalCommandExecutionOptions {
  actorUserId: number;
  occurredAtUtc: string;
  businessDate: string;
  idempotencyKey: string;
}

interface ExistingPatientRow {
  id: number;
}

interface NextPatientIdRow {
  next_id: number;
}

function exact(value: string, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  if (value.trim() !== value) throw new TypeError(`${label} cannot contain surrounding whitespace`);
  return value;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${label} must be a positive safe integer`);
  return value;
}

function normalizeRow(row: PatientImportRowSnapshot): PatientImportRowSnapshot {
  return {
    name: exact(row.name.trim(), 'patient name'),
    mobile: exact(row.mobile.trim(), 'patient mobile'),
    fatherHusband: row.fatherHusband?.trim() || '',
    address: row.address?.trim() || '',
    gender: row.gender?.trim() || 'other',
    dateOfBirth: row.dateOfBirth?.trim() || null,
  };
}

export async function buildPatientImportRouteContext(
  db: CanonicalBatchDatabase,
  input: {
    tenantId: string;
    sourcePublicId: string;
    row: PatientImportRowSnapshot;
  },
): Promise<PatientImportRouteContext> {
  const tenantId = exact(input.tenantId, 'tenantId');
  const sourcePublicId = exact(input.sourcePublicId, 'sourcePublicId');
  const row = normalizeRow(input.row);
  const existing = await db.prepare(`
    SELECT id
    FROM patients
    WHERE tenant_id=? AND canonical_source_key=?
    LIMIT 1
  `).bind(tenantId, sourcePublicId).first<ExistingPatientRow>();
  let legacyPatientId: number;
  if (existing) {
    legacyPatientId = positiveInteger(Number(existing.id), 'legacyPatientId');
  } else {
    const next = await db.prepare(`
      SELECT COALESCE(MAX(id), 0) + 1 AS next_id
      FROM patients
    `).first<NextPatientIdRow>();
    legacyPatientId = positiveInteger(Number(next?.next_id), 'legacyPatientId');
  }
  const sourceEvidenceSha256 = await createSourceEvidenceSha256({
    sourceType: PATIENT_IMPORT_SOURCE_TYPE,
    sourcePublicId,
    row,
  });
  return {
    tenantId,
    sourcePublicId,
    legacyPatientId,
    row,
    sourceEvidenceSha256,
  };
}

export async function createImportedPatient(
  db: CanonicalBatchDatabase,
  context: PatientImportRouteContext,
  execution: PatientImportRouteExecution,
): Promise<CanonicalCommandResult<RegisterOrLinkPatientResult>> {
  return registerOrLinkPatient(db, {
    tenantId: context.tenantId,
    legacyPatientId: context.legacyPatientId,
    globalPatientUhid: null,
    linkStatus: 'unlinked',
    verificationLevel: 'unverified',
    evidenceType: 'no_link_placeholder',
    evidenceSha256: context.sourceEvidenceSha256,
    effectiveAtUtc: execution.occurredAtUtc,
    eventType: 'registered',
    reasonCode: 'settings_patient_import_without_exact_global_identity',
    actorUserId: positiveInteger(Number(execution.actorUserId), 'actorUserId'),
    sourceType: PATIENT_IMPORT_SOURCE_TYPE,
    sourcePublicId: context.sourcePublicId,
    sourceTable: PATIENT_SOURCE_TABLE,
    idempotencyKey: exact(execution.idempotencyKey, 'idempotencyKey'),
    businessDate: execution.businessDate,
  }, {
    authoritativeStatements: execution.authoritativeStatements,
  });
}
