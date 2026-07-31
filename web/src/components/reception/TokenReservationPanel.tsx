import { useState } from 'react';
import { X, Plus, Trash2, Hash, Repeat, CalendarRange } from 'lucide-react';
import toast from 'react-hot-toast';
import { useApiQuery, useApiMutation, useQueryClient } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import { getTodayGMT6 } from '../../lib/date-utils';

interface Doctor {
  id: number;
  name: string;
  specialty?: string;
}

interface TokenReservation {
  id: number;
  doctor_id: number | null;
  doctor_name?: string | null;
  reservation_date: string;
  end_date?: string | null;
  token_from: number;
  token_to: number;
  label?: string | null;
  is_active: number;
}

type DurationMode = 'single' | 'range' | 'always';

// Sentinel end_date the backend uses for "Always / indefinite" reservations.
const ALWAYS_END_DATE = '2099-12-31';

export function isAlwaysEnd(endDate?: string | null): boolean {
  return !endDate || endDate === ALWAYS_END_DATE;
}

export function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetweenInclusive(startISO: string, endISO: string): number {
  const start = new Date(`${startISO}T00:00:00Z`).getTime();
  const end = new Date(`${endISO}T00:00:00Z`).getTime();
  return Math.max(1, Math.round((end - start) / 86_400_000) + 1);
}

interface Props {
  doctors: Doctor[];
  onClose: () => void;
}

