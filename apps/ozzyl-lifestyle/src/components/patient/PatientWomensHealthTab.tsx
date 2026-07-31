import React from 'react';
import CycleTracker from './CycleTracker';
import { PregnancyModeWidget } from './PregnancyModeWidget';
import { PrivacyGate } from './PrivacyGate';

export default function PatientWomensHealthTab() {
  return (
    <PrivacyGate module="womens-health">
      <div className="space-y-8 animate-in fade-in pb-20 max-w-7xl mx-auto px-4 md:px-8 mt-24">
        <div className="mb-6">
          <h2 className="text-3xl font-extrabold text-slate-900 tracking-tight">Women's Health</h2>
          <p className="text-slate-500 mt-2">Track your cycle, pregnancy, and get personalized health predictions.</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <CycleTracker />
          <PregnancyModeWidget />
        </div>
      </div>
    </PrivacyGate>
  );
}
