import type { CanonicalBatchDatabase, CanonicalPreparedStatement } from './command-batch';
import { createRequestFingerprint } from './idempotency';
import { completeCanonicalSyncInboxEvent } from './local-sync-inbox';
import {
  parseCanonicalSyncBusinessPayload,
  type EncounterCancelledMutation,
  type EncounterCompletedMutation,
  type EncounterStartedMutation,
  type InvoiceCancelledMutation,
  type InvoiceIssuedMutation,
  type PaymentReceiptRecordedMutation,
  type PaymentReversedMutation,
  type DepositRecordedMutation,
  type DepositAppliedMutation,
  type DepositRefundedMutation,
  type CompensationAccruedMutation,
  type CompensationAdjustedMutation,
  type InventoryMovementRecordedMutation,
  type ServiceEventCancelledMutation,
  type ServiceEventRecordedMutation,
  type ServiceRequestCancelledMutation,
  type ServiceRequestCreatedMutation,
} from './local-sync-business-payload';
import type { CanonicalSyncEnvelope } from './local-sync-protocol';

export class CanonicalSyncBusinessApplyError extends Error {
  readonly code = 'CANONICAL_SYNC_BUSINESS_APPLY';

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CanonicalSyncBusinessApplyError';
  }
}

const UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;

function assertUtc(value: string, label: string): void {
  if (!UTC_PATTERN.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new CanonicalSyncBusinessApplyError(`${label} must be a valid ISO-8601 UTC timestamp`);
  }
}

function clearAssertions(
  db: CanonicalBatchDatabase,
  tenantId: string,
  operationKey: string,
): CanonicalPreparedStatement {
  return db.prepare(`
    DELETE FROM canonical_sync_batch_assertions
    WHERE tenant_id = ? AND operation_key = ?
  `).bind(tenantId, operationKey);
}

function assertion(
  db: CanonicalBatchDatabase,
  input: {
    tenantId: string;
    operationKey: string;
    stepKey: string;
    expectedChanges: number;
    createdAtUtc: string;
  },
): CanonicalPreparedStatement {
  return db.prepare(`
    INSERT INTO canonical_sync_batch_assertions (
      tenant_id,operation_key,step_key,assertion_value,created_at_utc
    ) VALUES (?, ?, ?, CASE WHEN changes() = ? THEN 1 ELSE 0 END, ?)
  `).bind(
    input.tenantId,
    input.operationKey,
    input.stepKey,
    input.expectedChanges,
    input.createdAtUtc,
  );
}

function pushGuardedMutation(
  statements: CanonicalPreparedStatement[],
  db: CanonicalBatchDatabase,
  input: {
    mutation: CanonicalPreparedStatement;
    tenantId: string;
    operationKey: string;
    stepKey: string;
    expectedChanges?: number;
    appliedAtUtc: string;
  },
): void {
  statements.push(
    input.mutation,
    assertion(db, {
      tenantId: input.tenantId,
      operationKey: input.operationKey,
      stepKey: input.stepKey,
      expectedChanges: input.expectedChanges ?? 1,
      createdAtUtc: input.appliedAtUtc,
    }),
  );
}

function prepareEncounterStarted(
  db: CanonicalBatchDatabase,
  envelope: CanonicalSyncEnvelope,
  mutation: EncounterStartedMutation,
  operationKey: string,
  appliedAtUtc: string,
): CanonicalPreparedStatement[] {
  const statements: CanonicalPreparedStatement[] = [];
  pushGuardedMutation(statements, db, {
    tenantId: envelope.tenantId,
    operationKey,
    stepKey: 'encounter-start',
    appliedAtUtc,
    mutation: db.prepare(`
      INSERT INTO canonical_encounters (
        tenant_id,encounter_public_id,legacy_patient_id,encounter_type,status,
        started_at_utc,ended_at_utc,signed_snapshot_sha256,signed_at_utc,
        source_evidence_sha256,created_at_utc,updated_at_utc
      )
      SELECT ?, ?, p.id, ?, 'in_progress', ?, NULL, NULL, NULL, ?, ?, ?
      FROM patients p
      WHERE p.tenant_id = ? AND p.sync_key = ?
      ON CONFLICT (tenant_id,encounter_public_id) DO UPDATE SET
        updated_at_utc = excluded.updated_at_utc
      WHERE canonical_encounters.legacy_patient_id = excluded.legacy_patient_id
        AND canonical_encounters.encounter_type = excluded.encounter_type
        AND canonical_encounters.status = 'in_progress'
        AND canonical_encounters.started_at_utc = excluded.started_at_utc
        AND canonical_encounters.ended_at_utc IS NULL
        AND canonical_encounters.signed_snapshot_sha256 IS NULL
        AND canonical_encounters.signed_at_utc IS NULL
        AND canonical_encounters.source_evidence_sha256 = excluded.source_evidence_sha256
    `).bind(
      envelope.tenantId,
      envelope.entityPublicId,
      mutation.encounterType,
      mutation.startedAtUtc,
      mutation.sourceEvidenceSha256,
      mutation.startedAtUtc,
      appliedAtUtc,
      envelope.tenantId,
      mutation.patientSyncKey,
    ),
  });
  return statements;
}

function prepareEncounterCompleted(
  db: CanonicalBatchDatabase,
  envelope: CanonicalSyncEnvelope,
  mutation: EncounterCompletedMutation,
  operationKey: string,
  appliedAtUtc: string,
): CanonicalPreparedStatement[] {
  const statements: CanonicalPreparedStatement[] = [];
  pushGuardedMutation(statements, db, {
    tenantId: envelope.tenantId,
    operationKey,
    stepKey: 'encounter-complete',
    appliedAtUtc,
    mutation: db.prepare(`
      UPDATE canonical_encounters
      SET status = 'completed', ended_at_utc = ?, updated_at_utc = ?
      WHERE tenant_id = ? AND encounter_public_id = ?
        AND encounter_type = ?
        AND status = 'in_progress'
        AND started_at_utc = ?
        AND ended_at_utc IS NULL
        AND source_evidence_sha256 = ?
    `).bind(
      mutation.completedAtUtc,
      appliedAtUtc,
      envelope.tenantId,
      envelope.entityPublicId,
      mutation.encounterType,
      mutation.startedAtUtc,
      mutation.sourceEvidenceSha256,
    ),
  });
  return statements;
}

function prepareEncounterCancelled(
  db: CanonicalBatchDatabase,
  envelope: CanonicalSyncEnvelope,
  mutation: EncounterCancelledMutation,
  operationKey: string,
  appliedAtUtc: string,
): CanonicalPreparedStatement[] {
  const statements: CanonicalPreparedStatement[] = [];
  pushGuardedMutation(statements, db, {
    tenantId: envelope.tenantId,
    operationKey,
    stepKey: 'encounter-cancel',
    appliedAtUtc,
    mutation: db.prepare(`
      UPDATE canonical_encounters
      SET status = 'cancelled', ended_at_utc = ?, updated_at_utc = ?
      WHERE tenant_id = ? AND encounter_public_id = ?
        AND encounter_type = ?
        AND status = 'in_progress'
        AND started_at_utc = ?
        AND ended_at_utc IS NULL
        AND source_evidence_sha256 = ?
    `).bind(
      mutation.cancelledAtUtc,
      appliedAtUtc,
      envelope.tenantId,
      envelope.entityPublicId,
      mutation.encounterType,
      mutation.startedAtUtc,
      mutation.sourceEvidenceSha256,
    ),
  });
  return statements;
}

function prepareServiceRequestCreated(
  db: CanonicalBatchDatabase,
  envelope: CanonicalSyncEnvelope,
  mutation: ServiceRequestCreatedMutation,
  operationKey: string,
  appliedAtUtc: string,
): CanonicalPreparedStatement[] {
  const statements: CanonicalPreparedStatement[] = [];
  pushGuardedMutation(statements, db, {
    tenantId: envelope.tenantId,
    operationKey,
    stepKey: 'service-request-create',
    appliedAtUtc,
    mutation: db.prepare(`
      INSERT INTO canonical_service_requests (
        tenant_id,request_public_id,legacy_patient_id,encounter_public_id,
        service_public_id,requested_quantity,fulfilled_quantity,last_event_public_id,
        status,requested_at_utc,cancelled_at_utc,source_evidence_sha256,
        created_at_utc,updated_at_utc
      )
      SELECT ?, ?, p.id, ?, ?, ?, 0, NULL, 'active', ?, NULL, ?, ?, ?
      FROM patients p
      WHERE p.tenant_id = ? AND p.sync_key = ?
        AND EXISTS (
          SELECT 1 FROM canonical_service_catalog_items c
          WHERE c.tenant_id = ? AND c.service_public_id = ?
        )
        AND (
          ? IS NULL OR EXISTS (
            SELECT 1 FROM canonical_encounters e
            WHERE e.tenant_id = ? AND e.encounter_public_id = ?
          )
        )
      ON CONFLICT (tenant_id,request_public_id) DO UPDATE SET
        updated_at_utc = excluded.updated_at_utc
      WHERE canonical_service_requests.legacy_patient_id = excluded.legacy_patient_id
        AND COALESCE(canonical_service_requests.encounter_public_id,'') = COALESCE(excluded.encounter_public_id,'')
        AND canonical_service_requests.service_public_id = excluded.service_public_id
        AND canonical_service_requests.requested_quantity = excluded.requested_quantity
        AND canonical_service_requests.fulfilled_quantity = 0
        AND canonical_service_requests.last_event_public_id IS NULL
        AND canonical_service_requests.status = 'active'
        AND canonical_service_requests.requested_at_utc = excluded.requested_at_utc
        AND canonical_service_requests.cancelled_at_utc IS NULL
        AND canonical_service_requests.source_evidence_sha256 = excluded.source_evidence_sha256
    `).bind(
      envelope.tenantId,
      envelope.entityPublicId,
      mutation.encounterPublicId,
      mutation.servicePublicId,
      mutation.requestedQuantity,
      mutation.requestedAtUtc,
      mutation.sourceEvidenceSha256,
      mutation.requestedAtUtc,
      appliedAtUtc,
      envelope.tenantId,
      mutation.patientSyncKey,
      envelope.tenantId,
      mutation.servicePublicId,
      mutation.encounterPublicId,
      envelope.tenantId,
      mutation.encounterPublicId,
    ),
  });
  return statements;
}

function prepareServiceRequestCancelled(
  db: CanonicalBatchDatabase,
  envelope: CanonicalSyncEnvelope,
  mutation: ServiceRequestCancelledMutation,
  operationKey: string,
  appliedAtUtc: string,
): CanonicalPreparedStatement[] {
  const statements: CanonicalPreparedStatement[] = [];
  pushGuardedMutation(statements, db, {
    tenantId: envelope.tenantId,
    operationKey,
    stepKey: 'service-request-cancel',
    appliedAtUtc,
    mutation: db.prepare(`
      UPDATE canonical_service_requests
      SET status = 'cancelled', cancelled_at_utc = ?, updated_at_utc = ?
      WHERE tenant_id = ? AND request_public_id = ?
        AND COALESCE(encounter_public_id,'') = COALESCE(?,'')
        AND service_public_id = ?
        AND requested_quantity = ?
        AND fulfilled_quantity = ?
        AND status IN ('active','partially_fulfilled')
        AND requested_at_utc = ?
        AND cancelled_at_utc IS NULL
        AND source_evidence_sha256 = ?
    `).bind(
      mutation.cancelledAtUtc,
      appliedAtUtc,
      envelope.tenantId,
      envelope.entityPublicId,
      mutation.encounterPublicId,
      mutation.servicePublicId,
      mutation.requestedQuantity,
      mutation.fulfilledQuantity,
      mutation.requestedAtUtc,
      mutation.sourceEvidenceSha256,
    ),
  });
  return statements;
}

