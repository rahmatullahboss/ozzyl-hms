import { z } from 'zod';
import { paymentMethodSchema } from './billing';

const NON_CASH_PAYMENT_METHODS = new Set(['card', 'bkash', 'nagad', 'rocket', 'bank_transfer', 'bank', 'cheque', 'other']);

function requireNonCashReference(method: string | undefined, reference: string | undefined, ctx: z.RefinementCtx, path: (string | number)[]) {
  const paymentMethod = method ?? 'cash';
  if (NON_CASH_PAYMENT_METHODS.has(paymentMethod) && !reference?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Transaction/reference number is required for non-cash payments.',
      path,
    });
  }
}

const discountAllocationReasonSchema = z.enum(['normal_hospital_discount', 'poor_patient_charity', 'doctor_commission_waiver', 'management_approved', 'reference_discount', 'staff_benefit_discount', 'vip_benefit_discount', 'owner_benefit_discount', 'shareholder_benefit_discount', 'corporate_contract_discount', 'campaign_discount', 'rounding_adjustment']);

const billingCounterDiscountAllocationSchema = z.object({
  reason: discountAllocationReasonSchema.default('normal_hospital_discount'),
  amount: z.number().min(0),
  doctorId: z.number().int().positive().optional(),
  note: z.string().trim().max(300).optional(),
});

const billingCounterSchemeApplicationSchema = z.object({
  schemeId: z.number().int().positive().optional(),
  schemeCode: z.string().trim().max(80).optional(),
  memberCode: z.string().trim().max(80).optional(),
  memberId: z.number().int().positive().optional(),
  serviceCategory: z.string().trim().max(80).optional(),
  allocationType: discountAllocationReasonSchema.optional(),
  suggestedDiscount: z.number().min(0).optional(),
}).strict().refine((value) => Boolean(value.schemeId || value.schemeCode || value.memberCode || value.memberId), {
  message: 'Provide a scheme, member code, or member id',
});

export const billingCounterServiceSearchSchema = z.object({
  search: z.string().trim().optional(),
  ids: z.string().trim().max(300).optional(),
  department_id: z.coerce.number().int().positive().optional(),
  price_category_id: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const denominationSchema = z.object({
  note1: z.number().int().min(0).default(0),
  note2: z.number().int().min(0).default(0),
  note5: z.number().int().min(0).default(0),
  note10: z.number().int().min(0).default(0),
  note20: z.number().int().min(0).default(0),
  note50: z.number().int().min(0).default(0),
  note100: z.number().int().min(0).default(0),
  note200: z.number().int().min(0).default(0),
  note500: z.number().int().min(0).default(0),
  note1000: z.number().int().min(0).default(0),
}).transform((data) => ({
  ...data,
  total: data.note1 * 1 + data.note2 * 2 + data.note5 * 5 + data.note10 * 10 +
         data.note20 * 20 + data.note50 * 50 + data.note100 * 100 + data.note200 * 200 +
         data.note500 * 500 + data.note1000 * 1000,
}));

export const cashDropSchema = z.object({
  amount: z.number().positive(),
  reason: z.string().trim().min(1).max(300),
  denominations: denominationSchema.optional(),
});

export const bankDepositRequestSchema = z.object({
  amount: z.number().positive(),
  proposedBankName: z.string().trim().max(160).optional(),
  note: z.string().trim().max(300).optional(),
  idempotencyKey: z.string().trim().min(8).max(128),
});

export const billingCounterActivateSchema = z.object({
  counterId: z.number().int().positive(),
  openingCash: z.number().min(0).default(0),
  openingDenominations: denominationSchema.optional(),
  remarks: z.string().trim().max(300).optional(),
});

export const nonCashSettlementSchema = z.object({
  bkash: z.number().min(0).optional().default(0),
  nagad: z.number().min(0).optional().default(0),
  rocket: z.number().min(0).optional().default(0),
  card: z.number().min(0).optional().default(0),
  bank: z.number().min(0).optional().default(0),
  bank_transfer: z.number().min(0).optional().default(0),
  cheque: z.number().min(0).optional().default(0),
  other: z.number().min(0).optional().default(0),
}).partial().optional();

export const billingCounterCloseSchema = z.object({
  closingCash: z.number().min(0),
  closingDenominations: denominationSchema.optional(),
  nonCashSettlements: nonCashSettlementSchema,
  nonCashRemarks: z.string().trim().max(500).optional(),
  handoverTo: z.number().int().positive().optional(),
  handoverAmount: z.number().min(0).optional(),
  handoverPurpose: z.enum(['shift_transfer', 'management_collection']).optional(),
  remarks: z.string().trim().max(300).optional(),
});

const billingCounterLineItemSchema = z.object({
  serviceItemId: z.number().int().positive().optional(),
  doctorId: z.number().int().positive().optional(),
  quantity: z.number().int().positive().default(1),
  discountAmount: z.number().min(0).default(0),
  discountPercent: z.number().min(0).max(100).default(0),
  performerDoctorId: z.number().int().positive().optional(),
  prescriberDoctorId: z.number().int().positive().optional(),
  labTestId: z.number().int().positive().optional(),
  remarks: z.string().max(300).optional(),
}).strict().superRefine((item, ctx) => {
  const sourceCount = Number(Boolean(item.serviceItemId)) + Number(Boolean(item.doctorId));
  if (sourceCount !== 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Select exactly one billable source: service item or doctor consultation',
      path: ['serviceItemId'],
    });
  }
  if (item.discountAmount > 0 && item.discountPercent > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Use either discountAmount or discountPercent, not both',
      path: ['discountPercent'],
    });
  }
});

