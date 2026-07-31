import type { CanonicalBatchDatabase } from './command-batch';
import {
  createDeterministicSourceId,
  createSourceEvidenceSha256,
  normalizeIdentityText,
} from './source-mapping';

const BILLING_SERVICE_SOURCE_TYPE = 'legacy_billing_service_item';

export interface CanonicalBillingServiceMappingInput {
  tenantId: string;
  billingServiceItemId: number;
}

type CanonicalServiceKind =
  | 'laboratory'
  | 'radiology'
  | 'consultation'
  | 'bed'
  | 'procedure'
  | 'product'
  | 'other';

type BillingServiceSourceRow = {
  id: number;
  service_department_id: number;
  item_code: string;
  item_name: string;
  price: number;
  is_active: number;
  department_code: string | null;
  department_name: string | null;
};

type MappingRow = {
  canonical_public_id: string | null;
  mapping_status: string;
  evidence_sha256: string | null;
};

type CanonicalServiceRow = {
  item_kind: string;
  canonical_code: string | null;
  display_name: string;
  unit_code: string;
  status: string;
  source_evidence_sha256: string;
};

function exact(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new TypeError(`${label} cannot be empty`);
  if (trimmed !== value) throw new TypeError(`${label} cannot contain surrounding whitespace`);
  return value;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function normalizedCode(value: string | null | undefined): string | null {
  const normalized = value?.normalize('NFKC').trim().toUpperCase().replace(/\s+/g, '-');
  return normalized || null;
}

function classifyServiceKind(
  departmentCode: string | null,
  departmentName: string | null,
): CanonicalServiceKind {
  const key = `${departmentCode ?? ''} ${departmentName ?? ''}`.toLowerCase();
  if (/lab|patholog|diagnostic/.test(key)) return 'laboratory';
  if (/radio|imaging|xray|ultra|ct|mri/.test(key)) return 'radiology';
  if (/consult|doctor|opd/.test(key)) return 'consultation';
  if (/bed|cabin|ward/.test(key)) return 'bed';
  if (/procedure|operation|ot|surgery/.test(key)) return 'procedure';
  if (/pharmacy|medicine|product/.test(key)) return 'product';
  return 'other';
}

async function readSourceMapping(
  db: CanonicalBatchDatabase,
  tenantId: string,
  sourcePublicId: string,
): Promise<MappingRow | null> {
  return db.prepare(`
    SELECT canonical_public_id,mapping_status,evidence_sha256
    FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type='service_catalog_item'
      AND source_type=? AND source_public_id=?
    LIMIT 1
  `).bind(
    tenantId,
    BILLING_SERVICE_SOURCE_TYPE,
    sourcePublicId,
  ).first<MappingRow>();
}

async function readCanonicalService(
  db: CanonicalBatchDatabase,
  tenantId: string,
  servicePublicId: string,
): Promise<CanonicalServiceRow | null> {
  return db.prepare(`
    SELECT item_kind,canonical_code,display_name,unit_code,status,source_evidence_sha256
    FROM canonical_service_catalog_items
    WHERE tenant_id=? AND service_public_id=?
    LIMIT 1
  `).bind(tenantId, servicePublicId).first<CanonicalServiceRow>();
}

export interface PreparedCanonicalBillingServiceMapping {
  servicePublicId: string;
  evidenceSha256: string;
  status: 'active' | 'inactive';
  statements: ReturnType<CanonicalBatchDatabase['prepare']>[];
  reconciliationStatements: ReturnType<CanonicalBatchDatabase['prepare']>[];
}

export async function prepareCanonicalBillingServiceMapping(
  db: CanonicalBatchDatabase,
  input: CanonicalBillingServiceMappingInput,
): Promise<PreparedCanonicalBillingServiceMapping> {
  const tenantId = exact(input.tenantId, 'tenantId');
  const billingServiceItemId = positiveInteger(input.billingServiceItemId, 'billingServiceItemId');
  const sourcePublicId = String(billingServiceItemId);
  const source = await db.prepare(`
    SELECT
      i.id,i.service_department_id,i.item_code,i.item_name,i.price,i.is_active,
      d.department_code,d.department_name
    FROM billing_service_items i
    LEFT JOIN billing_service_departments d
      ON d.tenant_id=i.tenant_id AND d.id=i.service_department_id
    WHERE CAST(i.tenant_id AS TEXT)=? AND i.id=?
    LIMIT 1
  `).bind(tenantId, billingServiceItemId).first<BillingServiceSourceRow>();
  if (!source) throw new Error('Billing service item not found for canonical live recovery');

  const normalizedName = normalizeIdentityText(source.item_name);
  if (!normalizedName) throw new Error('Billing service item name is missing for canonical live recovery');
  const displayName = source.item_name;
  const canonicalCode = normalizedCode(source.item_code);
  const itemKind = classifyServiceKind(source.department_code, source.department_name);
  const status = Number(source.is_active) === 1 ? 'active' : 'inactive';
  const servicePublicId = await createDeterministicSourceId(
    'svc', tenantId, BILLING_SERVICE_SOURCE_TYPE, sourcePublicId,
  );
  const evidenceSha256 = await createSourceEvidenceSha256({
    sourceType: BILLING_SERVICE_SOURCE_TYPE,
    sourcePublicId,
    departmentId: source.service_department_id,
    code: canonicalCode,
    name: normalizedName,
    price: String(source.price),
    active: Number(source.is_active) === 1,
  });

  const existingMapping = await readSourceMapping(db, tenantId, sourcePublicId);
  if (existingMapping) {
    if (
      existingMapping.mapping_status !== 'mapped'
      || existingMapping.canonical_public_id !== servicePublicId
      || existingMapping.evidence_sha256 !== evidenceSha256
    ) {
      throw new Error('Canonical billing service mapping conflicts with live recovery');
    }
    const existingService = await readCanonicalService(db, tenantId, servicePublicId);
    if (existingService && status === 'active' && existingService.status !== 'active') {
      throw new Error('Canonical billing service mapping requires an active canonical service');
    }
    if (
      !existingService
      || existingService.item_kind !== itemKind
      || existingService.canonical_code !== canonicalCode
      || existingService.display_name !== displayName
      || existingService.unit_code !== 'service'
      || existingService.status !== status
      || existingService.source_evidence_sha256 !== evidenceSha256
    ) {
      throw new Error('Canonical billing service item conflicts with live recovery');
    }
    return { servicePublicId, evidenceSha256, status, statements: [], reconciliationStatements: [] };
  }

  const codeOwner = canonicalCode == null ? null : await db.prepare(`
    SELECT service_public_id
    FROM canonical_service_catalog_items
    WHERE tenant_id=? AND canonical_code=?
    LIMIT 1
  `).bind(tenantId, canonicalCode).first<{ service_public_id: string }>();
  if (codeOwner && codeOwner.service_public_id !== servicePublicId) {
    throw new Error('Canonical billing service code conflicts with live recovery');
  }

  return {
    servicePublicId,
    evidenceSha256,
    status,
    statements: [db.prepare(`
      INSERT INTO canonical_service_catalog_items (
        tenant_id,service_public_id,item_kind,canonical_code,display_name,
        unit_code,status,source_evidence_sha256
      ) VALUES (?,?,?,?,?,'service',?,?)
    `).bind(
      tenantId,
      servicePublicId,
      itemKind,
      canonicalCode,
      displayName,
      status,
      evidenceSha256,
    )],
    reconciliationStatements: [db.prepare(`
      INSERT INTO canonical_source_mappings (
        tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
        source_table,mapping_status,mapping_version,evidence_sha256
      ) VALUES (?,'service_catalog_item',?,?,?,'billing_service_items','mapped',1,?)
    `).bind(
      tenantId,
      servicePublicId,
      BILLING_SERVICE_SOURCE_TYPE,
      sourcePublicId,
      evidenceSha256,
    )],
  };
}

export async function ensureCanonicalBillingServiceMapping(
  db: CanonicalBatchDatabase,
  input: CanonicalBillingServiceMappingInput,
): Promise<string> {
  const prepared = await prepareCanonicalBillingServiceMapping(db, input);
  if (prepared.statements.length > 0 || prepared.reconciliationStatements.length > 0) {
    await db.batch([...prepared.statements, ...prepared.reconciliationStatements]);
  }

  const tenantId = exact(input.tenantId, 'tenantId');
  const service = await readCanonicalService(db, tenantId, prepared.servicePublicId);
  if (!service || service.source_evidence_sha256 !== prepared.evidenceSha256) {
    throw new Error('Canonical billing service item conflicts with live recovery');
  }
  const mapping = await readSourceMapping(db, tenantId, String(input.billingServiceItemId));
  if (
    mapping?.mapping_status !== 'mapped'
    || mapping.canonical_public_id !== prepared.servicePublicId
    || mapping.evidence_sha256 !== prepared.evidenceSha256
  ) {
    throw new Error('Canonical billing service mapping conflicts with live recovery');
  }
  return prepared.servicePublicId;
}
