import { z } from 'zod';


// Individual line item on a bill
export const invoiceItemSchema = z.object({
  itemCategory: z.enum(['test', 'doctor_visit', 'operation', 'medicine', 'admission', 'fire_service', 'service', 'other']),
  description: z.string().optional(),
  quantity: z.number().int().positive().default(1),
  unitPrice: z.number().int().nonnegative('Price cannot be negative'),
  referenceId: z.number().int().optional(),
  serviceItemId: z.number().int().optional(),
});

export const createBillSchema = z.object({
  patientId: z.number().int().positive('Patient ID required'),
  visitId: z.number().int().positive().optional(),
  items: z.array(invoiceItemSchema).min(1, 'At least one item is required'),
  discount: z.number().int().nonnegative().default(0),
  discountReason: z.string().trim().max(300).optional(),
  discountByName: z.string().trim().max(200).optional(),
  priceCategoryId: z.number().int().positive().optional(),
  referringDoctorId: z.number().int().positive().optional(),
  // Idempotency-Key may be passed as either a JSON field or an HTTP
  // header. We keep it optional and trim/length-validate in both routes.
  idempotencyKey: z.string().trim().min(8).max(128).optional(),
}).refine(data => data.discount === 0 || !!data.discountReason, {
  message: 'Discount reason is required when discount is applied',
}).refine(data => data.discount > 0 || !data.discountByName, {
  message: 'Discount by name is only applicable when discount is applied',
}).refine(data => data.discount === 0 || !!data.discountByName?.trim(), {
  message: 'Discount referred by name is required when discount is applied.',
});

export const paymentMethodSchema = z.enum([
  'cash',
  'card',
  'bkash',
  'nagad',
  'rocket',
  'bank_transfer',
  'bank',
  'cheque',
  'other',
]);

const NON_CASH_PAYMENT_METHODS = new Set(['card', 'bkash', 'nagad', 'rocket', 'bank_transfer', 'bank', 'cheque', 'other']);

export const paymentSchema = z.object({
  billId: z.number().int().positive('Bill ID required'),
  amount: z.number().int().positive('Amount must be positive'),
  type: z.enum(['current', 'due']).default('current'),
  paymentMethod: paymentMethodSchema.optional(),
  idempotencyKey: z.string().trim().min(8).max(128).optional(),
  externalTransactionId: z.string().trim().min(3).max(128).optional(),
  notes: z.string().optional(),
}).superRefine((data, ctx) => {
  const method = data.paymentMethod ?? 'cash';
  if (NON_CASH_PAYMENT_METHODS.has(method) && !data.externalTransactionId?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Transaction/reference number is required for non-cash payments.',
      path: ['externalTransactionId'],
    });
  }
});

// Edit bill (only allowed before any payment)
export const editBillSchema = z.object({
  items: z.array(invoiceItemSchema).min(1, 'At least one item is required'),
  discount: z.number().int().nonnegative().optional(),
  discountReason: z.string().trim().max(300).optional(),
  discountByName: z.string().trim().max(200).optional(),
}).refine(data => (data.discount ?? 0) === 0 || !!data.discountReason, {
  message: 'Discount reason is required when discount is applied',
}).refine(data => (data.discount ?? 0) > 0 || !data.discountByName, {
  message: 'Discount by name is only applicable when discount is applied',
}).refine(data => (data.discount ?? 0) === 0 || !!data.discountByName?.trim(), {
  message: 'Discount referred by name is required when discount is applied.',
});

export type CreateBillInput = z.infer<typeof createBillSchema>;
export type PaymentInput = z.infer<typeof paymentSchema>;
export type EditBillInput = z.infer<typeof editBillSchema>;
