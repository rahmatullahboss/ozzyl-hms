import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, UserPlus, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useCreateProxyInvite } from '../../hooks/useFamilyGraph';

interface ProxyInviteModalProps {
  onClose: () => void;
}

const RELATIONSHIPS = [
  { value: 'child', label: 'Child' },
  { value: 'parent', label: 'Parent' },
  { value: 'spouse', label: 'Spouse' },
  { value: 'sibling', label: 'Sibling' },
  { value: 'caregiver', label: 'Caregiver' },
  { value: 'legal_guardian', label: 'Legal Guardian' },
  { value: 'grandparent', label: 'Grandparent' },
  { value: 'grandchild', label: 'Grandchild' },
  { value: 'other', label: 'Other' },
];

export const ProxyInviteModal: React.FC<ProxyInviteModalProps> = ({ onClose }) => {
  const { t } = useTranslation('patients');
  const { mutate: createInvite, isPending } = useCreateProxyInvite();

  const [uhid, setUhid] = useState('');
  const [relationship, setRelationship] = useState(RELATIONSHIPS[0].value);
  const [notes, setNotes] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!uhid.trim()) {
      toast.error('Patient UHID is required');
      return;
    }

    createInvite(
      { uhid: uhid.trim(), relationship, notes: notes.trim() },
      {
        onSuccess: () => {
          toast.success('Invite sent successfully');
          onClose();
        },
        onError: (err: any) => {
          toast.error(err.message || 'Failed to send invite');
        },
      }
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in">
      <div className="bg-white rounded-3xl w-full max-w-md overflow-hidden shadow-2xl animate-in slide-in-from-bottom-8">
        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-teal-100 flex justify-center items-center">
              <UserPlus className="w-5 h-5 text-teal-600" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-800">Add Family Member</h2>
              <p className="text-xs text-slate-500">Send a secure health record invite</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-full transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">Patient UHID</label>
            <input
              type="text"
              required
              value={uhid}
              onChange={(e) => setUhid(e.target.value)}
              placeholder="e.g. UHID-12345"
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100 transition-shadow"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">Relationship to you</label>
            <select
              value={relationship}
              onChange={(e) => setRelationship(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100 transition-shadow appearance-none"
            >
              {RELATIONSHIPS.map((rel) => (
                <option key={rel.value} value={rel.value}>
                  {rel.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">Message (Optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Hi, please accept my proxy request..."
              rows={3}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100 transition-shadow"
            />
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={isPending || !uhid.trim()}
              className="w-full relative flex justify-center items-center bg-slate-900 text-white font-semibold py-3.5 rounded-xl disabled:opacity-50 hover:bg-slate-800 transition-colors"
            >
              {isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Send Invite'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
