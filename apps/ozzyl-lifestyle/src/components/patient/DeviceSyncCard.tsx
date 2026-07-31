import { useCallback, useMemo, useState } from 'react';
import { BellRing, Smartphone, Watch, Waves } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { initPushNotifications } from '../../lib/push-notifications';
import {
  detectPlatform,
  isNativeHealthAvailable,
  queryHealthData,
  requestHealthPermissions,
} from '../../lib/wearable-bridge';
import { useRegisteredDevices, useRegisterDevice, useSyncWearable } from '../../hooks/useDeviceSync';



function getDeviceId(): string {
  let id = localStorage.getItem('ozzylife_device_id');
  if (!id) {
    id = `dev_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem('ozzylife_device_id', id);
  }
  return id;
}

function mapSamplesForBackend(samples: Awaited<ReturnType<typeof queryHealthData>>) {
  return samples
    .map((sample) => ({
      type:
        sample.metric === 'distance_meters'
          ? 'distance_m'
          : sample.metric,
      value: sample.value,
      date: sample.recorded_at.slice(0, 10),
      timestamp: sample.recorded_at,
    }))
    .filter((sample) =>
      ['steps', 'heart_rate', 'sleep_minutes', 'active_calories', 'distance_m'].includes(sample.type),
    );
}

export default function DeviceSyncCard() {
  const [message, setMessage] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [registering, setRegistering] = useState(false);
  const nativeHealth = useMemo(() => isNativeHealthAvailable(), []);
  const platform = Capacitor.getPlatform();

  const { data: devicesData, isLoading: loading } = useRegisteredDevices();
  const devices = devicesData?.devices || [];

  const { mutateAsync: registerDevice } = useRegisterDevice();
  const { mutateAsync: syncWearable } = useSyncWearable();

  const handleRegisterDevice = useCallback(async () => {
    setRegistering(true);
    try {
      if (Capacitor.isNativePlatform()) {
        await initPushNotifications();
        setMessage('Push registration started on this device.');
      } else {
        await registerDevice({
          device_id: getDeviceId(),
          platform: 'web',
        });
        setMessage('This device is now registered for reminders.');
      }
    } catch {
      setMessage('Device registration failed.');
    } finally {
      setRegistering(false);
    }
  }, [registerDevice]);

  const handleWearableSync = useCallback(async () => {
    setSyncing(true);
    setMessage('');
    try {
      const granted = await requestHealthPermissions();
      if (!granted) {
        setMessage('Health permission was denied or the plugin is unavailable on this device.');
        return;
      }

      const samples = mapSamplesForBackend(await queryHealthData(7));
      if (samples.length === 0) {
        setMessage('No wearable samples were found for the last 7 days.');
        return;
      }

      const data = await syncWearable({
        device_name: navigator.userAgent.includes('iPhone') ? 'iPhone Health' : 'Android Health',
        platform: platform === 'ios' ? 'ios' : 'android',
        samples,
      }) as { synced?: number; error?: string };
      
      setMessage(`Synced ${data?.synced ?? samples.length} wearable samples.`);
    } catch (e: any) {
      setMessage(e.message || 'Wearable sync failed.');
    } finally {
      setSyncing(false);
    }
  }, [platform, syncWearable]);

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-600">Native sync</p>
          <h3 className="mt-2 text-xl font-bold text-slate-900">Devices, push, and wearable health data</h3>
          <p className="mt-2 text-sm text-slate-500">
            Keep your Capacitor app feeling native by registering the handset and syncing supported health metrics.
          </p>
        </div>
        <div className="rounded-2xl bg-cyan-100 p-3 text-cyan-700">
          <Smartphone className="h-5 w-5" />
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <button
          onClick={() => void handleRegisterDevice()}
          disabled={registering}
          className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
        >
          <BellRing className="mr-2 inline h-4 w-4" />
          {registering ? 'Registering...' : 'Register this device'}
        </button>
        <button
          onClick={() => void handleWearableSync()}
          disabled={!nativeHealth || syncing}
          className="rounded-2xl bg-cyan-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Watch className="mr-2 inline h-4 w-4" />
          {syncing ? 'Syncing...' : 'Sync wearable data'}
        </button>
      </div>

      <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-500">
        <span className="rounded-full bg-slate-100 px-3 py-1 font-medium">Platform: {platform}</span>
        <span className="rounded-full bg-slate-100 px-3 py-1 font-medium">
          Health source: {nativeHealth ? detectPlatform().replace('_', ' ') : 'web only'}
        </span>
      </div>

      <div className="mt-5 rounded-2xl bg-slate-50 p-4">
        <div className="flex items-center gap-2">
          <Waves className="h-4 w-4 text-cyan-600" />
          <p className="text-sm font-semibold text-slate-900">Registered devices</p>
        </div>
        {loading ? (
          <p className="mt-3 text-sm text-slate-500">Loading devices...</p>
        ) : devices.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No device has been registered yet.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {devices.map((device) => (
              <div key={device.id} className="rounded-2xl bg-white px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{device.platform.toUpperCase()}</p>
                    <p className="text-xs text-slate-500">{device.device_id}</p>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${device.has_token ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                    {device.has_token ? 'Push token ready' : 'Registered only'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {message && <p className="mt-4 text-sm font-medium text-cyan-700">{message}</p>}
    </section>
  );
}
