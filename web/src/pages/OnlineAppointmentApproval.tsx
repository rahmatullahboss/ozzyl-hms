import { useState } from 'react';
import {
  CalendarCheck, Check, X, RefreshCw, Clock, User, Phone,
  Stethoscope, AlertCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import DashboardLayout from '../components/DashboardLayout';
import { useApiQuery, useApiMutation, useQueryClient } from '../hooks/useApiQuery';

interface PendingAppointment {
  id: number;
  appt_no: string;
  patient_id: number;
  patient_name: string;
  patient_code: string;
  patient_mobile: string;
  doctor_name: string;
  doctor_specialty: string;
  appt_date: string;
  appt_time: string | null;
  visit_type: string;
  chief_complaint: string | null;
  fee: number;
  source: string;
  created_at: string;
}

interface AppointmentsResponse {
  appointments: PendingAppointment[];
}

function fmt(date: string | null | undefined) {
  if (!date) return '—';
  const d = new Date(date);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function timeAgo(date: string): string {
  const mins = Math.floor((Date.now() - new Date(date).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function OnlineAppointmentApproval({ role = 'reception' }: { role?: string }) {
  const { t } = useTranslation(['appointments', 'common']);
  const queryClient = useQueryClient();
  const [processingId, setProcessingId] = useState<number | null>(null);

  const { data, isLoading } = useApiQuery<AppointmentsResponse>(
    ['appointments', 'pending_approval'],
    '/api/appointments?status=pending_approval',
  );

  const approveMutation = useApiMutation<unknown, { id: number; status: string }>(
    'put',
    (vars) => `/api/appointments/${vars.id}`,
    {
      onSuccess: (_, vars) => {
        toast.success(vars.status === 'scheduled' ? 'Appointment approved' : 'Appointment rejected');
        setProcessingId(null);
        queryClient.invalidateQueries({ queryKey: ['appointments', 'pending_approval'] });
      },
      onError: () => {
        toast.error('Action failed');
        setProcessingId(null);
      },
    },
  );

  const handleAction = (id: number, status: 'scheduled' | 'cancelled') => {
    setProcessingId(id);
    approveMutation.mutate({ id, status });
  };

  const pending = data?.appointments ?? [];

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-xl mx-auto">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-[var(--color-text-primary)] flex items-center gap-2">
              <CalendarCheck className="w-5 h-5 text-[var(--color-primary)]" />
              {t('onlineApproval', { defaultValue: 'Online Appointment Approval' })}
            </h1>
            <p className="text-sm text-[var(--color-text-muted)]">
              {t('onlineApprovalDesc', { defaultValue: 'Review and approve patient-booked appointments' })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {pending.length > 0 && (
              <span className="badge badge-warning">{pending.length} {t('pending', { defaultValue: 'pending' })}</span>
            )}
            <button
              onClick={() => queryClient.invalidateQueries({ queryKey: ['appointments', 'pending_approval'] })}
              className="btn-ghost"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => <div key={i} className="skeleton h-28 rounded-xl" />)}
          </div>
        ) : pending.length === 0 ? (
          <div className="card p-12 text-center">
            <CalendarCheck className="w-12 h-12 mx-auto text-[var(--color-text-muted)] opacity-30 mb-3" />
            <h3 className="text-lg font-semibold text-[var(--color-text)]">{t('noPending', { defaultValue: 'No Pending Requests' })}</h3>
            <p className="text-sm text-[var(--color-text-muted)] mt-1">
              {t('noPendingDesc', { defaultValue: 'All online appointment requests have been processed.' })}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {pending.map(appt => (
              <div key={appt.id} className="card p-4 border-l-4 border-l-amber-400 hover:shadow-md transition-shadow">
                <div className="flex flex-col sm:flex-row sm:items-center gap-4">

                  {/* Patient info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-sm font-bold text-[var(--color-text)]">{appt.patient_name}</h3>
                      <span className="text-xs font-mono text-[var(--color-primary)]">{appt.patient_code}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">
                        {t('pendingApproval', { defaultValue: 'Pending Approval' })}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-1 text-xs text-[var(--color-text-muted)]">
                      <span className="flex items-center gap-1">
                        <Phone className="w-3 h-3" /> {appt.patient_mobile}
                      </span>
                      <span className="flex items-center gap-1">
                        <Stethoscope className="w-3 h-3" /> {appt.doctor_name || '—'} {appt.doctor_specialty ? `(${appt.doctor_specialty})` : ''}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" /> {t('requested', { defaultValue: 'Requested' })} {timeAgo(appt.created_at)}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-2 text-sm">
                      <span className="font-medium">{fmt(appt.appt_date)}</span>
                      {appt.appt_time && <span className="text-[var(--color-text-muted)]">{appt.appt_time}</span>}
                      <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600 capitalize">{appt.visit_type}</span>
                      {appt.fee > 0 && <span className="text-xs text-emerald-600 font-medium">৳{appt.fee}</span>}
                    </div>
                    {appt.chief_complaint && (
                      <p className="text-xs text-[var(--color-text-muted)] mt-1.5 flex items-start gap-1">
                        <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
                        {appt.chief_complaint}
                      </p>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => handleAction(appt.id, 'scheduled')}
                      disabled={processingId === appt.id}
                      className="btn-primary text-sm px-4 py-2"
                    >
                      <Check className="w-4 h-4" />
                      {t('approve', { defaultValue: 'Approve' })}
                    </button>
                    <button
                      onClick={() => handleAction(appt.id, 'cancelled')}
                      disabled={processingId === appt.id}
                      className="btn-secondary text-sm px-4 py-2 text-red-600 border-red-200 hover:bg-red-50"
                    >
                      <X className="w-4 h-4" />
                      {t('reject', { defaultValue: 'Reject' })}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
