import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export interface VisitPassHistoryRow {
  id: string;
  pass_code_hint: string;
  is_active: boolean;
  status: 'active' | 'expired' | 'redeemed' | 'revoked';
  expires_at: string;
  redeemed_at: string | null;
  redeemed_hospital: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface VisitPassDetails extends VisitPassHistoryRow {
  pass_code: string | null;
  scope: string;
  qr_payload: string;
  acting_profile?: {
    patient_identity_id: string;
    name: string;
    uhid: string;
    is_proxy: boolean;
  };
  hospitals: string[];
}

export interface VisitPassResponse {
  active_pass: VisitPassDetails | null;
  recent_passes: VisitPassHistoryRow[];
}

export const useVisitPass = () => {
  return useQuery<VisitPassResponse>({
    queryKey: ['visit-pass'],
    queryFn: async () => {
      const response = await fetch('/api/global-portal/visit-pass', { credentials: 'include' });
      if (!response.ok) throw new Error('Network response was not ok');
      return response.json();
    },
  });
};

export const useCreateVisitPass = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (payload: { scope?: string; valid_hours?: number; for_managed_identity_id?: string }) => {
      const response = await fetch('/api/global-portal/visit-pass', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error('Network response was not ok');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['visit-pass'] });
    },
  });
};

export const useRevokeVisitPass = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (passId: string) => {
      const response = await fetch(`/api/global-portal/visit-pass/${passId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Network response was not ok');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['visit-pass'] });
    },
  });
};
