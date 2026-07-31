import React, { useState, useEffect } from 'react';
import { Play, Pause, Square, Moon } from 'lucide-react';
import { useLogMeditation } from '../../hooks/usePatientWellness';

const PRESETS = [5, 10, 15, 20, 30]; // minutes

export function MeditationTimer() {
  const [duration, setDuration] = useState<number | null>(null);
  const [timeLeft, setTimeLeft] = useState<number>(0);
  const [isActive, setIsActive] = useState(false);
  const { mutateAsync: logMeditation } = useLogMeditation();

  useEffect(() => {
    let interval: any;
    if (isActive && timeLeft > 0) {
      interval = setInterval(() => setTimeLeft(prev => prev - 1), 1000);
    } else if (timeLeft === 0 && isActive) {
      setIsActive(false);
      logSession();
    }
    return () => clearInterval(interval);
  }, [isActive, timeLeft]);

  const startTimer = () => {
    if (duration && timeLeft === 0) {
      setTimeLeft(duration * 60);
    }
    setIsActive(true);
  };

  const togglePause = () => setIsActive(!isActive);

  const stopTimer = async () => {
    setIsActive(false);
    await logSession();
    setDuration(null);
    setTimeLeft(0);
  };

  const logSession = async () => {
    if (!duration) return;
    const completedMinutes = duration - Math.floor(timeLeft / 60);
    if (completedMinutes <= 0) return;

    try {
      await logMeditation({
        durationMinutes: completedMinutes,
        type: 'unguided'
      });
    } catch (e) {
      console.error(e);
    }
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  if (!duration) {
    return (
      <div className="max-w-md mx-auto p-6 bg-white rounded-3xl border border-gray-100 shadow-sm mt-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-3 bg-indigo-100 text-indigo-600 rounded-2xl">
            <Moon className="w-6 h-6" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900">Meditation</h2>
        </div>

        <p className="text-gray-500 font-medium mb-4">Choose duration</p>
        <div className="grid grid-cols-3 gap-3 mb-8">
          {PRESETS.map(min => (
            <button
              key={min}
              onClick={() => {
                setDuration(min);
                setTimeLeft(min * 60);
              }}
              className="py-4 text-center font-bold text-gray-700 bg-gray-50 hover:bg-indigo-50 hover:text-indigo-700 rounded-2xl border-2 border-transparent transition-all focus:border-indigo-200"
            >
              {min} min
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto p-8 bg-indigo-900 rounded-3xl shadow-xl mt-8 flex flex-col items-center justify-center text-white">
      <h2 className="text-indigo-200 font-semibold uppercase tracking-widest text-sm mb-12">Unguided Session</h2>
      
      <div className="text-7xl font-black tracking-tighter tabular-nums text-white drop-shadow-lg mb-16">
        {formatTime(timeLeft)}
      </div>

      <div className="flex gap-4">
        {!isActive && timeLeft === duration * 60 ? (
          <button
            onClick={startTimer}
            className="w-16 h-16 bg-white text-indigo-900 rounded-full flex items-center justify-center hover:scale-105 transition-transform"
          >
            <Play className="w-6 h-6 ml-1" />
            <span className="sr-only">Start</span>
          </button>
        ) : (
          <button
            onClick={togglePause}
            className="w-16 h-16 bg-white/20 text-white rounded-full flex items-center justify-center hover:bg-white/30 transition-colors"
          >
            {isActive ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6 ml-1" />}
            <span className="sr-only">{isActive ? 'Pause' : 'Resume'}</span>
          </button>
        )}

        <button
          onClick={stopTimer}
          className="w-16 h-16 bg-red-500/20 text-red-100 hover:bg-red-500/40 rounded-full flex items-center justify-center transition-colors"
        >
          <Square className="w-6 h-6" />
          <span className="sr-only">Finish</span>
        </button>
      </div>

      
      {/* Visual spacer */}
      <div className="flex w-full mt-10 justify-between items-center px-4" aria-hidden="true" />
      <div className="absolute inset-x-0 bottom-12 flex justify-center w-full" aria-hidden="true" />
    </div>
  );
}
