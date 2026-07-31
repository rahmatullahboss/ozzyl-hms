import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export interface PatientPortalQueryError extends Error {
  status?: number;
}

export interface PatientProfileUser {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  national_id?: string | null;
  uhid: string | null;
  created_at?: string | null;
}

export interface PatientProfileResponse {
  user?: PatientProfileUser;
  message?: string;
  error?: string;
}

export interface PatientGlobalDashboardReport {
  id: number;
  hospital_name: string;
  order_no?: string | null;
  result_date: string | null;
  status: string | null;
  test_names?: string | null;
  abnormal_count?: number | null;
}

export interface PatientGlobalDashboardResponse {
  hospitalsCount: number;
  appointments: Array<{
    id: number;
    hospital_name: string;
    doctor_name: string | null;
    appointment_date: string;
    appointment_time: string | null;
    status: string | null;
    department?: string | null;
  }>;
  prescriptions: Array<{
    id: number;
    hospital_name: string;
    doctor_name: string | null;
    date: string;
  }>;
  reports?: PatientGlobalDashboardReport[];
  labResults?: PatientGlobalDashboardReport[];
  bills: Array<{
    id: number;
    hospital_name: string;
    bill_date: string;
    grand_total: number | null;
    payment_status: string | null;
  }>;
  patient_guidance?: {
    headline: string;
    status: 'attention' | 'watch' | 'stable';
    summary: string;
    what_changed: string[];
    next_steps: string[];
    trust_notes: string[];
    care_reminders: string[];
    counts: {
      pending_review_items: number;
      verified_items: number;
      vault_documents: number;
      active_visit_pass: number;
    };
  };
  message?: string;
  error?: string;
}

export interface PatientHospitalsResponse {
  acting_profile?: {
    identity_id: number;
    name: string;
    managed?: boolean;
    relationship?: string | null;
  };
  hospitals: GlobalHospitalLink[];
}

export interface PatientVaultDocument {
  id: number;
  document_url: string;
  document_type: string;
  document_date: string | null;
  title: string | null;
  notes: string | null;
  entered_at: string;
  file_name?: string | null;
  mime_type?: string | null;
  file_size?: number | null;
  source_kind?: 'uploaded_file' | 'external_link' | string | null;
}

export interface PatientVaultResponse {
  documents: PatientVaultDocument[];
}

export interface GlobalHospitalLink {
  tenantId: string;
  patientId: number;
  hospitalName: string;
}

export interface PatientFamilyRiskInsight {
  label: string;
  severity: 'watch' | 'elevated';
  rationale: string;
}

export interface PatientFamilySummaryResponse {
  managed_profiles?: Array<{
    identity_id: number;
    name: string | null;
    relationship: string;
    hospitals_count: number;
  }>;
  risk_overview?: {
    status: 'stable' | 'watch' | 'attention';
    headline: string;
    insights: PatientFamilyRiskInsight[];
  };
}

export interface PatientVisitPassResponse {
  active_pass?: {
    id: number;
    pass_code: string;
    expires_at: string;
    redeemed_at?: string | null;
  } | null;
  history?: Array<{
    id: number;
    pass_code_hint: string;
    status: string;
    expires_at: string;
  }>;
}

export interface AddPatientDependentInput {
  name: string;
  relationship: string;
  date_of_birth?: string;
  gender?: string;
  phone?: string;
}

async function fetchPatientPortalJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    credentials: 'include',
    cache: 'no-store',
    headers: {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Pragma: 'no-cache',
    },
  });

  const data = await response.json().catch(() => null) as (T & { error?: string; message?: string }) | null;
  if (!response.ok) {
    const error = new Error(
      data?.error ||
      data?.message ||
      `Request failed with status ${response.status}`,
    ) as PatientPortalQueryError;
    error.status = response.status;
    throw error;
  }

  return (data ?? {}) as T;
}

async function mutatePatientPortalJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: 'include',
    cache: 'no-store',
    ...init,
  });

  const data = await response.json().catch(() => null) as (T & { error?: string; message?: string }) | null;
  if (!response.ok) {
    const error = new Error(
      data?.error ||
      data?.message ||
      `Request failed with status ${response.status}`,
    ) as PatientPortalQueryError;
    error.status = response.status;
    throw error;
  }

  return (data ?? {}) as T;
}

export const patientPortalQueryKeys = {
  profile: ['patient-profile'] as const,
  globalDashboard: ['patient-global-dashboard'] as const,
  hospitals: ['patient-hospitals'] as const,
  vault: ['patient-vault'] as const,
  family: ['patient-family'] as const,
  visitPass: ['patient-visit-pass'] as const,
};

export function patientProfileQueryOptions() {
  return queryOptions({
    queryKey: patientPortalQueryKeys.profile,
    queryFn: () => fetchPatientPortalJson<PatientProfileResponse>('/api/patient-auth/me'),
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
}

export function patientGlobalDashboardQueryOptions() {
  return queryOptions({
    queryKey: patientPortalQueryKeys.globalDashboard,
    queryFn: () => fetchPatientPortalJson<PatientGlobalDashboardResponse>('/api/global-portal/dashboard'),
    retry: false,
    staleTime: 60 * 1000,
  });
}

export function patientHospitalsQueryOptions() {
  return queryOptions({
    queryKey: patientPortalQueryKeys.hospitals,
    queryFn: () => fetchPatientPortalJson<PatientHospitalsResponse>('/api/global-portal/hospitals'),
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
}

export function patientVaultQueryOptions() {
  return queryOptions({
    queryKey: patientPortalQueryKeys.vault,
    queryFn: () => fetchPatientPortalJson<PatientVaultResponse>('/api/patient-phr/vault'),
    retry: false,
    staleTime: 60 * 1000,
  });
}

export function patientFamilySummaryQueryOptions() {
  return queryOptions({
    queryKey: patientPortalQueryKeys.family,
    queryFn: () => fetchPatientPortalJson<PatientFamilySummaryResponse>('/api/global-portal/family'),
    retry: false,
    staleTime: 60 * 1000,
  });
}

export function patientVisitPassQueryOptions() {
  return queryOptions({
    queryKey: patientPortalQueryKeys.visitPass,
    queryFn: () => fetchPatientPortalJson<PatientVisitPassResponse>('/api/global-portal/visit-pass'),
    retry: false,
    staleTime: 60 * 1000,
  });
}

export function usePatientProfileQuery() {
  return useQuery(patientProfileQueryOptions());
}

export function usePatientGlobalDashboardQuery() {
  return useQuery(patientGlobalDashboardQueryOptions());
}

export function usePatientHospitalsQuery() {
  return useQuery(patientHospitalsQueryOptions());
}

export function usePatientVaultQuery() {
  return useQuery(patientVaultQueryOptions());
}

export function usePatientFamilySummaryQuery() {
  return useQuery(patientFamilySummaryQueryOptions());
}

export function usePatientVisitPassQuery() {
  return useQuery(patientVisitPassQueryOptions());
}

export function useAddPatientDependentMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: AddPatientDependentInput) =>
      mutatePatientPortalJson('/api/global-portal/family/dependents', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(input),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: patientPortalQueryKeys.family });
    },
  });
}

export function useDeletePatientVaultDocumentMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (documentId: number) =>
      mutatePatientPortalJson(`/api/patient-phr/vault/${documentId}`, {
        method: 'DELETE',
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: patientPortalQueryKeys.vault });
    },
  });
}