function requestStatusExpression(increment: number): string {
  return `CASE
    WHEN fulfilled_quantity + ${increment} = requested_quantity THEN 'fulfilled'
    WHEN fulfilled_quantity + ${increment} > 0 THEN 'partially_fulfilled'
    ELSE 'active'
  END`;
}

function prepareServiceEventRecorded(
  db: CanonicalBatchDatabase,
  envelope: CanonicalSyncEnvelope,
  mutation: ServiceEventRecordedMutation,
  operationKey: string,
  appliedAtUtc: string,
): CanonicalPreparedStatement[] {
  const increment = mutation.serviceEventType === 'accepted' ? 0 : mutation.quantity;
  const statusExpression = requestStatusExpression(increment);
  const statements: CanonicalPreparedStatement[] = [];

  pushGuardedMutation(statements, db, {
    tenantId: envelope.tenantId,
    operationKey,
    stepKey: 'service-request-fulfilment',
    appliedAtUtc,
    mutation: db.prepare(`
      UPDATE canonical_service_requests
      SET fulfilled_quantity = fulfilled_quantity + ?,
          status = ${statusExpression},
          last_event_public_id = ?,
          updated_at_utc = ?
      WHERE tenant_id = ? AND request_public_id = ?
        AND COALESCE(encounter_public_id,'') = COALESCE(?,'')
        AND service_public_id = ?
        AND status IN ('active','partially_fulfilled')
        AND requested_quantity >= fulfilled_quantity + ?
        AND last_event_public_id IS NULL
        AND ? = ${statusExpression}
    `).bind(
      increment,
      envelope.entityPublicId,
      appliedAtUtc,
      envelope.tenantId,
      mutation.requestPublicId,
      mutation.encounterPublicId,
      mutation.servicePublicId,
      increment,
      mutation.requestStatusAfter,
    ),
  });

  pushGuardedMutation(statements, db, {
    tenantId: envelope.tenantId,
    operationKey,
    stepKey: 'service-event-insert',
    appliedAtUtc,
    mutation: db.prepare(`
      INSERT INTO canonical_service_events (
        tenant_id,event_public_id,request_public_id,encounter_public_id,
        service_public_id,event_type,quantity,status,occurred_at_utc,
        cancelled_at_utc,source_evidence_sha256,created_at_utc,updated_at_utc
      )
      SELECT ?, ?, r.request_public_id, r.encounter_public_id, r.service_public_id,
             ?, ?, 'posted', ?, NULL, ?, ?, ?
      FROM canonical_service_requests r
      WHERE r.tenant_id = ? AND r.request_public_id = ?
        AND r.last_event_public_id = ?
        AND COALESCE(r.encounter_public_id,'') = COALESCE(?,'')
        AND r.service_public_id = ?
        AND r.status = ?
      ON CONFLICT (tenant_id,event_public_id) DO UPDATE SET
        updated_at_utc = excluded.updated_at_utc
      WHERE COALESCE(canonical_service_events.request_public_id,'') = COALESCE(excluded.request_public_id,'')
        AND COALESCE(canonical_service_events.encounter_public_id,'') = COALESCE(excluded.encounter_public_id,'')
        AND canonical_service_events.service_public_id = excluded.service_public_id
        AND canonical_service_events.event_type = excluded.event_type
        AND canonical_service_events.quantity = excluded.quantity
        AND canonical_service_events.status = 'posted'
        AND canonical_service_events.occurred_at_utc = excluded.occurred_at_utc
        AND canonical_service_events.cancelled_at_utc IS NULL
        AND canonical_service_events.source_evidence_sha256 = excluded.source_evidence_sha256
    `).bind(
      envelope.tenantId,
      envelope.entityPublicId,
      mutation.serviceEventType,
      mutation.quantity,
      mutation.occurredAtUtc,
      mutation.sourceEvidenceSha256,
      mutation.occurredAtUtc,
      appliedAtUtc,
      envelope.tenantId,
      mutation.requestPublicId,
      envelope.entityPublicId,
      mutation.encounterPublicId,
      mutation.servicePublicId,
      mutation.requestStatusAfter,
    ),
  });
  return statements;
}

function prepareServiceEventCancelled(
  db: CanonicalBatchDatabase,
  envelope: CanonicalSyncEnvelope,
  mutation: ServiceEventCancelledMutation,
  operationKey: string,
  appliedAtUtc: string,
): CanonicalPreparedStatement[] {
  const statements: CanonicalPreparedStatement[] = [];
  pushGuardedMutation(statements, db, {
    tenantId: envelope.tenantId,
    operationKey,
    stepKey: 'service-request-fulfilment-reverse',
    appliedAtUtc,
    mutation: db.prepare(`
      UPDATE canonical_service_requests
      SET fulfilled_quantity = ?, status = ?, last_event_public_id = ?, updated_at_utc = ?
      WHERE tenant_id = ? AND request_public_id = ?
        AND COALESCE(encounter_public_id,'') = COALESCE(?,'')
        AND service_public_id = ?
        AND requested_quantity = ?
        AND fulfilled_quantity = ?
        AND status = ?
        AND last_event_public_id = ?
        AND cancelled_at_utc IS NULL
        AND (
          ? IS NULL OR EXISTS (
            SELECT 1 FROM canonical_service_events prior
            WHERE prior.tenant_id = ? AND prior.event_public_id = ?
              AND prior.request_public_id = ? AND prior.status = 'posted'
          )
        )
    `).bind(
      mutation.fulfilledQuantityAfter,
      mutation.requestStatusAfter,
      mutation.previousEventPublicId,
      appliedAtUtc,
      envelope.tenantId,
      mutation.requestPublicId,
      mutation.encounterPublicId,
      mutation.servicePublicId,
      mutation.requestedQuantity,
      mutation.fulfilledQuantityBefore,
      mutation.requestStatusBefore,
      envelope.entityPublicId,
      mutation.previousEventPublicId,
      envelope.tenantId,
      mutation.previousEventPublicId,
      mutation.requestPublicId,
    ),
  });
  pushGuardedMutation(statements, db, {
    tenantId: envelope.tenantId,
    operationKey,
    stepKey: 'service-event-cancel',
    appliedAtUtc,
    mutation: db.prepare(`
      UPDATE canonical_service_events
      SET status = 'cancelled', cancelled_at_utc = ?, updated_at_utc = ?
      WHERE tenant_id = ? AND event_public_id = ? AND request_public_id = ?
        AND COALESCE(encounter_public_id,'') = COALESCE(?,'')
        AND service_public_id = ? AND event_type = ? AND quantity = ?
        AND status = 'posted' AND occurred_at_utc = ? AND cancelled_at_utc IS NULL
        AND source_evidence_sha256 = ?
    `).bind(
      mutation.cancelledAtUtc,
      appliedAtUtc,
      envelope.tenantId,
      envelope.entityPublicId,
      mutation.requestPublicId,
      mutation.encounterPublicId,
      mutation.servicePublicId,
      mutation.serviceEventType,
      mutation.quantity,
      mutation.occurredAtUtc,
      mutation.sourceEvidenceSha256,
    ),
  });
  return statements;
}

function prepareInvoiceIssued(
  db: CanonicalBatchDatabase,
  envelope: CanonicalSyncEnvelope,
  mutation: InvoiceIssuedMutation,
  operationKey: string,
  appliedAtUtc: string,
): CanonicalPreparedStatement[] {
  const statements: CanonicalPreparedStatement[] = [];
  pushGuardedMutation(statements, db, {
    tenantId: envelope.tenantId,
    operationKey,
    stepKey: 'invoice-header',
    appliedAtUtc,
    mutation: db.prepare(`
      INSERT INTO canonical_invoices (
        tenant_id,invoice_public_id,invoice_number,legacy_patient_id,currency_code,
        subtotal_minor,adjustment_total_minor,total_minor,paid_minor,due_minor,
        credited_minor,net_due_minor,adjustment_projection_guard,status,
        issued_at_utc,posted_at_utc,cancelled_at_utc,reversed_at_utc,
        source_evidence_sha256,created_at_utc,updated_at_utc
      )
      SELECT ?, ?, ?, p.id, ?, ?, ?, ?, 0, ?, 0, ?, 1, 'posted', ?, ?, NULL, NULL, ?, ?, ?
      FROM patients p
      WHERE p.tenant_id = ? AND p.sync_key = ?
      ON CONFLICT (tenant_id,invoice_public_id) DO UPDATE SET
        updated_at_utc = excluded.updated_at_utc
      WHERE canonical_invoices.invoice_number = excluded.invoice_number
        AND canonical_invoices.legacy_patient_id = excluded.legacy_patient_id
        AND canonical_invoices.currency_code = excluded.currency_code
        AND canonical_invoices.subtotal_minor = excluded.subtotal_minor
        AND canonical_invoices.adjustment_total_minor = excluded.adjustment_total_minor
        AND canonical_invoices.total_minor = excluded.total_minor
        AND canonical_invoices.paid_minor = 0
        AND canonical_invoices.due_minor = excluded.total_minor
        AND canonical_invoices.credited_minor = 0
        AND canonical_invoices.net_due_minor = excluded.total_minor
        AND canonical_invoices.adjustment_projection_guard = 1
        AND canonical_invoices.status = 'posted'
        AND canonical_invoices.issued_at_utc = excluded.issued_at_utc
        AND canonical_invoices.posted_at_utc = excluded.posted_at_utc
        AND canonical_invoices.cancelled_at_utc IS NULL
        AND canonical_invoices.reversed_at_utc IS NULL
        AND canonical_invoices.source_evidence_sha256 = excluded.source_evidence_sha256
    `).bind(
      envelope.tenantId,
      envelope.entityPublicId,
      mutation.invoiceNumber,
      mutation.currencyCode,
      mutation.subtotalMinor,
      mutation.adjustmentTotalMinor,
      mutation.totalMinor,
      mutation.totalMinor,
      mutation.totalMinor,
      mutation.issuedAtUtc,
      mutation.issuedAtUtc,
      mutation.sourceEvidenceSha256,
      mutation.issuedAtUtc,
      appliedAtUtc,
      envelope.tenantId,
      mutation.patientSyncKey,
    ),
  });

  mutation.lines.forEach((line, index) => {
    pushGuardedMutation(statements, db, {
      tenantId: envelope.tenantId,
      operationKey,
      stepKey: `invoice-line-${index + 1}`,
      appliedAtUtc,
      mutation: db.prepare(`
        INSERT INTO canonical_invoice_lines (
          tenant_id,line_public_id,invoice_public_id,line_type,service_event_public_id,
          adjustment_code,quantity,unit_amount_minor,line_amount_minor,
          source_evidence_sha256,created_at_utc,updated_at_utc
        )
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM canonical_invoices i
          WHERE i.tenant_id = ? AND i.invoice_public_id = ? AND i.status = 'posted'
        )
          AND (
            ? <> 'service' OR EXISTS (
              SELECT 1 FROM canonical_service_events e
              WHERE e.tenant_id = ? AND e.event_public_id = ?
            )
          )
        ON CONFLICT (tenant_id,line_public_id) DO UPDATE SET
          updated_at_utc = excluded.updated_at_utc
        WHERE canonical_invoice_lines.invoice_public_id = excluded.invoice_public_id
          AND canonical_invoice_lines.line_type = excluded.line_type
          AND COALESCE(canonical_invoice_lines.service_event_public_id,'') = COALESCE(excluded.service_event_public_id,'')
          AND COALESCE(canonical_invoice_lines.adjustment_code,'') = COALESCE(excluded.adjustment_code,'')
          AND canonical_invoice_lines.quantity = excluded.quantity
          AND canonical_invoice_lines.unit_amount_minor = excluded.unit_amount_minor
          AND canonical_invoice_lines.line_amount_minor = excluded.line_amount_minor
          AND canonical_invoice_lines.source_evidence_sha256 = excluded.source_evidence_sha256
      `).bind(
        envelope.tenantId,
        line.linePublicId,
        envelope.entityPublicId,
        line.lineType,
        line.serviceEventPublicId,
        line.adjustmentCode,
        line.quantity,
        line.unitAmountMinor,
        line.lineAmountMinor,
        line.sourceEvidenceSha256,
        mutation.issuedAtUtc,
        appliedAtUtc,
        envelope.tenantId,
        envelope.entityPublicId,
        line.lineType,
        envelope.tenantId,
        line.serviceEventPublicId,
      ),
    });
  });

  if (mutation.encounterLink) {
    const link = mutation.encounterLink;
    pushGuardedMutation(statements, db, {
      tenantId: envelope.tenantId,
      operationKey,
      stepKey: 'invoice-encounter-link',
      appliedAtUtc,
      mutation: db.prepare(`
        INSERT INTO canonical_invoice_encounter_links (
          tenant_id,invoice_public_id,encounter_public_id,legacy_admission_id,
          link_type,source_evidence_sha256,created_at_utc,updated_at_utc
        )
        SELECT ?, ?, a.encounter_public_id, a.legacy_admission_id, ?, ?, ?, ?
        FROM canonical_encounter_admission_links a
        WHERE a.tenant_id = ?
          AND a.encounter_public_id = ?
          AND a.admission_no = ?
          AND a.link_status = 'active'
          AND EXISTS (
            SELECT 1 FROM canonical_invoices i
            WHERE i.tenant_id = ? AND i.invoice_public_id = ?
          )
        ON CONFLICT (tenant_id,invoice_public_id) DO UPDATE SET
          updated_at_utc = excluded.updated_at_utc
        WHERE canonical_invoice_encounter_links.encounter_public_id = excluded.encounter_public_id
          AND canonical_invoice_encounter_links.legacy_admission_id = excluded.legacy_admission_id
          AND canonical_invoice_encounter_links.link_type = excluded.link_type
          AND canonical_invoice_encounter_links.source_evidence_sha256 = excluded.source_evidence_sha256
      `).bind(
        envelope.tenantId,
        envelope.entityPublicId,
        link.linkType,
        link.sourceEvidenceSha256,
        mutation.issuedAtUtc,
        appliedAtUtc,
        envelope.tenantId,
        link.encounterPublicId,
        link.admissionNo,
        envelope.tenantId,
        envelope.entityPublicId,
      ),
    });
  }
  return statements;
}

