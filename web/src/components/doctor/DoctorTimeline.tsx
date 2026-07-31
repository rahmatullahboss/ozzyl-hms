import { useMemo, useState } from 'react';
import { Calendar, Clock, ChevronLeft, ChevronRight, Plus, X, Trash2, Edit2, Check, XCircle, AlertCircle } from 'lucide-react';
import { getTodayGMT6, addDays, formatDateForAPI, getWeekDates } from '../../lib/date-utils';

type EventType = 'available' | 'on_leave' | 'not_coming' | 'scheduled' | 'emergency_leave';

interface ScheduleEvent {
  id?: number;
  date: string;
  type: EventType;
  startTime?: string;
  endTime?: string;
  reason?: string;
  isOverride?: boolean;
}

// For data coming from API (snake_case fields)
interface ApiScheduleEvent {
  id?: number;
  date: string;
  type: string;
  start_time?: string;
  end_time?: string;
  reason?: string;
}

// Unified event type for component internal use
type UnifiedEvent = ScheduleEvent & ApiScheduleEvent;

interface TimelineProps {
  doctorName: string;
  regularSchedule?: { days: string[]; startTime: string; endTime: string } | null;
  events?: (ScheduleEvent | ApiScheduleEvent)[];
  onAddEvent?: (event: Omit<ScheduleEvent, 'id'>) => void;
  onDeleteEvent?: (eventId: number) => void;
  onUpdateEvent?: (eventId: number, event: Partial<ScheduleEvent>) => void;
  readOnly?: boolean;
}

const EVENT_COLORS: Record<EventType, { bg: string; border: string; text: string; icon: typeof Check }> = {
  available: { bg: 'bg-emerald-50', border: 'border-emerald-300', text: 'text-emerald-700', icon: Check },
  on_leave: { bg: 'bg-amber-50', border: 'border-amber-300', text: 'text-amber-700', icon: Clock },
  not_coming: { bg: 'bg-rose-50', border: 'border-rose-300', text: 'text-rose-700', icon: XCircle },
  scheduled: { bg: 'bg-blue-50', border: 'border-blue-300', text: 'text-blue-700', icon: Clock },
  emergency_leave: { bg: 'bg-red-50', border: 'border-red-300', text: 'text-red-700', icon: AlertCircle },
};

const EVENT_LABELS: Record<EventType, string> = {
  available: 'Available',
  on_leave: 'On Leave',
  not_coming: 'Not Coming',
  scheduled: 'Scheduled',
  emergency_leave: 'Emergency Leave',
};

const DAYS_BN = { Sat: 'শনি', Sun: 'রবি', Mon: 'সোম', Tue: 'মঙ্গল', Wed: 'বুধ', Thu: 'বৃহঃ', Fri: 'শুক্র' };
const DAYS = ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

