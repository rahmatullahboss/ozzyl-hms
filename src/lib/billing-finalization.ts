import type { D1Database } from '@cloudflare/workers-types';
import type { BillCategoryTotals } from './billing-category-totals';
import {
  ACCOUNTING_EVENT_TYPES,
  recordAccountingPostingEvent,
} from './accounting-posting';
import { roundMoney } from './discount_allocation';
import { accrueBillCommissions, type DoctorCommissionWaiverAllocationInput } from './lab-finance';
import { buildLegacyLiveInvoiceSourceLineId } from './canonical/live-invoice-line-identity';
import {
  createBillDiagnosticPerformerReserves,
  loadCanonicalBillPerformerItems,
  type BillItemPerformerReserveSummary,
  type CanonicalBillPerformerItem,
} from './diagnostic-performer-reserve';

export type FinalizedBillLineItem = {
  itemCategory: string;
  description?: string | null;
  lineTotal: number;
  grossLineTotal?: number | null;
  taxAmount?: number | null;
  canonicalSourceLineId?: string | null;
  referenceId?: number | null;
  billItemId?: number | null;
  performerDoctorId?: number | null;
  prescriberDoctorId?: number | null;
  labTestId?: number | null;
  commissionBaseAmount?: number | null;
  performerReserveAmount?: number | null;
  hasPerformerReserve?: boolean;
};

export type BillFinalizationInput = {
  tenantId: string;
  userId: string | number;
  patientId: number;
  visitId: number | null;
  billId: number;
  invoiceNo: string;
  referringDoctorId?: number | null;
  billDate: string;
  accruedAtUtc?: string;
  subtotal: number;
  discount: number;
  total: number;
  categoryTotals: BillCategoryTotals;
  counterId?: number | null;
  counterSessionId?: number | null;
  extraPayload?: Record<string, unknown>;
  skipCommissionAccrual?: boolean;
  skipBillAccountingEvent?: boolean;
  doctorCommissionWaivers?: DoctorCommissionWaiverAllocationInput[];
  canonicalItemsOverride?: CanonicalBillPerformerItem[];
  items: FinalizedBillLineItem[];
};

export function buildBillCreatedAccountingPayload(input: BillFinalizationInput): Record<string, unknown> {
  return {
    ...(input.extraPayload ?? {}),
    billId: input.billId,
    invoiceNo: input.invoiceNo,
    patientId: input.patientId,
    visitId: input.visitId,
    referringDoctorId: input.referringDoctorId ?? null,
    subtotal: input.subtotal,
    discount: input.discount,
    total: input.total,
    counterId: input.counterId ?? null,
    counterSessionId: input.counterSessionId ?? null,
    ...input.categoryTotals,
  };
}

function netServiceAmount(lineTotal: number, taxAmount: number | null | undefined): number {
  return Math.max(0, Math.round((Number(lineTotal || 0) - Number(taxAmount || 0)) * 100) / 100);
}

export function buildBillCommissionItems(items: FinalizedBillLineItem[]) {
  return items.map((item, index) => ({
    itemCategory: item.itemCategory,
    description: item.description ?? null,
    lineTotal: netServiceAmount(item.lineTotal, item.taxAmount),
    grossLineTotal: item.grossLineTotal ?? null,
    taxAmount: item.taxAmount ?? 0,
    canonicalSourceLineId: item.canonicalSourceLineId ?? buildLegacyLiveInvoiceSourceLineId({
      lineNumber: index + 1,
      itemCategory: item.itemCategory,
      referenceId: item.referenceId ?? null,
    }),
    referenceId: item.referenceId ?? null,
    billItemId: item.billItemId ?? null,
    performerDoctorId: item.performerDoctorId ?? null,
    prescriberDoctorId: item.prescriberDoctorId ?? null,
    labTestId: item.labTestId ?? null,
    commissionBaseAmount: item.commissionBaseAmount ?? null,
    performerReserveAmount: item.performerReserveAmount ?? null,
    hasPerformerReserve: item.hasPerformerReserve ?? false,
  }));
}

