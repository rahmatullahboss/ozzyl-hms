import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, Timer, Flame } from 'lucide-react';
import ActivityRings from './ActivityRings';
import { useActivityLogs, useLogActivity, type ActivityLog } from '../../hooks/usePatientWellness';

interface ActivityModuleProps {
  isSessionReady?: boolean;
}

const ACTIVITY_TYPES = [
  { key: 'walk', bn: 'হাঁটা', en: 'Walk', calPerMin: 4 },
  { key: 'run', bn: 'দৌড়', en: 'Run', calPerMin: 10 },
  { key: 'cycle', bn: 'সাইকেল', en: 'Cycle', calPerMin: 7 },
  { key: 'gym', bn: 'জিম', en: 'Gym', calPerMin: 6 },
  { key: 'yoga', bn: 'যোগ', en: 'Yoga', calPerMin: 3 },
  { key: 'namaz', bn: 'নামাজ', en: 'Namaz', calPerMin: 2 },
  { key: 'housework', bn: 'ঘরের কাজ', en: 'Housework', calPerMin: 3.5 },
  { key: 'swim', bn: 'সাঁতার', en: 'Swim', calPerMin: 8 },
  { key: 'other', bn: 'অন্যান্য', en: 'Other', calPerMin: 4 },
] as const;

export default function ActivityModule({ isSessionReady = true }: ActivityModuleProps) {
  const { i18n } = useTranslation('patientPortal');
  const isBn = i18n.language === 'bn';

  const today = new Date().toISOString().slice(0, 10);
  const { data: logsData, isLoading: loading } = useActivityLogs(today);
  const logs = logsData?.logs ?? [];

  const [showForm, setShowForm] = useState(false);
  const [activityType, setActivityType] = useState('walk');
  const [duration, setDuration] = useState(30);

  const { mutateAsync: logActivity, isPending: submitting } = useLogActivity();

  const handleSubmit = async () => {
    const actDef = ACTIVITY_TYPES.find((a) => a.key === activityType);
    const estCal = Math.round(duration * (actDef?.calPerMin ?? 4));

    try {
      await logActivity({
        activity_type: activityType,
        duration_min: duration,
        calories_burned: estCal,
      });
      setShowForm(false);
    } catch { /* ignore */ }
  };

  if (loading || !isSessionReady) {
    return <div className="bg-white rounded-2xl p-6 shadow-sm animate-pulse h-32" />;
  }

  const totalMin = logs.reduce((s: number, l: Extract<ActivityLog, any>) => s + l.duration_min, 0);
  const totalCal = logs.reduce((s: number, l: Extract<ActivityLog, any>) => s + (l.calories_burned || 0), 0);
  const distinctActiveHours = new Set(logs.map((log: Extract<ActivityLog, any>) => new Date(log.logged_at).getHours())).size;
  const movePercent = Math.round((totalCal / 300) * 100);
  const exercisePercent = Math.round((totalMin / 30) * 100);
  const standPercent = Math.round((distinctActiveHours / 8) * 100);

  // Empty state
  if (logs.length === 0 && !showForm) {
    return (
      <div className="bg-white rounded-2xl p-6 shadow-sm text-center">
        <Activity className="w-10 h-10 text-slate-300 mx-auto mb-3" />
        <p className="text-sm text-slate-500 mb-3">{isBn ? 'আজ কোনো ব্যায়াম লগ হয়নি' : 'No activity logged today'}</p>
        <button
          onClick={() => setShowForm(true)}
          className="px-4 py-2 bg-orange-600 text-white text-sm rounded-xl font-semibold hover:bg-orange-500 transition-colors"
        >
          {isBn ? 'ব্যায়াম লগ করুন' : 'Log Your First Exercise'}
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-slate-900 flex items-center gap-2">
          <Activity className="w-4 h-4 text-orange-500" />
          {isBn ? 'ব্যায়াম' : 'Activity'}
        </h3>
        <button
          onClick={() => setShowForm(!showForm)}
          className="text-xs text-orange-600 font-semibold hover:underline"
        >
          {showForm ? (isBn ? 'বাতিল' : 'Cancel') : (isBn ? '+ লগ করুন' : '+ Log')}
        </button>
      </div>

      {showForm ? (
        <div className="space-y-3">
          {/* Activity type selector */}
          <div className="flex flex-wrap gap-2">
            {ACTIVITY_TYPES.map((at) => (
              <button
                key={at.key}
                onClick={() => setActivityType(at.key)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                  activityType === at.key
                    ? 'bg-orange-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {isBn ? at.bn : at.en}
              </button>
            ))}
          </div>

          {/* Duration slider */}
          <div>
            <label className="text-xs text-slate-500 mb-1 block">
              {isBn ? 'সময়কাল' : 'Duration'}: <span className="font-bold text-slate-700">{duration} {isBn ? 'মিনিট' : 'min'}</span>
            </label>
            <input
              type="range"
              min={5}
              max={180}
              step={5}
              value={duration}
              onChange={(e) => setDuration(parseInt(e.target.value))}
              className="w-full accent-orange-500"
            />
          </div>

          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full py-2.5 bg-orange-600 text-white rounded-xl text-sm font-semibold hover:bg-orange-500 transition-colors disabled:opacity-60"
          >
            {submitting ? '...' : (isBn ? 'সেভ করুন' : 'Save')}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="rounded-2xl bg-slate-50 border border-slate-100 p-4 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {isBn ? 'আজকের অ্যাক্টিভিটি রিংস' : 'Today\'s Activity Rings'}
              </p>
              <p className="mt-1 text-sm text-slate-600">
                {isBn ? 'মুভ, ব্যায়াম, এবং active hours goal-এর progress' : 'Progress for move, exercise, and active hours goals'}
              </p>
            </div>
            <ActivityRings
              movePercent={movePercent}
              exercisePercent={exercisePercent}
              standPercent={standPercent}
              moveValue={`${totalCal} kcal`}
              exerciseValue={`${totalMin} min`}
              standValue={`${distinctActiveHours} hr`}
              size={120}
            />
          </div>

          {/* Today's summary */}
          <div className="flex gap-3">
            <div className="flex-1 bg-orange-50 rounded-xl p-3 text-center">
              <Timer className="w-5 h-5 text-orange-500 mx-auto mb-1" />
              <p className="text-xl font-bold text-orange-900">{totalMin}</p>
              <p className="text-xs text-orange-600">{isBn ? 'মিনিট' : 'minutes'}</p>
            </div>
            <div className="flex-1 bg-red-50 rounded-xl p-3 text-center">
              <Flame className="w-5 h-5 text-red-500 mx-auto mb-1" />
              <p className="text-xl font-bold text-red-900">{totalCal}</p>
              <p className="text-xs text-red-600">{isBn ? 'ক্যালোরি' : 'calories'}</p>
            </div>
          </div>

          {/* Activity list */}
          {logs.map((log: Extract<ActivityLog, any>) => {
            const actDef = ACTIVITY_TYPES.find((a) => a.key === log.activity_type);
            return (
              <div key={log.id} className="flex justify-between items-center py-1.5 text-sm">
                <span className="text-slate-700">{isBn ? actDef?.bn : actDef?.en} ({log.duration_min} {isBn ? 'মিনিট' : 'min'})</span>
                <span className="text-slate-500 text-xs">{log.calories_burned || 0} kcal</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