export function DoctorTimeline({
  doctorName,
  regularSchedule,
  events = [],
  onAddEvent,
  onDeleteEvent,
  onUpdateEvent,
  readOnly = false,
}: TimelineProps) {
  const [currentDate, setCurrentDate] = useState(getTodayGMT6());
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingEvent, setEditingEvent] = useState<ScheduleEvent | null>(null);
  const [formData, setFormData] = useState({
    date: getTodayGMT6(),
    type: 'on_leave' as EventType,
    startTime: '09:00',
    endTime: '17:00',
    reason: '',
  });

  // Calculate week dates for the current week view
  const weekDates = useMemo(() => getWeekDates(currentDate), [currentDate]);

  // Navigate weeks
  const prevWeek = () => {
    const d = new Date(currentDate);
    d.setDate(d.getDate() - 7);
    setCurrentDate(formatDateForAPI(d));
  };

  const nextWeek = () => {
    const d = new Date(currentDate);
    d.setDate(d.getDate() + 7);
    setCurrentDate(formatDateForAPI(d));
  };

  const goToToday = () => setCurrentDate(getTodayGMT6());

  // Get event for a specific date
  const getEventForDate = (date: string): UnifiedEvent | undefined => {
    return events.find(e => e.date === date) as UnifiedEvent | undefined;
  };

  // Get event property with fallback for snake_case
  const getEventType = (event: UnifiedEvent): EventType => {
    return (event.type as EventType) || 'available';
  };
  const getEventStartTime = (event: UnifiedEvent): string | undefined => {
    return event.startTime || event.start_time;
  };
  const getEventEndTime = (event: UnifiedEvent): string | undefined => {
    return event.endTime || event.end_time;
  };

  // Check if a day is in regular schedule
  const isDayInRegularSchedule = (dayName: string) => {
    if (!regularSchedule) return false;
    return regularSchedule.days.includes(dayName);
  };

  // Format date for display
  const formatDateDisplay = (dateStr: string) => {
    const d = new Date(dateStr);
    return {
      day: d.getDate(),
      month: d.toLocaleString('en-GB', { month: 'short' }),
      dayName: d.toLocaleString('en-GB', { weekday: 'short' }),
    };
  };

  // Check if date is today
  const isToday = (dateStr: string) => dateStr === getTodayGMT6();

  // Check if date is in the past
  const isPast = (dateStr: string) => dateStr < getTodayGMT6();

  // Get day name from date string
  const getDayName = (dateStr: string) => {
    const d = new Date(dateStr);
    return DAYS[d.getDay()];
  };

  const handleAddEvent = () => {
    if (!onAddEvent) return;
    onAddEvent({
      date: formData.date,
      type: formData.type,
      startTime: formData.type === 'available' || formData.type === 'scheduled' ? formData.startTime : undefined,
      endTime: formData.type === 'available' || formData.type === 'scheduled' ? formData.endTime : undefined,
      reason: formData.reason || undefined,
      isOverride: true,
    });
    setShowAddModal(false);
    setFormData({ date: getTodayGMT6(), type: 'on_leave', startTime: '09:00', endTime: '17:00', reason: '' });
  };

  const handleEditEvent = () => {
    if (!editingEvent || !editingEvent.id || !onUpdateEvent) return;
    onUpdateEvent(editingEvent.id, {
      date: formData.date,
      type: formData.type,
      startTime: formData.type === 'available' || formData.type === 'scheduled' ? formData.startTime : undefined,
      endTime: formData.type === 'available' || formData.type === 'scheduled' ? formData.endTime : undefined,
      reason: formData.reason || undefined,
    });
    setEditingEvent(null);
  };

  const openEditModal = (event: UnifiedEvent) => {
    setFormData({
      date: event.date,
      type: getEventType(event),
      startTime: getEventStartTime(event) || '09:00',
      endTime: getEventEndTime(event) || '17:00',
      reason: event.reason || '',
    });
    setEditingEvent(event);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="font-semibold text-[var(--color-text-primary)]">
            {doctorName} - Schedule Timeline
          </h3>
          {!readOnly && (
            <button
              onClick={() => setShowAddModal(true)}
              className="btn-primary btn-sm"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Event
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={prevWeek} className="btn-ghost p-1.5" aria-label="Previous week">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button onClick={goToToday} className="btn-secondary btn-sm">
            Today
          </button>
          <button onClick={nextWeek} className="btn-ghost p-1.5" aria-label="Next week">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Regular Schedule Info */}
      {regularSchedule && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3 text-sm">
          <div className="flex items-center gap-2 mb-2">
            <Calendar className="w-4 h-4 text-[var(--color-primary)]" />
            <span className="font-medium">Regular Schedule:</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[var(--color-text-muted)]">Days:</span>
            {DAYS.map(day => (
              <span
                key={day}
                className={`px-2 py-0.5 rounded text-xs font-medium ${
                  regularSchedule.days.includes(day)
                    ? 'bg-[var(--color-primary)] text-white'
                    : 'bg-gray-100 text-gray-400'
                }`}
              >
                {DAYS_BN[day as keyof typeof DAYS_BN]}
              </span>
            ))}
            <span className="text-[var(--color-text-muted)] ml-2">Time:</span>
            <span className="font-mono text-xs">{regularSchedule.startTime} - {regularSchedule.endTime}</span>
          </div>
        </div>
      )}

      {/* Week View */}
      <div className="rounded-xl border border-[var(--color-border)] overflow-hidden">
        {/* Day Headers */}
        <div className="grid grid-cols-7 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
          {weekDates.map((dateStr) => {
            const { day, month, dayName } = formatDateDisplay(dateStr);
            const today = isToday(dateStr);
            return (
              <div
                key={dateStr}
                className={`p-3 text-center ${today ? 'bg-[var(--color-primary)] text-white' : ''}`}
              >
                <div className={`text-xs font-medium ${today ? '' : 'text-[var(--color-text-muted)]'}`}>
                  {DAYS_BN[dayName as keyof typeof DAYS_BN]}
                </div>
                <div className={`text-lg font-bold ${today ? '' : 'text-[var(--color-text-primary)]'}`}>
                  {day}
                </div>
                <div className={`text-[10px] ${today ? 'text-white/70' : 'text-[var(--color-text-muted)]'}`}>
                  {month}
                </div>
              </div>
            );
          })}
        </div>

        {/* Event Cells */}
        <div className="grid grid-cols-7 min-h-[180px]">
          {weekDates.map((dateStr) => {
            const event = getEventForDate(dateStr);
            const eventType = event ? getEventType(event) : undefined;
            const dayName = getDayName(dateStr);
            const inSchedule = isDayInRegularSchedule(dayName);
            const past = isPast(dateStr);
            const eventConfig = eventType ? EVENT_COLORS[eventType] : null;

            return (
              <div
                key={dateStr}
                className={`border-r border-b border-[var(--color-border)] p-2 relative ${
                  past ? 'opacity-60' : ''
                }`}
              >
                {/* Regular Schedule Indicator */}
                {!event && inSchedule && (
                  <div className="absolute top-1 right-1">
                    <div className="w-2 h-2 rounded-full bg-emerald-400" title="Regular schedule" />
                  </div>
                )}

                {/* Event Display */}
                {event && eventConfig && eventType && (
                  <div
                    className={`h-full rounded-lg p-2 ${eventConfig.bg} ${eventConfig.border} border`}
                  >
                    <div className={`flex items-center gap-1 text-xs font-semibold ${eventConfig.text}`}>
                      {(() => {
                        const Icon = eventConfig.icon;
                        return <Icon className="w-3 h-3" />;
                      })()}
                      {EVENT_LABELS[eventType]}
                    </div>
                    {(eventType === 'available' || eventType === 'scheduled') && getEventStartTime(event) && (
                      <div className="mt-1 text-[10px] font-mono text-[var(--color-text-muted)]">
                        {getEventStartTime(event)} - {getEventEndTime(event)}
                      </div>
                    )}
                    {event.reason && (
                      <div className="mt-1 text-[10px] text-[var(--color-text-muted)] line-clamp-2">
                        {event.reason}
                      </div>
                    )}
                    {!readOnly && (
                      <div className="mt-2 flex gap-1">
                        {event.id && onUpdateEvent && (
                          <button
                            onClick={() => openEditModal(event as UnifiedEvent)}
                            className="p-1 rounded hover:bg-white/50"
                            aria-label="Edit event"
                          >
                            <Edit2 className="w-3 h-3 text-[var(--color-text-muted)]" />
                          </button>
                        )}
                        {event.id && onDeleteEvent && (
                          <button
                            onClick={() => onDeleteEvent(event.id!)}
                            className="p-1 rounded hover:bg-white/50"
                            aria-label="Delete event"
                          >
                            <Trash2 className="w-3 h-3 text-rose-500" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* No Schedule */}
                {!event && !inSchedule && (
                  <div className="h-full flex items-center justify-center">
                    <span className="text-xs text-[var(--color-text-muted)]">Off</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Event List Below */}
      <div className="space-y-2">
        <h4 className="text-sm font-semibold text-[var(--color-text-primary)]">Upcoming Events</h4>
        {events.filter(e => e.date >= getTodayGMT6()).length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)]">No upcoming events</p>
        ) : (
          <div className="space-y-2">
            {events
              .filter(e => e.date >= getTodayGMT6())
              .sort((a, b) => a.date.localeCompare(b.date))
              .slice(0, 5)
              .map((event) => {
                const eventType = getEventType(event as UnifiedEvent);
                const config = EVENT_COLORS[eventType];
                const Icon = config.icon;
                return (
                  <div
                    key={event.id || event.date}
                    className={`flex items-center justify-between rounded-lg border ${config.bg} ${config.border} p-3`}
                  >
                    <div className="flex items-center gap-3">
                      <Icon className={`w-4 h-4 ${config.text}`} />
                      <div>
                        <div className={`text-sm font-medium ${config.text}`}>
                          {EVENT_LABELS[eventType]}
                        </div>
                        <div className="text-xs text-[var(--color-text-muted)]">
                          {formatDateDisplay(event.date).dayName}, {event.date}
                          {(eventType === 'available' || eventType === 'scheduled') && getEventStartTime(event as UnifiedEvent) && (
                            <> · {getEventStartTime(event as UnifiedEvent)} - {getEventEndTime(event as UnifiedEvent)}</>
                          )}
                        </div>
                        {event.reason && (
                          <div className="text-xs text-[var(--color-text-muted)] mt-0.5">
                            {event.reason}
                          </div>
                        )}
                      </div>
                    </div>
                    {!readOnly && (
                      <div className="flex gap-1">
                        {event.id && onUpdateEvent && (
                          <button
                            onClick={() => openEditModal(event as UnifiedEvent)}
                            className="btn-ghost p-1.5"
                            aria-label="Edit event"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {event.id && onDeleteEvent && (
                          <button
                            onClick={() => onDeleteEvent(event.id!)}
                            className="btn-ghost p-1.5 text-rose-500"
                            aria-label="Delete event"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      {(showAddModal || editingEvent) && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
              <h3 className="font-semibold">
                {editingEvent ? 'Edit Event' : 'Add Event'}
              </h3>
              <button
                onClick={() => {
                  setShowAddModal(false);
                  setEditingEvent(null);
                }}
                className="btn-ghost p-1.5"
                aria-label="Close dialog"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                editingEvent ? handleEditEvent() : handleAddEvent();
              }}
              className="p-5 space-y-4"
            >
              <div>
                <label className="label">Date *</label>
                <input
                  type="date"
                  value={formData.date}
                  onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                  className="input"
                  required
                />
              </div>
              <div>
                <label className="label">Status *</label>
                <select
                  value={formData.type}
                  onChange={(e) => setFormData({ ...formData, type: e.target.value as EventType })}
                  className="input"
                >
                  <option value="available">Available</option>
                  <option value="on_leave">On Leave</option>
                  <option value="not_coming">Not Coming</option>
                  <option value="emergency_leave">Emergency Leave</option>
                  <option value="scheduled">Scheduled (Special Hours)</option>
                </select>
              </div>
              {(formData.type === 'available' || formData.type === 'scheduled') && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">Start Time</label>
                    <input
                      type="time"
                      value={formData.startTime}
                      onChange={(e) => setFormData({ ...formData, startTime: e.target.value })}
                      className="input"
                    />
                  </div>
                  <div>
                    <label className="label">End Time</label>
                    <input
                      type="time"
                      value={formData.endTime}
                      onChange={(e) => setFormData({ ...formData, endTime: e.target.value })}
                      className="input"
                    />
                  </div>
                </div>
              )}
              <div>
                <label className="label">Reason (optional)</label>
                <input
                  type="text"
                  value={formData.reason}
                  onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                  className="input"
                  placeholder="e.g., Annual leave, Personal work, etc."
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddModal(false);
                    setEditingEvent(null);
                  }}
                  className="btn-secondary"
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary">
                  {editingEvent ? 'Update' : 'Add Event'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
