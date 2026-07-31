import { useState } from 'react';
import { useApiMutation, useQueryClient } from '../../hooks/useApiQuery';
import { api } from '../../lib/apiClient';
import toast from 'react-hot-toast';
import { queryKeys } from '../../lib/queryKeys';
import { Plus, Pencil, Trash2 } from 'lucide-react';

interface Shift {
  id: number;
  dayOfWeek: number;
  day_of_week?: number;
  shiftName: string;
  shift_name?: string;
  startTime: string;
  start_time?: string;
  endTime: string;
  end_time?: string;
}

interface Props {
  doctorId: number;
  initialShifts: Shift[];
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SHIFT_COLORS: Record<string, string> = {
  Morning: 'bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-900/30 dark:border-emerald-800 dark:text-emerald-400',
  Evening: 'bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-900/30 dark:border-amber-800 dark:text-amber-400',
  Night: 'bg-indigo-50 border-indigo-200 text-indigo-700 dark:bg-indigo-900/30 dark:border-indigo-800 dark:text-indigo-400',
};

export function ScheduleGrid({ doctorId, initialShifts }: Props) {
  const qc = useQueryClient();
  const [shifts, setShifts] = useState<Shift[]>(
    initialShifts.map(s => ({
      ...s,
      dayOfWeek: s.dayOfWeek ?? s.day_of_week ?? 0,
      shiftName: s.shiftName ?? s.shift_name ?? '',
      startTime: s.startTime ?? s.start_time ?? '',
      endTime: s.endTime ?? s.end_time ?? '',
    })),
  );
  const [editing, setEditing] = useState<{ day: number; shift?: Shift } | null>(null);

  const addShift = useApiMutation<unknown, { dayOfWeek: number; shiftName: string; startTime: string; endTime: string }>(
    'post',
    () => `/api/doctor-schedule/${doctorId}/schedule`,
    {
      onSuccess: () => {
        toast.success('Shift added');
        qc.invalidateQueries({ queryKey: queryKeys.doctors.all });
      },
      onError: () => toast.error('Failed to add shift'),
    },
  );

  const updateShiftDirect = (
    shiftId: number,
    body: { shiftName?: string; startTime?: string; endTime?: string },
  ) => {
    return api.put(`/api/doctor-schedule/${doctorId}/schedule/${shiftId}`, body)
      .then(() => {
        toast.success('Shift updated');
        qc.invalidateQueries({ queryKey: queryKeys.doctors.all });
      })
      .catch(() => toast.error('Failed to update shift'));
  };

  const deleteShift = useApiMutation<unknown, number>(
    'delete',
    (id: number) => `/api/doctor-schedule/${doctorId}/schedule/${id}`,
    {
      onSuccess: () => {
        toast.success('Shift removed');
        qc.invalidateQueries({ queryKey: queryKeys.doctors.all });
      },
      onError: () => toast.error('Failed to remove shift'),
    },
  );

  const handleSave = (shift: Partial<Shift>) => {
    if (!editing) return;
    if (shift.id) {
      // Update existing shift - capture previous value for rollback on failure
      const previousShift = shifts.find(s => s.id === shift.id);
      // Optimistic update: write new value first
      setShifts(prev =>
        prev.map(s => (s.id === shift.id ? { ...s, ...(shift as Shift) } : s)),
      );
      updateShiftDirect(shift.id, {
        shiftName: shift.shiftName,
        startTime: shift.startTime,
        endTime: shift.endTime,
      })
        .catch(() => {
          // Rollback to the previous value if the API rejected
          if (previousShift) {
            setShifts(prev =>
              prev.map(s => (s.id === shift.id ? previousShift : s)),
            );
          }
        });
    } else {
      // Add new shift - use a negative temp id and capture the previous list for rollback
      const tempId = -Date.now();
      const previousList = shifts;
      setShifts(prev => [
        ...prev,
        { id: tempId, dayOfWeek: editing.day, ...shift } as Shift,
      ]);
      addShift.mutate(
        {
          dayOfWeek: editing.day,
          shiftName: shift.shiftName!,
          startTime: shift.startTime!,
          endTime: shift.endTime!,
        },
        {
          onError: () => {
            // Rollback: drop the optimistic row
            setShifts(previousList);
          },
        },
      );
    }
    setEditing(null);
  };

  const handleDelete = (shiftId: number) => {
    if (confirm('Remove this shift?')) {
      deleteShift.mutate(shiftId);
      setShifts(prev => prev.filter(s => s.id !== shiftId));
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-7 gap-2">
        {DAYS.map((day, idx) => (
          <div key={day} className="card p-2 min-h-[130px]">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-[var(--color-text-muted)]">{day}</span>
              <button
                onClick={() => setEditing({ day: idx })}
                className="btn-ghost !p-1 hover:text-[var(--color-primary)]"
                title="Add shift"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="space-y-1.5">
              {shifts
                .filter(s => (s.dayOfWeek ?? s.day_of_week) === idx)
                .map(s => (
                  <div
                    key={s.id}
                    className={`text-xs p-1.5 rounded border group ${
                      SHIFT_COLORS[s.shiftName] ?? 'bg-gray-50 border-gray-200 text-gray-600'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{s.shiftName}</span>
                      <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => setEditing({ day: idx, shift: s })}
                          className="p-0.5 hover:text-blue-600 rounded"
                          title="Edit"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => handleDelete(s.id)}
                          className="p-0.5 hover:text-red-600 rounded"
                          title="Delete"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                    <div className="text-[10px] opacity-70 mt-0.5">
                      {(s.startTime ?? s.start_time)?.slice(0, 5)}–{(s.endTime ?? s.end_time)?.slice(0, 5)}
                    </div>
                  </div>
                ))}
              {shifts.filter(s => (s.dayOfWeek ?? s.day_of_week) === idx).length === 0 && (
                <p className="text-[10px] text-[var(--color-text-muted)] text-center mt-2">—</p>
              )}
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <ShiftEditor
          shift={editing.shift}
          onSave={handleSave}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function ShiftEditor({
  shift,
  onSave,
  onClose,
}: {
  shift?: Shift;
  onSave: (s: Partial<Shift>) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(shift?.shiftName ?? 'Morning');
  const [start, setStart] = useState(shift?.startTime ?? shift?.start_time ?? '09:00');
  const [end, setEnd] = useState(shift?.endTime ?? shift?.end_time ?? '13:00');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="bg-[var(--color-bg-card)] rounded-xl p-6 w-80 shadow-xl border border-[var(--color-border)]">
        <h3 className="text-base font-semibold mb-4 text-[var(--color-text-primary)]">
          {shift?.id ? 'Edit Shift' : 'Add Shift'}
        </h3>
        <div className="space-y-3">
          <div>
            <label className="label text-xs">Shift Name</label>
            <select
              value={name}
              onChange={e => setName(e.target.value)}
              className="input"
            >
              <option>Morning</option>
              <option>Evening</option>
              <option>Night</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label text-xs">Start</label>
              <input
                type="time"
                value={start}
                onChange={e => setStart(e.target.value)}
                className="input"
              />
            </div>
            <div>
              <label className="label text-xs">End</label>
              <input
                type="time"
                value={end}
                onChange={e => setEnd(e.target.value)}
                className="input"
              />
            </div>
          </div>
        </div>
        <div className="flex gap-3 mt-6">
          <button
            onClick={() => onSave({ id: shift?.id, shiftName: name, startTime: start, endTime: end })}
            className="btn-primary flex-1 text-sm"
          >
            Save
          </button>
          <button onClick={onClose} className="btn-secondary text-sm">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
