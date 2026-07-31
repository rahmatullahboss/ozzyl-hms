import { z } from 'zod';

export const createFractionPercentSchema = z.object({
  serviceItemId: z.number().int().positive().optional(),
  billItemCategory: z.string().trim().min(1).optional(),
  hospitalPercent: z.number().min(0).max(100).default(60),
  doctorPercent: z.number().min(0).max(100).default(40),
});

export const calculateFractionSchema = z.object({
  billId: z.number().int().positive(),
  doctorId: z.number().int().positive(),
});

export type CreateFractionPercentInput = z.infer<typeof createFractionPercentSchema>;
export type CalculateFractionInput = z.infer<typeof calculateFractionSchema>;