type BillCommissionItem = ReturnType<typeof buildBillCommissionItems>[number];

function findOriginalLineItem(
  items: FinalizedBillLineItem[],
  canonical: CanonicalBillPerformerItem,
  index: number,
): FinalizedBillLineItem | undefined {
  const indexed = items[index];
  if (indexed) return indexed;
  return items.find((item) => (
    (item.billItemId && item.billItemId === canonical.billItemId)
    || (item.referenceId && item.referenceId === canonical.referenceId)
  ));
}

export function buildCanonicalBillCommissionItems(
  items: FinalizedBillLineItem[],
  canonicalItems: CanonicalBillPerformerItem[],
  reserveSummaries: Map<number, BillItemPerformerReserveSummary>,
) {
  if (canonicalItems.length === 0) return buildBillCommissionItems(items);
  return canonicalItems.map((canonical, index) => {
    const original = findOriginalLineItem(items, canonical, index);
    const reserve = reserveSummaries.get(canonical.billItemId);
    const itemCategory = original?.itemCategory ?? canonical.itemCategory;
    const referenceId = original?.referenceId ?? canonical.referenceId;
    const taxAmount = original?.taxAmount ?? canonical.taxAmount;
    return {
      itemCategory,
      description: original?.description ?? canonical.description,
      lineTotal: reserve?.netServiceAmount
        ?? netServiceAmount(original?.lineTotal ?? canonical.lineTotal, taxAmount),
      grossLineTotal: original?.grossLineTotal ?? canonical.grossServiceAmount,
      taxAmount,
      canonicalSourceLineId: original?.canonicalSourceLineId ?? buildLegacyLiveInvoiceSourceLineId({
        lineNumber: index + 1,
        itemCategory,
        referenceId,
      }),
      referenceId,
      billItemId: canonical.billItemId,
      performerDoctorId: original?.performerDoctorId ?? null,
      prescriberDoctorId: original?.prescriberDoctorId ?? null,
      labTestId: canonical.labTestId ?? original?.labTestId ?? null,
      commissionBaseAmount: reserve?.commissionBaseAmount ?? null,
      performerReserveAmount: reserve?.performerReserveAmount ?? null,
      hasPerformerReserve: Boolean(reserve),
    };
  });
}

function isDiagnosticCommissionItem(itemCategory: string): boolean {
  return /^(test|lab|laboratory|diagnostic|radiology|imaging|usg|xray|x-ray|pathology)$/i.test(itemCategory || '');
}

function positiveDoctorId(value: number | null | undefined): number | null {
  const doctorId = Number(value ?? 0);
  return Number.isInteger(doctorId) && doctorId > 0 ? doctorId : null;
}

function commissionBaseAmount(item: BillCommissionItem): number {
  const reserveAmount = Math.max(0, roundMoney(item.performerReserveAmount ?? 0));
  if (item.commissionBaseAmount != null) {
    return Math.max(0, roundMoney(item.commissionBaseAmount));
  }
  return Math.max(0, roundMoney(item.lineTotal - reserveAmount));
}

/**
 * Doctor-waiver discounts can be saved before invoice-line discount allocation is
 * fully reflected in performer-reserve snapshots. Ensure the explicit waiver is
 * represented in the diagnostic commission base before the same waiver is consumed
 * from earned commission. This keeps gross, discount, reserve, earned, and payable
 * authority internally consistent for both legacy and canonical accruals.
 */
