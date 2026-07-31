import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import type { PatientLiveVisitSummary } from '../lib/patientPortalUx';

async function fetchWithCredentials(url: string, options?: RequestInit) {
  const res = await fetch(url, { ...options, credentials: 'include' });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP error! status: ${res.status}`);
  }
  return res.json();
}

export interface HospitalLink {
  id: number;
  tenant_id: string;
  hospital_name: string;
  status: string;
  linked_at: string;
}

export interface HospitalLinksResponse {
  hospitals: HospitalLink[];
  all_hospitals?: HospitalLink[];
  pending_hospitals?: HospitalLink[];
  verified_count?: number;
  pending_count?: number;
}

export interface Consent {
  tenant_id: string;
  consent_type: string;
  granted: number;
}

export interface ClinicalData {
  appointments?: any[];
  prescriptions?: any[];
  labs?: any[];
  bills?: any[];
}

export interface PreVisitInsight {
  title_bn?: string;
  title_en?: string;
  body_bn?: string;
  body_en?: string;
}

export function useHospitalLinks() {
  return useQuery<HospitalLinksResponse>({
    queryKey: ['hospital-links'],
    queryFn: () => fetchWithCredentials('/api/hospital-links'),
  });
}

export function useHospitalData(linkId?: number | null) {
  return useQuery<{ data: ClinicalData }>({
    queryKey: ['hospital-data', linkId],
    queryFn: () => fetchWithCredentials(`/api/hospital-links/${linkId}/data?type=summary`),
    enabled: typeof linkId === 'number' && Number.isFinite(linkId),
  });
}

export function useHospitalConsents(tenantId?: string | null) {
  return useQuery<{ consents: Consent[] }>({
    queryKey: ['hospital-consents', tenantId],
    queryFn: () => fetchWithCredentials(`/api/hospital-links/consents?tenant_id=${tenantId}`),
    enabled: !!tenantId,
  });
}

export function usePreVisitInsight(linkId?: number | null) {
  return useQuery<{ insight?: PreVisitInsight | null; actions?: Array<{ bn?: string; en?: string }> }>({
    queryKey: ['pre-visit-insight', linkId],
    queryFn: () =>
      fetchWithCredentials(`/api/hospital-links/${linkId}/pre-visit`, { method: 'POST' }),
    enabled: !!linkId,
  });
}

export function useSelectedHospitalLiveVisit(tenantId?: string | null) {
  return useQuery<{ live_visit?: PatientLiveVisitSummary | null }>({
    queryKey: ['selected-hospital-live-visit', tenantId],
    queryFn: () => fetchWithCredentials('/api/patient-portal/live-visit-status', {
      headers: tenantId ? { 'X-Tenant-ID': tenantId } : undefined,
      cache: 'no-store',
    }),
    enabled: !!tenantId,
    refetchInterval: tenantId ? 20_000 : false,
  });
}

export function useUpdateConsent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { tenant_id: string; consent_type: string; granted: boolean }) =>
      fetchWithCredentials('/api/hospital-links/consents', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['hospital-consents', variables.tenant_id] });
    },
    onError: () => {
      toast.error('Failed to update consent settings.');
    },
  });
}

export function useUnlinkHospital() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => fetchWithCredentials(`/api/hospital-links/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hospital-links'] });
      toast.success('Disconnected successfully');
    },
    onError: () => {
      toast.error('Failed to disconnect hospital');
    },
  });
}

export function useSyncHospitalData() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { linkId: number; kind: 'labs' | 'prescriptions' }) =>
      fetchWithCredentials(`/api/hospital-links/${data.linkId}/sync-${data.kind}`, { method: 'POST' }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['wellness-score'] });
      if (variables.kind === 'labs') {
        queryClient.invalidateQueries({ queryKey: ['health-records'] });
      } else {
        queryClient.invalidateQueries({ queryKey: ['prescriptions'] });
      }
    },
  });
}
