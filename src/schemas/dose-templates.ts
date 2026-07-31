import { z } from 'zod';

export const createDoseTemplateSchema = z.object({
  doctorId:    z.number().int().positive('Doctor ID required'),
  name:        z.string().min(1, 'Template name required').max(200),
  frequency:   z.string().max(50).optional(),
  duration:    z.string().max(50).optional(),
  instructions: z.string().max(500).optional(),
  isDefault:   z.number().int().min(0).max(1).optional().default(0),
  sortOrder:   z.number().int().min(0).optional().default(0),
});

export const updateDoseTemplateSchema = z.object({
  name:        z.string().min(1).max(200).optional(),
  frequency:   z.string().max(50).optional(),
  duration:    z.string().max(50).optional(),
  instructions: z.string().max(500).optional(),
  isDefault:   z.number().int().min(0).max(1).optional(),
  sortOrder:   z.number().int().min(0).optional(),
}).refine(obj => Object.keys(obj).length > 0, { message: 'At least one field required' });
