import { z } from 'zod';

// ─── Prescription AI Assistant ──────────────────────────────────────────────

export const prescriptionAssistSchema = z.object({
  medications: z.array(
    z.object({
      name: z.string().min(1, 'Drug name is required'),
      dosage: z.string().optional(),
      frequency: z.string().optional(),
      duration: z.string().optional(),
    }),
  ).min(1, 'At least one medication required'),
  patientId: z.number().int().positive().optional(),
  patientAge: z.number().int().min(0).max(150).optional(),
  patientWeight: z.number().positive().optional(),
  patientGender: z.enum(['Male', 'Female', 'Other']).optional(),
  knownAllergies: z.array(z.string()).optional(),
});

export type PrescriptionAssistInput = z.infer<typeof prescriptionAssistSchema>;

// ─── Diagnosis Suggestions ──────────────────────────────────────────────────

export const diagnosisSuggestSchema = z.object({
  symptoms: z.string().min(3, 'Describe symptoms').max(2000, 'Symptoms text too long'),
  vitals: z.object({
    bp: z.string().optional(),
    temperature: z.string().optional(),
    spo2: z.string().optional(),
    pulse: z.string().optional(),
  }).optional(),
  patientAge: z.number().int().min(0).max(150).optional(),
  patientGender: z.enum(['Male', 'Female', 'Other']).optional(),
  medicalHistory: z.string().max(2000).optional(),
});

export type DiagnosisSuggestInput = z.infer<typeof diagnosisSuggestSchema>;

// ─── Auto-Billing from Notes ────────────────────────────────────────────────

export const billingFromNotesSchema = z.object({
  consultationNotes: z.string().min(10, 'Notes must be at least 10 characters').max(5000, 'Notes too long'),
  patientId: z.number().int().positive().optional(),
});

export type BillingFromNotesInput = z.infer<typeof billingFromNotesSchema>;

// ─── Symptom Triage Chatbot ─────────────────────────────────────────────────

export const triageChatSchema = z.object({
  message: z.string().min(1, 'Message is required').max(1000, 'Message too long'),
  conversationHistory: z.array(
    z.object({
      role: z.enum(['user', 'assistant']),
      content: z.string(),
    }),
  ).max(20).optional().default([]),
});

export type TriageChatInput = z.infer<typeof triageChatSchema>;

// ─── Clinical Note Summarization ────────────────────────────────────────────

export const noteSummarySchema = z.object({
  note: z.string().min(20, 'Note must be at least 20 characters').max(5000, 'Note too long'),
  format: z.enum(['brief', 'soap']).optional().default('soap'),
});

export type NoteSummaryInput = z.infer<typeof noteSummarySchema>;

// ─── Lab Report Interpretation ──────────────────────────────────────────────

export const labInterpretSchema = z.object({
  results: z.array(
    z.object({
      testName: z.string().min(1),
      value: z.string().min(1),
      unit: z.string().optional(),
      normalRange: z.string().optional(),
    }),
  ).min(1, 'At least one lab result required'),
  patientAge: z.number().int().min(0).max(150).optional(),
  patientGender: z.enum(['Male', 'Female', 'Other']).optional(),
});

export type LabInterpretInput = z.infer<typeof labInterpretSchema>;

// ─── Dashboard Insights ────────────────────────────────────────────────────

export const dashboardInsightsSchema = z.object({
  dateRange: z.object({
    from: z.string().min(1),
    to: z.string().min(1),
  }),
});

export type DashboardInsightsInput = z.infer<typeof dashboardInsightsSchema>;
