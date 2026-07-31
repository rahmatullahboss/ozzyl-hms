export const LOCAL_SYNC_CLOUD_APPLY_ENTITY_TYPES = [
  'ipd_doctor_round',
  'billing_provisional_doctor_round',
  'patients',
  'global_patient_identity',
  'patient_health_links',
  'medicine_catalog_entry',
] as const;

export const LOCAL_SERVER_EXPLICIT_OUTBOX_ENTITY_TYPES = [
  'ipd_doctor_round',
  'billing_provisional_doctor_round',
  'patients',
  'global_patient_identity',
  'patient_health_links',
  'medicine_catalog_entry',
] as const;

export const LOCAL_SERVER_NON_ATOMIC_OUTBOX_ENTITY_TYPES = [
  'patients',
  'global_patient_identity',
  'patient_health_links',
] as const;

export const LOCAL_SERVER_PARTIAL_WRITE_PATH_COVERAGE_TYPES = [
  'patients',
] as const;

export const LOCAL_SERVER_ATOMIC_PATIENT_WRITE_PATHS = [
  'patients:update',
  'emergency:create-patient',
  'patient-portal:register',
  'referrals:accept-create-patient',
  'reception:quick-admit',
] as const;

export const LOCAL_SERVER_DURABLE_STAGED_PATIENT_WRITE_PATHS = [
  'patients:link-global',
  'referrals:accept-health-link',
] as const;

export const LOCAL_SERVER_PATIENT_WRITE_PATH_GAPS = [
  'patients:create-global-link',
  'marketplace-patient:create',
  'fhir:patient-import',
  'health-record:patient-import',
  'settings-import-export:patient-import',
] as const;

export const LOCAL_SERVER_ENTITY_ID_MAPPING_GAPS = [
  'visits',
  'appointments',
  'admissions',
  'bills',
  'invoice_items',
  'payments',
  'billing_deposits',
] as const;

export const LOCAL_SERVER_CORE_OUTBOX_GAPS = [
  'appointments',
  'visits',
  'bills',
  'invoice_items',
  'payments',
  'billing_deposits',
  'admissions',
  'queue_entries',
] as const;

const cloudApplyTypes = new Set<string>(LOCAL_SYNC_CLOUD_APPLY_ENTITY_TYPES);

export function supportsLocalSyncCloudApply(entityType: string): boolean {
  return cloudApplyTypes.has(entityType);
}
