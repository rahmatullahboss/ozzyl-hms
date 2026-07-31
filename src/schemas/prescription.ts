import { z } from 'zod';

export const prescriptionItemSchema = z.object({
  medicine_name: z.string().min(1, 'Medicine name required'),
  dosage:        z.string().optional(),
  frequency:     z.string().optional(),
  duration:      z.string().optional(),
  instructions:  z.string().optional(),
  sort_order:    z.number().int().nonnegative().optional().default(0),
  quantity:      z.number().int().nonnegative().optional().default(0),
  medicine_id:   z.number().int().positive().optional(),
});

export const createPrescriptionSchema = z.object({
  patientId:        z.number().int().positive(),
  doctorId:         z.number().int().positive().optional(),
  appointmentId:    z.number().int().positive().optional(),

  // Vitals
  bp:               z.string().max(20).optional(),
  temperature:      z.string().max(20).optional(),
  weight:           z.string().max(20).optional(),
  spo2:             z.string().max(10).optional(),

  // Clinical
  chiefComplaint:   z.string().optional(),
  diagnosis:        z.string().optional(),
  examinationNotes: z.string().optional(),
  advice:           z.string().optional(),
  labTests:         z.array(z.string()).optional().default([]),
  followUpDate:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),

  status:           z.enum(['draft', 'final']).default('draft'),
  dispense_status:  z.enum(['pending', 'partial', 'dispensed']).optional(),
  items:            z.array(prescriptionItemSchema).min(0).default([]),
});

export const updatePrescriptionSchema = createPrescriptionSchema.partial();

export type CreatePrescriptionInput = z.infer<typeof createPrescriptionSchema>;
export type UpdatePrescriptionInput = z.infer<typeof updatePrescriptionSchema>;
