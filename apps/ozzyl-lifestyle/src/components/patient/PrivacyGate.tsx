import React, { useState, useEffect } from 'react';
import { Lock, Fingerprint, KeyRound, ShieldCheck, Eye, EyeOff, Settings } from 'lucide-react';
import {
  isModuleLocked,
  verifyPin,
  recordUnlock,
  hasPinSet,
  isBiometricAvailable,
  getLockConfig,
  saveLockConfig,
  setPin,
  LOCKABLE_MODULES,
  type LockableModule,
} from '../../lib/privacy-lock';

interface PrivacyGateProps {
  module: LockableModule;
  children: React.ReactNode;
}

/**
 * Wraps a sensitive module with a privacy lock screen.
 * If the module is locked, shows PIN entry. Otherwise renders children.
 */
export function PrivacyGate({ module, children }: PrivacyGateProps) {
  const [locked, setLocked] = useState(() => isModuleLocked(module));
  const [pin, setInputPin] = useState('');
  const [error, setError] = useState('');
  const [hasBiometric, setHasBiometric] = useState(false);

  useEffect(() => {
    isBiometricAvailable().then(setHasBiometric);
  }, []);

  if (!locked) {
    return <>{children}</>;
  }

  const handlePinSubmit = () => {
    if (verifyPin(pin)) {
      recordUnlock();
      setLocked(false);
      setError('');
    } else {
      setError('Incorrect PIN. Please try again.');
      setInputPin('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && pin.length >= 4) {
      handlePinSubmit();
    }
  };

  return (
    <div className="flex items-center justify-center min-h-[400px] p-8">
      <div className="max-w-sm w-full text-center">
        {/* Lock icon */}
        <div className="mx-auto w-20 h-20 bg-gradient-to-br from-slate-100 to-slate-200 rounded-3xl flex items-center justify-center mb-6 shadow-inner">
          <Lock className="w-9 h-9 text-slate-500" />
        </div>

        <h3 className="text-xl font-bold text-gray-900 mb-2">Privacy Protected</h3>
        <p className="text-sm text-gray-500 mb-6">
          This section is locked for your privacy. Enter your PIN to access.
        </p>

        {/* PIN input */}
        <div className="relative mb-4">
          <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="password"
            inputMode="numeric"
            maxLength={6}
            placeholder="Enter PIN"
            value={pin}
            onChange={(e) => {
              setInputPin(e.target.value.replace(/\D/g, ''));
              setError('');
            }}
            onKeyDown={handleKeyDown}
            className="w-full pl-11 pr-4 py-3 rounded-xl border border-gray-200 text-center text-2xl tracking-[0.5em] font-mono focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 outline-none"
          />
        </div>

        {error && (
          <p className="text-sm text-red-500 mb-4 font-medium">{error}</p>
        )}

        <button
          onClick={handlePinSubmit}
          disabled={pin.length < 4}
          className="w-full py-3 bg-gray-900 text-white font-bold rounded-xl hover:bg-gray-800 transition disabled:opacity-40"
        >
          <ShieldCheck className="w-4 h-4 inline mr-2" />
          Unlock
        </button>

        {/* Biometrics will be added in Phase 4 when device registration backend is ready */}
      </div>
    </div>
  );
}

/**
 * Settings panel for configuring the privacy lock.
 */
export function PrivacyLockSettings() {
  const [config, setConfig] = useState(() => getLockConfig());
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [pinMessage, setPinMessage] = useState('');
  const [showPin, setShowPin] = useState(false);
  const hasPin = hasPinSet();

  const handleToggle = () => {
    if (!config.enabled && !hasPin) {
      setPinMessage('Please set a PIN first before enabling the lock.');
      return;
    }
    const updated = { ...config, enabled: !config.enabled };
    saveLockConfig(updated);
    setConfig(updated);
  };

  const handleModuleToggle = (mod: LockableModule) => {
    const current = config.lockedModules.includes(mod);
    const updated = {
      ...config,
      lockedModules: current
        ? config.lockedModules.filter(m => m !== mod)
        : [...config.lockedModules, mod],
    };
    saveLockConfig(updated);
    setConfig(updated);
  };

  const handleSetPin = () => {
    if (newPin !== confirmPin) {
      setPinMessage('PINs do not match.');
      return;
    }
    if (setPin(newPin)) {
      setPinMessage('PIN set successfully!');
      setNewPin('');
      setConfirmPin('');
    } else {
      setPinMessage('PIN must be 4-6 digits.');
    }
  };

  const MODULE_LABELS: Record<LockableModule, string> = {
    'mental-health': '🧠 Mental Health',
    'womens-health': '🩺 Women\'s Health',
    'pregnancy': '🤰 Pregnancy',
  };

  return (
    <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2.5 bg-indigo-100 text-indigo-600 rounded-2xl">
          <Lock className="w-5 h-5" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-gray-900">Privacy Lock</h3>
          <p className="text-xs text-gray-500">Protect sensitive health modules with PIN or biometrics</p>
        </div>
      </div>

      {/* Enable toggle */}
      <div className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl">
        <span className="font-semibold text-gray-800">Enable Privacy Lock</span>
        <button
          onClick={handleToggle}
          className={`w-12 h-7 rounded-full transition-colors relative ${config.enabled ? 'bg-indigo-500' : 'bg-gray-300'}`}
        >
          <span className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-transform ${config.enabled ? 'translate-x-6' : 'translate-x-1'}`} />
        </button>
      </div>

      {/* Module selection */}
      <div className="space-y-2">
        <p className="text-sm font-semibold text-gray-600">Protected Modules</p>
        {LOCKABLE_MODULES.map(mod => (
          <label key={mod} className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl cursor-pointer hover:bg-gray-100 transition">
            <input
              type="checkbox"
              checked={config.lockedModules.includes(mod)}
              onChange={() => handleModuleToggle(mod)}
              className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"
            />
            <span className="text-sm font-medium text-gray-800">{MODULE_LABELS[mod]}</span>
          </label>
        ))}
      </div>

      {/* PIN setup */}
      <div className="border-t border-gray-100 pt-4 space-y-3">
        <p className="text-sm font-semibold text-gray-600">
          {hasPin ? 'Change PIN' : 'Set PIN'}
        </p>
        <div className="relative">
          <input
            type={showPin ? 'text' : 'password'}
            inputMode="numeric"
            maxLength={6}
            placeholder="New PIN (4-6 digits)"
            value={newPin}
            onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))}
            className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:ring-2 focus:ring-indigo-400 outline-none pr-10"
          />
          <button onClick={() => setShowPin(!showPin)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
            {showPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        <input
          type="password"
          inputMode="numeric"
          maxLength={6}
          placeholder="Confirm PIN"
          value={confirmPin}
          onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
          className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:ring-2 focus:ring-indigo-400 outline-none"
        />
        <button
          onClick={handleSetPin}
          disabled={newPin.length < 4 || confirmPin.length < 4}
          className="w-full py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition disabled:opacity-40"
        >
          {hasPin ? 'Update PIN' : 'Set PIN'}
        </button>
        {pinMessage && (
          <p className={`text-sm font-medium ${pinMessage.includes('successfully') ? 'text-emerald-600' : 'text-red-500'}`}>
            {pinMessage}
          </p>
        )}
      </div>
    </div>
  );
}
