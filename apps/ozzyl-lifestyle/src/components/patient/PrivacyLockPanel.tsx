import { useEffect, useState } from 'react';
import { Fingerprint, Lock, ShieldCheck } from 'lucide-react';
import {
  getLockConfig,
  hasPinSet,
  isBiometricAvailable,
  isModuleLocked,
  recordUnlock,
  saveLockConfig,
  setPin,
  verifyPin,
  type LockableModule,
} from '../../lib/privacy-lock';

const MODULE_COPY: Record<LockableModule, { title: string; subtitle: string }> = {
  'mental-health': { title: 'Mental Health', subtitle: 'PHQ-9, GAD-7, and sensitive wellbeing reflections' },
  'womens-health': { title: 'Women\'s Health', subtitle: 'Cycle tracking and private reproductive health data' },
  pregnancy: { title: 'Pregnancy', subtitle: 'Pregnancy mode, trimester progress, and due-date data' },
};

export function SensitiveModuleGate({
  module,
  title,
  children,
}: {
  module: LockableModule;
  title: string;
  children: React.ReactNode;
}) {
  const [pin, setPinInput] = useState('');
  const [error, setError] = useState('');
  const [isUnlocked, setIsUnlocked] = useState(() => !isModuleLocked(module));

  if (isUnlocked) return <>{children}</>;

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-900 text-white">
        <Lock className="h-5 w-5" />
      </div>
      <div className="mt-4 text-center">
        <h3 className="text-lg font-bold text-slate-900">{title} is privacy protected</h3>
        <p className="mt-2 text-sm text-slate-500">
          Enter your PIN to unlock this sensitive section for the next 15 minutes.
        </p>
      </div>
      <div className="mt-5 space-y-3">
        <input
          type="password"
          inputMode="numeric"
          maxLength={6}
          value={pin}
          onChange={(event) => {
            setPinInput(event.target.value.replace(/\D/g, ''));
            setError('');
          }}
          placeholder="PIN"
          className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-center text-lg font-semibold tracking-[0.35em] text-slate-900 outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-200"
        />
        {error && <p className="text-center text-sm font-medium text-rose-600">{error}</p>}
        <button
          onClick={() => {
            if (verifyPin(pin)) {
              recordUnlock();
              setIsUnlocked(true);
              setError('');
              return;
            }
            setPinInput('');
            setError('PIN did not match.');
          }}
          disabled={pin.length < 4}
          className="w-full rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Unlock
        </button>
      </div>
    </div>
  );
}

export default function PrivacyLockPanel() {
  const [config, setConfig] = useState(() => getLockConfig());
  const [pin, setPinInput] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [message, setMessage] = useState('');
  const [hasBiometric, setHasBiometric] = useState(false);

  useEffect(() => {
    void isBiometricAvailable().then(setHasBiometric).catch(() => setHasBiometric(false));
  }, []);

  const toggleModule = (module: LockableModule) => {
    const next = config.lockedModules.includes(module)
      ? config.lockedModules.filter((value) => value !== module)
      : [...config.lockedModules, module];
    const updated = { ...config, lockedModules: next };
    saveLockConfig(updated);
    setConfig(updated);
  };

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-600">Privacy lock</p>
          <h3 className="mt-2 text-xl font-bold text-slate-900">Protect sensitive health modules</h3>
          <p className="mt-2 text-sm text-slate-500">
            Enable a native-feeling PIN gate for mental health, women&apos;s health, and pregnancy sections.
          </p>
        </div>
        <div className="rounded-2xl bg-slate-900 p-3 text-white">
          <ShieldCheck className="h-5 w-5" />
        </div>
      </div>

      <div className="mt-5 rounded-2xl bg-slate-50 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-900">Enable privacy lock</p>
            <p className="text-xs text-slate-500">
              {hasPinSet()
                ? 'PIN ready. Toggle protection on or off at any time.'
                : 'Set a 4-6 digit PIN before turning this on.'}
            </p>
          </div>
          <button
            onClick={() => {
              if (!config.enabled && !hasPinSet()) {
                setMessage('Set a PIN first.');
                return;
              }
              const updated = { ...config, enabled: !config.enabled };
              saveLockConfig(updated);
              setConfig(updated);
              setMessage(updated.enabled ? 'Privacy lock enabled.' : 'Privacy lock disabled.');
            }}
            className={`relative h-7 w-12 rounded-full transition ${config.enabled ? 'bg-cyan-600' : 'bg-slate-300'}`}
          >
            <span className={`absolute top-1 h-5 w-5 rounded-full bg-white transition ${config.enabled ? 'left-6' : 'left-1'}`} />
          </button>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        {(Object.keys(MODULE_COPY) as LockableModule[]).map((module) => (
          <button
            key={module}
            onClick={() => toggleModule(module)}
            className={`rounded-2xl border px-4 py-4 text-left transition ${
              config.lockedModules.includes(module)
                ? 'border-cyan-300 bg-cyan-50'
                : 'border-slate-200 bg-white hover:border-slate-300'
            }`}
          >
            <p className="text-sm font-semibold text-slate-900">{MODULE_COPY[module].title}</p>
            <p className="mt-1 text-xs text-slate-500">{MODULE_COPY[module].subtitle}</p>
          </button>
        ))}
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
        <div className="grid gap-3 sm:grid-cols-2">
          <input
            type="password"
            inputMode="numeric"
            maxLength={6}
            value={pin}
            onChange={(event) => setPinInput(event.target.value.replace(/\D/g, ''))}
            placeholder="New PIN"
            className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-200"
          />
          <input
            type="password"
            inputMode="numeric"
            maxLength={6}
            value={confirmPin}
            onChange={(event) => setConfirmPin(event.target.value.replace(/\D/g, ''))}
            placeholder="Confirm PIN"
            className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-200"
          />
        </div>
        <button
          onClick={() => {
            if (pin !== confirmPin) {
              setMessage('PIN values must match.');
              return;
            }
            if (!setPin(pin)) {
              setMessage('PIN must be 4-6 digits.');
              return;
            }
            setPinInput('');
            setConfirmPin('');
            setMessage('PIN saved successfully.');
          }}
          className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
        >
          Save PIN
        </button>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1">
          <Fingerprint className="h-3.5 w-3.5" />
          {hasBiometric ? 'Biometric-capable device detected' : 'PIN fallback active'}
        </span>
        {message && <span className="font-medium text-cyan-700">{message}</span>}
      </div>
    </section>
  );
}
