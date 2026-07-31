import { z } from 'zod';

const allergyTypes = ['drug', 'food', 'environment', 'biological', 'other'] as const;
const severityLevels = ['mild', 'moderate', 'severe', 'life_threatening'] as const;

export const createAllergySchema = z.object({
  patientId: z.number().int().positive(),
  allergyType: z.enum(allergyTypes),
  allergen: z.string().min(1).max(500),
  severity: z.enum(severityLevels).default('mild'),
  reaction: z.string().max(1000).optional(),
  onsetDate: z.string().optional(),
  notes: z.string().max(2000).optional(),
});

export const updateAllergySchema = z.object({
  allergyType: z.enum(allergyTypes).optional(),
  allergen: z.string().min(1).max(500).optional(),
  severity: z.enum(severityLevels).optional(),
  reaction: z.string().max(1000).optional(),
  onsetDate: z.string().optional(),
  notes: z.string().max(2000).optional(),
}).refine(obj => Object.keys(obj).length > 0, { message: 'At least one field required' });
