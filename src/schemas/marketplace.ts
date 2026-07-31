import { z } from 'zod';

// ─── Search Schemas (query params) ──────────────────────────────────────────

export const hospitalSearchSchema = z.object({
  q:           z.string().max(200).optional(),
  specialty:   z.string().max(100).optional(),
  lat:         z.string().transform(Number).pipe(z.number().min(-90).max(90)).optional(),
  lng:         z.string().transform(Number).pipe(z.number().min(-180).max(180)).optional(),
  radius:      z.string().transform(Number).pipe(z.number().int().min(1).max(500)).optional().default('20'),
  rating_min:  z.string().transform(Number).pipe(z.number().int().min(1).max(5)).optional(),
  type:        z.enum(['hospital', 'chamber']).optional(),
  page:        z.string().transform(Number).pipe(z.number().int().min(1)).optional().default('1'),
  limit:       z.string().transform(Number).pipe(z.number().int().min(1).max(50)).optional().default('20'),
});

export const doctorSearchSchema = z.object({
  q:              z.string().max(200).optional(),
  specialty:      z.string().max(100).optional(),
  hospital:       z.string().max(100).optional(),
  language:       z.string().max(50).optional(),
  available_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD').optional(),
  fee_max:        z.string().transform(Number).pipe(z.number().int().min(0)).optional(),
  rating_min:     z.string().transform(Number).pipe(z.number().int().min(1).max(5)).optional(),
  page:           z.string().transform(Number).pipe(z.number().int().min(1)).optional().default('1'),
  limit:          z.string().transform(Number).pipe(z.number().int().min(1).max(50)).optional().default('20'),
});

export const availabilityQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
});

// ─── Action Schemas (JSON body) ─────────────────────────────────────────────

export const marketplaceBookingSchema = z.object({
  doctor_id:    z.number().int().positive(),
  tenant_id:    z.string().min(1),
  booking_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  booking_time: z.string().regex(/^\d{2}:\d{2}$/, 'Time must be HH:MM'),
});

export const reviewSchema = z.object({
  target_type:      z.enum(['hospital', 'doctor']),
  target_tenant_id: z.string().min(1),
  target_doctor_id: z.number().int().positive().optional(),
  rating:           z.number().int().min(1).max(5),
  review_text:      z.string().max(2000).optional(),
});

export const publishHospitalSchema = z.object({
  is_published: z.boolean(),
});

export const publishDoctorSchema = z.object({
  is_marketplace_visible: z.boolean(),
});

export const updateHospitalProfileSchema = z.object({
  public_description: z.string().max(5000).optional(),
  public_photos:      z.array(z.string().max(500)).max(10).optional(),
  specialties:        z.array(z.string().max(100)).max(20).optional(),
  latitude:           z.number().min(-90).max(90).optional(),
  longitude:          z.number().min(-180).max(180).optional(),
  operating_hours:    z.record(z.string().max(50)).optional(),
});

// ─── Doctor Auth Schemas ────────────────────────────────────────────────────

const scheduleEntrySchema = z.object({
  day_of_week:  z.number().int().min(0).max(6),
  start_time:   z.string().regex(/^\d{2}:\d{2}$/, 'Time must be HH:MM'),
  end_time:     z.string().regex(/^\d{2}:\d{2}$/, 'Time must be HH:MM'),
  max_patients: z.number().int().min(1).max(200).default(20),
});

export const doctorRegisterSchema = z.object({
  name:               z.string().min(2).max(200),
  email:              z.string().email().optional(),
  phone:              z.string().min(6).max(20).optional(),
  password:           z.string().min(8).max(128),
  specialty:          z.string().min(2).max(100),
  bmdc_registration:  z.string().min(1).max(50),
  qualifications:     z.string().max(500).optional(),
  chamber_name:       z.string().min(2).max(200),
  chamber_address:    z.string().min(5).max(500),
  consultation_fee:   z.number().int().min(0),
  public_bio:         z.string().max(2000).optional(),
  languages:          z.array(z.string().max(50)).max(10).optional(),
  schedule:           z.array(scheduleEntrySchema).min(0).max(7),
});

export const doctorLoginSchema = z.object({
  email:    z.string().email().optional(),
  phone:    z.string().min(6).max(20).optional(),
  password: z.string().min(1),
});

// ─── Type Exports ───────────────────────────────────────────────────────────

export type HospitalSearchInput = z.infer<typeof hospitalSearchSchema>;
export type DoctorSearchInput = z.infer<typeof doctorSearchSchema>;
export type MarketplaceBookingInput = z.infer<typeof marketplaceBookingSchema>;
export type ReviewInput = z.infer<typeof reviewSchema>;
export type DoctorRegisterInput = z.infer<typeof doctorRegisterSchema>;
export type DoctorLoginInput = z.infer<typeof doctorLoginSchema>;
export type PublishHospitalInput = z.infer<typeof publishHospitalSchema>;
export type PublishDoctorInput = z.infer<typeof publishDoctorSchema>;
export type UpdateHospitalProfileInput = z.infer<typeof updateHospitalProfileSchema>;
