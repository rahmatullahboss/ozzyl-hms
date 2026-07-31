import { z } from 'zod';

export const createAdviceTemplateSchema = z.object({
  doctorId:    z.number().int().positive().optional(),
  content:     z.string().min(1, 'Content required').max(2000),
  category:    z.string().max(50).optional().default('general'),
  language:    z.string().max(10).optional().default('bn'),
  sortOrder:   z.number().int().min(0).optional().default(0),
});

export const updateAdviceTemplateSchema = z.object({
  content:     z.string().min(1).max(2000).optional(),
  category:    z.string().max(50).optional(),
  language:    z.string().max(10).optional(),
  sortOrder:   z.number().int().min(0).optional(),
}).refine(obj => Object.keys(obj).length > 0, { message: 'At least one field required' });
