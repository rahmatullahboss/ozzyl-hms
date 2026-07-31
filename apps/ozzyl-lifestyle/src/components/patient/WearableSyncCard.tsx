import React, { useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { Watch, RefreshCw, CheckCircle2, AlertCircle, Smartphone, Activity, Heart, Moon } from 'lucide-react';
import {
  isNativeHealthAvailable,
  syncWearableData,
  detectPlatform,
  type SyncResult,
} from '../../lib/wearable-bridge';

type SyncStatus = 'idle' | 'syncing' | 'success' | 'error' | 'unavailable';

export function WearableSyncCard() {
  const { token } = useAuth();
  const [status, setStatus] = useState<SyncStatus>(
    isNativeHealthAvailable() ? 'idle' : 'unavailable',
  );
  const [result, setResult] = useState<SyncResult | null>(null);

  const handleSync = async () => {
    if (!token) return;
    setStatus('syncing');
    setResult(null);

    const syncResult = await syncWearableData(token, 7);
    setResult(syncResult);
    setStatus(syncResult.success ? 'success' : 'error');

    // Auto-reset after 5s
    setTimeout(() => {
      setStatus('idle');
      setResult(null);
    }, 5000);
  };

  const platform = detectPlatform();
  const platformLabel =
    platform === 'apple_health'
      ? 'Apple Health'
      : platform === 'health_connect'
        ? 'Health Connect'
        : 'Smartwatch';

  return (
    <div className="bg-slate-50 min-h-screen p-6 font-sans">
      <div className="bg-white rounded-[2rem] p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] relative overflow-hidden mb-8 max-w-md mx-auto">
        {/* Soft abstract background blobs */}
        <div className="absolute -top-10 -right-10 w-48 h-48 bg-emerald-500/10 blur-[60px] rounded-full z-0" />
        <div className="absolute -bottom-10 -left-10 w-48 h-48 bg-amber-500/10 blur-[60px] rounded-full z-0" />
        
        {/* Header */}
        <div className="relative z-10 flex items-center justify-between mb-8">
          <div>
            <h3 className="text-2xl font-bold text-slate-800 font-['Manrope'] tracking-tight">Ecosystem</h3>
            <p className="text-emerald-600 font-medium text-sm mt-1 font-['Be_Vietnam_Pro']">{platformLabel}</p>
          </div>
          <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center shadow-[0_4px_20px_rgb(0,0,0,0.05)]">
            <Watch className="w-6 h-6 text-slate-800" />
          </div>
        </div>

        {/* Sync Status Banner */}
        <div className="relative z-10 mb-8">
          {status === 'unavailable' ? (
            <div className="flex items-center gap-3 p-5 bg-amber-50 rounded-3xl">
              <Smartphone className="w-5 h-5 text-amber-600 flex-shrink-0" />
              <p className="text-sm text-slate-700 font-['Be_Vietnam_Pro'] leading-relaxed">
                Open the Ozzyl app on your phone to sync health data from your wearable.
              </p>
            </div>
          ) : status === 'success' ? (
            <div className="flex items-center gap-3 p-5 bg-emerald-50 rounded-3xl">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
              <p className="text-sm text-slate-700 font-medium font-['Be_Vietnam_Pro']">
                Synced <span className="font-bold">{result?.samplesCount ?? 0}</span> data points successfully!
              </p>
            </div>
          ) : status === 'error' ? (
            <div className="flex items-center gap-3 p-5 bg-rose-50 rounded-3xl">
              <AlertCircle className="w-5 h-5 text-rose-600 flex-shrink-0" />
              <div>
                <p className="text-sm text-rose-800 font-bold font-['Manrope']">Sync failed</p>
                <p className="text-xs text-rose-600 mt-1">{result?.error}</p>
              </div>
            </div>
          ) : null}
        </div>

        {/* Quick Stats Grid */}
        <div className="relative z-10 grid grid-cols-2 gap-4 mb-8">
          {/* Steps */}
          <div className="bg-slate-50 rounded-3xl p-5 hover:bg-slate-100 transition-colors">
            <div className="flex items-center gap-2 mb-3">
              <Activity className="w-4 h-4 text-emerald-500" />
              <span className="text-xs font-bold text-slate-400 uppercase tracking-widest font-['Manrope']">Steps</span>
            </div>
            <p className="text-2xl font-black text-slate-800 font-['Manrope']">8,432</p>
            <p className="text-xs text-slate-500 mt-1 font-medium text-emerald-600">Goal: 10k</p>
          </div>

          {/* Heart Rate */}
          <div className="bg-slate-50 rounded-3xl p-5 hover:bg-slate-100 transition-colors">
            <div className="flex items-center gap-2 mb-3">
              <Heart className="w-4 h-4 text-rose-500" />
              <span className="text-xs font-bold text-slate-400 uppercase tracking-widest font-['Manrope']">BPM</span>
            </div>
            <p className="text-2xl font-black text-slate-800 font-['Manrope']">72</p>
            <p className="text-xs text-slate-500 mt-1 font-medium">Resting: 68</p>
          </div>

          {/* Sleep Score */}
          <div className="col-span-2 bg-slate-50 rounded-3xl p-5 flex items-center justify-between hover:bg-slate-100 transition-colors">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Moon className="w-4 h-4 text-indigo-500" />
                <span className="text-xs font-bold text-slate-400 uppercase tracking-widest font-['Manrope']">Sleep Score</span>
              </div>
              <p className="text-sm text-slate-500 font-medium">Quality of rest</p>
            </div>
            <p className="text-4xl font-black text-slate-800 font-['Manrope']">85</p>
          </div>
        </div>

        {/* Sync Button */}
        {status !== 'unavailable' && (
          <button
            onClick={handleSync}
            disabled={status === 'syncing'}
            className="relative z-10 w-full flex items-center justify-center gap-2 py-4 bg-slate-900 text-white font-bold rounded-full hover:bg-slate-800 transition-all disabled:opacity-50 shadow-[0_8px_30px_rgb(15,23,42,0.15)] font-['Manrope']"
          >
            <RefreshCw className={`w-5 h-5 ${status === 'syncing' ? 'animate-spin' : ''}`} />
            {status === 'syncing' ? 'Syncing...' : 'Sync Device'}
          </button>
        )}
      </div>
    </div>
  );
}
