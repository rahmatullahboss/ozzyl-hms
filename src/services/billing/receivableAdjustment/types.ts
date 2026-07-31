import type { D1Database } from '@cloudflare/workers-types';
import { createDeterministicSourceId, createSourceEvidenceSha256 } from '../../../lib/canonical/source-mapping';
import type {
  ReceivableAuthorityMode,
  ReceivableSourceRef,
} from '../../actionCenter/collections/types';

export type ReceivableAdjustmentSourceType = 'credit_note' | 'receivable_write_off';

export interface ReceivableAdjustmentInput {
  db: D1Database;
  tenantId: string;
  source: ReceivableSourceRef;
  amountMinor: number;
  currencyCode: string;
  reasonCode: string;
  note?: string;
  actorId: number;
  sourceType: ReceivableAdjustmentSourceType;
  sourceRequestId: number;
  idempotencyKey: string;
}

export interface ReceivableAdjustmentResult {
  authorityMode: ReceivableAuthorityMode;
  adjustmentPublicId: string;
  legacyCreditNoteId?: number;
  canonicalCreditNotePublicId?: string;
  previousDueMinor: number;
  newDueMinor: number;
  appliedAmountMinor: number;
  currencyCode: string;
}

export interface PreparedReceivableAdjustment extends ReceivableAdjustmentInput {
  adjustmentPublicId: string;
  canonicalCreditNotePublicId: string;
  canonicalCreditLinePublicId: string;
  canonicalOutboxEventPublicId: string;
  creditNoteNumber: string;
  sourceEvidenceSha256: string;
}

export class ReceivableAdjustmentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReceivableAdjustmentValidationError';
  }
}

function exact(value: string, label: string): string {
  if (!value.trim()) throw new ReceivableAdjustmentValidationError(`${label} cannot be empty`);
  if (value.trim() !== value) {
    throw new ReceivableAdjustmentValidationError(`${label} cannot contain surrounding whitespace`);
  }
  return value;
}

function positiveSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new ReceivableAdjustmentValidationError(`${label} must be a positive safe integer`);
  }
  return value;
}

function validateSource(source: ReceivableSourceRef): void {
  if (source.sourceType !== 'invoice') {
    throw new ReceivableAdjustmentValidationError('Only invoice receivable sources are supported');
  }
  if (
    source.legacyBillId !== undefined
    && (!Number.isSafeInteger(source.legacyBillId) || source.legacyBillId <= 0)
  ) {
    throw new ReceivableAdjustmentValidationError('legacyBillId must be a positive safe integer');
  }
  if (
    source.canonicalInvoicePublicId !== undefined
    && !source.canonicalInvoicePublicId.trim()
  ) {
    throw new ReceivableAdjustmentValidationError('canonicalInvoicePublicId cannot be empty');
  }
  if (source.legacyBillId === undefined && source.canonicalInvoicePublicId === undefined) {
    throw new ReceivableAdjustmentValidationError('An invoice source identity is required');
  }
}

export function validateReceivableAdjustmentInput(input: ReceivableAdjustmentInput): void {
  exact(input.tenantId, 'tenantId');
  validateSource(input.source);
  positiveSafeInteger(input.amountMinor, 'amountMinor');
  if (!/^[A-Z]{3}$/.test(input.currencyCode)) {
    throw new ReceivableAdjustmentValidationError('currencyCode must be an uppercase ISO currency code');
  }
  exact(input.reasonCode, 'reasonCode');
  if (input.note !== undefined && input.note.trim() !== input.note) {
    throw new ReceivableAdjustmentValidationError('note cannot contain surrounding whitespace');
  }
  positiveSafeInteger(input.actorId, 'actorId');
  if (input.sourceType !== 'credit_note' && input.sourceType !== 'receivable_write_off') {
    throw new ReceivableAdjustmentValidationError('sourceType is not supported');
  }
  positiveSafeInteger(input.sourceRequestId, 'sourceRequestId');
  exact(input.idempotencyKey, 'idempotencyKey');
}

export async function prepareReceivableAdjustment(
  input: ReceivableAdjustmentInput,
): Promise<PreparedReceivableAdjustment> {
  validateReceivableAdjustmentInput(input);
  const sourcePublicId = `${input.sourceType}:${input.sourceRequestId}`;
  const [
    adjustmentPublicId,
    canonicalCreditNotePublicId,
    canonicalCreditLinePublicId,
    canonicalOutboxEventPublicId,
  ] = await Promise.all([
    createDeterministicSourceId('rcvadj', input.tenantId, input.sourceType, sourcePublicId),
    createDeterministicSourceId('crnote', input.tenantId, input.sourceType, sourcePublicId),
    createDeterministicSourceId('crline', input.tenantId, input.sourceType, sourcePublicId),
    createDeterministicSourceId('outbox', input.tenantId, input.sourceType, sourcePublicId),
  ]);
  const sourceEvidenceSha256 = await createSourceEvidenceSha256({
    tenantId: input.tenantId,
    source: input.source,
    amountMinor: input.amountMinor,
    currencyCode: input.currencyCode,
    reasonCode: input.reasonCode,
    sourceType: input.sourceType,
    sourceRequestId: input.sourceRequestId,
    idempotencyKey: input.idempotencyKey,
  });

  return {
    ...input,
    adjustmentPublicId,
    canonicalCreditNotePublicId,
    canonicalCreditLinePublicId,
    canonicalOutboxEventPublicId,
    creditNoteNumber: `CN-${adjustmentPublicId.slice(-20)}`,
    sourceEvidenceSha256,
  };
}

export function minorToMajor(amountMinor: number): number {
  if (!Number.isSafeInteger(amountMinor)) {
    throw new ReceivableAdjustmentValidationError('Minor-unit amount must be a safe integer');
  }
  return Number((amountMinor / 100).toFixed(2));
}
