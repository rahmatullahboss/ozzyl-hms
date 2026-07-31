import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/apiClient';

interface PatientLookupResult {
  patient_id: number;
  patient_code: string;
  name: string;
}

interface UsePatientVerificationOptions {
  patientId: number | undefined;
  barcode: string | null;
  enabled?: boolean;
}

export function usePatientVerification({ patientId, barcode, enabled = true }: UsePatientVerificationOptions) {
  const query = useQuery<PatientLookupResult, Error>({
    queryKey: ['nursing', 'barcode', 'patient', barcode],
    queryFn: () => api.get<PatientLookupResult>(`/api/nursing/barcode/patient/${encodeURIComponent(barcode!)}`),
    enabled: enabled && !!barcode && barcode.length > 0,
    retry: false,
    staleTime: 0,
  });

  const isVerified = query.data ? query.data.patient_id === patientId : false;
  const isMismatch = query.data ? query.data.patient_id !== patientId : false;

  return {
    isVerified,
    isMismatch,
    matchedPatient: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error?.message ?? null,
    refetch: query.refetch,
  };
}
