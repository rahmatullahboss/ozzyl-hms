import { z } from 'zod';

const optionalText = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().optional(),
);

const optionalDate = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
);

const departmentSchema = z.string().trim().min(1).max(100).optional();

export const createStaffSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  address: optionalText,
  position: z.string().trim().min(1, 'Position is required'),
  salary: z.number().nonnegative('Salary required').default(0),
  bankAccount: optionalText,
  mobile: optionalText,
  joiningDate: optionalDate,
  department: departmentSchema,
  email: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().email('Invalid email format').optional(),
  ),
  dateOfBirth: optionalDate,
  gender: z.enum(['Male', 'Female', 'Other']).optional(),
  salutation: z.enum(['Mr', 'Mrs', 'Ms', 'Dr']).optional(),
  emergencyContact: optionalText,
  bloodGroup: optionalText,
  category: optionalText,
  biometricDeviceId: optionalText,
  shiftType: optionalText,
});

export const updateStaffSchema = createStaffSchema.partial().extend({
  department: z.string().trim().min(1).max(100).nullable().optional(),
});

export const paySalarySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, 'Month must be YYYY-MM'),
  bonus: z.number().int().nonnegative().default(0),
  deduction: z.number().int().nonnegative().default(0),
  paymentMethod: z.enum(['cash', 'bank', 'bkash', 'other']).optional(),
  referenceNo: z.string().optional(),
});

export type CreateStaffInput  = z.infer<typeof createStaffSchema>;
export type UpdateStaffInput  = z.infer<typeof updateStaffSchema>;
export type PaySalaryInput    = z.infer<typeof paySalarySchema>;
