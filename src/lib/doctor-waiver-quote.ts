import { hydrateDiagnosticPerformerPreviewReserves } from './diagnostic-performer-reserve';
import {
  previewDoctorCommissionForItems,
  type DoctorCommissionPreviewItem,
  type DoctorCommissionPreviewLine,
} from './lab-finance';
import { roundMoney } from './discount_allocation';

export interface DoctorWaiverQuoteInput {
  tenantId: string;
  doctorId: number;
  billDate: string;
  totalDiscount?: number;
  items: DoctorCommissionPreviewItem[];
}

export interface DoctorWaiverQuote {
  doctorId: number;
  eligibleCommissionAmount: number;
  performerReserveAmount: number;
  protectedCommissionAmount: number;
  maximumDoctorWaiverAmount: number;
  doctorWaiverAmount: number;
  payableCommissionAmount: number;
  hospitalFundedAmount: number;
  lines: DoctorCommissionPreviewLine[];
}

export async function quoteDoctorWaiver(
  db: D1Database,
  input: DoctorWaiverQuoteInput,
): Promise<DoctorWaiverQuote> {
  const items = await hydrateDiagnosticPerformerPreviewReserves(db, {
    tenantId: input.tenantId,
    billDate: input.billDate,
    items: input.items,
  });
  const preview = await previewDoctorCommissionForItems(db, {
    tenantId: input.tenantId,
    doctorId: input.doctorId,
    billDate: input.billDate,
    items,
  });

  const totalDiscount = Math.max(0, roundMoney(input.totalDiscount ?? 0));
  const eligibleCommissionAmount = Math.max(0, roundMoney(preview.eligibleCommissionAmount));
  const performerReserveAmount = roundMoney(items.reduce(
    (sum, item) => sum + Math.max(0, roundMoney(item.performerReserveAmount ?? 0)),
    0,
  ));
  const protectedCommissionAmount = Math.max(0, roundMoney(preview.protectedCommissionAmount));
  const maximumDoctorWaiverAmount = Math.max(0, roundMoney(preview.maximumDoctorWaiverAmount));
  const doctorWaiverAmount = totalDiscount > 0
    ? roundMoney(Math.min(totalDiscount, maximumDoctorWaiverAmount))
    : maximumDoctorWaiverAmount;
  const payableCommissionAmount = roundMoney(Math.max(0, eligibleCommissionAmount - doctorWaiverAmount));

  return {
    doctorId: input.doctorId,
    eligibleCommissionAmount,
    performerReserveAmount,
    protectedCommissionAmount,
    maximumDoctorWaiverAmount,
    doctorWaiverAmount,
    payableCommissionAmount,
    hospitalFundedAmount: totalDiscount > 0
      ? roundMoney(Math.max(0, totalDiscount - doctorWaiverAmount))
      : 0,
    lines: preview.lines,
  };
}
