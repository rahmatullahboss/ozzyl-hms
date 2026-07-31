import { useEffect } from 'react';
import { apiFetch } from '../lib/apiClient';
import { applyDynamicManifest, applyPwaIcons } from '../lib/pwaPrompt';
import { getToken } from '../hooks/useAuth';

export function AppIconSync() {
  useEffect(() => {
    let cancelled = false;

    const syncIcons = async () => {
      if (!getToken()) {
        applyPwaIcons(null);
        applyDynamicManifest(null);
        return;
      }

      try {
        const data = await apiFetch<{ settings?: { hospital_logo_url?: string } }>('/api/settings');

        if (cancelled) return;
        const logoUrl = data?.settings?.hospital_logo_url ?? null;
        applyPwaIcons(logoUrl);
        applyDynamicManifest(logoUrl);
      } catch {
        if (!cancelled) {
          applyPwaIcons(null);
          applyDynamicManifest(null);
        }
      }
    };

    void syncIcons();

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
