import { z } from 'zod';

export const createConsultationSchema = z.object({
  doctorId:       z.number().int().positive('Doctor ID required'),
  patientId:      z.number().int().positive('Patient ID required'),
  scheduledAt:    z.string().min(1, 'Scheduled datetime required'),
  durationMin:    z.number().int().min(5).max(480).default(30),
  notes:          z.string().max(1000).optional(),
  chiefComplaint: z.string().max(500).optional(),
  followupDate:   z.string().optional(),
});

export const endConsultationSchema = z.object({
  prescription:  z.string().max(2000).optional(),
  followupDate:  z.string().optional(),
  notes:         z.string().max(1000).optional(),
});

export const updateConsultationSchema = z.object({
  scheduledAt:    z.string().optional(),
  durationMin:    z.number().int().min(5).max(480).optional(),
  notes:          z.string().max(1000).optional(),
  chiefComplaint: z.string().max(500).optional(),
  status:         z.enum(['waiting', 'scheduled', 'in_progress', 'completed', 'cancelled', 'no_show', 'referred', 'follow_up_required']).optional(),
  prescriptionId: z.number().int().positive().optional(),
});
