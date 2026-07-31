import { z } from 'zod';

/** Request magic link — patient provides their email */
export const requestMagicLinkSchema = z.object({
  email: z.string().email({ message: 'Valid email required' }),
});

/** Verify magic link — token from email query param */
export const verifyMagicLinkSchema = z.object({
  token: z.string().min(1, { message: 'Token is required' }),
});

/** Patient self-registration */
export const patientRegisterSchema = z.object({
  name: z.string().min(1, { message: 'Name is required' }).max(200),
  email: z.string().email({ message: 'Valid email required' }),
  mobile: z.string().min(1).max(20).optional(),
  date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD').optional(),
  gender: z.enum(['male', 'female', 'other']).optional(),
  address: z.string().max(500).optional(),
});

export type RequestMagicLinkInput = z.infer<typeof requestMagicLinkSchema>;
export type VerifyMagicLinkInput = z.infer<typeof verifyMagicLinkSchema>;
export type PatientRegisterInput = z.infer<typeof patientRegisterSchema>;
