import {
  providePatientIdentityProjection,
  type PatientIdentityProviderDatabase,
  type PatientIdentityProviderInput,
  type PatientIdentityProviderProjection,
} from './patient-identity-provider';
import {
  resolvePractitionerProjection,
  type PractitionerProviderDatabase,
  type PractitionerProviderInput,
  type PractitionerProviderProjection,
} from './practitioner-provider';
import {
  resolveAppointmentProjection,
  type AppointmentProviderDatabase,
  type AppointmentProviderInput,
  type AppointmentProviderProjection,
} from './appointment-provider';
import {
  resolveEncounterProjection,
  type EncounterProviderDatabase,
  type EncounterProviderInput,
  type EncounterProviderProjection,
} from './encounter-provider';
import {
  resolveAdmissionBedProjection,
  type AdmissionBedProviderDatabase,
  type AdmissionBedProviderInput,
  type AdmissionBedProviderProjection,
} from './admission-bed-provider';
import {
  createIdentityEpisodeShadowEvidence,
  type IdentityEpisodeShadowComparison,
  type IdentityEpisodeShadowEvidenceReceipt,
  type IdentityEpisodeShadowProvider,
  type IdentityEpisodeVarianceClass,
} from './identity-episode-shadow-evidence';

export interface IdentityEpisodeAdapterEvidenceInput {
  observedAtUtc: string;
  elapsedMs: number;
  errorCount: number;
  latencyBudgetMs: number;
  acceptedExceptionIds: string[];
  consumerId?: string;
}

export interface IdentityEpisodeReadAdapterDependencies {
  patient: (
    db: PatientIdentityProviderDatabase,
    input: PatientIdentityProviderInput,
  ) => Promise<PatientIdentityProviderProjection>;
  practitioner: (
    db: PractitionerProviderDatabase,
    input: PractitionerProviderInput,
  ) => Promise<PractitionerProviderProjection>;
  appointment: (
    db: AppointmentProviderDatabase,
    input: AppointmentProviderInput,
  ) => Promise<AppointmentProviderProjection>;
  encounter: (
    db: EncounterProviderDatabase,
    input: EncounterProviderInput,
  ) => Promise<EncounterProviderProjection>;
  admissionBed: (
    db: AdmissionBedProviderDatabase,
    input: AdmissionBedProviderInput,
  ) => Promise<AdmissionBedProviderProjection>;
}

export interface IdentityEpisodeReadAdapterResult<T> {
  provider: IdentityEpisodeShadowProvider;
  projection: T;
  shadowEvidence: IdentityEpisodeShadowEvidenceReceipt | null;
  rollbackMode: 'legacy';
}

const DEFAULT_DEPENDENCIES: IdentityEpisodeReadAdapterDependencies = {
  patient: providePatientIdentityProjection,
  practitioner: resolvePractitionerProjection,
  appointment: resolveAppointmentProjection,
  encounter: resolveEncounterProjection,
  admissionBed: resolveAdmissionBedProjection,
};

function comparison(
  varianceClass: IdentityEpisodeVarianceClass,
  matches: boolean,
  critical = true,
): IdentityEpisodeShadowComparison {
  return { varianceClass, matches, critical };
}

