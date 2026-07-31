import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

async function fetchWithCredentials(url: string, options?: RequestInit) {
  const res = await fetch(url, { ...options, credentials: 'include' });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.error || json.message || 'Failed to fetch API');
  }
  return res.json();
}

export interface FamilyProxyInvite {
  id: number;
  patient_identity_id: number;
  inviter_auth_user_id: number;
  invitee_auth_user_id: number | null;
  relationship: string;
  access_role: string;
  status: 'pending' | 'accepted' | 'declined' | 'revoked' | 'expired';
  notes: string | null;
  expires_at: string;
  created_at: string;
}

export interface FamilyProxyInvitesResponse {
  incoming: FamilyProxyInvite[];
  outgoing: FamilyProxyInvite[];
}

export function useProxyInvites() {
  return useQuery({
    queryKey: ['family-proxy-invites'],
    queryFn: async () => {
      return fetchWithCredentials('/api/global-portal/family/proxy-invites') as Promise<FamilyProxyInvitesResponse>;
    },
    staleTime: 1000 * 60 * 5,
  });
}

export function useCreateProxyInvite() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: { uhid: string; relationship: string; notes?: string }) => {
      return fetchWithCredentials('/api/global-portal/family/proxy-invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['family-proxy-invites'] });
    },
  });
}

export function useRespondProxyInvite() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (args: { id: number; action: 'accept' | 'decline' }) => {
      return fetchWithCredentials(`/api/global-portal/family/proxy-invites/${args.id}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: args.action }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['family-proxy-invites'] });
    },
  });
}
