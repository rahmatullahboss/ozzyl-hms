import { useState } from 'react';
import { Clock, Loader2, Save, Stethoscope } from 'lucide-react';
import toast from 'react-hot-toast';
import { useApiMutation, useApiQuery, useQueryClient } from '../../hooks/useApiQuery';

type DoctorPresence = {
  doctorId: number;
  doctorName: string;
  specialty?: string | null;
  department?: string | null;
  date?: string | null;
  status: string;
  isAvailable: boolean;
  expectedArrivalTime?: string | null;
  delayMinutes?: number | null;
  publicMessage?: string | null;
  receptionNote?: string | null;
  reason?: string | null;
  source?: string | null;
  updatedAt?: string | null;
  updatedByName?: string | null;
};

type BoardResponse = { date: string; doctors: DoctorPresence[] };

type OverridePayload = {
  doctorId: number;
  status: string;
  expectedArrivalTime?: string;
  delayMinutes?: number;
  publicMessage?: string;
  receptionNote?: string;
  reason?: string;
};

const STATUS_OPTIONS = [
  ['available', 'Available'],
  ['on_the_way', 'On the way'],
  ['delayed', 'Delayed'],
  ['emergency_delay', 'Emergency delay'],
  ['not_coming', 'Not coming'],
  ['chamber_closed', 'Chamber closed'],
  ['serial_stopped', 'Stop serial'],
] as const;

function label(status: string) {
  return STATUS_OPTIONS.find(([value]) => value === status)?.[1] ?? status.replace(/_/g, ' ');
}

function badgeClass(status: string, isAvailable: boolean) {
  if (!isAvailable || ['not_coming', 'chamber_closed', 'serial_stopped'].includes(status)) return 'bg-red-100 text-red-700';
  if (['delayed', 'on_the_way', 'emergency_delay'].includes(status)) return 'bg-amber-100 text-amber-800';
  return 'bg-emerald-100 text-emerald-700';
}

export function ReceptionDoctorPresenceBoard() {
  const queryClient = useQueryClient();
  const [editingDoctorId, setEditingDoctorId] = useState<number | null>(null);
  const [status, setStatus] = useState('available');
  const [expectedArrivalTime, setExpectedArrivalTime] = useState('');
  const [delayMinutes, setDelayMinutes] = useState('');
  const [publicMessage, setPublicMessage] = useState('');
  const [receptionNote, setReceptionNote] = useState('');
  const [reason, setReason] = useState('');

  const boardQ = useApiQuery<BoardResponse>(['doctor-presence', 'today'], '/api/doctor-schedule/presence/today', {
    staleTime: 10 * 60_000,
  });

  const overrideMutation = useApiMutation<unknown, OverridePayload>(
    'put',
    (vars) => `/api/doctor-schedule/${vars.doctorId}/presence`,
    {
      onSuccess: () => {
        toast.success('Doctor status updated');
        setEditingDoctorId(null);
        queryClient.invalidateQueries({ queryKey: ['doctor-presence', 'today'] });
      },
      onError: () => toast.error('Failed to update doctor status'),
    },
  );

  const doctors = boardQ.data?.doctors ?? [];

  const beginEdit = (doctor: DoctorPresence) => {
    setEditingDoctorId(doctor.doctorId);
    setStatus(doctor.status || 'available');
    setExpectedArrivalTime(doctor.expectedArrivalTime ?? '');
    setDelayMinutes(doctor.delayMinutes ? String(doctor.delayMinutes) : '');
    setPublicMessage(doctor.publicMessage ?? '');
    setReceptionNote(doctor.receptionNote ?? '');
    setReason(doctor.reason ?? '');
  };

  const save = (doctorId: number) => {
    overrideMutation.mutate({
      doctorId,
      status,
      expectedArrivalTime: expectedArrivalTime || undefined,
      delayMinutes: delayMinutes ? Number(delayMinutes) : undefined,
      publicMessage: publicMessage || undefined,
      receptionNote: receptionNote || undefined,
      reason: reason || undefined,
    });
  };

  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text)]">
            <Stethoscope className="h-4 w-4 text-[var(--color-primary)]" />
            Doctor availability today
          </h2>
          <p className="text-xs text-[var(--color-text-muted)]">Reception can update arrival, delay, absence and serial status.</p>
        </div>
        {boardQ.isLoading ? <Loader2 className="h-4 w-4 animate-spin text-[var(--color-text-muted)]" /> : null}
      </div>

      <div className="grid gap-2 lg:grid-cols-2 xl:grid-cols-3">
        {doctors.map((doctor) => {
          const editing = editingDoctorId === doctor.doctorId;
          return (
            <div key={doctor.doctorId} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-[var(--color-text)]">{doctor.doctorName}</div>
                  <div className="truncate text-xs text-[var(--color-text-muted)]">{doctor.department ?? doctor.specialty ?? 'Department'}</div>
                </div>
                <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold ${badgeClass(doctor.status, doctor.isAvailable)}`}>
                  <Clock className="h-3 w-3" />
                  {label(doctor.status)}
                </span>
              </div>

              <div className="mt-2 space-y-1 text-xs text-[var(--color-text-muted)]">
                {doctor.expectedArrivalTime ? <div>ETA: {doctor.expectedArrivalTime}</div> : null}
                {doctor.delayMinutes ? <div>Delay: {doctor.delayMinutes} min</div> : null}
                {doctor.publicMessage ? <div className="text-[var(--color-text)]">{doctor.publicMessage}</div> : null}
                {doctor.receptionNote ? <div>Note: {doctor.receptionNote}</div> : null}
              </div>

              {editing ? (
                <div className="mt-3 grid gap-2">
                  <select value={status} onChange={(e) => setStatus(e.target.value)} className="input h-9 text-xs">
                    {STATUS_OPTIONS.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
                  </select>
                  <div className="grid grid-cols-2 gap-2">
                    <input type="time" value={expectedArrivalTime} onChange={(e) => setExpectedArrivalTime(e.target.value)} className="input h-9 text-xs" />
                    <input type="number" min={0} max={720} value={delayMinutes} onChange={(e) => setDelayMinutes(e.target.value)} className="input h-9 text-xs" placeholder="Delay min" />
                  </div>
                  <input value={publicMessage} onChange={(e) => setPublicMessage(e.target.value)} className="input h-9 text-xs" placeholder="Public message" maxLength={250} />
                  <input value={receptionNote} onChange={(e) => setReceptionNote(e.target.value)} className="input h-9 text-xs" placeholder="Reception note" maxLength={500} />
                  <input value={reason} onChange={(e) => setReason(e.target.value)} className="input h-9 text-xs" placeholder="Reason" maxLength={500} />
                  <div className="flex gap-2">
                    <button type="button" onClick={() => save(doctor.doctorId)} disabled={overrideMutation.isPending} className="btn-primary flex-1 text-xs">
                      <Save className="h-3.5 w-3.5" /> Save
                    </button>
                    <button type="button" onClick={() => setEditingDoctorId(null)} className="btn-ghost text-xs">Cancel</button>
                  </div>
                </div>
              ) : (
                <button type="button" onClick={() => beginEdit(doctor)} className="btn-ghost mt-3 w-full text-xs">Update status</button>
              )}
            </div>
          );
        })}
        {doctors.length === 0 && !boardQ.isLoading ? (
          <div className="rounded-lg border border-dashed border-[var(--color-border)] p-6 text-center text-sm text-[var(--color-text-muted)]">No doctors found</div>
        ) : null}
      </div>
    </section>
  );
}