export const billingCounterInvoiceSchema = z.object({
  patientId: z.number().int().positive(),
  visitId: z.number().int().positive().optional(),
  createWalkInVisit: z.boolean().default(false),
  schemeId: z.number().int().positive().optional(),
  schemeApplication: billingCounterSchemeApplicationSchema.optional(),
  priceCategoryId: z.number().int().positive().optional(),
  billMode: z.enum(['provisional', 'paid', 'credit']).default('paid'),
  idempotencyKey: z.string().trim().min(8).max(128).optional(),
  referringDoctorId: z.number().int().positive().nullable().optional(),
  referredByType: z.enum(['self', 'hospital', 'doctor', 'other']).optional(),
  referrerSelectionSource: z.enum(['manual', 'patient_context']).optional(),
  referredByHospitalId: z.number().int().positive().nullable().optional(),
  referredByName: z.string().trim().min(1).max(200).optional(),
  discountByName: z.string().trim().max(200).optional(),
  discountSourceIntent: discountAllocationReasonSchema.optional(),
  discountAllocations: z.array(billingCounterDiscountAllocationSchema).max(10).optional(),
  items: z.array(billingCounterLineItemSchema).min(1),
  payment: z.object({
    paymentMethod: paymentMethodSchema.default('cash'),
    paidAmount: z.number().min(0).default(0),
    depositDeducted: z.number().min(0).default(0),
    creditAmount: z.number().min(0).default(0),
    externalTransactionId: z.string().trim().min(3).max(128).optional(),
  }).default({ paymentMethod: 'cash', paidAmount: 0, depositDeducted: 0, creditAmount: 0 }),
}).superRefine((data, ctx) => {
  const type = data.referredByType
    ?? (data.referringDoctorId != null ? 'doctor' : data.referredByHospitalId != null ? 'hospital' : 'self');
  if (type === 'hospital') {
    if (data.referredByHospitalId == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'referredByHospitalId is required when referredByType is "hospital"',
        path: ['referredByHospitalId'],
      });
    }
    if (data.referringDoctorId != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'referringDoctorId must not be set when referredByType is "hospital"',
        path: ['referringDoctorId'],
      });
    }
  } else if (type === 'doctor') {
    if (data.referringDoctorId == null && !data.referredByName?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A doctor id or doctor name is required when referredByType is "doctor"',
        path: ['referredByName'],
      });
    }
    if (data.referredByHospitalId != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'referredByHospitalId must not be set when referredByType is "doctor"',
        path: ['referredByHospitalId'],
      });
    }
  } else if (type === 'other') {
    if (!data.referredByName?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'referredByName is required when referredByType is "other"',
        path: ['referredByName'],
      });
    }
    if (data.referringDoctorId != null || data.referredByHospitalId != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Doctor and hospital ids must not be set when referredByType is "other"',
        path: ['referredByType'],
      });
    }
  } else {
    if (data.referringDoctorId != null || data.referredByHospitalId != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Neither referringDoctorId nor referredByHospitalId should be set when referredByType is "self"',
        path: ['referredByType'],
      });
    }
  }

  data.items.forEach((item, index) => {
    if (item.prescriberDoctorId == null) return;
    if (type !== 'doctor' || data.referringDoctorId == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Internal prescriber commission requires an internal doctor referral',
        path: ['items', index, 'prescriberDoctorId'],
      });
    }
  });

  const isDashboardQuickBill = data.idempotencyKey?.startsWith('dashboard-service-bill-') === true;
  if (isDashboardQuickBill && type === 'doctor' && data.referringDoctorId != null && !data.referrerSelectionSource) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Confirm whether the quick-bill referring doctor was selected manually or from patient context',
      path: ['referrerSelectionSource'],
    });
  }
  if ((type !== 'doctor' || data.referringDoctorId == null) && data.referrerSelectionSource) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Referral selection source is only valid for an internal doctor referral',
      path: ['referrerSelectionSource'],
    });
  }

  if (data.billMode === 'paid' && Number(data.payment.paidAmount ?? 0) > 0) {
    requireNonCashReference(data.payment.paymentMethod, data.payment.externalTransactionId, ctx, ['payment', 'externalTransactionId']);
  }
});

export type BillingCounterInvoiceInput = z.infer<typeof billingCounterInvoiceSchema>;

export const pendingLabOrderBillSchema = z.object({
  itemIds: z.array(z.number().int().positive()).min(1).max(50),
  billMode: z.enum(['paid', 'credit']).default('paid'),
  payment: z.object({
    paymentMethod: paymentMethodSchema.default('cash'),
    paidAmount: z.number().min(0).default(0),
    externalTransactionId: z.string().trim().min(3).max(128).optional(),
  }).default({ paymentMethod: 'cash', paidAmount: 0 }),
}).strict().superRefine((data, ctx) => {
  if (data.billMode === 'paid' && Number(data.payment.paidAmount ?? 0) > 0) {
    requireNonCashReference(data.payment.paymentMethod, data.payment.externalTransactionId, ctx, ['payment', 'externalTransactionId']);
  }
});

export type PendingLabOrderBillInput = z.infer<typeof pendingLabOrderBillSchema>;
