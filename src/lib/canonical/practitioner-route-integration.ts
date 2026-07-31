import {
  createPractitioner,
  linkOrUnlinkPractitionerEmployee,
  linkOrUnlinkPractitionerUser,
  updateOrRetirePractitioner,
  type PractitionerClassificationInput,
  type PractitionerIdentifierInput,
} from './commands/manage-practitioner';
import type {
  CanonicalBatchDatabase,
  CanonicalCommandResult,
  CanonicalPreparedStatement,
} from './command-batch';
import {
  createDeterministicSourceId,
  createSourceEvidenceSha256,
  normalizeIdentityText,
  normalizeRegistrationNumber,
} from './source-mapping';

const DOCTOR_SOURCE_TYPE = 'legacy_doctor';
const DOCTOR_SOURCE_TABLE = 'doctors';

export interface LegacyDoctorPractitionerSnapshot {
  name: string;
  specialty: string | null;
  department: string | null;
  bmdcRegNo: string | null;
  userId: number | null;
  isActive: boolean;
}

export interface PractitionerRouteContext {
  tenantId: string;
  sourcePublicId: string;
  practitionerPublicId: string;
  snapshot: LegacyDoctorPractitionerSnapshot;
  sourceEvidenceSha256: string;
}

export interface PractitionerRouteExecution {
  authoritativeStatements: readonly CanonicalPreparedStatement[];
  occurredAtUtc: string;
  businessDate: string;
  idempotencyKey: string;
}

interface MappingRow {
  canonical_public_id: string | null;
  mapping_status: string;
}