export default function TokenReservationPanel({ doctors, onClose }: Props) {
  const queryClient = useQueryClient();
  const [date, setDate] = useState(getTodayGMT6());
  const [doctorId, setDoctorId] = useState<number | ''>('');
  const [showForm, setShowForm] = useState(false);
  const [formDoctorId, setFormDoctorId] = useState<number | ''>('');
  const [formFrom, setFormFrom] = useState(1);
  const [formTo, setFormTo] = useState(10);
  const [formLabel, setFormLabel] = useState('');
  const [durationMode, setDurationMode] = useState<DurationMode>('single');
  const [formEndDate, setFormEndDate] = useState(() => addDaysISO(getTodayGMT6(), 6));

  const filters = { date, doctorId: doctorId ? String(doctorId) : '' };

  const { data, isLoading } = useApiQuery<{ reservations: TokenReservation[] }>(
    queryKeys.tokenReservations.list(filters),
    `/api/reception/token-reservations?date=${date}${doctorId ? `&doctorId=${doctorId}` : ''}`,
  );

  const createMutation = useApiMutation<{ id: number }, {
    doctorId: number | null;
    reservationDate: string;
    endDate: string | null;
    tokenFrom: number;
    tokenTo: number;
    label: string | null;
  }>(
    'post',
    '/api/reception/token-reservations',
    {
      onSuccess: () => {
        toast.success('Reservation created');
        queryClient.invalidateQueries({ queryKey: queryKeys.tokenReservations.all });
        setShowForm(false);
        setFormLabel('');
        setFormFrom(formTo + 1);
        setFormTo(formTo + 10);
      },
      onError: (err: Error) => toast.error(err?.message || 'Failed to create reservation'),
    },
  );

  const deleteMutation = useApiMutation<unknown, { id: number }>(
    'delete',
    (vars) => `/api/reception/token-reservations/${vars.id}`,
    {
      onSuccess: () => {
        toast.success('Reservation removed');
        queryClient.invalidateQueries({ queryKey: queryKeys.tokenReservations.all });
      },
    },
  );

  const reservations = data?.reservations ?? [];

  const handleCreate = () => {
    if (formFrom < 1 || formTo < formFrom) {
      toast.error('Invalid range');
      return;
    }
    let endDate: string | null;
    if (durationMode === 'single') {
      endDate = date;
    } else if (durationMode === 'always') {
      endDate = ALWAYS_END_DATE;
    } else {
      if (!formEndDate || formEndDate < date) {
        toast.error('End date must be on or after the start date');
        return;
      }
      endDate = formEndDate;
    }
    createMutation.mutate({
      doctorId: formDoctorId || null,
      reservationDate: date,
      endDate,
      tokenFrom: formFrom,
      tokenTo: formTo,
      label: formLabel || null,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div
        className="w-full max-w-md bg-[var(--color-bg)] shadow-xl h-full overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-[var(--color-bg)] border-b border-[var(--color-border)] p-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Hash className="w-5 h-5" /> Token Reservations
          </h2>
          <button onClick={onClose} className="p-1 hover:bg-[var(--color-bg-secondary)] rounded">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Filters */}
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-xs text-[var(--color-text-muted)] mb-1 block">Date</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-sm"
              />
            </div>
            <div className="flex-1">
              <label className="text-xs text-[var(--color-text-muted)] mb-1 block">Doctor</label>
              <select
                value={doctorId}
                onChange={(e) => setDoctorId(e.target.value ? Number(e.target.value) : '')}
                className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-sm"
              >
                <option value="">All Doctors</option>
                {doctors.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Reservation List */}
          <div className="space-y-2">
            {isLoading ? (
              <p className="text-sm text-[var(--color-text-muted)]">Loading...</p>
            ) : reservations.length === 0 ? (
              <p className="text-sm text-[var(--color-text-muted)]">No reservations for this date</p>
            ) : (
              reservations.map((r) => {
                const isAlways = isAlwaysEnd(r.end_date);
                const isRange = r.end_date && !isAlways && r.end_date !== r.reservation_date;
                return (
                  <div
                    key={r.id}
                    className="flex items-center justify-between p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)]"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono font-semibold text-[var(--color-primary)]">
                          #{r.token_from}–{r.token_to}
                        </span>
                        {r.label && (
                          <span className="text-xs px-2 py-0.5 rounded bg-violet-100 text-violet-700">
                            {r.label}
                          </span>
                        )}
                        {isAlways && (
                          <span
                            className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-indigo-100 text-indigo-700"
                            title="Repeats every day"
                          >
                            <Repeat className="w-3 h-3" aria-hidden="true" /> Always
                          </span>
                        )}
                        {isRange && (
                          <span
                            className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-sky-100 text-sky-700"
                            title={`Active ${r.reservation_date} → ${r.end_date}`}
                          >
                            <CalendarRange className="w-3 h-3" aria-hidden="true" />
                            {r.reservation_date} → {r.end_date}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-[var(--color-text-muted)] mt-1">
                        {r.doctor_name || 'All Doctors'} · {r.token_to - r.token_from + 1} tokens
                        {isRange && (
                          <> · {daysBetweenInclusive(r.reservation_date, r.end_date!)} day(s)</>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => deleteMutation.mutate({ id: r.id })}
                      className="p-1.5 text-red-500 hover:bg-red-50 rounded"
                      title="Remove"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                );
              })
            )}
          </div>

          {/* Add Form */}
          {showForm ? (
            <div className="p-3 rounded-lg border border-[var(--color-primary)] bg-[var(--color-bg)] space-y-3">
              <div>
                <label className="text-xs text-[var(--color-text-muted)] mb-1 block">Doctor</label>
                <select
                  value={formDoctorId}
                  onChange={(e) => setFormDoctorId(e.target.value ? Number(e.target.value) : '')}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-sm"
                >
                  <option value="">All Doctors</option>
                  {doctors.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-[var(--color-text-muted)] mb-1 block">Duration</label>
                <div className="grid grid-cols-3 gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-0.5">
                  {([
                    { value: 'single', label: 'Single day' },
                    { value: 'range', label: 'Date range' },
                    { value: 'always', label: 'Always' },
                  ] as Array<{ value: DurationMode; label: string }>).map((opt) => {
                    const active = durationMode === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => {
                          setDurationMode(opt.value);
                          if (opt.value === 'range' && (!formEndDate || formEndDate < date)) {
                            setFormEndDate(addDaysISO(date, 6));
                          }
                        }}
                        aria-pressed={active}
                        className={`px-2 py-1.5 text-xs font-medium rounded-md transition ${
                          active
                            ? 'bg-[var(--color-primary)] text-white shadow-sm'
                            : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
                        }`}
                      >
                        {opt.value === 'always' && <Repeat className="w-3 h-3 inline mr-1" aria-hidden="true" />}
                        {opt.value === 'range' && <CalendarRange className="w-3 h-3 inline mr-1" aria-hidden="true" />}
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">
                  {durationMode === 'single' && `Reservation for ${date} only`}
                  {durationMode === 'range' && `Reservation from ${date} until the end date`}
                  {durationMode === 'always' && 'Repeats every day until removed'}
                </p>
              </div>
              {durationMode === 'range' && (
                <div>
                  <label className="text-xs text-[var(--color-text-muted)] mb-1 block">End date</label>
                  <input
                    type="date"
                    min={date}
                    value={formEndDate}
                    onChange={(e) => setFormEndDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-sm"
                  />
                </div>
              )}
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-xs text-[var(--color-text-muted)] mb-1 block">From</label>
                  <input
                    type="number"
                    min={1}
                    value={formFrom}
                    onChange={(e) => setFormFrom(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-sm"
                  />
                </div>
                <div className="flex-1">
                  <label className="text-xs text-[var(--color-text-muted)] mb-1 block">To</label>
                  <input
                    type="number"
                    min={1}
                    value={formTo}
                    onChange={(e) => setFormTo(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-[var(--color-text-muted)] mb-1 block">Label (optional)</label>
                <input
                  type="text"
                  value={formLabel}
                  onChange={(e) => setFormLabel(e.target.value)}
                  placeholder="e.g., VIP, Staff, Referral"
                  className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-sm"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleCreate}
                  disabled={createMutation.isPending}
                  className="flex-1 px-3 py-2 bg-[var(--color-primary)] text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50"
                >
                  {createMutation.isPending ? 'Creating...' : 'Create'}
                </button>
                <button
                  onClick={() => setShowForm(false)}
                  className="px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowForm(true)}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 border-2 border-dashed border-[var(--color-border)] rounded-lg text-sm text-[var(--color-text-muted)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
            >
              <Plus className="w-4 h-4" /> Add Reservation
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
