import { z } from 'zod';

const noteTypes = ['progress', 'soap', 'procedure', 'consultation', 'discharge', 'history_physical', 'operative', 'referral', 'telephone', 'other'] as const;

export const createNoteSchema = z.object({
  patientId: z.number().int().positive(),
  visitId: z.number().int().positive().optional(),
  noteType: z.enum(noteTypes).default('progress'),
  title: z.string().max(500).optional(),
  content: z.string().min(1).max(50000),
  chiefComplaint: z.string().max(2000).optional(),
  subjective: z.string().max(10000).optional(),
  objective: z.string().max(10000).optional(),
  assessment: z.string().max(10000).optional(),
  plan: z.string().max(10000).optional(),
  followUp: z.string().max(200).optional(),
  followUpUnit: z.string().max(50).optional(),
  templateId: z.number().int().positive().optional(),
  performerId: z.number().int().positive().optional(),
});

export const updateNoteSchema = z.object({
  noteType: z.enum(noteTypes).optional(),
  title: z.string().max(500).optional(),
  content: z.string().min(1).max(50000).optional(),
  chiefComplaint: z.string().max(2000).optional(),
  subjective: z.string().max(10000).optional(),
  objective: z.string().max(10000).optional(),
  assessment: z.string().max(10000).optional(),
  plan: z.string().max(10000).optional(),
  followUp: z.string().max(200).optional(),
  followUpUnit: z.string().max(50).optional(),
}).refine(obj => Object.keys(obj).length > 0, { message: 'At least one field required' });