interface PractitionerRow {
  practitioner_kind: 'internal' | 'external';
  display_name: string;
  status: 'active' | 'inactive' | 'unknown';
  version: number;
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

function classification(value: string | null): PractitionerClassificationInput | null {
  const normalizedKey = normalizeIdentityText(value);
  if (!normalizedKey || value == null) return null;
  return {
    normalizedKey,
    displayText: exact(value.trim(), 'classification displayText'),
    isPrimary: true,
  };
}

function identifier(value: string | null, verificationStatus: PractitionerIdentifierInput['verificationStatus']): PractitionerIdentifierInput | null {
  const normalized = normalizeRegistrationNumber(value);
  if (!normalized || value == null) return null;
  return {
    system: 'bmdc',
    issuerKey: 'bangladesh-medical-and-dental-council',
    value: normalized,
    displayValue: exact(value.trim(), 'BMDC displayValue'),
    verificationStatus,
  };
}

function snapshotRequest(snapshot: LegacyDoctorPractitionerSnapshot) {
  return {
    name: normalizeIdentityText(snapshot.name),
    specialty: normalizeIdentityText(snapshot.specialty),
    department: normalizeIdentityText(snapshot.department),
    bmdcRegNo: normalizeRegistrationNumber(snapshot.bmdcRegNo),
    userId: snapshot.userId,
    isActive: snapshot.isActive,
  };
}

export function practitionerIdentityChanged(
  current: LegacyDoctorPractitionerSnapshot,
  next: LegacyDoctorPractitionerSnapshot,
): boolean {
  const comparison = (snapshot: LegacyDoctorPractitionerSnapshot) => ({
    name: snapshot.name.trim(),
    specialty: snapshot.specialty?.trim() || null,
    department: snapshot.department?.trim() || null,
    bmdcRegNo: normalizeRegistrationNumber(snapshot.bmdcRegNo),
    userId: snapshot.userId,
    isActive: snapshot.isActive,
  });
  return JSON.stringify(comparison(current)) !== JSON.stringify(comparison(next));
}

async function exactMappedPractitionerPublicId(
  db: CanonicalBatchDatabase,
  tenantId: string,
  sourcePublicId: string,
): Promise<string | null> {
  const mapping = await db.prepare(`
    SELECT canonical_public_id,mapping_status
    FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type='practitioner'
      AND source_type=? AND source_public_id=?
    LIMIT 1
  `).bind(tenantId, DOCTOR_SOURCE_TYPE, sourcePublicId).first<MappingRow>();
  if (!mapping) return null;
  if (mapping.mapping_status !== 'mapped' || !mapping.canonical_public_id) {
    throw new Error('doctor source mapping is not an exact mapped practitioner identity');
  }
  return mapping.canonical_public_id;
}

export async function buildPractitionerRouteContext(
  db: CanonicalBatchDatabase,
  input: {
    tenantId: string;
    sourcePublicId: string;
    snapshot: LegacyDoctorPractitionerSnapshot;
  },
): Promise<PractitionerRouteContext> {
  const tenantId = exact(input.tenantId, 'tenantId');
  const sourcePublicId = exact(input.sourcePublicId, 'sourcePublicId');
  const name = exact(input.snapshot.name, 'doctor name');
  const userId = input.snapshot.userId == null ? null : positiveInteger(Number(input.snapshot.userId), 'doctor userId');
  const snapshot: LegacyDoctorPractitionerSnapshot = {
    name,
    specialty: input.snapshot.specialty?.trim() || null,
    department: input.snapshot.department?.trim() || null,
    bmdcRegNo: input.snapshot.bmdcRegNo?.trim() || null,
    userId,
    isActive: Boolean(input.snapshot.isActive),
  };
  const practitionerPublicId = await exactMappedPractitionerPublicId(db, tenantId, sourcePublicId)
    ?? await createDeterministicSourceId('pract', tenantId, DOCTOR_SOURCE_TYPE, sourcePublicId);
  const sourceEvidenceSha256 = await createSourceEvidenceSha256({
    sourceType: DOCTOR_SOURCE_TYPE,
    sourcePublicId,
    ...snapshotRequest(snapshot),
  });
  return {
    tenantId,
    sourcePublicId,
    practitionerPublicId,
    snapshot,
    sourceEvidenceSha256,
  };
}

export async function createRoutePractitioner(
  db: CanonicalBatchDatabase,
  context: PractitionerRouteContext,
  execution: PractitionerRouteExecution,
): Promise<CanonicalCommandResult<{ practitionerPublicId: string; practitionerKind: 'internal' | 'external'; status: 'active' | 'inactive' | 'unknown'; version: number }>> {
  return createPractitioner(db, {
    tenantId: context.tenantId,
    practitionerPublicId: context.practitionerPublicId,
    practitionerKind: 'internal',
    displayName: context.snapshot.name,
    status: context.snapshot.isActive ? 'active' : 'inactive',
    sourceType: DOCTOR_SOURCE_TYPE,
    sourcePublicId: context.sourcePublicId,
    sourceTable: DOCTOR_SOURCE_TABLE,
    sourceEvidenceSha256: context.sourceEvidenceSha256,
    identifier: identifier(context.snapshot.bmdcRegNo, 'unverified') ?? undefined,
    userLink: context.snapshot.userId == null ? undefined : {
      legacyUserId: context.snapshot.userId,
      evidenceType: 'legacy_doctor_user_id',
      linkStatus: context.snapshot.isActive ? 'active' : 'retired',
    },
    specialty: classification(context.snapshot.specialty) ?? undefined,
    department: classification(context.snapshot.department) ?? undefined,
    occurredAtUtc: execution.occurredAtUtc,
    businessDate: execution.businessDate,
    idempotencyKey: execution.idempotencyKey,
  }, {
    authoritativeStatements: execution.authoritativeStatements,
  });
}

async function requireCurrentPractitioner(
  db: CanonicalBatchDatabase,
  context: PractitionerRouteContext,
): Promise<PractitionerRow> {
  const mapped = await exactMappedPractitionerPublicId(db, context.tenantId, context.sourcePublicId);
  if (!mapped || mapped !== context.practitionerPublicId) {
    throw new Error('Canonical practitioner mapping is required before updating an existing doctor');
  }
  const row = await db.prepare(`
    SELECT practitioner_kind,display_name,status,version
    FROM canonical_practitioners
    WHERE tenant_id=? AND practitioner_public_id=?
    LIMIT 1
  `).bind(context.tenantId, context.practitionerPublicId).first<PractitionerRow>();
  if (!row) throw new Error('Canonical practitioner is required before updating an existing doctor');
  return row;
}

function identifierUpdates(
  current: LegacyDoctorPractitionerSnapshot,
  next: LegacyDoctorPractitionerSnapshot,
): PractitionerIdentifierInput[] {
  const previous = normalizeRegistrationNumber(current.bmdcRegNo);
  const upcoming = normalizeRegistrationNumber(next.bmdcRegNo);
  if (previous === upcoming) return [];
  const updates: PractitionerIdentifierInput[] = [];
  const retired = identifier(current.bmdcRegNo, 'retired');
  const added = identifier(next.bmdcRegNo, 'unverified');
  if (retired) updates.push(retired);
  if (added) updates.push(added);
  return updates;
}

export async function updateRoutePractitioner(
  db: CanonicalBatchDatabase,
  currentContext: PractitionerRouteContext,
  nextContext: PractitionerRouteContext,
  execution: PractitionerRouteExecution,
): Promise<CanonicalCommandResult<{ practitionerPublicId: string; practitionerKind: 'internal' | 'external'; status: 'active' | 'inactive' | 'unknown'; version: number }>> {
  if (
    currentContext.tenantId !== nextContext.tenantId
    || currentContext.sourcePublicId !== nextContext.sourcePublicId
    || currentContext.practitionerPublicId !== nextContext.practitionerPublicId
  ) {
    throw new Error('practitioner route identity changed during update');
  }
  const mapped = await exactMappedPractitionerPublicId(
    db,
    currentContext.tenantId,
    currentContext.sourcePublicId,
  );
  if (!mapped) return createRoutePractitioner(db, nextContext, execution);
  const currentCanonical = await requireCurrentPractitioner(db, currentContext);
  const specialtyChanged = (currentContext.snapshot.specialty?.trim() || null)
    !== (nextContext.snapshot.specialty?.trim() || null);
  const departmentChanged = (currentContext.snapshot.department?.trim() || null)
    !== (nextContext.snapshot.department?.trim() || null);
  const nextStatus = nextContext.snapshot.isActive ? 'active' : 'inactive';
  const userLink = nextContext.snapshot.userId == null ? undefined : {
    legacyUserId: nextContext.snapshot.userId,
    evidenceType: 'legacy_doctor_user_id' as const,
    linkStatus: nextStatus === 'active' ? 'active' as const : 'retired' as const,
  };
  return updateOrRetirePractitioner(db, {
    tenantId: nextContext.tenantId,
    practitionerPublicId: nextContext.practitionerPublicId,
    displayName: nextContext.snapshot.name,
    status: nextStatus,
    expectedVersion: Number(currentCanonical.version),
    sourceEvidenceSha256: nextContext.sourceEvidenceSha256,
    identifierUpdates: identifierUpdates(currentContext.snapshot, nextContext.snapshot),
    userLink,
    specialty: specialtyChanged ? classification(nextContext.snapshot.specialty) : undefined,
    department: departmentChanged ? classification(nextContext.snapshot.department) : undefined,
    occurredAtUtc: execution.occurredAtUtc,
    businessDate: execution.businessDate,
    idempotencyKey: execution.idempotencyKey,
  }, {
    authoritativeStatements: execution.authoritativeStatements,
  });
}

export async function runPractitionerProjectionCompatibility(
  db: CanonicalBatchDatabase,
  statements: readonly CanonicalPreparedStatement[],
): Promise<void> {
  await db.batch([...statements]);
}

// Dedicated exact link wrappers keep the frozen account-link commands available
// to the doctor/invitation compatibility boundary without introducing another
// identity command name.
export const linkDoctorPractitionerUser = linkOrUnlinkPractitionerUser;
export const linkDoctorPractitionerEmployee = linkOrUnlinkPractitionerEmployee;
