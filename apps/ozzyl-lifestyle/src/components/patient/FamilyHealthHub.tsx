import React, { useState } from 'react';
import { UserPlus, Activity, Calendar, FileText, Check, X } from 'lucide-react';
import { ProxyInviteModal } from './ProxyInviteModal';
import { useProxyInvites, useRespondProxyInvite } from '../../hooks/useFamilyGraph';
import toast from 'react-hot-toast';

interface FamilyMember {
  id: string;
  name: string;
  relation: string;
  status: 'healthy' | 'warning' | 'critical';
  avatar: string;
  updateText: string;
  appointments: { type: string; time: string; doctor: string }[];
}

const MOCK_FAMILY: FamilyMember[] = [
  {
    id: '1',
    name: 'Rahim (Self)',
    relation: 'Primary',
    status: 'healthy',
    avatar: 'https://ui-avatars.com/api/?name=Rahim&background=2DD4BF&color=fff',
    updateText: 'All vitals normal. Sleep has improved.',
    appointments: [{ type: 'Cardiology Follow-up', time: 'Tomorrow, 10:00 AM', doctor: 'Dr. Hasan' }]
  },
  {
    id: '2',
    name: 'Sarah',
    relation: 'Daughter',
    status: 'warning',
    avatar: 'https://ui-avatars.com/api/?name=Sarah&background=f43f5e&color=fff',
    updateText: 'Due for vaccination.',
    appointments: [{ type: 'Pediatrician', time: 'Oct 20, 3:00 PM', doctor: 'Dr. Amina' }]
  },
  {
    id: '3',
    name: 'Abul',
    relation: 'Father',
    status: 'healthy',
    avatar: 'https://ui-avatars.com/api/?name=Abul&background=3b82f6&color=fff',
    updateText: 'Blood pressure is stable.',
    appointments: []
  }
];

export const FamilyHealthHub: React.FC = () => {
  const [activeMemberId, setActiveMemberId] = useState<string>(MOCK_FAMILY[0].id);
  const [showInviteModal, setShowInviteModal] = useState(false);

  const { data: invitesData, isLoading: isLoadingInvites } = useProxyInvites();
  const { mutate: respondInvite, isPending: isResponding } = useRespondProxyInvite();

  const handleRespond = (id: number, action: 'accept' | 'decline') => {
    respondInvite(
      { id, action },
      {
        onSuccess: () => {
          toast.success(`Invite ${action}ed`);
        },
        onError: () => {
          toast.error(`Failed to ${action} invite`);
        },
      }
    );
  };

  const activeMember = MOCK_FAMILY.find(m => m.id === activeMemberId) || MOCK_FAMILY[0];

  return (
    <div className="w-full max-w-md mx-auto min-h-screen bg-slate-50 flex flex-col font-sans relative">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-teal-100/40 via-slate-50 to-emerald-50/30 -z-10" />
      
      <header className="p-6 pt-10">
        <h1 className="text-2xl font-semibold text-slate-800">Family Health Hub</h1>
        <p className="text-sm text-slate-500 mt-1">Manage health for your loved ones</p>
      </header>

      <main className="flex-1 p-6 space-y-8 pt-2">
        {/* Pending Invites */}
        {invitesData && invitesData.incoming.filter(i => i.status === 'pending').length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-amber-600 mb-3">Action Required: Pending Requests</h2>
            <div className="space-y-3">
              {invitesData.incoming
                .filter(i => i.status === 'pending')
                .map(invite => (
                  <div key={invite.id} className="p-4 bg-amber-50 rounded-2xl border border-amber-100 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-slate-800">
                        {invite.relationship.charAt(0).toUpperCase() + invite.relationship.slice(1)} request
                      </p>
                      <p className="text-xs text-slate-500">From User #{invite.inviter_auth_user_id}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleRespond(invite.id, 'accept')}
                        disabled={isResponding}
                        className="w-8 h-8 rounded-full bg-teal-100 text-teal-600 flex items-center justify-center hover:bg-teal-200 transition-colors"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleRespond(invite.id, 'decline')}
                        disabled={isResponding}
                        className="w-8 h-8 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center hover:bg-rose-200 transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* My Circle - Avatars */}
        <div>
          <h2 className="text-sm font-semibold text-slate-700 mb-4">My Circle</h2>
          <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide">
            {MOCK_FAMILY.map(member => (
              <button
                key={member.id}
                data-testid={`family-avatar-${member.id}`}
                onClick={() => setActiveMemberId(member.id)}
                className={`relative flex flex-col items-center gap-2 group transition-all shrink-0 ${
                  activeMemberId === member.id ? 'opacity-100 scale-105' : 'opacity-60 hover:opacity-100'
                }`}
              >
                <div className={`relative rounded-full p-0.5 ${activeMemberId === member.id ? 'bg-teal-500' : 'bg-transparent'}`}>
                  <img src={member.avatar} alt={member.name} className="w-16 h-16 rounded-full border-2 border-white shadow-sm" />
                  <div className={`absolute bottom-0 right-0 w-4 h-4 rounded-full border-2 border-white ${
                    member.status === 'healthy' ? 'bg-teal-500' : member.status === 'warning' ? 'bg-amber-500' : 'bg-rose-500'
                  }`} />
                </div>
                <span className="text-xs font-medium text-slate-700">{member.name.split(' ')[0]}</span>
              </button>
            ))}
            <button onClick={() => setShowInviteModal(true)} className="flex flex-col items-center gap-2 opacity-60 hover:opacity-100 shrink-0 group">
              <div className="w-16 h-16 rounded-full border-2 border-dashed border-slate-300 bg-slate-100 flex items-center justify-center text-slate-400 group-hover:bg-slate-200 transition-colors">
                <UserPlus className="w-6 h-6" />
              </div>
              <span className="text-xs font-medium text-slate-700">Add</span>
            </button>
          </div>
        </div>

        {/* At a Glance */}
        <div>
          <h2 className="text-sm font-semibold text-slate-700 mb-4">At a Glance - {activeMember.name}</h2>
          <div className="p-5 bg-white/60 backdrop-blur-xl rounded-3xl border border-white shadow-[0_8px_30px_rgb(0,0,0,0.04)] leading-relaxed">
            <div className="flex items-start gap-3">
              <Activity className="w-5 h-5 text-teal-500 shrink-0 mt-0.5" />
              <p className="text-sm text-slate-700">{activeMember.updateText}</p>
            </div>
            {activeMember.appointments.length > 0 ? (
              <div className="mt-4 pt-4 border-t border-slate-100/60">
                <p className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-3">Upcoming Appointments</p>
                {activeMember.appointments.map((appt, i) => (
                  <div key={i} className="flex items-center gap-3 bg-white/80 p-3 rounded-2xl mb-2">
                    <Calendar className="w-8 h-8 p-1.5 bg-teal-50 text-teal-600 rounded-xl" />
                    <div>
                      <p className="text-sm font-semibold text-slate-800">{appt.type}</p>
                      <p className="text-xs text-slate-500">{appt.time} • {appt.doctor}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-4 pt-4 border-t border-slate-100/60 flex items-center gap-3">
                <Calendar className="w-8 h-8 p-1.5 bg-slate-50 text-slate-400 rounded-xl" />
                <p className="text-sm text-slate-500">No upcoming appointments.</p>
              </div>
            )}
          </div>
        </div>
      </main>

      {showInviteModal && <ProxyInviteModal onClose={() => setShowInviteModal(false)} />}
    </div>
  );
};
