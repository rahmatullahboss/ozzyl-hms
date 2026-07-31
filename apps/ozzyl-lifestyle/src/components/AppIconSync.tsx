import { useEffect } from 'react';
import axios from 'axios';
import { applyDynamicManifest, applyPwaIcons } from '../lib/pwaPrompt';

export function AppIconSync() {
  useEffect(() => {
    let cancelled = false;

    const syncIcons = async () => {
      const token = localStorage.getItem('hms_token');
      if (!token) {
        applyPwaIcons(null);
        applyDynamicManifest(null);
        return;
      }

      try {
        const { data } = await axios.get('/api/settings', {
          headers: { Authorization: `Bearer ${token}` },
        });

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
