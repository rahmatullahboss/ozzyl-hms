import { z } from 'zod';

const medStatuses = ['active', 'discontinued', 'completed', 'on_hold', 'suspended'] as const;
const medSources = ['prescribed', 'patient_reported', 'imported', 'pharmacy'] as const;

export const createMedicationSchema = z.object({
  patientId: z.number().int().positive(),
  formularyItemId: z.number().int().positive().optional(),
  medicationName: z.string().min(1).max(500),
  genericName: z.string().max(500).optional(),
  strength: z.string().max(100).optional(),
  dosageForm: z.string().max(100).optional(),
  dosage: z.string().max(200).optional(),
  frequency: z.string().max(200).optional(),
  duration: z.string().max(200).optional(),
  instructions: z.string().max(2000).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  source: z.enum(medSources).default('prescribed'),
  prescriptionId: z.number().int().positive().optional(),
});

export const updateMedicationSchema = z.object({
  medicationName: z.string().min(1).max(500).optional(),
  genericName: z.string().max(500).optional(),
  strength: z.string().max(100).optional(),
  dosageForm: z.string().max(100).optional(),
  dosage: z.string().max(200).optional(),
  frequency: z.string().max(200).optional(),
  duration: z.string().max(200).optional(),
  instructions: z.string().max(2000).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  status: z.enum(medStatuses).optional(),
  statusReason: z.string().max(1000).optional(),
}).refine(obj => Object.keys(obj).length > 0, { message: 'At least one field required' });
