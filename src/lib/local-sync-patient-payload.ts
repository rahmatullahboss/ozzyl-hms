export type LocalSyncPatientPayloadInput = {
  id?: number;
  tenantId: string;
  name?: string | null;
  fatherHusband?: string | null;
  address?: string | null;
  mobile?: string | null;
  email?: string | null;
  patientCode?: string | null;
  uhid?: string | null;
  nationalId?: string | null;
  dateOfBirth?: string | null;
  gender?: string | null;
  age?: number | null;
  createdAt?: string | null;
};

export function buildLocalSyncPatientPayload(
  input: LocalSyncPatientPayloadInput,
): Record<string, unknown> {
  return {
    ...(input.id === undefined ? {} : { id: input.id }),
    tenant_id: input.tenantId,
    name: input.name ?? null,
    father_husband: input.fatherHusband ?? '',
    address: input.address ?? '',
    mobile: input.mobile ?? null,
    email: input.email ?? null,
    patient_code: input.patientCode ?? null,
    uhid: input.uhid ?? null,
    national_id: input.nationalId ?? null,
    date_of_birth: input.dateOfBirth ?? null,
    gender: input.gender ?? null,
    age: input.age ?? null,
    created_at: input.createdAt ?? null,
  };
}
