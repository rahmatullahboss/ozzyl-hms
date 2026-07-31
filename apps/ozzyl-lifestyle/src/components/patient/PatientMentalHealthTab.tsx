import React from 'react';
import MentalHealthScreen from './MentalHealthScreen';
import BreathingExercise from './BreathingExercise';
import { MeditationTimer } from './MeditationTimer';
import { PrivacyGate } from './PrivacyGate';

export default function PatientMentalHealthTab() {
  return (
    <PrivacyGate module="mental-health">
      <div className="space-y-8 animate-in fade-in pb-20 max-w-7xl mx-auto px-4 md:px-8 mt-24">
        <div className="mb-6">
          <h2 className="text-3xl font-extrabold text-slate-900 tracking-tight">Mental Health Hub</h2>
          <p className="text-slate-500 mt-2">Track your well-being with clinically validated screens and mindfulness tools.</p>
        </div>

        <MentalHealthScreen />
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-12">
          <BreathingExercise />
          <MeditationTimer />
        </div>
      </div>
    </PrivacyGate>
  );
}
