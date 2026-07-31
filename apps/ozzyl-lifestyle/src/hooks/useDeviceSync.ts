import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

async function fetchWithCredentials(url: string, options?: RequestInit) {
  const res = await fetch(url, { ...options, credentials: 'include' });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP error! status: ${res.status}`);
  }
  return res.json();
}

export type DeviceRow = {
  id: number;
  device_id: string;
  platform: string;
  has_token: number;
  last_seen_at?: string | null;
};

export function useRegisteredDevices() {
  return useQuery<{ devices: DeviceRow[] }>({
    queryKey: ['registered-devices'],
    queryFn: () => fetchWithCredentials('/api/device-notifications/devices'),
  });
}

export function useRegisterDevice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { device_id: string; platform: string }) =>
      fetchWithCredentials('/api/device-notifications/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['registered-devices'] });
    },
  });
}

export function useSyncWearable() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { device_name: string; platform: string; samples: any[] }) =>
      fetchWithCredentials('/api/wellness/sync/wearable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wellness-score'] });
      queryClient.invalidateQueries({ queryKey: ['wearable-history'] });
    },
  });
}
