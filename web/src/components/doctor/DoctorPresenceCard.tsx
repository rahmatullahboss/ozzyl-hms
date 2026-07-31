import { useEffect, useState } from 'react';
import { Clock, Loader2, Save, Stethoscope } from 'lucide-react';
import toast from 'react-hot-toast';
import { useApiMutation, useApiQuery, useQueryClient } from '../../hooks/useApiQuery';

const STATUS_OPTIONS = [
  { value: 'available', label: 'Available' },
  { value: 'on_the_way', label: 'On the way' },
  { value: 'delayed', label: 'Delayed' },
  { value: 'emergency_delay', label: 'Emergency delay' },
  { value: 'not_coming', label: 'Not coming' },
  { value: 'chamber_closed', label: 'Chamber closed' },
  { value: 'serial_stopped', label: 'Stop serial' },
] as const;

type PresenceStatus = typeof STATUS_OPTIONS[number]['value'];

type DoctorPresence = {
  doctorId: number;
  doctorName: string;
  date: string | null;
  status: PresenceStatus | string;
  isAvailable: boolean;
  startTime?: string | null;
  endTime?: string | null;
  expectedArrivalTime?: string | null;
  delayMinutes?: number | null;
  publicMessage?: string | null;
  receptionNote?: string | null;
  reason?: string | null;
  source?: string | null;
  updatedAt?: string | null;
  updatedByName?: string | null;
};

type PresenceResponse = { presence: DoctorPresence | null };

type PresencePayload = {
  status: PresenceStatus;
  expectedArrivalTime?: string;
  delayMinutes?: number;
  publicMessage?: string;
  receptionNote?: string;
  reason?: string;
};

function statusLabel(status?: string | null): string {
  return STATUS_OPTIONS.find((item) => item.value === status)?.label ?? 'Available';
}

function statusBadgeClass(status?: string | null): string {
  if (status === 'available' || status === 'scheduled') return 'bg-emerald-100 text-emerald-700';
  if (status === 'on_the_way' || status === 'delayed' || status === 'emergency_delay') return 'bg-amber-100 text-amber-800';
  return 'bg-red-100 text-red-700';
}

export function DoctorPresenceCard() {
  const queryClient = useQueryClient();
  const presenceQ = useApiQuery<PresenceResponse>(['doctor-presence', 'me'], '/api/doctor-schedule/me/presence', {
    refetchInterval: 30000,
  });

  const presence = presenceQ.data?.presence;
  const [status, setStatus] = useState<PresenceStatus>('available');
  const [expectedArrivalTime, setExpectedArrivalTime] = useState('');
  const [delayMinutes, setDelayMinutes] = useState('');
  const [publicMessage, setPublicMessage] = useState('');
  const [receptionNote, setReceptionNote] = useState('');
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (!presence) return;
    setStatus((presence.status as PresenceStatus) || 'available');
    setExpectedArrivalTime(presence.expectedArrivalTime ?? '');
    setDelayMinutes(presence.delayMinutes ? String(presence.delayMinutes) : '');
    setPublicMessage(presence.publicMessage ?? '');
    setReceptionNote(presence.receptionNote ?? '');
    setReason(presence.reason ?? '');
  }, [presence]);

  const mutation = useApiMutation<unknown, PresencePayload>('put', '/api/doctor-schedule/me/presence', {
    onSuccess: () => {
      toast.success('Doctor status updated');
      queryClient.invalidateQueries({ queryKey: ['doctor-presence', 'me'] });
      queryClient.invalidateQueries({ queryKey: ['doctor-presence', 'today'] });
    },
    onError: () => toast.error('Failed to update doctor status'),
  });

  const save = () => {
    mutation.mutate({
      status,
      expectedArrivalTime: expectedArrivalTime || undefined,
      delayMinutes: delayMinutes ? Number(delayMinutes) : undefined,
      publicMessage: publicMessage || undefined,
      receptionNote: receptionNote || undefined,
      reason: reason || undefined,
    });
  };

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-3 sm:p-4">
      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="w-8 h-8 rounded-lg bg-[var(--color-primary)]/10 text-[var(--color-primary)] flex items-center justify-center">
              <Stethoscope className="w-4 h-4" />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-[var(--color-text)]">Today's chamber status</h2>
              <p className="text-xs text-[var(--color-text-muted)]">Update arrival/late/absence so reception and queue screens stay aligned.</p>
            </div>
          </div>
          {presence?.updatedAt && (
            <p className="mt-2 text-xs text-[var(--color-text-muted)]">
              Last updated {presence.updatedAt}{presence.updatedByName ? ` by ${presence.updatedByName}` : ''}
            </p>
          )}
        </div>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${statusBadgeClass(status)}`}>
          <Clock className="w-3.5 h-3.5" />
          {statusLabel(status)}
        </span>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-12">
        <div className="lg:col-span-4">
          <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value as PresenceStatus)} className="input w-full">
            {STATUS_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </div>
        <div className="lg:col-span-2">
          <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">ETA</label>
          <input type="time" value={expectedArrivalTime} onChange={(e) => setExpectedArrivalTime(e.target.value)} className="input w-full" />
        </div>
        <div className="lg:col-span-2">
          <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Delay min</label>
          <input type="number" min={0} max={720} value={delayMinutes} onChange={(e) => setDelayMinutes(e.target.value)} className="input w-full" placeholder="0" />
        </div>
        <div className="lg:col-span-4">
          <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Public message</label>
          <input value={publicMessage} onChange={(e) => setPublicMessage(e.target.value)} className="input w-full" placeholder="Shown to reception/patient display" maxLength={250} />
        </div>
        <div className="lg:col-span-6">
          <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Reception note</label>
          <input value={receptionNote} onChange={(e) => setReceptionNote(e.target.value)} className="input w-full" placeholder="Internal instruction for reception" maxLength={500} />
        </div>
        <div className="lg:col-span-4">
          <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Reason</label>
          <input value={reason} onChange={(e) => setReason(e.target.value)} className="input w-full" placeholder="Emergency, OT, traffic, leave..." maxLength={500} />
        </div>
        <div className="lg:col-span-2 flex items-end">
          <button type="button" onClick={save} disabled={mutation.isPending} className="btn-primary w-full">
            {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