function prepareInvoiceCancelled(
  db: CanonicalBatchDatabase,
  envelope: CanonicalSyncEnvelope,
  mutation: InvoiceCancelledMutation,
  operationKey: string,
  appliedAtUtc: string,
): CanonicalPreparedStatement[] {
  const statements: CanonicalPreparedStatement[] = [];

  pushGuardedMutation(statements, db, {
    tenantId: envelope.tenantId,
    operationKey,
    stepKey: 'invoice-cancel',
    appliedAtUtc,
    mutation: db.prepare(`
      UPDATE canonical_invoices
      SET status = 'cancelled',
          cancelled_at_utc = ?,
          updated_at_utc = ?
      WHERE tenant_id = ? AND invoice_public_id = ?
        AND total_minor = ?
        AND status = 'posted'
        AND paid_minor = 0
        AND due_minor = total_minor
        AND credited_minor = 0
        AND net_due_minor = total_minor
        AND cancelled_at_utc IS NULL
    `).bind(
      mutation.cancelledAtUtc,
      appliedAtUtc,
      envelope.tenantId,
      envelope.entityPublicId,
      mutation.totalMinor,
    ),
  });

  mutation.compensationAdjustments.forEach((adjustment, index) => {
    pushGuardedMutation(statements, db, {
      tenantId: envelope.tenantId,
      operationKey,
      stepKey: `invoice-cancel-accrual-${index + 1}`,
      appliedAtUtc,
      mutation: db.prepare(`
        UPDATE canonical_compensation_accruals
        SET adjusted_minor = ?,
            payable_minor = ?,
            status = ?,
            updated_at_utc = ?
        WHERE tenant_id = ? AND accrual_public_id = ?
          AND invoice_public_id = ?
          AND adjusted_minor = ?
          AND settled_minor = ?
          AND payable_minor = ?
          AND status = ?
      `).bind(
        adjustment.adjustedAfterMinor,
        adjustment.payableAfterMinor,
        adjustment.statusAfter,
        appliedAtUtc,
        envelope.tenantId,
        adjustment.accrualPublicId,
        envelope.entityPublicId,
        adjustment.adjustedBeforeMinor,
        adjustment.settledBeforeMinor,
        adjustment.payableBeforeMinor,
        adjustment.statusBefore,
      ),
    });

    pushGuardedMutation(statements, db, {
      tenantId: envelope.tenantId,
      operationKey,
      stepKey: `invoice-cancel-adjustment-${index + 1}`,
      appliedAtUtc,
      mutation: db.prepare(`
        INSERT INTO canonical_compensation_adjustments (
          tenant_id,adjustment_public_id,accrual_public_id,settlement_public_id,
          settlement_allocation_public_id,adjustment_type,reason_code,amount_minor,
          accrual_adjusted_before_minor,accrual_adjusted_after_minor,
          accrual_settled_before_minor,accrual_settled_after_minor,
          accrual_payable_before_minor,accrual_payable_after_minor,
          occurred_at_utc,business_date,balance_guard,source_evidence_sha256
        )
        SELECT ?, ?, a.accrual_public_id, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?
        FROM canonical_compensation_accruals a
        WHERE a.tenant_id = ?
          AND a.accrual_public_id = ?
          AND a.invoice_public_id = ?
          AND a.adjusted_minor = ?
          AND a.settled_minor = ?
          AND a.payable_minor = ?
          AND a.status = ?
      `).bind(
        envelope.tenantId,
        adjustment.adjustmentPublicId,
        adjustment.adjustmentType,
        adjustment.reasonCode,
        adjustment.amountMinor,
        adjustment.adjustedBeforeMinor,
        adjustment.adjustedAfterMinor,
        adjustment.settledBeforeMinor,
        adjustment.settledAfterMinor,
        adjustment.payableBeforeMinor,
        adjustment.payableAfterMinor,
        adjustment.occurredAtUtc,
        adjustment.businessDate,
        adjustment.sourceEvidenceSha256,
        envelope.tenantId,
        adjustment.accrualPublicId,
        envelope.entityPublicId,
        adjustment.adjustedAfterMinor,
        adjustment.settledAfterMinor,
        adjustment.payableAfterMinor,
        adjustment.statusAfter,
      ),
    });
  });

  pushGuardedMutation(statements, db, {
    tenantId: envelope.tenantId,
    operationKey,
    stepKey: 'invoice-cancel-projection-guard',
    appliedAtUtc,
    mutation: db.prepare(`
      UPDATE canonical_invoices
      SET adjustment_projection_guard = 1,
          updated_at_utc = ?
      WHERE tenant_id = ? AND invoice_public_id = ?
        AND total_minor = ?
        AND status = 'cancelled'
        AND cancelled_at_utc = ?
        AND paid_minor = 0
        AND due_minor = total_minor
        AND credited_minor = 0
        AND net_due_minor = total_minor
        AND NOT EXISTS (
          SELECT 1
          FROM canonical_compensation_accruals a
          WHERE a.tenant_id = canonical_invoices.tenant_id
            AND a.invoice_public_id = canonical_invoices.invoice_public_id
            AND (a.settled_minor > 0 OR a.payable_minor > 0)
        )
    `).bind(
      appliedAtUtc,
      envelope.tenantId,
      envelope.entityPublicId,
      mutation.totalMinor,
      mutation.cancelledAtUtc,
    ),
  });

  return statements;
}

