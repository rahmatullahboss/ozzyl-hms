import { z } from 'zod';

const encounterTypes = ['outpatient', 'inpatient', 'emergency', 'telehealth', 'home_visit', 'day_care'] as const;
const encounterStatuses = ['planned', 'in_progress', 'completed', 'cancelled', 'no_show'] as const;

export const createEncounterSchema = z.object({
  patientId: z.number().int().positive(),
  visitId: z.number().int().positive().optional(),
  encounterType: z.enum(encounterTypes).default('outpatient'),
  providerId: z.number().int().positive().optional(),
  departmentId: z.number().int().positive().optional(),
  reasonForVisit: z.string().max(2000).optional(),
  chiefComplaint: z.string().max(2000).optional(),
});

export const updateEncounterSchema = z.object({
  status: z.enum(encounterStatuses).optional(),
  encounterType: z.enum(encounterTypes).optional(),
  providerId: z.number().int().positive().optional(),
  departmentId: z.number().int().positive().optional(),
  reasonForVisit: z.string().max(2000).optional(),
  chiefComplaint: z.string().max(2000).optional(),
  endTime: z.string().optional(),
  dispositionCode: z.string().max(50).optional(),
  dispositionNote: z.string().max(2000).optional(),
}).refine(obj => Object.keys(obj).length > 0, { message: 'At least one field required' });
