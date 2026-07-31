import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Calendar, ChevronLeft, ChevronRight, DoorOpen, User } from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';
import { useApiQuery } from '../hooks/useApiQuery';
import { queryKeys } from '../lib/queryKeys';

interface OTBooking {
  id: number;
  patient_name?: string;
  patient_code?: string;
  booked_for_date: string;
  surgery_type?: string;
  anesthesia_type?: string;
  operation_status?: string;
  room_id?: number;
  room_name?: string;
  is_emergency?: number;
  surgeons?: { staff_name: string }[];
}

interface OTRoom {
  id: number;
  name: string;
  status: string;
}

const STATUS_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  scheduled:    { bg: 'bg-blue-100 dark:bg-blue-900/30',    border: 'border-blue-300 dark:border-blue-700',    text: 'text-blue-800 dark:text-blue-200' },
  pre_op:       { bg: 'bg-amber-100 dark:bg-amber-900/30',   border: 'border-amber-300 dark:border-amber-700',   text: 'text-amber-800 dark:text-amber-200' },
  in_progress:  { bg: 'bg-emerald-100 dark:bg-emerald-900/30', border: 'border-emerald-300 dark:border-emerald-700', text: 'text-emerald-800 dark:text-emerald-200' },
  completed:    { bg: 'bg-slate-100 dark:bg-slate-800',      border: 'border-slate-300 dark:border-slate-600',   text: 'text-slate-600 dark:text-slate-400' },
  cancelled:    { bg: 'bg-red-100 dark:bg-red-900/30',       border: 'border-red-300 dark:border-red-700',       text: 'text-red-600 dark:text-red-400' },
};

const HOURS = Array.from({ length: 12 }, (_, i) => i + 7); // 7 AM to 6 PM

function formatHour(h: number) {
  return `${h.toString().padStart(2, '0')}:00`;
}

function today() {
  return new Date().toISOString().split('T')[0];
}