function preparePaymentReceiptRecorded(
  db: CanonicalBatchDatabase,
  envelope: CanonicalSyncEnvelope,
  mutation: PaymentReceiptRecordedMutation,
  operationKey: string,
  appliedAtUtc: string,
): CanonicalPreparedStatement[] {
  const statements: CanonicalPreparedStatement[] = [];

  pushGuardedMutation(statements, db, {
    tenantId: envelope.tenantId,
    operationKey,
    stepKey: 'payment-receipt',
    appliedAtUtc,
    mutation: db.prepare(`
      INSERT INTO canonical_payment_receipts (
        tenant_id,receipt_public_id,receipt_number,legacy_patient_id,currency_code,
        total_minor,allocated_total_minor,unallocated_minor,status,received_at_utc,
        business_date,legacy_collector_id,legacy_counter_id,legacy_counter_session_id,
        external_transaction_id,posted_at_utc,failed_at_utc,reversed_at_utc,
        reconciliation_guard,source_evidence_sha256,created_at_utc,updated_at_utc,
        refunded_minor,net_received_minor,refund_projection_guard
      )
      SELECT ?, ?, ?, p.id, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, NULL,
             1, ?, ?, ?, 0, ?, 1
      FROM patients p
      WHERE p.tenant_id = ? AND p.sync_key = ?
      ON CONFLICT (tenant_id,receipt_public_id) DO UPDATE SET
        updated_at_utc = excluded.updated_at_utc
      WHERE canonical_payment_receipts.receipt_number = excluded.receipt_number
        AND canonical_payment_receipts.legacy_patient_id = excluded.legacy_patient_id
        AND canonical_payment_receipts.currency_code = excluded.currency_code
        AND canonical_payment_receipts.total_minor = excluded.total_minor
        AND canonical_payment_receipts.allocated_total_minor = excluded.allocated_total_minor
        AND canonical_payment_receipts.unallocated_minor = excluded.unallocated_minor
        AND canonical_payment_receipts.status = excluded.status
        AND canonical_payment_receipts.received_at_utc = excluded.received_at_utc
        AND canonical_payment_receipts.business_date = excluded.business_date
        AND canonical_payment_receipts.legacy_collector_id IS NULL
        AND canonical_payment_receipts.legacy_counter_id IS NULL
        AND canonical_payment_receipts.legacy_counter_session_id IS NULL
        AND COALESCE(canonical_payment_receipts.external_transaction_id,'') = COALESCE(excluded.external_transaction_id,'')
        AND COALESCE(canonical_payment_receipts.posted_at_utc,'') = COALESCE(excluded.posted_at_utc,'')
        AND COALESCE(canonical_payment_receipts.failed_at_utc,'') = COALESCE(excluded.failed_at_utc,'')
        AND canonical_payment_receipts.reversed_at_utc IS NULL
        AND canonical_payment_receipts.refunded_minor = 0
        AND canonical_payment_receipts.net_received_minor = excluded.total_minor
        AND canonical_payment_receipts.refund_projection_guard = 1
        AND canonical_payment_receipts.source_evidence_sha256 = excluded.source_evidence_sha256
    `).bind(
      envelope.tenantId,
      envelope.entityPublicId,
      mutation.receiptNumber,
      mutation.currencyCode,
      mutation.totalMinor,
      mutation.allocatedTotalMinor,
      mutation.unallocatedMinor,
      mutation.status,
      mutation.receivedAtUtc,
      mutation.businessDate,
      mutation.externalTransactionId,
      mutation.postedAtUtc,
      mutation.failedAtUtc,
      mutation.sourceEvidenceSha256,
      mutation.receivedAtUtc,
      appliedAtUtc,
      mutation.totalMinor,
      envelope.tenantId,
      mutation.patientSyncKey,
    ),
  });

  mutation.tenders.forEach((tender, index) => {
    pushGuardedMutation(statements, db, {
      tenantId: envelope.tenantId,
      operationKey,
      stepKey: `payment-tender-${index + 1}`,
      appliedAtUtc,
      mutation: db.prepare(`
        INSERT INTO canonical_payment_tenders (
          tenant_id,tender_public_id,receipt_public_id,tender_type,method_code,
          amount_minor,status,external_transaction_id,captured_at_utc,failed_at_utc,
          reversed_at_utc,source_evidence_sha256,created_at_utc,updated_at_utc,
          reversed_minor,remaining_minor,reversal_projection_guard
        ) VALUES (?,?,?,?,?,?,?,?,?,?,NULL,?,?,?,0,?,1)
        ON CONFLICT (tenant_id,tender_public_id) DO UPDATE SET
          updated_at_utc = excluded.updated_at_utc
        WHERE canonical_payment_tenders.receipt_public_id = excluded.receipt_public_id
          AND canonical_payment_tenders.tender_type = excluded.tender_type
          AND canonical_payment_tenders.method_code = excluded.method_code
          AND canonical_payment_tenders.amount_minor = excluded.amount_minor
          AND canonical_payment_tenders.status = excluded.status
          AND COALESCE(canonical_payment_tenders.external_transaction_id,'') = COALESCE(excluded.external_transaction_id,'')
          AND COALESCE(canonical_payment_tenders.captured_at_utc,'') = COALESCE(excluded.captured_at_utc,'')
          AND COALESCE(canonical_payment_tenders.failed_at_utc,'') = COALESCE(excluded.failed_at_utc,'')
          AND canonical_payment_tenders.reversed_at_utc IS NULL
          AND canonical_payment_tenders.reversed_minor = 0
          AND canonical_payment_tenders.remaining_minor = excluded.amount_minor
          AND canonical_payment_tenders.reversal_projection_guard = 1
          AND canonical_payment_tenders.source_evidence_sha256 = excluded.source_evidence_sha256
      `).bind(
        envelope.tenantId,
        tender.tenderPublicId,
        envelope.entityPublicId,
        tender.tenderType,
        tender.methodCode,
        tender.amountMinor,
        tender.status,
        tender.externalTransactionId,
        tender.capturedAtUtc,
        tender.failedAtUtc,
        tender.sourceEvidenceSha256,
        mutation.receivedAtUtc,
        appliedAtUtc,
        tender.amountMinor,
      ),
    });
  });

  mutation.allocations.forEach((allocation, index) => {
    pushGuardedMutation(statements, db, {
      tenantId: envelope.tenantId,
      operationKey,
      stepKey: `payment-invoice-${index + 1}`,
      appliedAtUtc,
      mutation: db.prepare(`
        UPDATE canonical_invoices
        SET paid_minor = CASE
              WHEN due_minor = ? AND NOT EXISTS (
                SELECT 1 FROM canonical_payment_allocations a
                WHERE a.tenant_id = ? AND a.allocation_public_id = ?
              ) THEN paid_minor + ?
              ELSE paid_minor
            END,
            due_minor = ?,
            net_due_minor = ?,
            updated_at_utc = ?
        WHERE tenant_id = ? AND invoice_public_id = ? AND status = 'posted'
          AND paid_minor + due_minor = total_minor
          AND net_due_minor = due_minor - credited_minor
          AND (
            (
              due_minor = ?
              AND net_due_minor >= ?
              AND NOT EXISTS (
                SELECT 1 FROM canonical_payment_allocations a
                WHERE a.tenant_id = ? AND a.allocation_public_id = ?
              )
            )
            OR (
              due_minor = ?
              AND net_due_minor = ? - credited_minor
              AND EXISTS (
                SELECT 1 FROM canonical_payment_allocations a
                WHERE a.tenant_id = ? AND a.allocation_public_id = ?
                  AND a.receipt_public_id = ? AND a.invoice_public_id = ?
                  AND COALESCE(a.invoice_line_public_id,'') = COALESCE(?,'')
                  AND a.amount_minor = ?
                  AND a.invoice_due_before_minor = ?
                  AND a.invoice_due_after_minor = ?
                  AND a.status = 'active'
                  AND a.reversed_minor = 0
                  AND a.remaining_minor = a.amount_minor
              )
            )
          )
      `).bind(
        allocation.invoiceDueBeforeMinor,
        envelope.tenantId,
        allocation.allocationPublicId,
        allocation.amountMinor,
        allocation.invoiceDueAfterMinor,
        allocation.invoiceDueAfterMinor,
        appliedAtUtc,
        envelope.tenantId,
        allocation.invoicePublicId,
        allocation.invoiceDueBeforeMinor,
        allocation.amountMinor,
        envelope.tenantId,
        allocation.allocationPublicId,
        allocation.invoiceDueAfterMinor,
        allocation.invoiceDueAfterMinor,
        envelope.tenantId,
        allocation.allocationPublicId,
        envelope.entityPublicId,
        allocation.invoicePublicId,
        allocation.invoiceLinePublicId,
        allocation.amountMinor,
        allocation.invoiceDueBeforeMinor,
        allocation.invoiceDueAfterMinor,
      ),
    });

    pushGuardedMutation(statements, db, {
      tenantId: envelope.tenantId,
      operationKey,
      stepKey: `payment-allocation-${index + 1}`,
      appliedAtUtc,
      mutation: db.prepare(`
        INSERT INTO canonical_payment_allocations (
          tenant_id,allocation_public_id,receipt_public_id,invoice_public_id,
          invoice_line_public_id,amount_minor,invoice_due_before_minor,
          invoice_due_after_minor,status,allocated_at_utc,reversed_at_utc,
          balance_guard,source_evidence_sha256,created_at_utc,updated_at_utc,
          reversed_minor,remaining_minor,reversal_projection_guard
        )
        SELECT ?, ?, ?, i.invoice_public_id, ?, ?, ?, ?, 'active', ?, NULL,
               1, ?, ?, ?, 0, ?, 1
        FROM canonical_invoices i
        WHERE i.tenant_id = ? AND i.invoice_public_id = ? AND i.status = 'posted'
          AND i.due_minor = ?
          AND i.net_due_minor = i.due_minor - i.credited_minor
          AND (
            ? IS NULL OR EXISTS (
              SELECT 1 FROM canonical_invoice_lines l
              WHERE l.tenant_id = i.tenant_id
                AND l.invoice_public_id = i.invoice_public_id
                AND l.line_public_id = ?
            )
          )
        ON CONFLICT (tenant_id,allocation_public_id) DO UPDATE SET
          updated_at_utc = excluded.updated_at_utc
        WHERE canonical_payment_allocations.receipt_public_id = excluded.receipt_public_id
          AND canonical_payment_allocations.invoice_public_id = excluded.invoice_public_id
          AND COALESCE(canonical_payment_allocations.invoice_line_public_id,'') = COALESCE(excluded.invoice_line_public_id,'')
          AND canonical_payment_allocations.amount_minor = excluded.amount_minor
          AND canonical_payment_allocations.invoice_due_before_minor = excluded.invoice_due_before_minor
          AND canonical_payment_allocations.invoice_due_after_minor = excluded.invoice_due_after_minor
          AND canonical_payment_allocations.status = 'active'
          AND canonical_payment_allocations.allocated_at_utc = excluded.allocated_at_utc
          AND canonical_payment_allocations.reversed_at_utc IS NULL
          AND canonical_payment_allocations.reversed_minor = 0
          AND canonical_payment_allocations.remaining_minor = excluded.amount_minor
          AND canonical_payment_allocations.reversal_projection_guard = 1
          AND canonical_payment_allocations.source_evidence_sha256 = excluded.source_evidence_sha256
      `).bind(
        envelope.tenantId,
        allocation.allocationPublicId,
        envelope.entityPublicId,
        allocation.invoiceLinePublicId,
        allocation.amountMinor,
        allocation.invoiceDueBeforeMinor,
        allocation.invoiceDueAfterMinor,
        allocation.allocatedAtUtc,
        allocation.sourceEvidenceSha256,
        allocation.allocatedAtUtc,
        appliedAtUtc,
        allocation.amountMinor,
        envelope.tenantId,
        allocation.invoicePublicId,
        allocation.invoiceDueAfterMinor,
        allocation.invoiceLinePublicId,
        allocation.invoiceLinePublicId,
      ),
    });
  });

  pushGuardedMutation(statements, db, {
    tenantId: envelope.tenantId,
    operationKey,
    stepKey: 'payment-reconciliation',
    appliedAtUtc,
    mutation: db.prepare(`
      UPDATE canonical_payment_receipts
      SET reconciliation_guard = 1,
          updated_at_utc = ?
      WHERE tenant_id = ? AND receipt_public_id = ?
        AND total_minor = COALESCE((
          SELECT SUM(amount_minor) FROM canonical_payment_tenders
          WHERE tenant_id = ? AND receipt_public_id = ?
        ),0)
        AND allocated_total_minor = COALESCE((
          SELECT SUM(amount_minor) FROM canonical_payment_allocations
          WHERE tenant_id = ? AND receipt_public_id = ? AND status = 'active'
        ),0)
        AND total_minor = allocated_total_minor + unallocated_minor
        AND (
          (status = 'posted' AND NOT EXISTS (
            SELECT 1 FROM canonical_payment_tenders
            WHERE tenant_id = ? AND receipt_public_id = ? AND status <> 'captured'
          ))
          OR (status = 'pending' AND allocated_total_minor = 0 AND unallocated_minor = total_minor
            AND NOT EXISTS (
              SELECT 1 FROM canonical_payment_tenders
              WHERE tenant_id = ? AND receipt_public_id = ? AND status <> 'verifying'
            ))
          OR (status = 'failed' AND allocated_total_minor = 0 AND unallocated_minor = total_minor
            AND NOT EXISTS (
              SELECT 1 FROM canonical_payment_tenders
              WHERE tenant_id = ? AND receipt_public_id = ? AND status <> 'failed'
            ))
        )
    `).bind(
      appliedAtUtc,
      envelope.tenantId,
      envelope.entityPublicId,
      envelope.tenantId,
      envelope.entityPublicId,
      envelope.tenantId,
      envelope.entityPublicId,
      envelope.tenantId,
      envelope.entityPublicId,
      envelope.tenantId,
      envelope.entityPublicId,
      envelope.tenantId,
      envelope.entityPublicId,
    ),
  });

  return statements;
}

