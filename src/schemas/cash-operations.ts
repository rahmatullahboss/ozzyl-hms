import { z } from 'zod';

export const cashOperationSettingsPatchSchema = z.object({
  pettyCashAutoApproveLimit: z.number().min(0).optional(),
  receiptRequiredLimit: z.number().min(0).optional(),
}).refine(
  (value) => value.pettyCashAutoApproveLimit !== undefined || value.receiptRequiredLimit !== undefined,
  { message: 'At least one setting must be provided' },
);

export type CashOperationSettingsPatchInput = z.infer<typeof cashOperationSettingsPatchSchema>;
