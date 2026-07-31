import { z } from 'zod';
import { bangladeshMobileSchema, optionalBangladeshMobileSchema } from '../lib/bangladesh-phone';
import { validateBDNationalId } from '../lib/nid-validation';
import { GLOBAL_UID_REGEX } from '../lib/global-identity';

const nationalIdField = z.string().superRefine((value, ctx) => {
  const result = validateBDNationalId(value);
  if (!result.valid) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: result.error ?? 'Invalid National ID',
    });
  }
});

const dateOfBirthField = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'DOB must be YYYY-MM-DD')
  .refine((value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (Number.isNaN(parsed.getTime())) return false;
    const normalized = parsed.toISOString().slice(0, 10);
    if (normalized !== value) return false;
    return value <= new Date().toISOString().slice(0, 10);
  }, 'DOB cannot be in the future');

const guardianRelationField = z.enum([
  'father', 'mother', 'spouse', 'son', 'daughter',
  'sibling', 'grandparent', 'uncle', 'aunt',
  'neighbor', 'legal_guardian', 'other',
]);

const mobileMissingReasonField = z.enum([
  'no_personal_mobile',
  'no_family_mobile',
  'emergency_arrival',
  'patient_refused',
  'will_update_later',
  'other',
]);

const patientBaseFields = z.object({
  name: z.string().trim().min(1).optional(),
  firstName: z.string().trim().min(1).optional(),
  middleName: z.string().trim().optional(),
  lastName: z.string().trim().optional(),
  fatherHusband: z.string().trim().optional(),
  address: z.string().trim().optional(),
  // Mobile is now CONDITIONAL-OPTIONAL. When the receptionist has no
  // number to give (very common in rural Bangladesh: emergency arrival,
  // patient has no phone, family is unreachable, etc.) the field is
  // empty and the `mobileMissingReason` + alternative identity fields
  // (guardian contact OR structured address) become required.
  mobile: optionalBangladeshMobileSchema,
  mobileMissingReason: mobileMissingReasonField.optional(),
  uhid: z.string().regex(GLOBAL_UID_REGEX, 'UHID must be in OZ-000001 or OZ-XXXX-XXXX format').optional(),
  guardianMobile: optionalBangladeshMobileSchema,
  // Guardian contact (used as the primary reachability channel when
  // `mobile` is null). Reused from the `patient_guardians` table contract.
  guardianName: z.string().trim().optional(),
  guardianRelation: guardianRelationField.optional(),
  // Structured address (BD administrative hierarchy) — becomes required
  // when there is no mobile AND no guardian contact.
  village: z.string().trim().optional(),
  unionName: z.string().trim().optional(),
  upazila: z.string().trim().optional(),
  district: z.string().trim().optional(),
  division: z.string().trim().optional(),
  // Age is stored as completed years for legacy reports. It must allow 0
  // because newborns/infants are clinically valid patients; precise pediatric
  // age should be derived from dateOfBirth when available.
  age: z.number().int().nonnegative('Age cannot be negative').max(130, 'Age looks too high').optional(),
  dateOfBirth: dateOfBirthField.optional(),
  gender: z.enum(['male', 'female', 'other']).optional(),
  bloodGroup: z.enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']).optional(),
  email: z.string().email().optional(),
  emergencyContactName: z.string().trim().optional(),
  emergencyContactPhone: optionalBangladeshMobileSchema,
  emergencyContactRelation: z.string().trim().optional(),
  nationalId: nationalIdField.optional(),
  duplicateOverrideReason: z.string().trim().min(5).max(500).optional(),
  idempotencyKey: z.string().trim().min(8).max(256).optional(),
});

const hasGuardianContact = (data: {
  guardianName?: string;
  guardianRelation?: string;
}) => Boolean(data.guardianName && data.guardianRelation);

const hasStructuredAddress = (data: {
  village?: string;
  unionName?: string;
  upazila?: string;
  district?: string;
}) => Boolean(
  data.village
  && data.unionName
  && data.upazila
  && data.district,
);

export const createPatientSchema = patientBaseFields
  .transform((data) => {
    // Auto-generate name from structured fields if not provided
    if (!data.name) {
      const parts = [data.firstName, data.middleName, data.lastName].filter(Boolean);
      if (parts.length > 0) {
        return { ...data, name: parts.join(' ') };
      }
    }
    return data;
  })
  .refine((data) => data.name && data.name.trim().length > 0, {
    message: 'Patient name is required (provide name or firstName)',
    path: ['name'],
  })
  .refine((data) => data.age !== undefined || !!data.dateOfBirth, {
    message: 'Age or date of birth is required',
    path: ['age'],
  })
  .refine((data) => data.gender !== undefined, {
    message: 'Gender is required',
    path: ['gender'],
  })
  .refine((data) => {
    // When the receptionist has a Bangladesh mobile, the form is happy
    // and the row is searchable on the (normalised) number.
    if (data.mobile) return true;
    // No mobile ⇒ a reason MUST be picked so the data quality team
    // can later chase up the number.
    if (!data.mobileMissingReason) return false;
    // And at least one of: a named guardian, or a fully structured
    // address, so the patient remains reachable.
    return hasGuardianContact(data) || hasStructuredAddress(data);
  }, {
    message: 'Mobile is missing — provide a reason and either a guardian contact (name + relation) or a full address (village + union + upazila + district).',
    path: ['mobileMissingReason'],
  });

export const updatePatientSchema = patientBaseFields.partial();

export type CreatePatientInput = z.infer<typeof createPatientSchema>;
export type UpdatePatientInput = z.infer<typeof updatePatientSchema>;

export const MOBILE_MISSING_REASONS = [
  { value: 'no_personal_mobile', labelKey: 'noPersonalMobile' },
  { value: 'no_family_mobile', labelKey: 'noFamilyMobile' },
  { value: 'emergency_arrival', labelKey: 'emergencyArrival' },
  { value: 'patient_refused', labelKey: 'patientRefused' },
  { value: 'will_update_later', labelKey: 'willUpdateLater' },
  { value: 'other', labelKey: 'other' },
] as const;

export const GUARDIAN_RELATIONS = [
  { value: 'father', labelKey: 'father' },
  { value: 'mother', labelKey: 'mother' },
  { value: 'spouse', labelKey: 'spouse' },
  { value: 'son', labelKey: 'son' },
  { value: 'daughter', labelKey: 'daughter' },
  { value: 'sibling', labelKey: 'sibling' },
  { value: 'grandparent', labelKey: 'grandparent' },
  { value: 'uncle', labelKey: 'uncle' },
  { value: 'aunt', labelKey: 'aunt' },
  { value: 'neighbor', labelKey: 'neighbor' },
  { value: 'legal_guardian', labelKey: 'legalGuardian' },
  { value: 'other', labelKey: 'other' },
] as const;