function preparePaymentReversed(
  db: CanonicalBatchDatabase,
  envelope: CanonicalSyncEnvelope,
  mutation: PaymentReversedMutation,
  operationKey: string,
  appliedAtUtc: string,
): CanonicalPreparedStatement[] {
  const statements: CanonicalPreparedStatement[] = [];

  pushGuardedMutation(statements, db, {
    tenantId: envelope.tenantId,
    operationKey,
    stepKey: 'payment-reversal-record',
    appliedAtUtc,
    mutation: db.prepare(`
      INSERT INTO canonical_payment_reversals (
        tenant_id,reversal_public_id,receipt_public_id,tender_public_id,
        allocation_public_id,invoice_public_id,amount_minor,reason_code,status,
        reversed_at_utc,business_date,allocation_reversed_before_minor,
        allocation_reversed_after_minor,tender_reversed_before_minor,
        tender_reversed_after_minor,receipt_refunded_before_minor,
        receipt_refunded_after_minor,invoice_paid_before_minor,invoice_paid_after_minor,
        invoice_due_before_minor,invoice_due_after_minor,invoice_net_due_before_minor,
        invoice_net_due_after_minor,compensation_guard,balance_guard,
        source_evidence_sha256,created_at_utc
      )
      SELECT ?,?,?,?,?,?,?,?,'posted',?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,1,?,?
      WHERE NOT EXISTS (
        SELECT 1 FROM canonical_compensation_accruals c
        WHERE c.tenant_id = ? AND c.invoice_public_id = ? AND c.settled_minor > 0
      )
    `).bind(
      envelope.tenantId,
      mutation.reversalPublicId,
      mutation.receiptPublicId,
      mutation.tenderPublicId,
      mutation.allocationPublicId,
      mutation.invoicePublicId,
      mutation.amountMinor,
      mutation.reasonCode,
      mutation.reversedAtUtc,
      mutation.businessDate,
      mutation.allocationReversedBeforeMinor,
      mutation.allocationReversedAfterMinor,
      mutation.tenderReversedBeforeMinor,
      mutation.tenderReversedAfterMinor,
      mutation.receiptRefundedBeforeMinor,
      mutation.receiptRefundedAfterMinor,
      mutation.invoicePaidBeforeMinor,
      mutation.invoicePaidAfterMinor,
      mutation.invoiceDueBeforeMinor,
      mutation.invoiceDueAfterMinor,
      mutation.invoiceNetDueBeforeMinor,
      mutation.invoiceNetDueAfterMinor,
      mutation.sourceEvidenceSha256,
      appliedAtUtc,
      envelope.tenantId,
      mutation.invoicePublicId,
    ),
  });

  pushGuardedMutation(statements, db, {
    tenantId: envelope.tenantId,
    operationKey,
    stepKey: 'payment-refund-record',
    appliedAtUtc,
    mutation: db.prepare(`
      INSERT INTO canonical_refunds (
        tenant_id,refund_public_id,source_type,deposit_public_id,receipt_public_id,
        tender_public_id,allocation_public_id,payment_reversal_public_id,amount_minor,
        tender_type,method_code,status,refunded_at_utc,business_date,reversed_at_utc,
        source_available_before_minor,source_available_after_minor,liability_guard,
        source_evidence_sha256,created_at_utc,updated_at_utc
      ) VALUES (?,?,'payment',NULL,?,?,?,?,?,?,?,'posted',?,?,NULL,NULL,NULL,1,?,?,?)
    `).bind(
      envelope.tenantId,
      mutation.refundPublicId,
      mutation.receiptPublicId,
      mutation.tenderPublicId,
      mutation.allocationPublicId,
      mutation.reversalPublicId,
      mutation.amountMinor,
      mutation.tenderType,
      mutation.methodCode,
      mutation.reversedAtUtc,
      mutation.businessDate,
      mutation.refundSourceEvidenceSha256,
      mutation.reversedAtUtc,
      appliedAtUtc,
    ),
  });

  pushGuardedMutation(statements, db, {
    tenantId: envelope.tenantId,
    operationKey,
    stepKey: 'payment-reversal-allocation',
    appliedAtUtc,
    mutation: db.prepare(`
      UPDATE canonical_payment_allocations
      SET reversed_minor = ?,
          remaining_minor = amount_minor - ?,
          status = CASE WHEN amount_minor = ? THEN 'reversed' ELSE 'active' END,
          reversed_at_utc = CASE WHEN amount_minor = ? THEN ? ELSE NULL END,
          updated_at_utc = ?
      WHERE tenant_id = ? AND allocation_public_id = ?
        AND receipt_public_id = ? AND invoice_public_id = ?
        AND status = 'active'
        AND reversed_minor = ?
        AND remaining_minor = amount_minor - ?
        AND remaining_minor >= ?
    `).bind(
      mutation.allocationReversedAfterMinor,
      mutation.allocationReversedAfterMinor,
      mutation.allocationReversedAfterMinor,
      mutation.allocationReversedAfterMinor,
      mutation.reversedAtUtc,
      appliedAtUtc,
      envelope.tenantId,
      mutation.allocationPublicId,
      mutation.receiptPublicId,
      mutation.invoicePublicId,
      mutation.allocationReversedBeforeMinor,
      mutation.allocationReversedBeforeMinor,
      mutation.amountMinor,
    ),
  });

  pushGuardedMutation(statements, db, {
    tenantId: envelope.tenantId,
    operationKey,
    stepKey: 'payment-reversal-tender',
    appliedAtUtc,
    mutation: db.prepare(`
      UPDATE canonical_payment_tenders
      SET reversed_minor = ?,
          remaining_minor = amount_minor - ?,
          status = CASE WHEN amount_minor = ? THEN 'reversed' ELSE 'captured' END,
          reversed_at_utc = CASE WHEN amount_minor = ? THEN ? ELSE NULL END,
          updated_at_utc = ?
      WHERE tenant_id = ? AND tender_public_id = ?
        AND receipt_public_id = ?
        AND tender_type = ? AND method_code = ?
        AND status = 'captured'
        AND reversed_minor = ?
        AND remaining_minor = amount_minor - ?
        AND remaining_minor >= ?
    `).bind(
      mutation.tenderReversedAfterMinor,
      mutation.tenderReversedAfterMinor,
      mutation.tenderReversedAfterMinor,
      mutation.tenderReversedAfterMinor,
      mutation.reversedAtUtc,
      appliedAtUtc,
      envelope.tenantId,
      mutation.tenderPublicId,
      mutation.receiptPublicId,
      mutation.tenderType,
      mutation.methodCode,
      mutation.tenderReversedBeforeMinor,
      mutation.tenderReversedBeforeMinor,
      mutation.amountMinor,
    ),
  });

  pushGuardedMutation(statements, db, {
    tenantId: envelope.tenantId,
    operationKey,
    stepKey: 'payment-reversal-receipt',
    appliedAtUtc,
    mutation: db.prepare(`
      UPDATE canonical_payment_receipts
      SET refunded_minor = ?,
          net_received_minor = total_minor - ?,
          status = CASE WHEN total_minor = ? THEN 'reversed' ELSE 'posted' END,
          reversed_at_utc = CASE WHEN total_minor = ? THEN ? ELSE NULL END,
          updated_at_utc = ?
      WHERE tenant_id = ? AND receipt_public_id = ?
        AND status = 'posted'
        AND refunded_minor = ?
        AND net_received_minor = total_minor - ?
        AND net_received_minor >= ?
    `).bind(
      mutation.receiptRefundedAfterMinor,
      mutation.receiptRefundedAfterMinor,
      mutation.receiptRefundedAfterMinor,
      mutation.receiptRefundedAfterMinor,
      mutation.reversedAtUtc,
      appliedAtUtc,
      envelope.tenantId,
      mutation.receiptPublicId,
      mutation.receiptRefundedBeforeMinor,
      mutation.receiptRefundedBeforeMinor,
      mutation.amountMinor,
    ),
  });

  pushGuardedMutation(statements, db, {
    tenantId: envelope.tenantId,
    operationKey,
    stepKey: 'payment-reversal-invoice',
    appliedAtUtc,
    mutation: db.prepare(`
      UPDATE canonical_invoices
      SET paid_minor = ?, due_minor = ?, net_due_minor = ?, updated_at_utc = ?
      WHERE tenant_id = ? AND invoice_public_id = ? AND status = 'posted'
        AND paid_minor = ? AND due_minor = ? AND net_due_minor = ?
        AND net_due_minor = due_minor - credited_minor
    `).bind(
      mutation.invoicePaidAfterMinor,
      mutation.invoiceDueAfterMinor,
      mutation.invoiceNetDueAfterMinor,
      appliedAtUtc,
      envelope.tenantId,
      mutation.invoicePublicId,
      mutation.invoicePaidBeforeMinor,
      mutation.invoiceDueBeforeMinor,
      mutation.invoiceNetDueBeforeMinor,
    ),
  });

  pushGuardedMutation(statements, db, {
    tenantId: envelope.tenantId,
    operationKey,
    stepKey: 'payment-reversal-guard',
    appliedAtUtc,
    mutation: db.prepare(`
      UPDATE canonical_payment_reversals
      SET balance_guard = 1
      WHERE tenant_id = ? AND reversal_public_id = ?
        AND EXISTS (
          SELECT 1 FROM canonical_refunds r
          WHERE r.tenant_id = ? AND r.refund_public_id = ?
            AND r.payment_reversal_public_id = ? AND r.status = 'posted'
        )
        AND EXISTS (
          SELECT 1 FROM canonical_payment_allocations a
          WHERE a.tenant_id = ? AND a.allocation_public_id = ?
            AND a.reversed_minor = ? AND a.remaining_minor = a.amount_minor - ?
            AND a.status = CASE WHEN a.amount_minor = ? THEN 'reversed' ELSE 'active' END
        )
        AND EXISTS (
          SELECT 1 FROM canonical_payment_tenders t
          WHERE t.tenant_id = ? AND t.tender_public_id = ?
            AND t.reversed_minor = ? AND t.remaining_minor = t.amount_minor - ?
            AND t.status = CASE WHEN t.amount_minor = ? THEN 'reversed' ELSE 'captured' END
        )
        AND EXISTS (
          SELECT 1 FROM canonical_payment_receipts r
          WHERE r.tenant_id = ? AND r.receipt_public_id = ?
            AND r.refunded_minor = ? AND r.net_received_minor = r.total_minor - ?
            AND r.status = CASE WHEN r.total_minor = ? THEN 'reversed' ELSE 'posted' END
        )
        AND EXISTS (
          SELECT 1 FROM canonical_invoices i
          WHERE i.tenant_id = ? AND i.invoice_public_id = ?
            AND i.paid_minor = ? AND i.due_minor = ? AND i.net_due_minor = ?
            AND i.net_due_minor = i.due_minor - i.credited_minor
        )
    `).bind(
      envelope.tenantId,
      mutation.reversalPublicId,
      envelope.tenantId,
      mutation.refundPublicId,
      mutation.reversalPublicId,
      envelope.tenantId,
      mutation.allocationPublicId,
      mutation.allocationReversedAfterMinor,
      mutation.allocationReversedAfterMinor,
      mutation.allocationReversedAfterMinor,
      envelope.tenantId,
      mutation.tenderPublicId,
      mutation.tenderReversedAfterMinor,
      mutation.tenderReversedAfterMinor,
      mutation.tenderReversedAfterMinor,
      envelope.tenantId,
      mutation.receiptPublicId,
      mutation.receiptRefundedAfterMinor,
      mutation.receiptRefundedAfterMinor,
      mutation.receiptRefundedAfterMinor,
      envelope.tenantId,
      mutation.invoicePublicId,
      mutation.invoicePaidAfterMinor,
      mutation.invoiceDueAfterMinor,
      mutation.invoiceNetDueAfterMinor,
    ),
  });

  return statements;
}

