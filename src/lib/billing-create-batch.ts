import type { BillCategoryTotals } from './billing-category-totals';
import type { CanonicalBatchDatabase, CanonicalPreparedStatement } from './canonical/command-batch';
import { prepareCanonicalBillingServiceMapping } from './canonical/live-service-catalog-recovery';
import {
  prepareAcceptedServiceRouteBatch,
  prepareProtectedConsultationService,
} from './canonical/service-delivery-route-integration';
import { resolveAppointmentRoutePractitioner } from './canonical/appointment-route-integration';
import type { ServiceOperationParticipantInput } from './canonical/commands/service-operations';

export interface BillCreationBatchItem {
  itemCategory: string;
  description?: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  taxAmount?: number | null;
  referenceId?: number | null;
  serviceItemId?: number | null;
  canonicalSourceKey?: string | null;
}

export interface BillCreationBatchInput {
  tenantId: string;
  userId: string;
  patientId: number;
  visitId?: number | null;
  invoiceNo: string;
  referringDoctorId?: number | null;
  categoryTotals: BillCategoryTotals;
  discount: number;
  discountReason?: string | null;
  discountByName?: string | null;
  total: number;
  taxTotal: number;
  counterId: number;
  counterSessionId: number;
  businessDate: string;
  occurredAtUtc: string;
  commandIdempotencyKey: string;
  items: BillCreationBatchItem[];
}

interface BillEncounterMappingRow {
  canonical_public_id: string | null;
  mapping_status: string;
}

interface BillEncounterRow {
  legacy_patient_id: number;
  status: string;
}

async function resolveBillEncounter(
  db: CanonicalBatchDatabase,
  input: BillCreationBatchInput,
): Promise<string | null> {
  if (!input.visitId) return null;
  const mapping = await db.prepare(`
    SELECT canonical_public_id,mapping_status
    FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type='encounter'
      AND source_type='legacy_visit' AND source_public_id=?
    LIMIT 1
  `).bind(input.tenantId, String(input.visitId)).first<BillEncounterMappingRow>();
  if (mapping?.mapping_status !== 'mapped' || !mapping.canonical_public_id) {
    throw new Error('bill visit requires one exact canonical encounter mapping');
  }
  const encounter = await db.prepare(`
    SELECT legacy_patient_id,status
    FROM canonical_encounters
    WHERE tenant_id=? AND encounter_public_id=?
    LIMIT 1
  `).bind(input.tenantId, mapping.canonical_public_id).first<BillEncounterRow>();
  if (!encounter || Number(encounter.legacy_patient_id) !== input.patientId) {
    throw new Error('bill encounter mapping does not match the billed patient');
  }
  if (['cancelled', 'entered_in_error'].includes(encounter.status)) {
    throw new Error('bill encounter is not eligible for service acceptance');
  }
  return mapping.canonical_public_id;
}

async function prepareBillCreationStrictStatements(
  db: CanonicalBatchDatabase,
  input: BillCreationBatchInput,
  legacyStatements: readonly CanonicalPreparedStatement[],
): Promise<readonly CanonicalPreparedStatement[]> {
  if (!input.visitId || input.items.length === 0) return legacyStatements;
  const encounterPublicId = await resolveBillEncounter(db, input);
  if (!encounterPublicId) return legacyStatements;
  const practitionerPublicId = input.referringDoctorId
    ? await resolveAppointmentRoutePractitioner(db, input.tenantId, input.referringDoctorId)
    : null;
  if (input.referringDoctorId && !practitionerPublicId) {
    throw new Error('bill service acceptance requires one exact practitioner mapping');
  }

  const catalogCache = new Map<number, Awaited<ReturnType<typeof prepareCanonicalBillingServiceMapping>>>();
  const includedCatalog = new Set<string>();
  const strictStatements: CanonicalPreparedStatement[] = [];
  let legacyEmbedded = false;

  for (let index = 0; index < input.items.length; index += 1) {
    const item = input.items[index];
    const sourcePublicId = item.canonicalSourceKey?.trim();
    if (!sourcePublicId) throw new Error('bill visit service requires a stable canonical source key');

    let servicePublicId: string;
    let serviceEvidenceSha256: string;
    let serviceBootstrap: readonly CanonicalPreparedStatement[];
    let participant: ServiceOperationParticipantInput | null = practitionerPublicId
      ? {
          practitionerPublicId,
          role: 'referring',
          evidenceType: 'approved_manual',
        }
      : null;

    if (item.serviceItemId) {
      let catalog = catalogCache.get(item.serviceItemId);
      if (!catalog) {
        catalog = await prepareCanonicalBillingServiceMapping(db, {
          tenantId: input.tenantId,
          billingServiceItemId: item.serviceItemId,
        });
        catalogCache.set(item.serviceItemId, catalog);
      }
      if (catalog.status !== 'active') {
        throw new Error('bill service acceptance requires an active canonical service');
      }
      servicePublicId = catalog.servicePublicId;
      serviceEvidenceSha256 = catalog.evidenceSha256;
      serviceBootstrap = includedCatalog.has(servicePublicId)
        ? []
        : [...catalog.statements, ...catalog.reconciliationStatements];
      includedCatalog.add(servicePublicId);
    } else {
      const consultation = await prepareProtectedConsultationService(db, input.tenantId);
      servicePublicId = consultation.servicePublicId;
      serviceEvidenceSha256 = consultation.sourceEvidenceSha256;
      serviceBootstrap = includedCatalog.has(servicePublicId) ? [] : consultation.statements;
      includedCatalog.add(servicePublicId);
      if (!practitionerPublicId) {
        throw new Error('manual consultation billing requires one exact practitioner mapping');
      }
      participant = {
        practitionerPublicId,
        role: 'performing',
        evidenceType: 'legacy_consultation_doctor',
      };
    }

    const prepared = await prepareAcceptedServiceRouteBatch(db, {
      tenantId: input.tenantId,
      legacyPatientId: input.patientId,
      encounterPublicId,
      servicePublicId,
      sourceType: 'legacy_visit_service_key',
      sourcePublicId,
      sourceTable: 'visit_services',
      quantity: item.quantity,
      occurredAtUtc: input.occurredAtUtc,
      sourceEvidence: {
        boundary: 'billing_create_visit_service',
        invoiceNo: input.invoiceNo,
        lineNumber: index + 1,
        visitId: input.visitId,
        patientId: input.patientId,
        sourcePublicId,
        serviceItemId: item.serviceItemId ?? null,
        referenceId: item.referenceId ?? null,
        quantity: item.quantity,
        unitAmountMinor: Math.round(item.unitPrice * 100),
        lineAmountMinor: Math.round(item.lineTotal * 100),
        status: 'billed',
      },
      participant,
      idempotencyKey: `${input.commandIdempotencyKey}:service:${index + 1}`,
      businessDate: input.businessDate,
      preparedService: serviceEvidenceSha256 && (
        serviceBootstrap.length > 0
        || (item.serviceItemId != null && (catalogCache.get(item.serviceItemId)?.statements.length ?? 0) > 0)
      )
        ? { servicePublicId, sourceEvidenceSha256: serviceEvidenceSha256 }
        : null,
      authoritativeStatements: [
        ...(!legacyEmbedded ? legacyStatements : []),
        ...serviceBootstrap,
      ],
    });
    if (prepared.status !== 'prepared') {
      throw new Error('new bill service acceptance unexpectedly replayed before bill creation');
    }
    strictStatements.push(...prepared.statements);
    legacyEmbedded = true;
  }

  return strictStatements.length > 0 ? strictStatements : legacyStatements;
}

