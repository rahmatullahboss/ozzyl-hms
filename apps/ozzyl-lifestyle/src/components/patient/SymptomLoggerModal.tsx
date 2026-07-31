import { useState } from 'react';
import { X, CheckCircle2, Activity } from 'lucide-react';
import toast from 'react-hot-toast';
import { useLogSymptoms } from '../../hooks/usePatientWellness';

interface SymptomLoggerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const COMMON_SYMPTOMS = [
  'Headache',
  'Fatigue',
  'Nausea',
  'Fever',
  'Cough',
  'Body Ache',
  'Dizziness',
];

export default function SymptomLoggerModal({ isOpen, onClose }: SymptomLoggerModalProps) {
  const [selectedSymptoms, setSelectedSymptoms] = useState<string[]>([]);
  const [severity, setSeverity] = useState<number>(5);
  const [notes, setNotes] = useState('');
  const { mutateAsync: logSymptoms, isPending: saving } = useLogSymptoms();

  if (!isOpen) return null;

  const toggleSymptom = (symptom: string) => {
    setSelectedSymptoms((prev) =>
      prev.includes(symptom) ? prev.filter((s) => s !== symptom) : [...prev, symptom]
    );
  };

  const handleSave = async () => {
    if (selectedSymptoms.length === 0) {
      toast.error('Please select at least one symptom');
      return;
    }
    try {
      await logSymptoms({ symptoms: selectedSymptoms, severity, notes });
      onClose();
    } catch {
      // useLogSymptoms handles toast internally
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
      <div className="relative w-full max-w-md overflow-hidden bg-surface-container-lowest rounded-[24px] shadow-2xl">
        <div className="flex items-center justify-between p-6 bg-emerald-50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-100 text-emerald-700 rounded-xl">
              <Activity className="w-6 h-6" />
            </div>
            <h2 className="text-xl font-bold text-slate-800 font-manrope">Log Symptoms</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 bg-white rounded-full hover:text-slate-600 hover:bg-slate-50 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-8 bg-white max-h-[70vh] overflow-y-auto">
          {/* Symptoms Grid */}
          <div className="space-y-4">
            <label className="block text-sm font-semibold text-slate-700 font-manrope">
              How are you feeling?
            </label>
            <div className="flex flex-wrap gap-2">
              {COMMON_SYMPTOMS.map((symptom) => {
                const isSelected = selectedSymptoms.includes(symptom);
                return (
                  <button
                    key={symptom}
                    onClick={() => toggleSymptom(symptom)}
                    className={`flex items-center gap-2 px-4 py-2 text-sm font-medium transition-all rounded-full ${
                      isSelected
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-surface-container-low text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    {isSelected && <CheckCircle2 className="w-4 h-4" />}
                    {symptom}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Severity Slider */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <label className="block text-sm font-semibold text-slate-700 font-manrope">
                Severity
              </label>
              <span className="text-sm font-bold text-emerald-600">{severity} / 10</span>
            </div>
            <input
              type="range"
              min="1"
              max="10"
              value={severity}
              onChange={(e) => setSeverity(parseInt(e.target.value))}
              className="w-full h-2 rounded-lg appearance-none cursor-pointer bg-gradient-to-r from-emerald-100 via-emerald-400 to-amber-500"
              style={{
                background: `linear-gradient(to right, #10b981 0%, #f59e0b 100%)`,
              }}
            />
            <div className="flex justify-between text-xs text-slate-500 font-medium font-manrope">
              <span>Mild</span>
              <span>Severe</span>
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <label className="block text-sm font-semibold text-slate-700 font-manrope">
              Additional Notes
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any other details you want to log..."
              className="w-full p-4 text-sm bg-surface-container-low border-none rounded-xl text-slate-700 placeholder:text-slate-400 focus:ring-2 focus:ring-emerald-500/20 focus:bg-white transition-colors"
              rows={3}
            />
          </div>
        </div>

        <div className="p-6 bg-white border-t border-slate-100">
          <button
            onClick={handleSave}
            disabled={saving || selectedSymptoms.length === 0}
            className="w-full py-3.5 font-bold text-white transition-transform rounded-xl bg-gradient-to-r from-emerald-700 to-emerald-500 hover:scale-[0.98] disabled:opacity-50 disabled:hover:scale-100 font-manrope shadow-lg shadow-emerald-500/20"
          >
            {saving ? 'Saving...' : 'Save Entry'}
          </button>
        </div>
      </div>
    </div>
  );
}
