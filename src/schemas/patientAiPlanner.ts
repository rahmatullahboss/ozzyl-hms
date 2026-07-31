import { z } from 'zod';

export const patientAiPlanSchema = z.object({
  headline: z.string().min(1),
  summary: z.string().min(1),
  focus_areas: z.array(z.string()).default([]),
  action_checklist: z.array(z.string()).default([]),
  eat_more: z.array(z.string()).default([]),
  avoid_or_reduce: z.array(z.string()).default([]),
  daily_routine: z.array(z.string()).default([]),
  exercise_plan: z.array(z.string()).default([]),
  follow_up_actions: z.array(z.string()).default([]),
  warning_signs: z.array(z.string()).default([]),
  doctor_consultation_advice: z.array(z.string()).default([]),
  disclaimer: z.string().min(1),
  confidence: z.enum(['low', 'medium', 'high']),
  data_gaps: z.array(z.string()).default([]),
});

export type PatientAiPlan = z.infer<typeof patientAiPlanSchema>;
