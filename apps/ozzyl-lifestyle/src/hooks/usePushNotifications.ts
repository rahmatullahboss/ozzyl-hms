import { useState, useCallback, useEffect } from 'react';

/**
 * React hook for managing Web Push notification subscriptions.
 *
 * Usage:
 *   const { isSupported, permission, isSubscribed, subscribe, unsubscribe } = usePushNotifications();
 */

interface PushNotificationState {
  /** Whether the browser supports push notifications */
  isSupported: boolean;
  /** Current notification permission: 'default' | 'granted' | 'denied' */
  permission: NotificationPermission;
  /** Whether the user is currently subscribed */
  isSubscribed: boolean;
  /** Loading state for subscribe/unsubscribe actions */
  loading: boolean;
  /** Error message if something went wrong */
  error: string | null;
  /** Subscribe to push notifications */
  subscribe: () => Promise<void>;
  /** Unsubscribe from push notifications */
  unsubscribe: () => Promise<void>;
}

/** Convert a base64 string to a Uint8Array for applicationServerKey */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/** Get the tenant slug from the current URL path */
function getTenantSlug(): string | null {
  const match = window.location.pathname.match(/^\/h\/([^/]+)/);
  return match ? match[1] : null;
}

/** Get stored auth token */
function getAuthToken(): string | null {
  return localStorage.getItem('token');
}

export function usePushNotifications(): PushNotificationState {
  const isSupported =
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window;

  const [permission, setPermission] = useState<NotificationPermission>(
    isSupported ? Notification.permission : 'default',
  );
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check if already subscribed on mount
  useEffect(() => {
    if (!isSupported) return;
    (async () => {
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        setIsSubscribed(!!sub);
      } catch {
        // Ignore errors on initial check
      }
    })();
  }, [isSupported]);

  const subscribe = useCallback(async () => {
    if (!isSupported) {
      setError('Push notifications are not supported in this browser');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // 1. Request permission
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== 'granted') {
        setError('Notification permission denied');
        return;
      }

      // 2. Get VAPID public key from backend
      const slug = getTenantSlug();
      const token = getAuthToken();
      if (!slug || !token) {
        setError('Not logged in');
        return;
      }

      const vapidRes = await fetch('/api/push/vapid-key', {
        headers: {
          'X-Tenant-Subdomain': slug,
          Authorization: `Bearer ${token}`,
        },
      });
      if (!vapidRes.ok) {
        setError('Push notifications not configured on this server');
        return;
      }
      const { publicKey } = (await vapidRes.json()) as { publicKey: string };

      // 3. Subscribe via PushManager
      const reg = await navigator.serviceWorker.ready;
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });

      // 4. Send subscription to backend
      const subJson = subscription.toJSON();
      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-Subdomain': slug,
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          endpoint: subJson.endpoint,
          keys: {
            p256dh: subJson.keys?.p256dh,
            auth: subJson.keys?.auth,
          },
        }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? 'Failed to subscribe');
      }

      setIsSubscribed(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to subscribe');
    } finally {
      setLoading(false);
    }
  }, [isSupported]);

  const unsubscribe = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const reg = await navigator.serviceWorker.ready;
      const subscription = await reg.pushManager.getSubscription();
      if (!subscription) {
        setIsSubscribed(false);
        return;
      }

      // Unsubscribe from push manager
      await subscription.unsubscribe();

      // Remove from backend
      const slug = getTenantSlug();
      const token = getAuthToken();
      if (slug && token) {
        await fetch('/api/push/unsubscribe', {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            'X-Tenant-Subdomain': slug,
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
      }

      setIsSubscribed(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to unsubscribe');
    } finally {
      setLoading(false);
    }
  }, []);

  return { isSupported, permission, isSubscribed, loading, error, subscribe, unsubscribe };
}