function parityComparisons(
  provider: IdentityEpisodeShadowProvider,
  parity: Record<string, boolean> | undefined,
): IdentityEpisodeShadowComparison[] {
  if (!parity) return [comparison('PROVIDER_ERROR', false)];
  switch (provider) {
    case 'patient_identity':
      return [
        comparison('MAPPING_MISSING', parity.exactTenantPatientLink === true),
        comparison('PATIENT_LINK_MISMATCH', parity.legacyPatientAgreement === true),
        comparison('STATUS_MISMATCH', parity.activeRelationship === true),
        comparison('INTERVAL_MISMATCH', parity.effectiveInterval === true),
        comparison('LIFECYCLE_MISMATCH', parity.positiveVersion === true),
      ];
    case 'practitioner':
      return [
        comparison('MAPPING_MISSING', parity.mapping === true),
        comparison('PRACTITIONER_LINK_MISMATCH', parity.identifier === true),
        comparison('STATUS_MISMATCH', parity.status === true),
        comparison('PRACTITIONER_LINK_MISMATCH', parity.userLink === true),
        comparison('PRACTITIONER_LINK_MISMATCH', parity.employeeLink === true),
      ];
    case 'appointment':
      return [
        comparison('MAPPING_MISSING', parity.mapping === true),
        comparison('PATIENT_LINK_MISMATCH', parity.patientLink === true),
        comparison('PRACTITIONER_LINK_MISMATCH', parity.practitioner === true),
        comparison('INTENT_ACTUAL_CARE_COLLAPSE', parity.kind === true),
        comparison('INTERVAL_MISMATCH', parity.interval === true),
        comparison('STATUS_MISMATCH', parity.status === true),
        comparison('LIFECYCLE_MISMATCH', parity.lineage === true),
        comparison('INTENT_ACTUAL_CARE_COLLAPSE', parity.encounterLink === true),
      ];
    case 'encounter':
      return [
        comparison('MAPPING_MISSING', parity.mapping === true),
        comparison('PATIENT_LINK_MISMATCH', parity.patientLink === true),
        comparison('PRACTITIONER_LINK_MISMATCH', parity.practitioner === true),
        comparison('INTENT_ACTUAL_CARE_COLLAPSE', parity.type === true),
        comparison('STATUS_MISMATCH', parity.status === true),
        comparison('INTERVAL_MISMATCH', parity.interval === true),
        comparison('PARTICIPANT_MISMATCH', parity.participants === true),
        comparison('LOCATION_MISMATCH', parity.careLocation === true),
      ];
    case 'admission_bed':
      return [
        comparison('MAPPING_MISSING', parity.mapping === true),
        comparison('PATIENT_LINK_MISMATCH', parity.patientLink === true),
        comparison('PATIENT_LINK_MISMATCH', parity.identity === true),
        comparison('LIFECYCLE_MISMATCH', parity.lifecycle === true),
        comparison('LIFECYCLE_MISMATCH', parity.latestEvent === true),
        comparison('BED_OCCUPANCY_MISMATCH', parity.openStayCardinality === true),
        comparison('MAPPING_MISSING', parity.bedMapping === true),
        comparison('BED_OCCUPANCY_MISMATCH', parity.derivedOccupancy === true),
        comparison('BED_OCCUPANCY_MISMATCH', parity.bedOperationalState === true),
      ];
  }
}

function createEvidence(
  provider: IdentityEpisodeShadowProvider,
  consumerId: string,
  tenantId: string,
  sourceType: string,
  sourcePublicId: string,
  mode: 'legacy' | 'shadow' | 'canonical',
  parity: Record<string, boolean> | undefined,
  evidence: IdentityEpisodeAdapterEvidenceInput,
): IdentityEpisodeShadowEvidenceReceipt | null {
  if (mode !== 'shadow') return null;
  return createIdentityEpisodeShadowEvidence({
    provider,
    consumerId,
    tenantId,
    sourceType,
    sourcePublicId,
    mode,
    comparisons: parityComparisons(provider, parity),
    elapsedMs: evidence.elapsedMs,
    errorCount: evidence.errorCount,
    latencyBudgetMs: evidence.latencyBudgetMs,
    observedAtUtc: evidence.observedAtUtc,
    acceptedExceptionIds: evidence.acceptedExceptionIds,
  });
}

