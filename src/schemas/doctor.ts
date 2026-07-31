import { z } from 'zod';
import { formatDoctorName } from '../lib/doctor-display';

export const createDoctorSchema = z.object({
  name: z.string().min(1, 'Doctor name is required').transform((val) => formatDoctorName(val)),
  specialty: z.string().optional(),
  mobileNumber: z.string().optional(),
  consultationFee: z.number().int().min(100, 'Minimum consultation fee is 100 BDT'),
  ipdRoundFee: z.number().int().min(0, 'IPD round fee cannot be negative').optional().default(0),
  publicBio: z.string().optional(),
  languages: z.array(z.string()).optional(),
  bmdcRegNo: z.string().optional(),
  qualifications: z.string().optional(),
  publishToMarketplace: z.boolean().optional().default(false),
  email: z.string().email().optional(),
  department: z.string().optional(),
  departmentId: z.number().int().positive().optional(),
  bio: z.string().optional(),
  photoKey: z.string().optional(),
  isAvailable: z.boolean().optional().default(true),
  displayOrder: z.number().int().nonnegative().optional().default(0),
  visitingHours: z.string().optional(),
  isMarketplaceVisible: z.boolean().optional(),
});

export const updateDoctorSchema = createDoctorSchema.partial();

export type CreateDoctorInput = z.infer<typeof createDoctorSchema>;
export type UpdateDoctorInput = z.infer<typeof updateDoctorSchema>;
