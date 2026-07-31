import { z } from 'zod';

export const createOrderSetSchema = z.object({
  code: z.string().min(1).max(50),
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  specialty: z.enum(['general', 'medicine', 'surgery', 'pediatrics', 'obs_gyn', 'icu', 'orthopedics', 'ent', 'ophthalmology', 'dermatology']).optional(),
  category: z.enum(['admission', 'discharge', 'procedure', 'protocol', 'custom']).default('admission'),
  is_global: z.boolean().default(true),
});

export const updateOrderSetSchema = createOrderSetSchema.partial();

export const createOrderSetItemSchema = z.object({
  sequence: z.number().int().nonnegative().default(0),
  item_type: z.enum(['medication', 'lab_test', 'nursing', 'diet', 'procedure', 'instruction']),
  medication_name: z.string().optional(),
  generic_name: z.string().optional(),
  dose: z.string().optional(),
  route: z.string().optional(),
  frequency: z.string().optional(),
  duration: z.string().optional(),
  instructions: z.string().optional(),
  formulary_item_id: z.number().int().positive().optional(),
  lab_test_id: z.number().int().positive().optional(),
  lab_test_code: z.string().optional(),
  description: z.string().optional(),
  priority: z.enum(['routine', 'urgent', 'stat', 'asap']).default('routine'),
  is_optional: z.boolean().default(false),
});

export const applyOrderSetSchema = z.object({
  patient_id: z.number().int().positive(),
  visit_id: z.number().int().positive().optional(),
  overrides: z.array(z.object({
    item_id: z.number().int().positive(),
    skip: z.boolean().default(false),
    dose: z.string().optional(),
    frequency: z.string().optional(),
    duration: z.string().optional(),
    instructions: z.string().optional(),
  })).optional(),
});

export const doctorFavoriteSchema = z.object({
  name: z.string().min(1).max(200),
  items_json: z.string().min(2),
});