export function reconcileDoctorWaiverCommissionItems(
  items: BillCommissionItem[],
  waivers: DoctorCommissionWaiverAllocationInput[] | undefined,
  referringDoctorId: number | null | undefined,
): BillCommissionItem[] {
  const waiverByDoctor = new Map<number, number>();
  for (const waiver of waivers ?? []) {
    const doctorId = positiveDoctorId(waiver.doctorId);
    const amount = Math.max(0, roundMoney(waiver.amount));
    if (!doctorId || amount <= 0) continue;
    waiverByDoctor.set(doctorId, roundMoney((waiverByDoctor.get(doctorId) ?? 0) + amount));
  }
  if (waiverByDoctor.size === 0) return items;

  const reconciled = items.map((item) => ({ ...item }));
  const fallbackDoctorId = positiveDoctorId(referringDoctorId);

  for (const [doctorId, requestedWaiver] of waiverByDoctor) {
    const candidateIndexes = reconciled.flatMap((item, index) => {
      const lineDoctorId = positiveDoctorId(item.prescriberDoctorId) ?? fallbackDoctorId;
      const hasGrossAuthority = item.grossLineTotal != null && Number.isFinite(Number(item.grossLineTotal));
      return lineDoctorId === doctorId && hasGrossAuthority && isDiagnosticCommissionItem(item.itemCategory)
        ? [index]
        : [];
    });
    if (candidateIndexes.length === 0) continue;

    let representedDiscount = 0;
    for (const index of candidateIndexes) {
      const item = reconciled[index];
      const grossAmount = Math.max(0, roundMoney(item.grossLineTotal ?? item.lineTotal));
      const reserveAmount = Math.max(0, roundMoney(item.performerReserveAmount ?? 0));
      const grossAfterReserve = Math.max(0, roundMoney(grossAmount - reserveAmount));
      representedDiscount = roundMoney(
        representedDiscount + Math.max(0, roundMoney(grossAfterReserve - commissionBaseAmount(item))),
      );
    }

    let missingWaiverDiscount = Math.max(0, roundMoney(requestedWaiver - representedDiscount));
    for (const index of candidateIndexes) {
      if (missingWaiverDiscount <= 0) break;
      const item = reconciled[index];
      const currentBase = commissionBaseAmount(item);
      const reduction = Math.min(currentBase, missingWaiverDiscount);
      if (reduction <= 0) continue;

      item.lineTotal = Math.max(0, roundMoney(item.lineTotal - reduction));
      item.commissionBaseAmount = Math.max(0, roundMoney(currentBase - reduction));
      missingWaiverDiscount = Math.max(0, roundMoney(missingWaiverDiscount - reduction));
    }
  }

  return reconciled;
}

export async function recordBillFinalizationSideEffects(
  db: D1Database,
  input: BillFinalizationInput,
): Promise<void> {
  const canonicalItems = input.canonicalItemsOverride ?? await loadCanonicalBillPerformerItems(db, {
    tenantId: input.tenantId,
    billId: input.billId,
  });
  const reserveSummaries = await createBillDiagnosticPerformerReserves(db, {
    tenantId: input.tenantId,
    userId: input.userId,
    billId: input.billId,
    invoiceNo: input.invoiceNo,
    billDate: input.billDate,
    accruedAtUtc: input.accruedAtUtc ?? new Date(`${input.billDate}T00:00:00+06:00`).toISOString(),
    canonicalItems,
  });

  if (!input.skipCommissionAccrual) {
    const commissionItems = reconcileDoctorWaiverCommissionItems(
      buildCanonicalBillCommissionItems(input.items, canonicalItems, reserveSummaries),
      input.doctorCommissionWaivers,
      input.referringDoctorId,
    );
    await accrueBillCommissions(db, {
      tenantId: input.tenantId,
      userId: input.userId,
      patientId: input.patientId,
      visitId: input.visitId,
      billId: input.billId,
      invoiceNo: input.invoiceNo,
      referringDoctorId: input.referringDoctorId ?? null,
      billDate: input.billDate,
      accruedAtUtc: input.accruedAtUtc ?? new Date(`${input.billDate}T00:00:00+06:00`).toISOString(),
      doctorCommissionWaivers: input.doctorCommissionWaivers,
      items: commissionItems,
    });
  }

  if (!input.skipBillAccountingEvent) {
    await recordAccountingPostingEvent(db, {
      tenantId: input.tenantId,
      sourceType: 'billing',
      sourceId: input.billId,
      eventType: ACCOUNTING_EVENT_TYPES.billCreated,
      eventDate: input.billDate,
      createdBy: input.userId,
      payload: buildBillCreatedAccountingPayload(input),
    });
  }
}
