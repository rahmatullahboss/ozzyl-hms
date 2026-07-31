// ═══════════════════════════════════════════════════════════════════════════════
// FHIR R4 Type Definitions — hand-coded from HL7 FHIR R4 spec
// Only the resource types needed by HMS-SaaS facade
// ═══════════════════════════════════════════════════════════════════════════════

export interface FhirMeta {
  versionId?: string;
  lastUpdated?: string;
  profile?: string[];
}

export interface FhirCoding {
  system?: string;
  code: string;
  display?: string;
}

export interface FhirCodeableConcept {
  coding?: FhirCoding[];
  text?: string;
}

export interface FhirIdentifier {
  system?: string;
  value: string;
  type?: FhirCodeableConcept;
}

export interface FhirHumanName {
  use?: 'official' | 'usual' | 'nickname' | 'old';
  text?: string;
  family?: string;
  given?: string[];
}

export interface FhirContactPoint {
  system?: 'phone' | 'email' | 'fax' | 'url';
  value: string;
  use?: 'home' | 'work' | 'mobile';
}

export interface FhirAddress {
  use?: 'home' | 'work' | 'billing';
  text?: string;
  city?: string;
  state?: string;
  country?: string;
  extension?: FhirExtension[];
}

export interface FhirExtension {
  url: string;
  valueString?: string;
  valueCode?: string;
  valueIdentifier?: FhirIdentifier;
}

export interface FhirReference {
  reference: string;
  display?: string;
}

export interface FhirPeriod {
  start?: string;
  end?: string;
}

export interface FhirQuantity {
  value: number;
  unit: string;
  system?: string;
  code?: string;
}

// ─── Resource Types ──────────────────────────────────────────────────────────

export interface FhirResource {
  resourceType: string;
  id: string;
  meta?: FhirMeta;
}

export interface FhirPatient extends FhirResource {
  resourceType: 'Patient';
  identifier?: FhirIdentifier[];
  name?: FhirHumanName[];
  telecom?: FhirContactPoint[];
  gender?: 'male' | 'female' | 'other' | 'unknown';
  birthDate?: string;
  address?: FhirAddress[];
  extension?: FhirExtension[];
}

export interface FhirPractitioner extends FhirResource {
  resourceType: 'Practitioner';
  identifier?: FhirIdentifier[];
  name?: FhirHumanName[];
  telecom?: FhirContactPoint[];
  qualification?: {
    code: FhirCodeableConcept;
  }[];
  active?: boolean;
}

export interface FhirObservationComponent {
  code: FhirCodeableConcept;
  valueQuantity?: FhirQuantity;
}

export interface FhirObservation extends FhirResource {
  resourceType: 'Observation';
  status: 'final' | 'preliminary' | 'registered' | 'amended';
  category?: FhirCodeableConcept[];
  code: FhirCodeableConcept;
  subject?: FhirReference;
  effectiveDateTime?: string;
  component?: FhirObservationComponent[];
  valueQuantity?: FhirQuantity;
}

export interface FhirDosage {
  text?: string;
  timing?: { code?: FhirCodeableConcept };
  doseAndRate?: { doseQuantity?: FhirQuantity }[];
}

export interface FhirMedicationRequest extends FhirResource {
  resourceType: 'MedicationRequest';
  status: 'active' | 'completed' | 'cancelled' | 'stopped' | 'draft';
  intent: 'order' | 'plan' | 'proposal';
  medicationCodeableConcept?: FhirCodeableConcept;
  subject?: FhirReference;
  requester?: FhirReference;
  authoredOn?: string;
  dosageInstruction?: FhirDosage[];
  note?: { text: string }[];
}

export interface FhirEncounter extends FhirResource {
  resourceType: 'Encounter';
  status: 'planned' | 'in-progress' | 'finished' | 'cancelled';
  class: FhirCoding;
  type?: FhirCodeableConcept[];
  subject?: FhirReference;
  participant?: { individual?: FhirReference }[];
  period?: FhirPeriod;
  diagnosis?: { condition: FhirReference; use?: FhirCodeableConcept }[];
  identifier?: FhirIdentifier[];
}

export interface FhirAppointment extends FhirResource {
  resourceType: 'Appointment';
  status: 'booked' | 'arrived' | 'fulfilled' | 'cancelled' | 'noshow' | 'proposed';
  start?: string;
  end?: string;
  description?: string;
  participant?: {
    actor?: FhirReference;
    status: 'accepted' | 'tentative' | 'needs-action';
  }[];
}

export interface FhirCondition extends FhirResource {
  resourceType: 'Condition';
  clinicalStatus?: FhirCodeableConcept;
  verificationStatus?: FhirCodeableConcept;
  category?: FhirCodeableConcept[];
  code?: FhirCodeableConcept;
  subject: FhirReference;
  encounter?: FhirReference;
  onsetDateTime?: string;
  recordedDate?: string;
  note?: { text: string }[];
}

// ─── Bundle ──────────────────────────────────────────────────────────────────

export interface FhirBundleEntry {
  fullUrl?: string;
  resource: FhirResource;
}

export interface FhirBundle {
  resourceType: 'Bundle';
  type: 'searchset' | 'batch' | 'collection';
  total: number;
  entry?: FhirBundleEntry[];
}

// ─── CapabilityStatement (minimal) ───────────────────────────────────────────

export interface FhirCapabilityStatement extends FhirResource {
  resourceType: 'CapabilityStatement';
  status: 'active';
  kind: 'instance';
  fhirVersion: '4.0.1';
  format: string[];
  instantiates?: string[];
  rest: {
    mode: 'server';
    resource: {
      type: string;
      profile?: string;
      interaction: { code: string }[];
      searchParam?: { name: string; type: string }[];
    }[];
  }[];
}
