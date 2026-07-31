import { z } from 'zod';
import { TENANT_INVITE_ROLES } from '../lib/staff-invite-policy';

const STAFF_LINKABLE_ROLES = [
  'nurse',
  'laboratory',
  'reception',
  'manager',
  'md',
  'director',
  'pharmacist',
  'accountant',
] as const;

export const createInvitationSchema = z.object({
  email:    z.string().email('Valid email required'),
  role:     z.enum(TENANT_INVITE_ROLES, { message: 'Invalid role' }),
  doctorId: z.number().int().positive().optional(),
  staffId:  z.number().int().positive().optional(),
}).superRefine((data, ctx) => {
  // doctor rules (unchanged)
  if (data.role === 'doctor' && !data.doctorId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['doctorId'],
      message: 'doctorId is required when role is doctor' });
  }
  if (data.role !== 'doctor' && data.doctorId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['doctorId'],
      message: 'doctorId is only valid when role is doctor' });
  }
  // staff rules: staff profiles can be linked to operational/management users.
  if (data.staffId && !STAFF_LINKABLE_ROLES.includes(data.role as any)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['staffId'],
      message: 'staffId is only valid for staff-linkable roles' });
  }
  // mutual exclusion
  if (data.doctorId && data.staffId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['staffId'],
      message: 'doctorId and staffId cannot both be set' });
  }
});

export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;
