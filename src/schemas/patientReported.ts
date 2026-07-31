import { z } from 'zod';

export const adverseReactionSchema = z.object({
  medication_name: z.string().trim().min(1).max(200),
  generic_name: z.string().trim().max(200).optional(),
  reaction: z.string().trim().min(1).max(1000),
  severity: z.enum(['mild', 'moderate', 'severe']).default('moderate'),
  onset_date: z.string().trim().max(50).optional(),
  outcome_status: z.enum(['ongoing', 'resolved', 'required_treatment', 'hospitalized']).optional(),
  notes: z.string().trim().max(2000).optional(),
});

export const lifestyleLogSchema = z.object({
  logged_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sleep_hours: z.number().min(0).max(24).optional(),
  exercise_minutes: z.number().int().min(0).max(1440).optional(),
  mood: z.enum(['very_low', 'low', 'neutral', 'good', 'excellent']).optional(),
  energy_level: z.enum(['very_low', 'low', 'moderate', 'high']).optional(),
  symptom_score: z.number().int().min(0).max(10).optional(),
  symptoms: z.string().trim().max(2000).optional(),
  diet_notes: z.string().trim().max(1000).optional(),
  water_glasses: z.number().int().min(0).max(20).optional(),
  notes: z.string().trim().max(2000).optional(),
}).superRefine((input, ctx) => {
  if (
    input.sleep_hours == null &&
    input.exercise_minutes == null &&
    !input.mood &&
    !input.energy_level &&
    input.symptom_score == null &&
    !input.symptoms &&
    !input.diet_notes &&
    !input.notes
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['notes'],
      message: 'Provide at least one lifestyle metric, symptom, or note',
    });
  }
});

export type AdverseReactionInput = z.infer<typeof adverseReactionSchema>;
export type LifestyleLogInput = z.infer<typeof lifestyleLogSchema>;

export const vitalsLogSchema = z.object({
  logged_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  systolic: z.number().int().min(50).max(250).optional().nullable(),
  diastolic: z.number().int().min(30).max(150).optional().nullable(),
  heart_rate: z.number().int().min(30).max(200).optional().nullable(),
  blood_sugar: z.number().min(2).max(40).optional().nullable(),
  blood_sugar_context: z.enum(['fasting', 'post_prandial', 'random']).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
}).superRefine((val, ctx) => {
  if (val.systolic != null && val.diastolic == null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Diastolic is required if systolic is provided", path: ["diastolic"] });
  }
  if (val.diastolic != null && val.systolic == null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Systolic is required if diastolic is provided", path: ["systolic"] });
  }
  if (val.blood_sugar != null && val.blood_sugar_context == null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Context is required when blood sugar is provided", path: ["blood_sugar_context"] });
  }
});

export type VitalsLogInput = z.infer<typeof vitalsLogSchema>;
