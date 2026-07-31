import { z } from 'zod';

export const createCommissionSchema = z.object({
  marketingPerson: z.string().min(1, 'Marketing person name required'),
  mobile: z.string().optional(),
  patientId: z.number().int().positive().optional(),
  billId: z.number().int().positive().optional(),
  commissionAmount: z.number().int().positive('Commission amount must be positive'),
  notes: z.string().optional(),
});

export const markCommissionPaidSchema = z.object({
  paidDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  paymentMode: z.enum(['cash', 'bank', 'cheque', 'card', 'mobile_banking', 'other']).optional(),
  referenceNo: z.string().optional(),
  notes: z.string().optional(),
});

export const doctorCommissionRuleSchema = z.object({
  doctorId: z.number().int().positive(),
  serviceType: z.enum(['lab_test', 'consultation_fee', 'referral', 'procedure', 'ipd_round']),
  labTestId: z.number().int().positive().optional(),
  category: z.string().trim().optional(),
  rateType: z.enum(['percent', 'flat']),
  rateValue: z.number().int().min(0),
  waiverPolicy: z.enum(['full_earned', 'protected_floor', 'no_doctor_waiver']).default('full_earned'),
  protectedRate: z.number().min(0).optional(),
  protectedFlatAmount: z.number().min(0).optional(),
  incentiveType: z.enum(['performer', 'prescriber', 'referrer']).default('performer'),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  effectiveTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  isActive: z.boolean().optional(),
  notes: z.string().optional(),
});

export const updateDoctorCommissionRuleSchema = doctorCommissionRuleSchema.partial().extend({
  labTestId: z.number().int().positive().nullable().optional(),
  category: z.string().trim().nullable().optional(),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  effectiveTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  notes: z.string().nullable().optional(),
});

export const approveDoctorCommissionsSchema = z.object({
  accrualIds: z.array(z.number().int().positive()).min(1, 'At least one accrual must be selected'),
});

export const settleDoctorCommissionsSchema = z.object({
  doctorId: z.number().int().positive(),
  accrualIds: z.array(z.number().int().positive()).min(1, 'At least one accrual must be selected'),
  paymentMode: z.enum(['cash', 'bank', 'cheque', 'card', 'mobile_banking', 'other']),
  referenceNo: z.string().optional(),
  notes: z.string().optional(),
  settlementDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const payoutLineOverrideSchema = z.object({
  lineId: z.number().int().positive(),
  payoutAmount: z.number().positive(),
  reason: z.string().trim().max(240).optional(),
});

export const receptionPerformerReservePayoutSchema = z.object({
  doctorId: z.number().int().positive(),
  reserveIds: z.array(z.number().int().positive()).min(1, 'At least one reserve must be selected').max(500)
    .transform((ids) => Array.from(new Set(ids)).sort((a, b) => a - b)),
  lineOverrides: z.array(payoutLineOverrideSchema).max(500).default([]),
  receiverType: z.enum(['doctor', 'assistant', 'representative']).default('doctor'),
  receiverName: z.string().trim().min(1, 'Receiver name is required').max(200),
  receiverReference: z.string().trim().max(200).optional(),
  paymentMethod: z.literal('cash').default('cash'),
  adjustments: z.object({
    advanceDeduction: z.number().min(0).default(0),
    otherAdjustment: z.number().default(0),
    roundingAdjustment: z.number().min(-1).max(1).default(0),
  }).default({ advanceDeduction: 0, otherAdjustment: 0, roundingAdjustment: 0 }),
  adjustmentReason: z.string().trim().max(240).optional(),
  note: z.string().trim().max(500).optional(),
  idempotencyKey: z.string().uuid(),
}).superRefine((value, ctx) => {
  const hasAdjustment = value.adjustments.advanceDeduction !== 0
    || value.adjustments.otherAdjustment !== 0
    || value.adjustments.roundingAdjustment !== 0;
  if (hasAdjustment && !value.adjustmentReason) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['adjustmentReason'], message: 'Adjustment reason is required' });
  }
});

export const receptionDoctorPayoutSchema = z.object({
  doctorId: z.number().int().positive().optional(),
  accrualIds: z.array(z.number().int().positive()).min(1, 'At least one accrual must be selected'),
  lineOverrides: z.array(payoutLineOverrideSchema).max(500).default([]),
  receiverType: z.enum(['doctor', 'assistant', 'representative']).default('doctor'),
  receiverName: z.string().trim().min(1, 'Receiver name is required').max(120),
  receiverReference: z.string().trim().max(160).optional(),
  paymentMethod: z.enum(['cash']).default('cash'),
  adjustments: z.object({
    advanceDeduction: z.number().min(0).default(0),
    otherAdjustment: z.number().default(0),
    roundingAdjustment: z.number().default(0),
  }).default({ advanceDeduction: 0, otherAdjustment: 0, roundingAdjustment: 0 }),
  adjustmentReason: z.string().trim().max(240).optional(),
  note: z.string().trim().max(500).optional(),
  notes: z.string().trim().max(500).optional(),
  referenceNo: z.string().trim().max(120).optional(),
  attachmentKey: z.string().trim().max(300).optional(),
  idempotencyKey: z.string().trim().min(8).max(120),
}).superRefine((value, ctx) => {
  const hasAdjustment = value.adjustments.advanceDeduction !== 0
    || value.adjustments.otherAdjustment !== 0
    || value.adjustments.roundingAdjustment !== 0;
  if (hasAdjustment && !value.adjustmentReason) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['adjustmentReason'], message: 'Adjustment reason is required' });
  }
});

export type CreateCommissionInput    = z.infer<typeof createCommissionSchema>;
export type MarkCommissionPaidInput  = z.infer<typeof markCommissionPaidSchema>;
export type DoctorCommissionRuleInput = z.infer<typeof doctorCommissionRuleSchema>;
export type ApproveDoctorCommissionsInput = z.infer<typeof approveDoctorCommissionsSchema>;
export type SettleDoctorCommissionsInput = z.infer<typeof settleDoctorCommissionsSchema>;
export type ReceptionDoctorPayoutInput = z.infer<typeof receptionDoctorPayoutSchema>;
