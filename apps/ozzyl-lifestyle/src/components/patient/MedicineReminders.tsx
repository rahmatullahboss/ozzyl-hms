import React, { useState } from 'react';
import { Pill, Plus, Check, X, Clock, Pill as PillIcon } from 'lucide-react';
import {
  useWellnessHub,
  useUpdateWellnessChecklist,
  useUpdateWellnessPreferences
} from '../../hooks/usePatientWellness';
import { formatPatientDateMonthYear } from '../../lib/patientPortalUx';

interface ParsedMedication {
  id: string;
  rawString: string;
  name: string;
  dosage: string;
  instructions: string;
  taken: boolean;
  timeSlot: 'morning' | 'afternoon' | 'evening';
}

export const MedicineReminders: React.FC = () => {
  const { data, isLoading } = useWellnessHub();
  const { mutate: updateChecklist } = useUpdateWellnessChecklist();
  const { mutate: updatePreferences, isPending: isUpdatingMeds } = useUpdateWellnessPreferences();
  
  const [isAdding, setIsAdding] = useState(false);
  const [newMedName, setNewMedName] = useState('');
  const [newMedDosage, setNewMedDosage] = useState('');
  const [newMedTimeSlot, setNewMedTimeSlot] = useState<'morning' | 'afternoon' | 'evening'>('morning');

  if (isLoading) {
    return <div className="p-8 text-center text-slate-500 animate-pulse">Loading reminders...</div>;
  }

  const rawReminders = data?.medication_reminders || [];
  const completedItems = new Set(data?.completed_items || []);

  const meds: ParsedMedication[] = rawReminders.map(raw => {
    // Expected format: "Med Name|Dosage|timeSlot"
    const parts = raw.split('|');
    const name = parts[0] || 'Unknown';
    const dosage = parts[1] || '';
    const timeSlotStr = (parts[2] || 'morning').toLowerCase();
    
    let timeSlot: 'morning' | 'afternoon' | 'evening' = 'morning';
    if (timeSlotStr === 'afternoon') timeSlot = 'afternoon';
    else if (timeSlotStr === 'evening') timeSlot = 'evening';
    
    return {
      id: raw,
      rawString: raw,
      name,
      dosage,
      instructions: '',
      taken: completedItems.has(raw),
      timeSlot
    };
  });

  const toggleMed = (rawString: string) => {
    const isCurrentlyCompleted = completedItems.has(rawString);
    let newCompletedItems: string[];
    
    if (isCurrentlyCompleted) {
      newCompletedItems = Array.from(completedItems).filter(item => item !== rawString);
    } else {
      newCompletedItems = [...Array.from(completedItems), rawString];
    }
    
    updateChecklist(newCompletedItems);
  };

  const handleAddMed = () => {
    if (!newMedName.trim() || !newMedDosage.trim()) return;
    
    const newMedString = `${newMedName.trim()}|${newMedDosage.trim()}|${newMedTimeSlot}`;
    const newReminders = [...rawReminders, newMedString];
    
    updatePreferences({
      medication_reminders: newReminders,
      daily_routines: data?.daily_routines || []
    }, {
      onSuccess: () => {
        setIsAdding(false);
        setNewMedName('');
        setNewMedDosage('');
        setNewMedTimeSlot('morning');
      }
    });
  };

  const getMedsBySlot = (slot: 'morning' | 'afternoon' | 'evening') => meds.filter(m => m.timeSlot === slot);

  const renderSlot = (title: string, slotMeds: ParsedMedication[]) => {
    if (slotMeds.length === 0) return null;
    return (
      <div className="mb-8">
        <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4 pl-2">{title}</h2>
        <div className="space-y-3">
          {slotMeds.map(med => (
            <button
              key={med.id}
              onClick={() => toggleMed(med.rawString)}
              className={`w-full p-4 rounded-3xl border transition-all flex items-center gap-4 text-left ${
                med.taken 
                  ? 'bg-teal-50 border-teal-100 shadow-sm' 
                  : 'bg-white border-slate-100 shadow-sm hover:border-teal-200'
              }`}
            >
              <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-colors ${
                med.taken ? 'bg-teal-500 text-white' : 'bg-slate-50 text-slate-400'
              }`}>
                {med.taken ? <Check className="w-5 h-5" /> : <Pill className="w-5 h-5" />}
              </div>
              <div className="flex-1">
                <h3 className={`font-semibold  ${med.taken ? 'text-teal-900' : 'text-slate-800'}`}>{med.name}</h3>
                <p className={`text-xs mt-0.5 ${med.taken ? 'text-teal-700/70' : 'text-slate-500'}`}>
                  {med.dosage}
                </p>
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  };

  const totalTaken = meds.filter(m => m.taken).length;
  const progressPercent = meds.length > 0 ? Math.round((totalTaken / meds.length) * 100) : 0;

  return (
    <div className="w-full max-w-md mx-auto bg-slate-50 flex flex-col font-sans relative pb-24 rounded-t-[2rem]">
      {/* Header */}
      <div className="bg-gradient-to-br from-teal-500 to-emerald-400 p-6 pt-12 pb-16 text-white rounded-b-[2.5rem]">
        <h1 className="text-2xl font-semibold mb-2">Medicine Reminders</h1>
        <p className="text-teal-50 text-sm opacity-90">Daily schedule for {formatPatientDateMonthYear(new Date())}</p>
        
        {/* Progress Mini Card */}
        <div className="mt-8 bg-white/20 backdrop-blur-md rounded-2xl p-4 flex items-center justify-between border border-white/20">
          <div>
            <p className="text-xs font-semibold text-teal-50 uppercase tracking-widest">Daily Progress</p>
            <p className="text-2xl font-bold mt-1">{totalTaken} <span className="text-base font-normal opacity-80">/ {meds.length} meds</span></p>
          </div>
          <div className="w-12 h-12 rounded-full border-4 border-teal-200/30 flex justify-center items-center relative">
            <svg className="absolute top-0 left-0 w-full h-full -rotate-90">
              <circle cx="24" cy="24" r="20" fill="none" stroke="currentColor" strokeWidth="4" className="text-white drop-shadow-sm opacity-90" strokeDasharray="125" strokeDashoffset={125 - (125 * progressPercent) / 100} strokeLinecap="round" />
            </svg>
            <span className="text-xs font-bold">{progressPercent}%</span>
          </div>
        </div>
      </div>

      <main className="flex-1 p-6 -mt-8 relative z-10 space-y-2">
        {isAdding && (
          <div className="bg-white p-5 rounded-3xl border border-slate-100 shadow-lg shadow-slate-200/50 mb-8 animate-in fly-in-from-top-4">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-semibold text-slate-800 flex items-center gap-2"><PillIcon className="w-4 h-4 text-teal-500" /> New Medication</h3>
              <button onClick={() => setIsAdding(false)} className="text-slate-400 hover:text-slate-700">
                <X className="w-5 h-5"/>
              </button>
            </div>
            
            <input
              value={newMedName}
              onChange={(e) => setNewMedName(e.target.value)}
              placeholder="Medication Name (e.g. Lisinopril)"
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100 mb-3"
            />
            
            <input
              value={newMedDosage}
              onChange={(e) => setNewMedDosage(e.target.value)}
              placeholder="Dosage & Instructions (e.g. 10mg after meal)"
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100 mb-3"
            />
            
            <div className="flex bg-slate-100 rounded-xl p-1 mb-4">
              {(['morning', 'afternoon', 'evening'] as const).map(slot => (
                <button
                  key={slot}
                  onClick={() => setNewMedTimeSlot(slot)}
                  className={`flex-1 flex justify-center py-2 text-xs font-semibold capitalize rounded-lg transition-colors ${
                    newMedTimeSlot === slot ? 'bg-white text-teal-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <Clock className="w-3 h-3 mr-1 inline" /> {slot}
                </button>
              ))}
            </div>
            
            <button
              onClick={handleAddMed}
              disabled={!newMedName.trim() || !newMedDosage.trim() || isUpdatingMeds}
              className="w-full bg-slate-800 text-white font-semibold py-3 rounded-xl disabled:opacity-50"
            >
              {isUpdatingMeds ? 'Saving...' : 'Add Medication'}
            </button>
          </div>
        )}

        {meds.length === 0 && !isAdding ? (
          <div className="text-center py-12 px-4">
            <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4 text-slate-300">
              <Pill className="w-8 h-8" />
            </div>
            <h3 className="text-slate-800 font-semibold mb-1">No Reminders Set</h3>
            <p className="text-sm text-slate-500">Tap the (+) button to add your medications and supplements to your daily schedule.</p>
          </div>
        ) : (
          <>
            {renderSlot('Morning', getMedsBySlot('morning'))}
            {renderSlot('Afternoon', getMedsBySlot('afternoon'))}
            {renderSlot('Evening', getMedsBySlot('evening'))}
          </>
        )}
      </main>

      {/* Floating Action Button */}
      <div className="absolute bottom-6 right-6 z-20">
        <button
          className={`${isAdding ? 'bg-rose-500 hover:bg-rose-600' : 'bg-slate-800 hover:bg-slate-700'} text-white px-6 py-4 rounded-full shadow-xl shadow-slate-800/20 transition-all flex items-center justify-center gap-2 group`}
          onClick={() => setIsAdding(!isAdding)}
        >
          {isAdding ? <X className="w-5 h-5 group-hover:scale-110 transition-transform" /> : <Plus className="w-5 h-5 group-hover:scale-110 transition-transform" />}
          <span className="font-semibold text-sm">{isAdding ? 'Cancel' : 'Add Med'}</span>
        </button>
      </div>
    </div>
  );
};