function prepareDepositRecorded(
  db: CanonicalBatchDatabase,
  envelope: CanonicalSyncEnvelope,
  mutation: DepositRecordedMutation,
  operationKey: string,
  appliedAtUtc: string,
): CanonicalPreparedStatement[] {
  const statements: CanonicalPreparedStatement[] = [];
  pushGuardedMutation(statements, db, {
    tenantId: envelope.tenantId,
    operationKey,
    stepKey: 'deposit-record',
    appliedAtUtc,
    mutation: db.prepare(`
      INSERT INTO canonical_deposits (
        tenant_id,deposit_public_id,deposit_number,receipt_public_id,
        legacy_patient_id,currency_code,amount_minor,applied_minor,refunded_minor,
        available_minor,status,received_at_utc,business_date,posted_at_utc,
        reversed_at_utc,reconciliation_guard,source_evidence_sha256,
        created_at_utc,updated_at_utc
      )
      SELECT ?, ?, ?, r.receipt_public_id, p.id, ?, ?, 0, 0, ?, 'posted', ?, ?, ?, NULL, 1, ?, ?, ?
      FROM canonical_payment_receipts r
      JOIN patients p
        ON p.tenant_id = r.tenant_id AND p.id = r.legacy_patient_id
      WHERE r.tenant_id = ? AND r.receipt_public_id = ?
        AND p.sync_key = ?
        AND r.currency_code = ?
        AND r.total_minor = ?
        AND r.allocated_total_minor = 0
        AND r.unallocated_minor = r.total_minor
        AND r.refunded_minor = 0
        AND r.net_received_minor = r.total_minor
        AND r.status = 'posted'
        AND r.posted_at_utc = ?
      ON CONFLICT (tenant_id,deposit_public_id) DO UPDATE SET
        updated_at_utc = excluded.updated_at_utc
      WHERE canonical_deposits.deposit_number = excluded.deposit_number
        AND canonical_deposits.receipt_public_id = excluded.receipt_public_id
        AND canonical_deposits.legacy_patient_id = excluded.legacy_patient_id
        AND canonical_deposits.currency_code = excluded.currency_code
        AND canonical_deposits.amount_minor = excluded.amount_minor
        AND canonical_deposits.applied_minor = 0
        AND canonical_deposits.refunded_minor = 0
        AND canonical_deposits.available_minor = excluded.amount_minor
        AND canonical_deposits.status = 'posted'
        AND canonical_deposits.received_at_utc = excluded.received_at_utc
        AND canonical_deposits.business_date = excluded.business_date
        AND canonical_deposits.posted_at_utc = excluded.posted_at_utc
        AND canonical_deposits.reversed_at_utc IS NULL
        AND canonical_deposits.source_evidence_sha256 = excluded.source_evidence_sha256
    `).bind(
      envelope.tenantId,
      envelope.entityPublicId,
      mutation.depositNumber,
      mutation.currencyCode,
      mutation.amountMinor,
      mutation.amountMinor,
      mutation.receivedAtUtc,
      mutation.businessDate,
      mutation.postedAtUtc,
      mutation.sourceEvidenceSha256,
      mutation.receivedAtUtc,
      appliedAtUtc,
      envelope.tenantId,
      mutation.receiptPublicId,
      mutation.patientSyncKey,
      mutation.currencyCode,
      mutation.amountMinor,
      mutation.postedAtUtc,
    ),
  });
  return statements;
}

function prepareDepositApplied(
  db: CanonicalBatchDatabase,
  envelope: CanonicalSyncEnvelope,
  mutation: DepositAppliedMutation,
  operationKey: string,
  appliedAtUtc: string,
): CanonicalPreparedStatement[] {
  const statements: CanonicalPreparedStatement[] = [];

  pushGuardedMutation(statements, db, {
    tenantId: envelope.tenantId,
    operationKey,
    stepKey: 'deposit-balance',
    appliedAtUtc,
    mutation: db.prepare(`
      UPDATE canonical_deposits
      SET applied_minor = CASE
            WHEN available_minor = ? AND NOT EXISTS (
              SELECT 1 FROM canonical_deposit_applications a
              WHERE a.tenant_id = ? AND a.application_public_id = ?
            ) THEN applied_minor + ?
            ELSE applied_minor
          END,
          available_minor = ?,
          updated_at_utc = ?
      WHERE tenant_id = ? AND deposit_public_id = ? AND status = 'posted'
        AND amount_minor = applied_minor + refunded_minor + available_minor
        AND (
          (
            available_minor = ?
            AND NOT EXISTS (
              SELECT 1 FROM canonical_deposit_applications a
              WHERE a.tenant_id = ? AND a.application_public_id = ?
            )
          )
          OR (
            available_minor = ?
            AND EXISTS (
              SELECT 1 FROM canonical_deposit_applications a
              WHERE a.tenant_id = ? AND a.application_public_id = ?
                AND a.deposit_public_id = ? AND a.invoice_public_id = ?
                AND a.amount_minor = ?
                AND a.deposit_available_before_minor = ?
                AND a.deposit_available_after_minor = ?
                AND a.status = 'active'
            )
          )
        )
    `).bind(
      mutation.depositAvailableBeforeMinor,
      envelope.tenantId,
      mutation.applicationPublicId,
      mutation.amountMinor,
      mutation.depositAvailableAfterMinor,
      appliedAtUtc,
      envelope.tenantId,
      envelope.entityPublicId,
      mutation.depositAvailableBeforeMinor,
      envelope.tenantId,
      mutation.applicationPublicId,
      mutation.depositAvailableAfterMinor,
      envelope.tenantId,
      mutation.applicationPublicId,
      envelope.entityPublicId,
      mutation.invoicePublicId,
      mutation.amountMinor,
      mutation.depositAvailableBeforeMinor,
      mutation.depositAvailableAfterMinor,
    ),
  });

  pushGuardedMutation(statements, db, {
    tenantId: envelope.tenantId,
    operationKey,
    stepKey: 'deposit-invoice',
    appliedAtUtc,
    mutation: db.prepare(`
      UPDATE canonical_invoices
      SET paid_minor = ?,
          due_minor = ?,
          net_due_minor = ?,
          updated_at_utc = ?
      WHERE tenant_id = ? AND invoice_public_id = ? AND status = 'posted'
        AND credited_minor = due_minor - net_due_minor
        AND (
          (
            paid_minor = ? AND due_minor = ? AND net_due_minor = ?
            AND NOT EXISTS (
              SELECT 1 FROM canonical_deposit_applications a
              WHERE a.tenant_id = ? AND a.application_public_id = ?
            )
          )
          OR (
            paid_minor = ? AND due_minor = ? AND net_due_minor = ?
            AND EXISTS (
              SELECT 1 FROM canonical_deposit_applications a
              WHERE a.tenant_id = ? AND a.application_public_id = ?
                AND a.deposit_public_id = ? AND a.invoice_public_id = ?
                AND a.amount_minor = ?
                AND a.invoice_paid_before_minor = ?
                AND a.invoice_paid_after_minor = ?
                AND a.invoice_due_before_minor = ?
                AND a.invoice_due_after_minor = ?
                AND a.invoice_net_due_before_minor = ?
                AND a.invoice_net_due_after_minor = ?
                AND a.status = 'active'
            )
          )
        )
    `).bind(
      mutation.invoicePaidAfterMinor,
      mutation.invoiceDueAfterMinor,
      mutation.invoiceNetDueAfterMinor,
      appliedAtUtc,
      envelope.tenantId,
      mutation.invoicePublicId,
      mutation.invoicePaidBeforeMinor,
      mutation.invoiceDueBeforeMinor,
      mutation.invoiceNetDueBeforeMinor,
      envelope.tenantId,
      mutation.applicationPublicId,
      mutation.invoicePaidAfterMinor,
      mutation.invoiceDueAfterMinor,
      mutation.invoiceNetDueAfterMinor,
      envelope.tenantId,
      mutation.applicationPublicId,
      envelope.entityPublicId,
      mutation.invoicePublicId,
      mutation.amountMinor,
      mutation.invoicePaidBeforeMinor,
      mutation.invoicePaidAfterMinor,
      mutation.invoiceDueBeforeMinor,
      mutation.invoiceDueAfterMinor,
      mutation.invoiceNetDueBeforeMinor,
      mutation.invoiceNetDueAfterMinor,
    ),
  });

  pushGuardedMutation(statements, db, {
    tenantId: envelope.tenantId,
    operationKey,
    stepKey: 'deposit-application',
    appliedAtUtc,
    mutation: db.prepare(`
      INSERT INTO canonical_deposit_applications (
        tenant_id,application_public_id,deposit_public_id,invoice_public_id,
        invoice_line_public_id,amount_minor,deposit_available_before_minor,
        deposit_available_after_minor,invoice_paid_before_minor,invoice_paid_after_minor,
        invoice_due_before_minor,invoice_due_after_minor,invoice_net_due_before_minor,
        invoice_net_due_after_minor,status,applied_at_utc,reversed_at_utc,
        balance_guard,source_evidence_sha256,created_at_utc,updated_at_utc
      )
      SELECT ?, ?, d.deposit_public_id, i.invoice_public_id, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
             'active', ?, NULL, 1, ?, ?, ?
      FROM canonical_deposits d
      JOIN canonical_invoices i ON i.tenant_id = d.tenant_id
      WHERE d.tenant_id = ? AND d.deposit_public_id = ? AND d.status = 'posted'
        AND d.available_minor = ?
        AND i.invoice_public_id = ? AND i.status = 'posted'
        AND i.paid_minor = ? AND i.due_minor = ? AND i.net_due_minor = ?
        AND (
          ? IS NULL OR EXISTS (
            SELECT 1 FROM canonical_invoice_lines l
            WHERE l.tenant_id = i.tenant_id
              AND l.invoice_public_id = i.invoice_public_id
              AND l.line_public_id = ?
          )
        )
      ON CONFLICT (tenant_id,application_public_id) DO UPDATE SET
        updated_at_utc = excluded.updated_at_utc
      WHERE canonical_deposit_applications.deposit_public_id = excluded.deposit_public_id
        AND canonical_deposit_applications.invoice_public_id = excluded.invoice_public_id
        AND COALESCE(canonical_deposit_applications.invoice_line_public_id,'') = COALESCE(excluded.invoice_line_public_id,'')
        AND canonical_deposit_applications.amount_minor = excluded.amount_minor
        AND canonical_deposit_applications.deposit_available_before_minor = excluded.deposit_available_before_minor
        AND canonical_deposit_applications.deposit_available_after_minor = excluded.deposit_available_after_minor
        AND canonical_deposit_applications.invoice_paid_before_minor = excluded.invoice_paid_before_minor
        AND canonical_deposit_applications.invoice_paid_after_minor = excluded.invoice_paid_after_minor
        AND canonical_deposit_applications.invoice_due_before_minor = excluded.invoice_due_before_minor
        AND canonical_deposit_applications.invoice_due_after_minor = excluded.invoice_due_after_minor
        AND canonical_deposit_applications.invoice_net_due_before_minor = excluded.invoice_net_due_before_minor
        AND canonical_deposit_applications.invoice_net_due_after_minor = excluded.invoice_net_due_after_minor
        AND canonical_deposit_applications.status = 'active'
        AND canonical_deposit_applications.applied_at_utc = excluded.applied_at_utc
        AND canonical_deposit_applications.reversed_at_utc IS NULL
        AND canonical_deposit_applications.source_evidence_sha256 = excluded.source_evidence_sha256
    `).bind(
      envelope.tenantId,
      mutation.applicationPublicId,
      mutation.invoiceLinePublicId,
      mutation.amountMinor,
      mutation.depositAvailableBeforeMinor,
      mutation.depositAvailableAfterMinor,
      mutation.invoicePaidBeforeMinor,
      mutation.invoicePaidAfterMinor,
      mutation.invoiceDueBeforeMinor,
      mutation.invoiceDueAfterMinor,
      mutation.invoiceNetDueBeforeMinor,
      mutation.invoiceNetDueAfterMinor,
      mutation.appliedAtUtc,
      mutation.sourceEvidenceSha256,
      mutation.appliedAtUtc,
      appliedAtUtc,
      envelope.tenantId,
      envelope.entityPublicId,
      mutation.depositAvailableAfterMinor,
      mutation.invoicePublicId,
      mutation.invoicePaidAfterMinor,
      mutation.invoiceDueAfterMinor,
      mutation.invoiceNetDueAfterMinor,
      mutation.invoiceLinePublicId,
      mutation.invoiceLinePublicId,
    ),
  });

  pushGuardedMutation(statements, db, {
    tenantId: envelope.tenantId,
    operationKey,
    stepKey: 'deposit-application-guard',
    appliedAtUtc,
    mutation: db.prepare(`
      UPDATE canonical_deposit_applications
      SET balance_guard = 1,
          updated_at_utc = ?
      WHERE tenant_id = ? AND application_public_id = ?
        AND EXISTS (
          SELECT 1 FROM canonical_deposits d
          WHERE d.tenant_id = canonical_deposit_applications.tenant_id
            AND d.deposit_public_id = canonical_deposit_applications.deposit_public_id
            AND d.available_minor = canonical_deposit_applications.deposit_available_after_minor
        )
        AND EXISTS (
          SELECT 1 FROM canonical_invoices i
          WHERE i.tenant_id = canonical_deposit_applications.tenant_id
            AND i.invoice_public_id = canonical_deposit_applications.invoice_public_id
            AND i.paid_minor = canonical_deposit_applications.invoice_paid_after_minor
            AND i.due_minor = canonical_deposit_applications.invoice_due_after_minor
            AND i.net_due_minor = canonical_deposit_applications.invoice_net_due_after_minor
        )
    `).bind(
      appliedAtUtc,
      envelope.tenantId,
      mutation.applicationPublicId,
    ),
  });

  return statements;
}

