import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Moon, Star, Clock } from 'lucide-react';
import { useSleepHistory, useLogSleep } from '../../hooks/usePatientWellness';

interface SleepLog {
  id: number;
  bedtime?: string;
  wake_time?: string;
  duration_min?: number;
  quality_rating?: number;
  source: string;
  logged_at: string;
}

interface SleepModuleProps {
  isSessionReady?: boolean;
}

function formatTime(time: string | undefined): string {
  if (!time) return '--:--';
  return time.slice(0, 5);
}

function sleepScore(durationMin: number, qualityRating: number): number {
  // Duration score: 7-9h = 100, linear falloff
  const hours = durationMin / 60;
  let dScore = 0;
  if (hours >= 7 && hours <= 9) dScore = 100;
  else if (hours >= 5 && hours < 7) dScore = Math.round(((hours - 5) / 2) * 100);
  else if (hours > 9 && hours <= 11) dScore = Math.round(((11 - hours) / 2) * 100);

  // Quality score: 1-5 → 20-100
  const qScore = qualityRating * 20;

  return Math.round(dScore * 0.6 + qScore * 0.4);
}

export default function SleepModule({ isSessionReady = true }: SleepModuleProps) {
  const { i18n } = useTranslation('patientPortal');
  const isBn = i18n.language === 'bn';

  const [showForm, setShowForm] = useState(false);
  const [bedtime, setBedtime] = useState('23:00');
  const [wakeTime, setWakeTime] = useState('07:00');
  const [quality, setQuality] = useState(3);

  const { data: sleepData, isLoading } = useSleepHistory(7);
  const { mutateAsync: logSleep, isPending: submitting } = useLogSleep();
  const logs = sleepData?.logs || [];

  const handleSubmit = useCallback(async () => {
    // Calculate duration from bedtime/wake time
    const [bh, bm] = bedtime.split(':').map(Number);
    const [wh, wm] = wakeTime.split(':').map(Number);
    let durationMin = (wh * 60 + wm) - (bh * 60 + bm);
    if (durationMin < 0) durationMin += 24 * 60; // overnight

    try {
      await logSleep({
        bedtime,
        wake_time: wakeTime,
        duration_min: durationMin,
        quality_rating: quality,
        source: 'manual',
      });
      setShowForm(false);
    } catch { /* ignore */ }
  }, [bedtime, wakeTime, quality, logSleep]);

  if (!isSessionReady || isLoading) {
    return <div className="bg-white rounded-2xl p-6 shadow-sm animate-pulse h-32" />;
  }

  const lastNight = logs[0];
  const lastDurationHrs = lastNight?.duration_min ? (lastNight.duration_min / 60).toFixed(1) : null;
  const lastScore = lastNight?.duration_min && lastNight?.quality_rating
    ? sleepScore(lastNight.duration_min, lastNight.quality_rating)
    : null;

  // Empty state
  if (!lastNight && !showForm) {
    return (
      <div className="bg-white rounded-2xl p-6 shadow-sm text-center">
        <Moon className="w-10 h-10 text-slate-300 mx-auto mb-3" />
        <p className="text-sm text-slate-500 mb-3">{isBn ? 'ঘুমের তথ্য নেই' : 'No sleep data yet'}</p>
        <button
          onClick={() => setShowForm(true)}
          className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-xl font-semibold hover:bg-indigo-500 transition-colors"
        >
          {isBn ? 'ঘুম লগ করুন' : 'Log Last Night\'s Sleep'}
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-slate-900 flex items-center gap-2">
          <Moon className="w-4 h-4 text-indigo-500" />
          {isBn ? 'ঘুম' : 'Sleep'}
        </h3>
        <button
          onClick={() => setShowForm(!showForm)}
          className="text-xs text-indigo-600 font-semibold hover:underline"
        >
          {showForm ? (isBn ? 'বাতিল' : 'Cancel') : (isBn ? '+ লগ করুন' : '+ Log')}
        </button>
      </div>

      {showForm ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-500 mb-1 block">{isBn ? 'ঘুমানোর সময়' : 'Bedtime'}</label>
              <input
                type="time"
                value={bedtime}
                onChange={(e) => setBedtime(e.target.value)}
                className="w-full bg-slate-100 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">{isBn ? 'জাগার সময়' : 'Wake time'}</label>
              <input
                type="time"
                value={wakeTime}
                onChange={(e) => setWakeTime(e.target.value)}
                className="w-full bg-slate-100 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-2 block">{isBn ? 'ঘুমের মান' : 'Sleep quality'}</label>
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5].map((s) => (
                <button
                  key={s}
                  onClick={() => setQuality(s)}
                  className="transition-transform hover:scale-110"
                >
                  <Star
                    className={`w-7 h-7 ${s <= quality ? 'text-amber-400 fill-amber-400' : 'text-slate-300'}`}
                  />
                </button>
              ))}
            </div>
          </div>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-500 transition-colors disabled:opacity-60"
          >
            {submitting ? '...' : (isBn ? 'সেভ করুন' : 'Save')}
          </button>
        </div>
      ) : lastNight ? (
        <div className="space-y-3">
          {/* Last night summary */}
          <div className="flex items-center justify-between bg-indigo-50 rounded-xl p-4">
            <div>
              <p className="text-2xl font-bold text-indigo-900">{lastDurationHrs}h</p>
              <p className="text-xs text-indigo-600">
                <Clock className="w-3 h-3 inline mr-1" />
                {formatTime(lastNight.bedtime)} - {formatTime(lastNight.wake_time)}
              </p>
            </div>
            {lastScore !== null && (
              <div className="text-center">
                <p className="text-2xl font-bold text-indigo-700">{lastScore}</p>
                <p className="text-xs text-indigo-500">{isBn ? 'ঘুম স্কোর' : 'Sleep Score'}</p>
              </div>
            )}
          </div>

          {/* Quality stars */}
          {lastNight.quality_rating && (
            <div className="flex items-center gap-1">
              <span className="text-xs text-slate-500 mr-2">{isBn ? 'মান:' : 'Quality:'}</span>
              {[1, 2, 3, 4, 5].map((s) => (
                <Star
                  key={s}
                  className={`w-4 h-4 ${s <= lastNight.quality_rating! ? 'text-amber-400 fill-amber-400' : 'text-slate-200'}`}
                />
              ))}
            </div>
          )}

          {/* 7-day mini bars */}
          {logs.length > 1 && (
            <div>
              <p className="text-xs text-slate-500 mb-2">{isBn ? 'গত ৭ দিন' : 'Last 7 days'}</p>
              <div className="flex items-end gap-1 h-12">
                {logs.slice(0, 7).reverse().map((log, i) => {
                  const hours = (log.duration_min || 0) / 60;
                  const height = Math.min(100, Math.round((hours / 10) * 100));
                  return (
                    <div
                      key={i}
                      className="flex-1 bg-indigo-200 rounded-t-sm transition-all"
                      style={{ height: `${height}%` }}
                      title={`${hours.toFixed(1)}h`}
                    />
                  );
                })}
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
