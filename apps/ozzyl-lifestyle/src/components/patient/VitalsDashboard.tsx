import React, { useState } from 'react';
import { Heart, Activity, Scale, Droplet, Plus, TrendingUp } from 'lucide-react';

interface VitalLog {
  id: string;
  type: 'heart_rate' | 'blood_pressure' | 'weight' | 'blood_sugar';
  value: string;
  unit: string;
  date: string;
  status: 'normal' | 'warning' | 'critical';
}

const MOCK_VITALS: Record<string, { label: string; icon: React.ReactNode; current: string; unit: string; trend: string; logs: VitalLog[] }> = {
  heart_rate: {
    label: 'Heart Rate',
    icon: <Heart className="w-5 h-5 text-rose-500" />,
    current: '72',
    unit: 'bpm',
    trend: '+2% from last week',
    logs: [{ id: '1', type: 'heart_rate', value: '72', unit: 'bpm', date: 'Today, 8:00 AM', status: 'normal' }]
  },
  blood_pressure: {
    label: 'Blood Pressure',
    icon: <Activity className="w-5 h-5 text-indigo-500" />,
    current: '120/80',
    unit: 'mmHg',
    trend: 'Normal range',
    logs: [{ id: '2', type: 'blood_pressure', value: '120/80', unit: 'mmHg', date: 'Yesterday, 9:00 AM', status: 'normal' }]
  },
  weight: {
    label: 'Weight',
    icon: <Scale className="w-5 h-5 text-teal-500" />,
    current: '68.5',
    unit: 'kg',
    trend: '-0.5kg this month',
    logs: [{ id: '3', type: 'weight', value: '68.5', unit: 'kg', date: 'Oct 12, 7:00 AM', status: 'normal' }]
  },
  blood_sugar: {
    label: 'Blood Sugar',
    icon: <Droplet className="w-5 h-5 text-blue-500" />,
    current: '95',
    unit: 'mg/dL',
    trend: 'Stable',
    logs: [{ id: '4', type: 'blood_sugar', value: '95', unit: 'mg/dL', date: 'Today, 7:30 AM', status: 'normal' }]
  }
};

export const VitalsDashboard: React.FC = () => {
  const [selectedVital, setSelectedVital] = useState<string>('heart_rate');

  return (
    <div className="w-full max-w-md mx-auto min-h-screen bg-slate-50 flex flex-col font-sans">
      <header className="p-6 bg-white/80 backdrop-blur-md sticky top-0 z-10 border-b border-slate-100">
        <h1 className="text-2xl font-semibold text-slate-800">Vitals Dashboard</h1>
        <p className="text-sm text-slate-500 mt-1">Monitor your daily health metrics</p>
      </header>

      <main className="flex-1 p-6 space-y-6">
        {/* Vitals Grid */}
        <div className="grid grid-cols-2 gap-4">
          {Object.entries(MOCK_VITALS).map(([key, data]) => (
            <button
              key={key}
              data-testid={`vital-card-${key}`}
              onClick={() => setSelectedVital(key)}
              className={`p-4 rounded-3xl text-left transition-all ${
                selectedVital === key
                  ? 'bg-teal-50 border-teal-200 border shadow-sm'
                  : 'bg-white border-transparent border shadow-sm hover:bg-slate-50'
              }`}
            >
              <div className="flex justify-between items-start mb-3">
                <div className="p-2 bg-slate-50 rounded-full">{data.icon}</div>
                {selectedVital === key && <TrendingUp className="w-4 h-4 text-teal-600" />}
              </div>
              <p className="text-xs text-slate-500 font-medium mb-1">{data.label}</p>
              <div className="flex items-baseline space-x-1">
                <span className="text-xl font-bold text-slate-800">{data.current}</span>
                <span className="text-xs text-slate-500">{data.unit}</span>
              </div>
            </button>
          ))}
        </div>

        {/* Selected Vital Details */}
        <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100 mt-6">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-lg font-semibold text-slate-800">
              {MOCK_VITALS[selectedVital].label} Trends
            </h3>
            <span className="text-xs px-2 py-1 bg-slate-100 text-slate-600 rounded-full font-medium">
              {MOCK_VITALS[selectedVital].trend}
            </span>
          </div>

          <div className="space-y-4">
            {MOCK_VITALS[selectedVital].logs.map((log) => (
              <div key={log.id} className="flex justify-between items-center p-4 bg-slate-50 rounded-2xl">
                <div>
                  <p className="text-sm font-semibold text-slate-800">
                    {log.value} <span className="text-xs font-normal text-slate-500">{log.unit}</span>
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">{log.date}</p>
                </div>
                <div className={`w-2 h-2 rounded-full ${
                  log.status === 'normal' ? 'bg-teal-500' : log.status === 'warning' ? 'bg-amber-500' : 'bg-rose-500'
                }`} />
              </div>
            ))}
          </div>
        </div>
      </main>

      {/* Floating Action Button */}
      <div className="fixed bottom-24 right-6">
        <button
          data-testid="log-vitals-btn"
          className="bg-teal-600 text-white p-4 rounded-full shadow-lg hover:bg-teal-700 transition-colors flex items-center justify-center group"
          onClick={() => {}}
        >
          <Plus className="w-6 h-6 group-hover:scale-110 transition-transform" />
        </button>
      </div>
    </div>
  );
};