function prepareDepositRefunded(
  db: CanonicalBatchDatabase,
  envelope: CanonicalSyncEnvelope,
  mutation: DepositRefundedMutation,
  operationKey: string,
  appliedAtUtc: string,
): CanonicalPreparedStatement[] {
  const statements: CanonicalPreparedStatement[] = [];
  pushGuardedMutation(statements, db, {
    tenantId: envelope.tenantId,
    operationKey,
    stepKey: 'deposit-refund-balance',
    appliedAtUtc,
    mutation: db.prepare(`
      UPDATE canonical_deposits
      SET refunded_minor = ?, available_minor = ?, updated_at_utc = ?
      WHERE tenant_id = ? AND deposit_public_id = ? AND status = 'posted'
        AND amount_minor = applied_minor + refunded_minor + available_minor
        AND refunded_minor = ? AND available_minor = ?
        AND reversed_at_utc IS NULL
        AND source_evidence_sha256 = ?
    `).bind(
      mutation.depositRefundedAfterMinor,
      mutation.depositAvailableAfterMinor,
      appliedAtUtc,
      envelope.tenantId,
      envelope.entityPublicId,
      mutation.depositRefundedBeforeMinor,
      mutation.depositAvailableBeforeMinor,
      mutation.depositSourceEvidenceSha256,
    ),
  });
  pushGuardedMutation(statements, db, {
    tenantId: envelope.tenantId,
    operationKey,
    stepKey: 'deposit-refund-insert',
    appliedAtUtc,
    mutation: db.prepare(`
      INSERT INTO canonical_refunds (
        tenant_id,refund_public_id,source_type,deposit_public_id,receipt_public_id,
        tender_public_id,allocation_public_id,payment_reversal_public_id,amount_minor,
        tender_type,method_code,status,refunded_at_utc,business_date,reversed_at_utc,
        source_available_before_minor,source_available_after_minor,liability_guard,
        source_evidence_sha256,created_at_utc,updated_at_utc
      )
      SELECT ?, ?,'deposit',d.deposit_public_id,NULL,NULL,NULL,NULL,?,?,?,'posted',?,?,NULL,
             ?,?,1,?,?,?
      FROM canonical_deposits d
      WHERE d.tenant_id = ? AND d.deposit_public_id = ? AND d.status = 'posted'
        AND d.refunded_minor = ? AND d.available_minor = ?
        AND d.amount_minor = d.applied_minor + d.refunded_minor + d.available_minor
        AND d.source_evidence_sha256 = ?
      ON CONFLICT (tenant_id,refund_public_id) DO UPDATE SET
        updated_at_utc = excluded.updated_at_utc
      WHERE canonical_refunds.source_type = 'deposit'
        AND canonical_refunds.deposit_public_id = excluded.deposit_public_id
        AND canonical_refunds.receipt_public_id IS NULL
        AND canonical_refunds.tender_public_id IS NULL
        AND canonical_refunds.allocation_public_id IS NULL
        AND canonical_refunds.payment_reversal_public_id IS NULL
        AND canonical_refunds.amount_minor = excluded.amount_minor
        AND canonical_refunds.tender_type = excluded.tender_type
        AND canonical_refunds.method_code = excluded.method_code
        AND canonical_refunds.status = 'posted'
        AND canonical_refunds.refunded_at_utc = excluded.refunded_at_utc
        AND canonical_refunds.business_date = excluded.business_date
        AND canonical_refunds.reversed_at_utc IS NULL
        AND canonical_refunds.source_available_before_minor = excluded.source_available_before_minor
        AND canonical_refunds.source_available_after_minor = excluded.source_available_after_minor
        AND canonical_refunds.liability_guard = 1
        AND canonical_refunds.source_evidence_sha256 = excluded.source_evidence_sha256
    `).bind(
      envelope.tenantId,
      mutation.refundPublicId,
      mutation.amountMinor,
      mutation.tenderType,
      mutation.methodCode,
      mutation.refundedAtUtc,
      mutation.businessDate,
      mutation.depositAvailableBeforeMinor,
      mutation.depositAvailableAfterMinor,
      mutation.refundSourceEvidenceSha256,
      mutation.refundedAtUtc,
      appliedAtUtc,
      envelope.tenantId,
      envelope.entityPublicId,
      mutation.depositRefundedAfterMinor,
      mutation.depositAvailableAfterMinor,
      mutation.depositSourceEvidenceSha256,
    ),
  });
  return statements;
}

function prepareCompensationAccrued(
  db: CanonicalBatchDatabase,
  envelope: CanonicalSyncEnvelope,
  mutation: CompensationAccruedMutation,
  operationKey: string,
  appliedAtUtc: string,
): CanonicalPreparedStatement[] {
  const statements: CanonicalPreparedStatement[] = [];
  pushGuardedMutation(statements, db, {
    tenantId: envelope.tenantId,
    operationKey,
    stepKey: 'compensation-accrual',
    appliedAtUtc,
    mutation: db.prepare(`
      INSERT INTO canonical_compensation_accruals (
        tenant_id,accrual_public_id,invoice_public_id,invoice_line_public_id,
        service_event_public_id,practitioner_public_id,practitioner_role,accrual_stage,
        rule_public_id,rule_version,calculation_basis,rate_type,rate_value,currency_code,
        gross_minor,discount_minor,tax_minor,performer_reserve_minor,eligible_base_minor,
        earned_minor,adjusted_minor,settled_minor,payable_minor,status,accrued_at_utc,
        business_date,payable_projection_guard,source_evidence_sha256,created_at_utc,updated_at_utc
      )
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,0,?,?,?, ?,1,?,?,?
      WHERE EXISTS (
        SELECT 1 FROM canonical_invoice_lines l
        WHERE l.tenant_id = ? AND l.invoice_public_id = ? AND l.line_public_id = ?
      )
        AND (? IS NULL OR EXISTS (
          SELECT 1 FROM canonical_service_events e
          WHERE e.tenant_id = ? AND e.event_public_id = ?
        ))
        AND (? IS NULL OR EXISTS (
          SELECT 1 FROM canonical_practitioners p
          WHERE p.tenant_id = ? AND p.practitioner_public_id = ? AND p.status = 'active'
        ))
        AND EXISTS (
          SELECT 1 FROM canonical_compensation_rules r
          WHERE r.tenant_id = ? AND r.rule_public_id = ? AND r.rule_version = ?
            AND r.practitioner_role = ? AND r.accrual_stage = ?
            AND r.calculation_basis = ? AND r.rate_type = ? AND r.rate_value = ?
        )
    `).bind(
      envelope.tenantId,
      envelope.entityPublicId,
      mutation.invoicePublicId,
      mutation.invoiceLinePublicId,
      mutation.serviceEventPublicId,
      mutation.practitionerPublicId,
      mutation.practitionerRole,
      mutation.accrualStage,
      mutation.rulePublicId,
      mutation.ruleVersion,
      mutation.calculationBasis,
      mutation.rateType,
      mutation.rateValue,
      mutation.currencyCode,
      mutation.grossMinor,
      mutation.discountMinor,
      mutation.taxMinor,
      mutation.performerReserveMinor,
      mutation.eligibleBaseMinor,
      mutation.earnedMinor,
      mutation.earnedMinor,
      mutation.initialStatus,
      mutation.accruedAtUtc,
      mutation.businessDate,
      mutation.sourceEvidenceSha256,
      mutation.accruedAtUtc,
      appliedAtUtc,
      envelope.tenantId,
      mutation.invoicePublicId,
      mutation.invoiceLinePublicId,
      mutation.serviceEventPublicId,
      envelope.tenantId,
      mutation.serviceEventPublicId,
      mutation.practitionerPublicId,
      envelope.tenantId,
      mutation.practitionerPublicId,
      envelope.tenantId,
      mutation.rulePublicId,
      mutation.ruleVersion,
      mutation.practitionerRole,
      mutation.accrualStage,
      mutation.calculationBasis,
      mutation.rateType,
      mutation.rateValue,
    ),
  });
  return statements;
}

function prepareCompensationAdjusted(
  db: CanonicalBatchDatabase,
  envelope: CanonicalSyncEnvelope,
  mutation: CompensationAdjustedMutation,
  operationKey: string,
  appliedAtUtc: string,
): CanonicalPreparedStatement[] {
  const adjustment = mutation.adjustment;
  const statements: CanonicalPreparedStatement[] = [];
  pushGuardedMutation(statements, db, {
    tenantId: envelope.tenantId,
    operationKey,
    stepKey: 'compensation-adjustment-record',
    appliedAtUtc,
    mutation: db.prepare(`
      INSERT INTO canonical_compensation_adjustments (
        tenant_id,adjustment_public_id,accrual_public_id,settlement_public_id,
        settlement_allocation_public_id,adjustment_type,reason_code,amount_minor,
        accrual_adjusted_before_minor,accrual_adjusted_after_minor,
        accrual_settled_before_minor,accrual_settled_after_minor,
        accrual_payable_before_minor,accrual_payable_after_minor,
        occurred_at_utc,business_date,balance_guard,source_evidence_sha256,created_at_utc
      ) VALUES (?,?,?,NULL,NULL,?,?,?,?,?,?,?,?,?,?,?,1,?,?)
    `).bind(
      envelope.tenantId,
      adjustment.adjustmentPublicId,
      adjustment.accrualPublicId,
      adjustment.adjustmentType,
      adjustment.reasonCode,
      adjustment.amountMinor,
      adjustment.adjustedBeforeMinor,
      adjustment.adjustedAfterMinor,
      adjustment.settledBeforeMinor,
      adjustment.settledAfterMinor,
      adjustment.payableBeforeMinor,
      adjustment.payableAfterMinor,
      adjustment.occurredAtUtc,
      adjustment.businessDate,
      adjustment.sourceEvidenceSha256,
      appliedAtUtc,
    ),
  });
  pushGuardedMutation(statements, db, {
    tenantId: envelope.tenantId,
    operationKey,
    stepKey: 'compensation-adjustment-accrual',
    appliedAtUtc,
    mutation: db.prepare(`
      UPDATE canonical_compensation_accruals
      SET adjusted_minor = ?, settled_minor = ?, payable_minor = ?, status = ?, updated_at_utc = ?
      WHERE tenant_id = ? AND accrual_public_id = ?
        AND adjusted_minor = ? AND settled_minor = ? AND payable_minor = ? AND status = ?
        AND earned_minor - ? - ? = ?
    `).bind(
      adjustment.adjustedAfterMinor,
      adjustment.settledAfterMinor,
      adjustment.payableAfterMinor,
      adjustment.statusAfter,
      appliedAtUtc,
      envelope.tenantId,
      adjustment.accrualPublicId,
      adjustment.adjustedBeforeMinor,
      adjustment.settledBeforeMinor,
      adjustment.payableBeforeMinor,
      adjustment.statusBefore,
      adjustment.adjustedAfterMinor,
      adjustment.settledAfterMinor,
      adjustment.payableAfterMinor,
    ),
  });
  pushGuardedMutation(statements, db, {
    tenantId: envelope.tenantId,
    operationKey,
    stepKey: 'compensation-adjustment-guard',
    appliedAtUtc,
    mutation: db.prepare(`
      UPDATE canonical_compensation_adjustments
      SET balance_guard = 1
      WHERE tenant_id = ? AND adjustment_public_id = ?
        AND EXISTS (
          SELECT 1 FROM canonical_compensation_accruals a
          WHERE a.tenant_id = canonical_compensation_adjustments.tenant_id
            AND a.accrual_public_id = canonical_compensation_adjustments.accrual_public_id
            AND a.adjusted_minor = canonical_compensation_adjustments.accrual_adjusted_after_minor
            AND a.settled_minor = canonical_compensation_adjustments.accrual_settled_after_minor
            AND a.payable_minor = canonical_compensation_adjustments.accrual_payable_after_minor
            AND a.status = ?
        )
    `).bind(
      envelope.tenantId,
      adjustment.adjustmentPublicId,
      adjustment.statusAfter,
    ),
  });
  return statements;
}

