import { z } from 'zod';

// ═══════════════════════════════════════════════════════════════════════════════
// FHIR R4 Write Validation — Zod schemas for POST endpoints
// ═══════════════════════════════════════════════════════════════════════════════

// ─── POST /fhir/Patient ─────────────────────────────────────────────────────

export const fhirCreatePatientSchema = z.object({
  resourceType: z.literal('Patient'),
  name: z.array(z.object({
    text: z.string().optional(),
    family: z.string().optional(),
    given: z.array(z.string()).optional(),
  }).refine(
    (n) => !!(n.text || n.family || (n.given && n.given.length > 0)),
    { message: 'At least one of text, family, or given is required' },
  )).min(1),
  telecom: z.array(z.object({
    system: z.enum(['phone', 'email']).optional(),
    value: z.string(),
    use: z.enum(['home', 'work', 'mobile']).optional(),
  })).optional(),
  gender: z.enum(['male', 'female', 'other', 'unknown']).optional(),
  birthDate: z.string().optional(),
  address: z.array(z.object({
    text: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    country: z.string().optional(),
  })).optional(),
  identifier: z.array(z.object({
    system: z.string().optional(),
    value: z.string(),
  })).optional(),
});

// ─── POST /fhir/Observation ─────────────────────────────────────────────────

export const fhirCreateObservationSchema = z.object({
  resourceType: z.literal('Observation'),
  status: z.enum(['final', 'preliminary', 'registered', 'amended']).default('final'),
  code: z.object({
    coding: z.array(z.object({
      system: z.string().optional(),
      code: z.string(),
      display: z.string().optional(),
    })).min(1),
  }),
  subject: z.object({
    reference: z.string().regex(/^Patient\/\d+$/),
  }),
  effectiveDateTime: z.string().optional(),
  valueQuantity: z.object({
    value: z.number(),
    unit: z.string().optional(),
    system: z.string().optional(),
    code: z.string().optional(),
  }).optional(),
  component: z.array(z.object({
    code: z.object({
      coding: z.array(z.object({
        system: z.string().optional(),
        code: z.string(),
        display: z.string().optional(),
      })).min(1),
    }),
    valueQuantity: z.object({
      value: z.number(),
      unit: z.string().optional(),
    }).optional(),
  })).optional(),
});

// ─── POST /fhir/Encounter ───────────────────────────────────────────────────

export const fhirCreateEncounterSchema = z.object({
  resourceType: z.literal('Encounter'),
  status: z.enum(['planned', 'in-progress', 'finished', 'cancelled']).default('finished'),
  class: z.object({
    code: z.string(),
    display: z.string().optional(),
  }),
  subject: z.object({
    reference: z.string().regex(/^Patient\/\d+$/),
  }),
  participant: z.array(z.object({
    individual: z.object({
      reference: z.string().optional(),
      display: z.string().optional(),
    }).optional(),
  })).optional(),
  period: z.object({
    start: z.string().optional(),
    end: z.string().optional(),
  }).optional(),
  reasonCode: z.array(z.object({
    coding: z.array(z.object({
      system: z.string().optional(),
      code: z.string(),
      display: z.string().optional(),
    })).optional(),
    text: z.string().optional(),
  })).optional(),
});