export async function readPatientIdentityAdapter(
  db: PatientIdentityProviderDatabase,
  input: PatientIdentityProviderInput,
  evidence: IdentityEpisodeAdapterEvidenceInput,
  dependencies: IdentityEpisodeReadAdapterDependencies = DEFAULT_DEPENDENCIES,
): Promise<IdentityEpisodeReadAdapterResult<PatientIdentityProviderProjection>> {
  const projection = await dependencies.patient(db, input);
  return {
    provider: 'patient_identity',
    projection,
    shadowEvidence: createEvidence(
      'patient_identity', evidence.consumerId ?? 'cdb113f_patient_detail', input.tenantId,
      'legacy_patient', String(input.legacyPatientId), projection.mode,
      projection.parity as unknown as Record<string, boolean> | undefined, evidence,
    ),
    rollbackMode: 'legacy',
  };
}

export async function readPractitionerAdapter(
  db: PractitionerProviderDatabase,
  input: PractitionerProviderInput,
  evidence: IdentityEpisodeAdapterEvidenceInput,
  dependencies: IdentityEpisodeReadAdapterDependencies = DEFAULT_DEPENDENCIES,
): Promise<IdentityEpisodeReadAdapterResult<PractitionerProviderProjection>> {
  const projection = await dependencies.practitioner(db, input);
  return {
    provider: 'practitioner',
    projection,
    shadowEvidence: createEvidence(
      'practitioner', evidence.consumerId ?? 'cdb113f_practitioner_detail', input.tenantId,
      input.sourceType, String(input.legacyId), projection.mode,
      projection.parity as unknown as Record<string, boolean> | undefined, evidence,
    ),
    rollbackMode: 'legacy',
  };
}

export async function readAppointmentAdapter(
  db: AppointmentProviderDatabase,
  input: AppointmentProviderInput,
  evidence: IdentityEpisodeAdapterEvidenceInput,
  dependencies: IdentityEpisodeReadAdapterDependencies = DEFAULT_DEPENDENCIES,
): Promise<IdentityEpisodeReadAdapterResult<AppointmentProviderProjection>> {
  const projection = await dependencies.appointment(db, input);
  return {
    provider: 'appointment',
    projection,
    shadowEvidence: createEvidence(
      'appointment', evidence.consumerId ?? 'cdb113f_appointment_detail', input.tenantId,
      input.sourceType, String(input.legacyId), projection.mode,
      projection.parity as unknown as Record<string, boolean> | undefined, evidence,
    ),
    rollbackMode: 'legacy',
  };
}

export async function readEncounterAdapter(
  db: EncounterProviderDatabase,
  input: EncounterProviderInput,
  evidence: IdentityEpisodeAdapterEvidenceInput,
  dependencies: IdentityEpisodeReadAdapterDependencies = DEFAULT_DEPENDENCIES,
): Promise<IdentityEpisodeReadAdapterResult<EncounterProviderProjection>> {
  const projection = await dependencies.encounter(db, input);
  return {
    provider: 'encounter',
    projection,
    shadowEvidence: createEvidence(
      'encounter', evidence.consumerId ?? 'cdb113f_encounter_detail', input.tenantId,
      input.sourceType, String(input.legacyId), projection.mode,
      projection.parity as unknown as Record<string, boolean> | undefined, evidence,
    ),
    rollbackMode: 'legacy',
  };
}

export async function readAdmissionBedAdapter(
  db: AdmissionBedProviderDatabase,
  input: AdmissionBedProviderInput,
  evidence: IdentityEpisodeAdapterEvidenceInput,
  dependencies: IdentityEpisodeReadAdapterDependencies = DEFAULT_DEPENDENCIES,
): Promise<IdentityEpisodeReadAdapterResult<AdmissionBedProviderProjection>> {
  const projection = await dependencies.admissionBed(db, input);
  const legacyId = input.legacyAdmissionId ?? input.legacyId;
  if (legacyId == null) throw new TypeError('legacyAdmissionId is required');
  return {
    provider: 'admission_bed',
    projection,
    shadowEvidence: createEvidence(
      'admission_bed', evidence.consumerId ?? 'cdb113f_admission_detail', input.tenantId,
      input.sourceType ?? 'legacy_admission', String(legacyId), projection.mode,
      projection.parity as unknown as Record<string, boolean> | undefined, evidence,
    ),
    rollbackMode: 'legacy',
  };
}
