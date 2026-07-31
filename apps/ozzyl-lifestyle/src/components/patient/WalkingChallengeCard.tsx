import React, { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { Trophy, Users, Plus, Medal, Footprints, Loader2 } from 'lucide-react';

interface Challenge {
  id: number;
  title: string;
  description: string;
  target_steps: number;
  start_date: string;
  end_date: string;
  status: string;
  created_by: number;
  participants: Array<{
    patient_id: number;
    patient_name?: string;
    total_steps: number;
    rank: number;
  }>;
}

export function WalkingChallengeCard() {
  const { token } = useAuth();
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [joiningId, setJoiningId] = useState<number | null>(null);

  useEffect(() => {
    fetchChallenges();
  }, []);

  const fetchChallenges = async () => {
    try {
      const res = await fetch('/api/wellness/challenges', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setChallenges(data.challenges ?? []);
      }
    } catch (e) {
      console.error('[WalkingChallenge] fetch error:', e);
    } finally {
      setIsLoading(false);
    }
  };

  const handleJoin = async (challengeId: number) => {
    setJoiningId(challengeId);
    try {
      await fetch(`/api/wellness/challenges/${challengeId}/join`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
      await fetchChallenges();
    } catch (e) {
      console.error('[WalkingChallenge] join error:', e);
    } finally {
      setJoiningId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="p-6 bg-white rounded-3xl border border-gray-100 shadow-sm flex justify-center items-center min-h-[120px]">
        <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
      </div>
    );
  }

  if (challenges.length === 0) {
    return (
      <div className="p-6 bg-gradient-to-br from-emerald-50 to-cyan-50 rounded-3xl border border-emerald-100 text-center">
        <Footprints className="w-10 h-10 text-emerald-400 mx-auto mb-3" />
        <h3 className="font-bold text-gray-900 text-lg mb-1">Walking Challenges</h3>
        <p className="text-sm text-gray-500">No active challenges yet. Check back soon!</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="p-2.5 bg-emerald-100 text-emerald-600 rounded-2xl">
          <Trophy className="w-5 h-5" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-gray-900">Walking Challenges</h3>
          <p className="text-xs text-gray-500">{challenges.length} active challenge{challenges.length > 1 ? 's' : ''}</p>
        </div>
      </div>

      {challenges.map((challenge) => {
        const daysLeft = Math.max(
          0,
          Math.ceil((new Date(challenge.end_date).getTime() - Date.now()) / 86400000),
        );
        const topParticipants = (challenge.participants ?? [])
          .sort((a, b) => b.total_steps - a.total_steps)
          .slice(0, 5);

        return (
          <div
            key={challenge.id}
            className="p-5 bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow"
          >
            {/* Challenge header */}
            <div className="flex items-start justify-between mb-4">
              <div>
                <h4 className="font-bold text-gray-900">{challenge.title}</h4>
                <p className="text-sm text-gray-500 mt-0.5">{challenge.description}</p>
              </div>
              <span className="px-3 py-1 bg-emerald-100 text-emerald-700 text-xs font-bold rounded-full whitespace-nowrap">
                {daysLeft}d left
              </span>
            </div>

            {/* Target */}
            <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl mb-4">
              <Footprints className="w-5 h-5 text-emerald-500" />
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Target</p>
                <p className="text-lg font-black text-gray-900 tabular-nums">
                  {challenge.target_steps.toLocaleString()} <span className="text-sm font-normal text-gray-400">steps</span>
                </p>
              </div>
            </div>

            {/* Leaderboard */}
            {topParticipants.length > 0 && (
              <div className="mb-4">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Leaderboard</p>
                <div className="space-y-2">
                  {topParticipants.map((p, idx) => {
                    const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : null;
                    const progress = Math.min(100, (p.total_steps / challenge.target_steps) * 100);

                    return (
                      <div key={p.patient_id} className="flex items-center gap-3">
                        <span className="w-6 text-center font-bold text-gray-400 text-sm">
                          {medal ?? `#${idx + 1}`}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-sm font-semibold text-gray-800 truncate">
                              {p.patient_name ?? `Patient ${p.patient_id}`}
                            </span>
                            <span className="text-xs font-bold text-gray-500 tabular-nums">
                              {p.total_steps.toLocaleString()}
                            </span>
                          </div>
                          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-emerald-400 to-cyan-400 rounded-full transition-all duration-500"
                              style={{ width: `${progress}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Join button */}
            <button
              onClick={() => handleJoin(challenge.id)}
              disabled={joiningId === challenge.id}
              className="w-full flex items-center justify-center gap-2 py-3 bg-gray-900 text-white font-bold rounded-xl hover:bg-gray-800 transition-colors disabled:opacity-50"
            >
              {joiningId === challenge.id ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Users className="w-4 h-4" />
              )}
              {joiningId === challenge.id ? 'Joining...' : 'Join Challenge'}
            </button>
          </div>
        );
      })}
    </div>
  );
}
