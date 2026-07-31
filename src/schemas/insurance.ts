import { z } from 'zod';

// ─── Insurance Policy ─────────────────────────────────────────────────────────

export const insurancePolicySchema = z.object({
  patient_id:     z.number().int().positive(),
  provider_name:  z.string().min(1, 'Provider name required').max(200),
  policy_no:      z.string().min(1, 'Policy number required').max(100),
  policy_type:    z.enum(['individual', 'group', 'government']).default('individual'),
  coverage_limit: z.number().int().min(0).default(0),  // paisa
  valid_from:     z.string().optional(),                // ISO date
  valid_to:       z.string().optional(),                // ISO date
  status:         z.enum(['active', 'expired', 'cancelled']).default('active'),
  notes:          z.string().max(1000).optional(),
});

export const updateInsurancePolicySchema = insurancePolicySchema.partial().omit({ patient_id: true });

export type InsurancePolicyInput     = z.infer<typeof insurancePolicySchema>;
export type UpdateInsurancePolicyInput = z.infer<typeof updateInsurancePolicySchema>;

// ─── Insurance Claim ──────────────────────────────────────────────────────────

export const insuranceClaimSchema = z.object({
  patient_id:     z.number().int().positive(),
  policy_id:      z.number().int().positive().optional(),
  bill_id:        z.number().int().positive().optional(),
  diagnosis:      z.string().max(500).optional(),
  icd10_code:     z.string().max(20).optional(),
  bill_amount:    z.number().int().min(0),              // paisa
  claimed_amount: z.number().int().min(0),              // paisa
});

export const updateInsuranceClaimSchema = z.object({
  status:          z.enum(['submitted', 'under_review', 'approved', 'rejected', 'settled']),
  approved_amount: z.number().int().min(0).optional(),  // paisa
  rejection_reason: z.string().max(1000).optional(),
  reviewer_notes:  z.string().max(2000).optional(),
  settled_at:      z.string().optional(),
});

export type InsuranceClaimInput       = z.infer<typeof insuranceClaimSchema>;
export type UpdateInsuranceClaimInput = z.infer<typeof updateInsuranceClaimSchema>;

// ─── Query filters ────────────────────────────────────────────────────────────
export const claimsQuerySchema = z.object({
  status:     z.enum(['submitted', 'under_review', 'approved', 'rejected', 'settled', 'all']).default('all'),
  patient_id: z.string().optional(),
  from:       z.string().optional(),  // ISO date
  to:         z.string().optional(),  // ISO date
  page:       z.string().default('1'),
  per_page:   z.string().default('20'),
});