function prepareInventoryMovement(
  db: CanonicalBatchDatabase,
  envelope: CanonicalSyncEnvelope,
  mutation: InventoryMovementRecordedMutation,
  operationKey: string,
  appliedAtUtc: string,
): CanonicalPreparedStatement[] {
  const statements: CanonicalPreparedStatement[] = [
    db.prepare(`
      INSERT INTO canonical_inventory_balances (
        tenant_id,item_public_id,location_public_id,lot_public_id,quantity_base,version,
        projection_guard,source_evidence_sha256,updated_at_utc,created_at_utc
      )
      SELECT ?,?,?,?,0,0,1,?,?,?
      WHERE EXISTS (
        SELECT 1 FROM canonical_inventory_items i
        WHERE i.tenant_id = ? AND i.item_public_id = ? AND i.status = 'active'
      )
        AND EXISTS (
          SELECT 1 FROM canonical_inventory_locations l
          WHERE l.tenant_id = ? AND l.location_public_id = ? AND l.status = 'active'
        )
        AND EXISTS (
          SELECT 1 FROM canonical_inventory_lots lot
          WHERE lot.tenant_id = ? AND lot.lot_public_id = ? AND lot.item_public_id = ?
            AND lot.status IN ('active','blocked','expired')
        )
      ON CONFLICT (tenant_id,item_public_id,location_public_id,lot_public_id) DO NOTHING
    `).bind(
      envelope.tenantId,
      mutation.itemPublicId,
      mutation.locationPublicId,
      mutation.lotPublicId,
      mutation.sourceEvidenceSha256,
      mutation.occurredAtUtc,
      appliedAtUtc,
      envelope.tenantId,
      mutation.itemPublicId,
      envelope.tenantId,
      mutation.locationPublicId,
      envelope.tenantId,
      mutation.lotPublicId,
      mutation.itemPublicId,
    ),
  ];
  pushGuardedMutation(statements, db, {
    tenantId: envelope.tenantId,
    operationKey,
    stepKey: 'inventory-balance',
    appliedAtUtc,
    mutation: db.prepare(`
      UPDATE canonical_inventory_balances
      SET quantity_base = ?, version = ?, projection_guard = 1,
          source_evidence_sha256 = ?, updated_at_utc = ?
      WHERE tenant_id = ? AND item_public_id = ? AND location_public_id = ? AND lot_public_id = ?
        AND quantity_base = ? AND version = ?
        AND (? >= 0 OR EXISTS (
          SELECT 1 FROM canonical_inventory_stock_policies p
          WHERE p.tenant_id = ? AND p.item_public_id = ? AND p.location_public_id = ?
            AND p.allow_negative_stock = 1
        ))
        AND EXISTS (
          SELECT 1 FROM canonical_inventory_items i
          WHERE i.tenant_id = ? AND i.item_public_id = ? AND i.status = 'active'
        )
        AND EXISTS (
          SELECT 1 FROM canonical_inventory_locations l
          WHERE l.tenant_id = ? AND l.location_public_id = ? AND l.status = 'active'
        )
        AND EXISTS (
          SELECT 1 FROM canonical_inventory_lots lot
          WHERE lot.tenant_id = ? AND lot.lot_public_id = ? AND lot.item_public_id = ?
            AND lot.status IN ('active','blocked','expired')
        )
    `).bind(
      mutation.balanceAfterBase,
      mutation.balanceVersionAfter,
      mutation.sourceEvidenceSha256,
      mutation.occurredAtUtc,
      envelope.tenantId,
      mutation.itemPublicId,
      mutation.locationPublicId,
      mutation.lotPublicId,
      mutation.balanceBeforeBase,
      mutation.balanceVersionBefore,
      mutation.balanceAfterBase,
      envelope.tenantId,
      mutation.itemPublicId,
      mutation.locationPublicId,
      envelope.tenantId,
      mutation.itemPublicId,
      envelope.tenantId,
      mutation.locationPublicId,
      envelope.tenantId,
      mutation.lotPublicId,
      mutation.itemPublicId,
    ),
  });
  pushGuardedMutation(statements, db, {
    tenantId: envelope.tenantId,
    operationKey,
    stepKey: 'inventory-movement',
    appliedAtUtc,
    mutation: db.prepare(`
      INSERT INTO canonical_inventory_movements (
        tenant_id,movement_public_id,item_public_id,location_public_id,lot_public_id,
        movement_type,direction,source_quantity,source_unit_code,conversion_numerator,
        conversion_denominator,quantity_base,signed_quantity_base,balance_before_base,
        balance_after_base,transfer_public_id,service_event_public_id,invoice_public_id,
        invoice_line_public_id,reversal_of_movement_public_id,source_type,source_public_id,
        source_line_public_id,source_table,status,occurred_at_utc,business_date,actor_user_id,
        balance_guard,source_evidence_sha256,created_at_utc
      )
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'posted',?,?,NULL,
        CASE WHEN EXISTS (
          SELECT 1 FROM canonical_inventory_balances b
          WHERE b.tenant_id = ? AND b.item_public_id = ? AND b.location_public_id = ?
            AND b.lot_public_id = ? AND b.quantity_base = ? AND b.version = ?
        ) THEN 1 ELSE 0 END,?,?
    `).bind(
      envelope.tenantId,
      envelope.entityPublicId,
      mutation.itemPublicId,
      mutation.locationPublicId,
      mutation.lotPublicId,
      mutation.movementType,
      mutation.direction,
      mutation.sourceQuantity,
      mutation.sourceUnitCode,
      mutation.conversionNumerator,
      mutation.conversionDenominator,
      mutation.quantityBase,
      mutation.signedQuantityBase,
      mutation.balanceBeforeBase,
      mutation.balanceAfterBase,
      mutation.transferPublicId,
      mutation.serviceEventPublicId,
      mutation.invoicePublicId,
      mutation.invoiceLinePublicId,
      mutation.reversalOfMovementPublicId,
      mutation.sourceType,
      mutation.sourcePublicId,
      mutation.sourceLinePublicId,
      mutation.sourceTable,
      mutation.occurredAtUtc,
      mutation.businessDate,
      envelope.tenantId,
      mutation.itemPublicId,
      mutation.locationPublicId,
      mutation.lotPublicId,
      mutation.balanceAfterBase,
      mutation.balanceVersionAfter,
      mutation.sourceEvidenceSha256,
      appliedAtUtc,
    ),
  });
  return statements;
}

export async function prepareCanonicalSyncBusinessApplyStatements(
  db: CanonicalBatchDatabase,
  input: {
    envelope: CanonicalSyncEnvelope;
    appliedAtUtc: string;
  },
): Promise<readonly CanonicalPreparedStatement[]> {
  assertUtc(input.appliedAtUtc, 'appliedAtUtc');
  const payload = parseCanonicalSyncBusinessPayload(input.envelope);
  const operationKey = `business:${await createRequestFingerprint({
    tenantId: input.envelope.tenantId,
    eventPublicId: input.envelope.eventPublicId,
    payloadSha256: input.envelope.payloadSha256,
    aggregateVersion: input.envelope.aggregateVersion,
  })}`;
  const statements: CanonicalPreparedStatement[] = [
    clearAssertions(db, input.envelope.tenantId, operationKey),
  ];

  switch (payload.mutation.kind) {
    case 'encounter_started':
      statements.push(...prepareEncounterStarted(db, input.envelope, payload.mutation, operationKey, input.appliedAtUtc));
      break;
    case 'encounter_completed':
      statements.push(...prepareEncounterCompleted(db, input.envelope, payload.mutation, operationKey, input.appliedAtUtc));
      break;
    case 'encounter_cancelled':
      statements.push(...prepareEncounterCancelled(db, input.envelope, payload.mutation, operationKey, input.appliedAtUtc));
      break;
    case 'service_request_created':
      statements.push(...prepareServiceRequestCreated(db, input.envelope, payload.mutation, operationKey, input.appliedAtUtc));
      break;
    case 'service_request_cancelled':
      statements.push(...prepareServiceRequestCancelled(db, input.envelope, payload.mutation, operationKey, input.appliedAtUtc));
      break;
    case 'service_event_recorded':
      statements.push(...prepareServiceEventRecorded(db, input.envelope, payload.mutation, operationKey, input.appliedAtUtc));
      break;
    case 'service_event_cancelled':
      statements.push(...prepareServiceEventCancelled(db, input.envelope, payload.mutation, operationKey, input.appliedAtUtc));
      break;
    case 'invoice_issued':
      statements.push(...prepareInvoiceIssued(db, input.envelope, payload.mutation, operationKey, input.appliedAtUtc));
      break;
    case 'invoice_cancelled':
      statements.push(...prepareInvoiceCancelled(db, input.envelope, payload.mutation, operationKey, input.appliedAtUtc));
      break;
    case 'payment_receipt_recorded':
      statements.push(...preparePaymentReceiptRecorded(db, input.envelope, payload.mutation, operationKey, input.appliedAtUtc));
      break;
    case 'payment_reversed':
      statements.push(...preparePaymentReversed(db, input.envelope, payload.mutation, operationKey, input.appliedAtUtc));
      break;
    case 'deposit_recorded':
      statements.push(...prepareDepositRecorded(db, input.envelope, payload.mutation, operationKey, input.appliedAtUtc));
      break;
    case 'deposit_applied':
      statements.push(...prepareDepositApplied(db, input.envelope, payload.mutation, operationKey, input.appliedAtUtc));
      break;
    case 'deposit_refunded':
      statements.push(...prepareDepositRefunded(db, input.envelope, payload.mutation, operationKey, input.appliedAtUtc));
      break;
    case 'compensation_accrued':
      statements.push(...prepareCompensationAccrued(db, input.envelope, payload.mutation, operationKey, input.appliedAtUtc));
      break;
    case 'compensation_adjusted':
      statements.push(...prepareCompensationAdjusted(db, input.envelope, payload.mutation, operationKey, input.appliedAtUtc));
      break;
    case 'inventory_movement_recorded':
      statements.push(...prepareInventoryMovement(db, input.envelope, payload.mutation, operationKey, input.appliedAtUtc));
      break;
    default:
      throw new CanonicalSyncBusinessApplyError(
        `Canonical sync business apply is not implemented for ${String((payload.mutation as { kind?: unknown }).kind)}`,
      );
  }

  statements.push(clearAssertions(db, input.envelope.tenantId, operationKey));
  return statements;
}

export async function completeCanonicalSyncBusinessEvent(
  db: CanonicalBatchDatabase,
  input: {
    envelope: CanonicalSyncEnvelope;
    claimPublicId: string;
    appliedAtUtc: string;
  },
): Promise<void> {
  const authoritativeStatements = await prepareCanonicalSyncBusinessApplyStatements(db, {
    envelope: input.envelope,
    appliedAtUtc: input.appliedAtUtc,
  });
  await completeCanonicalSyncInboxEvent(db, {
    envelope: input.envelope,
    claimPublicId: input.claimPublicId,
    appliedAtUtc: input.appliedAtUtc,
    authoritativeStatements,
  });
}