function addDays(date: string, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function getWeekDates(date: string) {
  const d = new Date(date);
  const day = d.getDay();
  const start = new Date(d);
  start.setDate(d.getDate() - (day === 0 ? 6 : day - 1)); // Monday
  return Array.from({ length: 7 }, (_, i) => {
    const dd = new Date(start);
    dd.setDate(start.getDate() + i);
    return dd.toISOString().split('T')[0];
  });
}

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

export default function OTCalendar({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['tenantClinical']);
  const [selectedDate, setSelectedDate] = useState(today());
  const [view, setView] = useState<'day' | 'week'>('day');

  const { data: roomsData } = useApiQuery<{ rooms: OTRoom[] }>(
    queryKeys.ot.rooms(), '/api/ot/rooms');
  const rooms = roomsData?.rooms ?? [];

  const dateRange = view === 'day' ? [selectedDate] : getWeekDates(selectedDate);
  const startDate = dateRange[0];
  const endDate = dateRange[dateRange.length - 1];

  const { data: bookingsData, isLoading } = useApiQuery<{ bookings: OTBooking[] }>(
    queryKeys.ot.bookings({ date: startDate, endDate }),
    `/api/ot/bookings?date=${startDate}&limit=200`,
  );
  const bookings = bookingsData?.bookings ?? [];

  const bookingsByRoomAndDate = useMemo(() => {
    const map = new Map<string, OTBooking[]>();
    for (const b of bookings) {
      const key = `${b.room_id ?? 'unassigned'}_${b.booked_for_date}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(b);
    }
    return map;
  }, [bookings]);

  const navigate = (dir: number) => {
    if (view === 'day') {
      setSelectedDate(addDays(selectedDate, dir));
    } else {
      setSelectedDate(addDays(selectedDate, dir * 7));
    }
  };

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">

        {/* Header */}
        <div className="page-header">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-blue-500/20">
              <Calendar className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="page-title">{t('otCalendar.title')}</h1>
              <p className="section-subtitle">{t('otCalendar.subtitle')}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center rounded-lg border border-[var(--color-border)] overflow-hidden">
              <button onClick={() => setView('day')} className={`px-3 py-1.5 text-xs font-medium ${view === 'day' ? 'bg-[var(--color-primary)] text-white' : 'hover:bg-[var(--color-border-light)]'}`}>{t('otCalendar.day')}</button>
              <button onClick={() => setView('week')} className={`px-3 py-1.5 text-xs font-medium ${view === 'week' ? 'bg-[var(--color-primary)] text-white' : 'hover:bg-[var(--color-border-light)]'}`}>{t('otCalendar.week')}</button>
            </div>
          </div>
        </div>

        {/* Date Navigation */}
        <div className="card p-3 flex items-center justify-between">
          <button onClick={() => navigate(-1)} className="btn-ghost p-1.5">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-3">
            <input
              type="date"
              value={selectedDate}
              onChange={e => setSelectedDate(e.target.value)}
              className="input py-1.5"
            />
            <button onClick={() => setSelectedDate(today())} className="btn-ghost text-xs">{t('otCalendar.today')}</button>
          </div>
          <button onClick={() => navigate(1)} className="btn-ghost p-1.5">
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>

        {/* Timeline Grid */}
        {view === 'day' ? (
          <DayView
            date={selectedDate}
            rooms={rooms}
            bookings={bookings}
            isLoading={isLoading}
          />
        ) : (
          <WeekView
            dates={dateRange}
            rooms={rooms}
            bookingsByRoomAndDate={bookingsByRoomAndDate}
            isLoading={isLoading}
          />
        )}
      </div>
    </DashboardLayout>
  );
}

function DayView({ rooms, bookings, isLoading }: {
  date: string; rooms: OTRoom[]; bookings: OTBooking[]; isLoading: boolean;
}) {
  const { t } = useTranslation(['tenantClinical']);
  const bookingsByRoom = useMemo(() => {
    const map = new Map<number, OTBooking[]>();
    for (const b of bookings) {
      const roomId = b.room_id ?? 0;
      if (!map.has(roomId)) map.set(roomId, []);
      map.get(roomId)!.push(b);
    }
    return map;
  }, [bookings]);

  if (isLoading) {
    return <div className="card p-5"><div className="skeleton h-64 w-full" /></div>;
  }

  return (
    <div className="card overflow-x-auto">
      <table className="w-full min-w-[800px]">
        <thead>
          <tr className="border-b border-[var(--color-border)]">
            <th className="p-3 text-left text-xs font-semibold text-[var(--color-text-muted)] w-20">{t('otCalendar.time')}</th>
            {rooms.map(room => (
              <th key={room.id} className="p-3 text-left text-xs font-semibold text-[var(--color-text-muted)]">
                <div className="flex items-center gap-1.5">
                  <DoorOpen className="w-3.5 h-3.5" />
                  {room.name}
                </div>
              </th>
            ))}
            <th className="p-3 text-left text-xs font-semibold text-[var(--color-text-muted)]">{t('otCalendar.unassigned')}</th>
          </tr>
        </thead>
        <tbody>
          {HOURS.map(hour => (
            <tr key={hour} className="border-b border-[var(--color-border)] last:border-0">
              <td className="p-2 text-xs font-data text-[var(--color-text-muted)] align-top">
                {formatHour(hour)}
              </td>
              {rooms.map(room => {
                const roomBookings = (bookingsByRoom.get(room.id) ?? []).filter(b => {
                  const h = parseInt(b.booked_for_date.slice(11, 13) || '9');
                  return h === hour;
                });
                return (
                  <td key={room.id} className="p-1 align-top">
                    {roomBookings.map(b => (
                      <BookingCard key={b.id} booking={b} />
                    ))}
                  </td>
                );
              })}
              <td className="p-1 align-top">
                {(bookingsByRoom.get(0) ?? []).filter(b => {
                  const h = parseInt(b.booked_for_date.slice(11, 13) || '9');
                  return h === hour;
                }).map(b => (
                  <BookingCard key={b.id} booking={b} />
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function WeekView({ dates, rooms, bookingsByRoomAndDate, isLoading }: {
  dates: string[]; rooms: OTRoom[]; bookingsByRoomAndDate: Map<string, OTBooking[]>; isLoading: boolean;
}) {
  const { t } = useTranslation(['tenantClinical']);
  if (isLoading) {
    return <div className="card p-5"><div className="skeleton h-64 w-full" /></div>;
  }

  return (
    <div className="card overflow-x-auto">
      <table className="w-full min-w-[1000px]">
        <thead>
          <tr className="border-b border-[var(--color-border)]">
            <th className="p-3 text-left text-xs font-semibold text-[var(--color-text-muted)] w-24">{t('otCalendar.room')}</th>
            {dates.map((date, i) => (
              <th key={date} className="p-3 text-left text-xs font-semibold text-[var(--color-text-muted)]">
                <div>{t(`otCalendar.dayShort.${DAY_KEYS[i]}`)}</div>
                <div className="font-data text-[var(--color-text-muted)]">{date.slice(5)}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rooms.map(room => (
            <tr key={room.id} className="border-b border-[var(--color-border)] last:border-0">
              <td className="p-2 text-xs font-medium align-top">
                <div className="flex items-center gap-1.5">
                  <DoorOpen className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />
                  {room.name}
                </div>
              </td>
              {dates.map(date => {
                const key = `${room.id}_${date}`;
                const dayBookings = bookingsByRoomAndDate.get(key) ?? [];
                return (
                  <td key={date} className="p-1 align-top">
                    {dayBookings.length > 0 ? (
                      <div className="space-y-1">
                        {dayBookings.map(b => (
                          <BookingCard key={b.id} booking={b} compact />
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-[var(--color-text-muted)]">—</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BookingCard({ booking, compact }: { booking: OTBooking; compact?: boolean }) {
  const status = booking.operation_status || 'scheduled';
  const colors = STATUS_COLORS[status] ?? STATUS_COLORS.scheduled;
  const surgeon = booking.surgeons?.[0]?.staff_name;

  return (
    <div className={`rounded-lg border p-2 ${colors.bg} ${colors.border} ${colors.text} ${compact ? 'text-xs' : 'text-sm'} transition-all hover:shadow-sm cursor-pointer`}>
      <div className="flex items-center gap-1">
        {booking.is_emergency ? <span className="text-red-500 text-xs">⚡</span> : null}
        <span className="font-medium truncate">{booking.patient_name ?? booking.patient_code ?? `#${booking.id}`}</span>
      </div>
      {!compact && (
        <div className="mt-1 space-y-0.5 text-xs opacity-80">
          {booking.surgery_type && <p>{booking.surgery_type}</p>}
          {surgeon && (
            <p className="flex items-center gap-1">
              <User className="w-3 h-3" />
              {surgeon}
            </p>
          )}
          {booking.anesthesia_type && <p>{booking.anesthesia_type}</p>}
        </div>
      )}
    </div>
  );
}
