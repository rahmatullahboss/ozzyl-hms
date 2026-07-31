import { z } from 'zod';

// ─── Terminology Search Schemas ─────────────────────────────────────────────

export const icd11SearchSchema = z.object({
  q: z.string().min(2, 'Search query must be at least 2 characters'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const loincSearchSchema = z.object({
  q: z.string().min(2, 'Search query must be at least 2 characters'),
  class: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const snomedSearchSchema = z.object({
  q: z.string().min(2, 'Search query must be at least 2 characters'),
  tag: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