export function buildBillCreationBatch(
  db: D1Database,
  input: BillCreationBatchInput,
): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [];
  const approvedBy = input.discount > 0 ? Number(input.userId) : null;

  statements.push(db.prepare(`
    INSERT INTO "bills" (
      patient_id, visit_id, invoice_no, referring_doctor_id,
      test_bill, admission_bill, doctor_visit_bill, operation_bill, medicine_bill,
      discount, discount_reason, discount_by_name, approved_by,
      total, tax_total, paid, due, status,
      counter_id, counter_session_id, tenant_id, created_at
    ) VALUES (
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, 0, ?, 'open',
      ?, ?, ?, datetime('now', '+6 hours')
    )
    RETURNING id
  `).bind(
    input.patientId,
    input.visitId ?? null,
    input.invoiceNo,
    input.referringDoctorId ?? null,
    input.categoryTotals.testBill,
    input.categoryTotals.admissionBill,
    input.categoryTotals.doctorVisitBill,
    input.categoryTotals.operationBill,
    input.categoryTotals.medicineBill,
    input.discount,
    input.discountReason ?? null,
    input.discountByName?.trim() || null,
    approvedBy,
    input.total,
    input.taxTotal,
    input.total,
    input.counterId,
    input.counterSessionId,
    input.tenantId,
  ));

  for (const item of input.items) {
    statements.push(db.prepare(`
      INSERT INTO "invoice_items" (
        bill_id, item_category, description, quantity, unit_price,
        line_total, tax_amount, reference_id, tenant_id
      )
      SELECT b.id, ?, ?, ?, ?, ?, ?, ?, ?
      FROM "bills" b
      WHERE b.tenant_id = ?
        AND b.invoice_no = ?
      ORDER BY b.id DESC
      LIMIT 1
    `).bind(
      item.itemCategory,
      item.description ?? null,
      item.quantity,
      item.unitPrice,
      item.lineTotal,
      item.taxAmount ?? 0,
      item.referenceId ?? null,
      input.tenantId,
      input.tenantId,
      input.invoiceNo,
    ));

    if (input.visitId) {
      const canonicalSourceKey = item.canonicalSourceKey?.trim();
      if (!canonicalSourceKey) {
        throw new Error('visit-linked bill item requires canonicalSourceKey');
      }
      statements.push(db.prepare(`
        INSERT INTO "visit_services" (
          tenant_id, visit_id, patient_id, service_type, description,
          service_item_id, doctor_id, amount, discount_amount, quantity,
          total_amount, reference_type, reference_id, status, bill_id, created_by,
          canonical_source_key
        )
        SELECT ?, ?, ?, 'other', i.description,
               ?, ?, i.unit_price, 0, i.quantity,
               i.line_total, 'invoice_item', i.id, 'billed', b.id, ?, ?
        FROM "bills" b
        JOIN "invoice_items" i
          ON i.bill_id = b.id
         AND i.tenant_id = b.tenant_id
        WHERE b.tenant_id = ?
          AND b.invoice_no = ?
        ORDER BY i.id DESC
        LIMIT 1
      `).bind(
        input.tenantId,
        input.visitId,
        input.patientId,
        item.serviceItemId ?? null,
        item.itemCategory === 'doctor_visit' ? (input.referringDoctorId ?? null) : null,
        input.userId,
        canonicalSourceKey,
        input.tenantId,
        input.invoiceNo,
      ));
    }
  }

  Object.defineProperty(statements, 'strictAuthoritativeStatements', {
    value: () => prepareBillCreationStrictStatements(
      db as unknown as CanonicalBatchDatabase,
      input,
      statements,
    ),
    enumerable: false,
    configurable: false,
    writable: false,
  });

  return statements;
}
