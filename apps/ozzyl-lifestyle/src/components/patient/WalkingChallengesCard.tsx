import { useCallback, useEffect, useState } from 'react';
import { Flag, Footprints, Plus } from 'lucide-react';

type Challenge = {
  id: number;
  name: string;
  type: 'steps' | 'distance_km';
  target: number;
  duration_days: number;
  current_value?: number | null;
  joined_at?: string | null;
};

const PRESETS = [
  { name: '7-day 50k steps', type: 'steps' as const, target: 50000, duration_days: 7 },
  { name: 'Weekend 10 km walk', type: 'distance_km' as const, target: 10, duration_days: 3 },
];

export default function WalkingChallengesCard() {
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [creating, setCreating] = useState(false);

  const loadChallenges = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/wellness/challenges', { credentials: 'include' });
      if (!response.ok) return;
      const data = await response.json() as { challenges?: Challenge[] };
      setChallenges(data.challenges || []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadChallenges();
  }, [loadChallenges]);

  const createPreset = useCallback(async (preset: typeof PRESETS[number]) => {
    setCreating(true);
    setMessage('');
    try {
      const response = await fetch('/api/wellness/challenges', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(preset),
      });
      const data = await response.json().catch(() => ({}));
      setMessage(response.ok ? 'Challenge created.' : (data.error ?? 'Could not create challenge.'));
      await loadChallenges();
    } catch {
      setMessage('Could not create challenge.');
    } finally {
      setCreating(false);
    }
  }, [loadChallenges]);

  const joinChallenge = useCallback(async (challengeId: number) => {
    try {
      const response = await fetch(`/api/wellness/challenges/${challengeId}/join`, {
        method: 'POST',
        credentials: 'include',
      });
      const data = await response.json().catch(() => ({}));
      setMessage(response.ok ? 'Challenge joined.' : (data.error ?? 'Could not join challenge.'));
      await loadChallenges();
    } catch {
      setMessage('Could not join challenge.');
    }
  }, [loadChallenges]);

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-600">Walking challenges</p>
          <h3 className="mt-2 text-xl font-bold text-slate-900">Turn new activity features into a goal loop</h3>
          <p className="mt-2 text-sm text-slate-500">
            Recent steps and distance work better when they are visible as goals you can create or join quickly.
          </p>
        </div>
        <div className="rounded-2xl bg-cyan-100 p-3 text-cyan-700">
          <Flag className="h-5 w-5" />
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {PRESETS.map((preset) => (
          <button
            key={preset.name}
            onClick={() => void createPreset(preset)}
            disabled={creating}
            className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-left transition hover:border-cyan-200 hover:bg-cyan-50 disabled:opacity-50"
          >
            <div className="flex items-center gap-2 text-slate-900">
              <Plus className="h-4 w-4 text-cyan-600" />
              <p className="text-sm font-semibold">{preset.name}</p>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              {preset.target.toLocaleString()} {preset.type === 'steps' ? 'steps' : 'km'} over {preset.duration_days} days
            </p>
          </button>
        ))}
      </div>

      <div className="mt-5 rounded-2xl bg-slate-50 p-4">
        <div className="flex items-center gap-2">
          <Footprints className="h-4 w-4 text-cyan-600" />
          <p className="text-sm font-semibold text-slate-900">Active challenges</p>
        </div>

        {loading ? (
          <p className="mt-3 text-sm text-slate-500">Loading challenges...</p>
        ) : challenges.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No challenge is active yet. Start with one of the quick presets above.</p>
        ) : (
          <div className="mt-3 space-y-3">
            {challenges.map((challenge) => (
              <div key={challenge.id} className="rounded-2xl bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{challenge.name}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      Target: {challenge.target.toLocaleString()} {challenge.type === 'steps' ? 'steps' : 'km'} • {challenge.duration_days} days
                    </p>
                  </div>
                  {challenge.joined_at ? (
                    <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                      Joined
                    </span>
                  ) : (
                    <button
                      onClick={() => void joinChallenge(challenge.id)}
                      className="rounded-full bg-slate-900 px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-slate-800"
                    >
                      Join
                    </button>
                  )}
                </div>
                {challenge.current_value != null && (
                  <p className="mt-3 text-xs font-medium text-cyan-700">
                    Current progress: {challenge.current_value.toLocaleString()} {challenge.type === 'steps' ? 'steps' : 'km'}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {message && <p className="mt-4 text-sm font-medium text-cyan-700">{message}</p>}
    </section>
  );
}
