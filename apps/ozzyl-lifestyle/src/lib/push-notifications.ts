import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';

let registered = false;

export async function initPushNotifications(): Promise<void> {
  if (!Capacitor.isNativePlatform() || registered) return;

  try {
    let permStatus = await PushNotifications.checkPermissions();

    if (permStatus.receive === 'prompt') {
      permStatus = await PushNotifications.requestPermissions();
    }

    if (permStatus.receive !== 'granted') {
      console.warn('[push] Permission denied');
      return;
    }

    await PushNotifications.addListener('registration', async (token) => {
      try {
        await fetch('/api/device-notifications/register', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            device_id: getDeviceId(),
            platform: Capacitor.getPlatform(),
            push_token: token.value,
          }),
        });
      } catch (err) {
        console.error('[push] Failed to register token:', err);
      }
    });

    await PushNotifications.addListener('registrationError', (err) => {
      console.error('[push] Registration error:', err.error);
    });

    await PushNotifications.addListener('pushNotificationReceived', (notification) => {
      console.log('[push] Received:', notification);
    });

    await PushNotifications.addListener('pushNotificationActionPerformed', (notification) => {
      console.log('[push] Action:', notification.actionId, notification.inputValue);
    });

    await PushNotifications.register();
    registered = true;
  } catch (err) {
    console.error('[push] Init failed:', err);
  }
}

function getDeviceId(): string {
  let id = localStorage.getItem('ozzylife_device_id');
  if (!id) {
    id = `dev_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem('ozzylife_device_id', id);
  }
  return id;
}
