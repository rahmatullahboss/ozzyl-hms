import { z } from 'zod';

export const createVitalsSchema = z.object({
  patientId: z.number().int().positive(),
  visitId: z.number().int().positive().optional(),
  temperature: z.number().min(30).max(45).optional(),
  pulse: z.number().int().min(0).max(300).optional(),
  bloodPressureSystolic: z.number().int().min(0).max(300).optional(),
  bloodPressureDiastolic: z.number().int().min(0).max(200).optional(),
  respiratoryRate: z.number().int().min(0).max(100).optional(),
  spo2: z.number().min(0).max(100).optional(),
  weight: z.number().min(0).max(500).optional(),
  height: z.number().min(0).max(300).optional(),
  painScale: z.number().int().min(0).max(10).optional(),
  bloodSugar: z.number().min(0).max(1000).optional(),
  notes: z.string().max(2000).optional(),
}).refine(
  (d) => d.temperature !== undefined || d.pulse !== undefined ||
    d.bloodPressureSystolic !== undefined || d.spo2 !== undefined ||
    d.weight !== undefined || d.height !== undefined ||
    d.respiratoryRate !== undefined || d.bloodSugar !== undefined,
  { message: 'At least one vital measurement is required' },
);

export const updateVitalsSchema = z.object({
  temperature: z.number().min(30).max(45).optional(),
  pulse: z.number().int().min(0).max(300).optional(),
  bloodPressureSystolic: z.number().int().min(0).max(300).optional(),
  bloodPressureDiastolic: z.number().int().min(0).max(200).optional(),
  respiratoryRate: z.number().int().min(0).max(100).optional(),
  spo2: z.number().min(0).max(100).optional(),
  weight: z.number().min(0).max(500).optional(),
  height: z.number().min(0).max(300).optional(),
  painScale: z.number().int().min(0).max(10).optional(),
  bloodSugar: z.number().min(0).max(1000).optional(),
  notes: z.string().max(2000).optional(),
}).refine(obj => Object.keys(obj).length > 0, { message: 'At least one field required' });
