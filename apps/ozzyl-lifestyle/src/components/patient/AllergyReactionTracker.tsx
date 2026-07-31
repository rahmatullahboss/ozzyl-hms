import React, { useState } from 'react';
import { AlertCircle, AlertTriangle, Plus, ShieldCheck, X, Activity } from 'lucide-react';
import { useAdverseReactions, useLogAdverseReaction } from '../../hooks/usePatientWellness';
import { formatPatientDateMonthYear } from '../../lib/patientPortalUx';

export const AllergyReactionTracker: React.FC = () => {
  const { data, isLoading } = useAdverseReactions();
  const { mutate: logAdverseReaction, isPending } = useLogAdverseReaction();
  
  const [isAdding, setIsAdding] = useState(false);
  const [medicationName, setMedicationName] = useState('');
  const [reaction, setReaction] = useState('');
  const [severity, setSeverity] = useState<'mild' | 'moderate' | 'severe'>('moderate');

  const allergies = data?.adverse_reactions || [];

  const getSeverityColor = (sev: string) => {
    switch(sev.toLowerCase()) {
      case 'severe': return 'text-error bg-error-container';
      case 'high': return 'text-[#B3261E] bg-[#F9DEDC]';
      case 'moderate': 
      case 'medium': return 'text-[#935200] bg-[#FFDDAE]';
      case 'mild':
      case 'low': return 'text-primary bg-primary-container';
      default: return 'text-on-surface bg-surface-container';
    }
  };

  const handleSave = () => {
    if (!medicationName.trim() || !reaction.trim()) return;
    
    logAdverseReaction({
      medication_name: medicationName,
      reaction,
      severity
    }, {
      onSuccess: () => {
        setIsAdding(false);
        setMedicationName('');
        setReaction('');
        setSeverity('moderate');
      }
    });
  };

  return (
    <div className="bg-surface-container-lowest rounded-xl shadow-sm border border-surface-container overflow-hidden font-inter">
      <div className="p-5 border-b border-surface-container flex justify-between items-center bg-surface w-full">
        <div className="flex items-center gap-3">
          <div className="bg-error-container/50 p-2 rounded-lg text-error">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-manrope text-lg font-semibold text-on-surface">Allergies & Reactions</h2>
            <p className="text-xs text-on-surface-variant">Medical alert registry</p>
          </div>
        </div>
        <button 
          onClick={() => setIsAdding(!isAdding)}
          className={`p-2 rounded-full transition-colors ${
            isAdding ? "bg-surface-container-high text-on-surface" : "bg-primary-container text-on-primary-container hover:bg-primary hover:text-on-primary"
          }`}
        >
          {isAdding ? <X className="w-5 h-5" /> : <Plus className="w-5 h-5" />}
        </button>
      </div>

      {isAdding && (
         <div className="p-4 bg-surface-container-lowest border-b border-surface-container">
           <div className="flex flex-col gap-3">
             <input
               value={medicationName}
               onChange={(e) => setMedicationName(e.target.value)}
               placeholder="Allergen or Medication Name"
               className="w-full text-sm bg-surface p-3 rounded-lg border border-surface-container outline-none focus:border-primary"
             />
             <input
               value={reaction}
               onChange={(e) => setReaction(e.target.value)}
               placeholder="Reaction (e.g. Rash, Swelling)"
               className="w-full text-sm bg-surface p-3 rounded-lg border border-surface-container outline-none focus:border-primary"
             />
             <div className="flex gap-2">
               {['mild', 'moderate', 'severe'].map(s => (
                 <button
                   key={s}
                   onClick={() => setSeverity(s as any)}
                   className={`flex-1 py-2 rounded-lg text-xs font-semibold capitalize border transition-colors ${
                     severity === s 
                       ? "bg-primary text-on-primary border-primary" 
                       : "bg-surface text-on-surface-variant border-surface-container"
                   }`}
                 >
                   {s}
                 </button>
               ))}
             </div>
             <button
               onClick={handleSave}
               disabled={isPending || !medicationName.trim() || !reaction.trim()}
               className="w-full mt-2 bg-primary text-on-primary font-semibold text-sm py-3 rounded-xl hover:opacity-90 disabled:opacity-50"
             >
               {isPending ? "Saving..." : "Log Reaction"}
             </button>
           </div>
         </div>
      )}

      <div className="p-2 space-y-1 bg-surface-container-low min-h-[200px]">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center p-8 text-on-surface-variant">
            <Activity className="w-6 h-6 animate-spin mb-2" />
            <p className="text-sm">Loading allergies...</p>
          </div>
        ) : allergies.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-8 text-on-surface-variant">
            <ShieldCheck className="w-10 h-10 mb-2 opacity-50" />
            <p className="text-sm font-medium">No allergies logged</p>
          </div>
        ) : (
          allergies.map(allergy => (
            <div key={allergy.id} className="bg-surface p-4 rounded-xl flex justify-between items-center shadow-sm">
              <div className="flex flex-col gap-1">
                <span className="font-semibold text-on-surface text-base">{allergy.medication_name}</span>
                <span className="text-xs text-on-surface-variant flex items-center gap-1">
                  {allergy.reaction} • Logged {formatPatientDateMonthYear(allergy.created_at)}
                  {allergy.review_status === 'verified' && <ShieldCheck className="w-3 h-3 text-primary ml-1" />}
                </span>
              </div>
              <div className={`px-3 py-1 rounded-full text-xs font-bold capitalize ${getSeverityColor(allergy.severity)}`}>
                {allergy.severity}
              </div>
            </div>
          ))
        )}
      </div>
      
      <div className="p-4 bg-surface text-center">
        <button className="text-sm font-semibold text-primary flex items-center justify-center w-full gap-2">
          Verify List Accuracy
        </button>
      </div>
    </div>
  );
};
