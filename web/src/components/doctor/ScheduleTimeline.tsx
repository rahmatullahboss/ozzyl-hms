import { useMemo } from 'react';
import { CalendarDays } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { QueueItem } from './types';

const DEFAULT_SCHEDULE_HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17];

interface ScheduleTimelineProps {
  queue: QueueItem[];
}

export function ScheduleTimeline({ queue }: ScheduleTimelineProps) {
  const { t } = useTranslation('dashboard');

  const { hours, slotMap } = useMemo(() => {
    const map: Record<number, QueueItem[]> = {};
    const appointmentHours: number[] = [];
    queue.forEach(q => {
      if (!q.appt_time) return;
      const h = parseInt(q.appt_time.split(':')[0], 10);
      if (!Number.isFinite(h)) return;
      if (!map[h]) map[h] = [];
      map[h].push(q);
      appointmentHours.push(h);
    });

    if (appointmentHours.length === 0) {
      return { hours: DEFAULT_SCHEDULE_HOURS, slotMap: map };
    }
    const minHour = Math.max(0, Math.min(...appointmentHours) - 1);
    const maxHour = Math.min(23, Math.max(...appointmentHours) + 1);
    return {
      hours: Array.from({ length: maxHour - minHour + 1 }, (_, index) => minHour + index),
      slotMap: map,
    };
  }, [queue]);

  return (
    <div className="card p-5">
      <h2 className="font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
        <CalendarDays className="w-4 h-4 text-[var(--color-primary)]" />
        {t('todaySchedule')}
      </h2>
      <div className="overflow-x-auto">
        <div className="flex gap-2 min-w-max">
          {hours.map(h => {
            const slots = slotMap[h] ?? [];
            const label = `${h > 12 ? h - 12 : h}${h >= 12 ? 'PM' : 'AM'}`;
            return (
              <div key={h} className="flex flex-col items-center gap-1 w-24">
                <div className="text-xs text-[var(--color-text-muted)] font-medium">{label}</div>
                <div className={`w-full rounded-lg p-2 min-h-[60px] text-xs flex flex-col gap-1 transition-colors ${
                  slots.length > 0
                    ? 'bg-[var(--color-primary)]/10 border border-[var(--color-primary)]/30'
                    : 'border-2 border-dashed border-[var(--color-border)]'
                }`}>
                  {slots.length > 0 ? slots.map((s, i) => (
                    <div key={i} className="text-[var(--color-primary)] font-medium truncate">
                      #{s.token_no} {s.patient_name.split(' ')[0]}
                    </div>
                  )) : (
                    <span className="text-[var(--color-text-muted)] text-center mt-1 text-[10px]">{t('free')}</span>
                  )}
                </div>
                {slots.length > 0 && (
                  <div className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                    slots.some(s => s.status === 'in_progress') ? 'bg-blue-100 text-blue-600' :
                    slots.every(s => ['completed','paid'].includes(s.status)) ? 'bg-green-100 text-green-600' :
                    'bg-amber-100 text-amber-600'
                  }`}>
                    {slots.length} pt{slots.length > 1 ? 's' : ''}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
