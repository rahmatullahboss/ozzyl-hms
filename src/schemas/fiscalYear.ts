import { z } from 'zod';

export const createFiscalYearSchema = z.object({
  fiscalYearName: z.string().min(1, 'Fiscal year name required').max(100),
  startDate: z.string().min(1, 'Start date required'),
  endDate: z.string().min(1, 'End date required'),
  prefix: z.string().optional(),
  insurancePrefix: z.string().optional(),
  pharmacyPrefix: z.string().optional(),
});

export const updateFiscalYearSchema = z.object({
  fiscalYearName: z.string().min(1).max(100).optional(),
  startDate: z.string().min(1).optional(),
  endDate: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
  isClosed: z.boolean().optional(),
  prefix: z.string().optional(),
  insurancePrefix: z.string().optional(),
  pharmacyPrefix: z.string().optional(),
});

export const reopenFiscalYearSchema = z.object({
  remark: z.string().min(1, 'Remark required for reopening'),
});