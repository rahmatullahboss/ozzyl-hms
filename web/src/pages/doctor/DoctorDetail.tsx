import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router';
import { useApiQuery, useApiMutation, useQueryClient } from '../../hooks/useApiQuery';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { ArrowLeft, Globe, GlobeOff, Calendar, Clock } from 'lucide-react';
import { DoctorForm } from '../../components/doctor/DoctorForm';
import { ScheduleGrid } from '../../components/doctor/ScheduleGrid';
import { DoctorTimeline } from '../../components/doctor/DoctorTimeline';
import DataTable from '../../components/dashboard/DataTable';
import { Doctor, DoctorVisit } from '../../components/doctor/types';
import { formatDoctorName } from '../../lib/doctor-display';

type Tab = 'profile' | 'schedule' | 'timeline' | 'availability' | 'visits';

interface DoctorAPIResponse {
  doctor?: Doctor;
  shifts?: Array<{
    id: number;
    dayOfWeek: number;
    day_of_week: number;
    shiftName: string;
    shift_name: string;
    startTime: string;
    start_time: string;
    endTime: string;
    end_time: string;
  }>;
  availability?: Array<{
    id: number;
    date: string;
    isAvailable: number;
    is_available: number;
    reason?: string;
  }>;
}

function initials(name: string) {
  return name
    .split(' ')
    .map(w => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export default function DoctorDetail() {
  const { id } = useParams();
  const { t } = useTranslation(['doctor', 'common']);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [tab, setTab] = useState<Tab>('profile');

  const { data, isLoading } = useApiQuery<DoctorAPIResponse>(
    ['doctors', 'detail', id],
    `/api/doctors/${id}`,
  );

  const { data: visitData } = useApiQuery<{ visits: DoctorVisit[] }>(
    ['doctors', 'detail', id, 'visits'],
    `/api/visits?doctorId=${id}`,
    { enabled: tab === 'visits' },
  );

  const publish = useApiMutation<unknown, number>(
    'post',
    (doctorId: number) => `/api/doctors/${doctorId}/publish`,
    {
      onSuccess: () => {
        toast.success(t('doctor.published', 'Published to marketplace'));
        qc.invalidateQueries({ queryKey: ['doctors', 'detail', id] });
      },
      onError: () => toast.error(t('doctor.publishFailed', 'Publish failed')),
    },
  );

  const tabs: { key: Tab; label: string }[] = [
    { key: 'profile', label: t('doctor.profile', 'Profile') },
    { key: 'schedule', label: t('doctor.schedule', 'Schedule') },
    { key: 'timeline', label: t('doctor.timeline', 'Timeline') },
    { key: 'availability', label: t('doctor.availability', 'Availability') },
    { key: 'visits', label: t('doctor.visits', 'Visits') },
  ];

  const d = data?.doctor;
  const shifts = (data?.shifts ?? []).map(s => ({
    id: s.id,
    dayOfWeek: s.dayOfWeek ?? s.day_of_week,
    day_of_week: s.dayOfWeek ?? s.day_of_week,
    shiftName: s.shiftName ?? s.shift_name,
    shift_name: s.shiftName ?? s.shift_name,
    startTime: s.startTime ?? s.start_time,
    start_time: s.startTime ?? s.start_time,
    endTime: s.endTime ?? s.end_time,
    end_time: s.endTime ?? s.end_time,
  }));

  const isPublished = !!(d?.isMarketplaceVisible ?? d?.is_marketplace_visible);
  const name = d?.name ?? '';
  const fee = d?.consultationFee ?? d?.consultation_fee ?? 0;

  if (isLoading && !d) {
    return (
      <div className="space-y-4 max-w-screen-2xl mx-auto">
        <div className="skeleton h-32 rounded-xl" />
        <div className="skeleton h-64 rounded-xl" />
      </div>
    );
  }

  if (!d && !isLoading) {
    return (
      <div className="card p-12 text-center">
        <p className="text-[var(--color-text-muted)]">{t('doctor.notFound', 'Doctor not found')}</p>
        <button onClick={() => navigate('/doctors')} className="btn-primary mt-4">
          {t('doctor.backToList', 'Back to Doctors')}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-screen-2xl mx-auto">
      {/* Back Button */}
      <button onClick={() => navigate('/doctors')} className="btn-ghost text-sm">
        <ArrowLeft className="w-4 h-4" />
        {t('doctor.backToList', 'Back to Doctors')}
      </button>

      {/* Profile Header Card */}
      <div className="card p-6">
        <div className="flex items-start gap-4">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-cyan-100 to-blue-200 flex items-center justify-center text-blue-700 text-xl font-bold shrink-0">
            {initials(name)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-semibold text-[var(--color-text-primary)]">
                {formatDoctorName(name, t('doctor.doctorPrefix', 'Dr.'))}
              </h1>
              {isPublished ? (
                <span className="badge-info"><Globe className="w-3 h-3" /> {t('doctor.marketplace')}</span>
              ) : (
                <span className="badge-neutral">{t('doctor.private', 'Private')}</span>
              )}
              <span className={d?.isAvailable || d?.is_available ? 'badge-success' : 'badge-danger'}>
                {d?.isAvailable || d?.is_available ? t('doctor.availableStatus', 'Available') : t('doctor.unavailableStatus', 'Unavailable')}
              </span>
            </div>
            <p className="text-[var(--color-text-muted)] mt-1">
              {[d?.specialty, d?.department].filter(Boolean).join(' · ')}
            </p>
            <div className="flex gap-4 mt-3 text-sm flex-wrap">
              <span className="text-[var(--color-text-muted)]">
                {t('doctor.bmdcNo')}: {d?.bmdcRegNo || d?.bmdc_reg_no || t('common.n_a')}
              </span>
              <span className="font-mono font-medium text-[var(--color-text-primary)]">৳{fee}{t('doctor.per_consult')}</span>
              {d?.qualifications && (
                <span className="text-[var(--color-text-muted)]">{d.qualifications}</span>
              )}
            </div>
            {/* Quick Actions */}
            <div className="flex gap-2 mt-3">
              {!isPublished && (
                <button
                  onClick={() => publish.mutate(d!.id)}
                  disabled={publish.isPending}
                  className="btn-secondary text-xs !px-3 !py-1.5"
                >
                  <Globe className="w-3.5 h-3.5" />
                  {t('doctor.publish', 'Publish to Marketplace')}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="card p-0 overflow-hidden">
        <div className="flex overflow-x-auto border-b border-[var(--color-border)]">
          {tabs.map(tb => (
            <button
              key={tb.key}
              onClick={() => setTab(tb.key)}
              className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                tab === tb.key
                  ? 'border-[var(--color-primary)] text-[var(--color-primary)]'
                  : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              {tb.label}
            </button>
          ))}
        </div>

        <div className="p-6">
          {/* Profile Tab */}
          {tab === 'profile' && (
            <DoctorForm doctor={d ?? null} mode="detail" />
          )}

          {/* Schedule Tab */}
          {tab === 'schedule' && (
            <ScheduleGrid doctorId={Number(id)} initialShifts={shifts} />
          )}

          {/* Timeline Tab */}
          {tab === 'timeline' && (
            <TimelineTab
              doctorId={Number(id)}
              doctorName={name}
              shifts={shifts}
              initialAvailability={data?.availability ?? []}
            />
          )}

          {/* Availability Tab */}
          {tab === 'availability' && (
            <AvailabilityTab doctorId={Number(id)} initialAvailability={data?.availability ?? []} />
          )}

          {/* Visits Tab */}
          {tab === 'visits' && (
            <DataTable
              data={visitData?.visits ?? []}
              columns={[
                {
                  key: 'visit_date' as keyof DoctorVisit,
                  header: t('doctor.visitDate', 'Date'),
                  render: (v: DoctorVisit) => (
                    <span className="text-sm">{v.visit_date ?? v.visitDate ?? '—'}</span>
                  ),
                },
                {
                  key: 'patient_name' as keyof DoctorVisit,
                  header: t('doctor.patient', 'Patient'),
                  render: (v: DoctorVisit) => (
                    <span className="font-medium text-sm">{v.patient_name ?? v.patientName ?? '—'}</span>
                  ),
                },
                {
                  key: 'visit_type' as keyof DoctorVisit,
                  header: t('doctor.type', 'Type'),
                  render: (v: DoctorVisit) => (
                    <span className="badge-primary text-xs">{v.visit_type ?? v.visitType ?? '—'}</span>
                  ),
                },
                {
                  key: 'diagnosis' as keyof DoctorVisit,
                  header: t('doctor.diagnosis', 'Diagnosis'),
                  render: (v: DoctorVisit) => (
                    <span className="text-sm text-[var(--color-text-muted)]">{v.diagnosis || '—'}</span>
                  ),
                },
              ]}
              keyField="id"
              emptyMessage={t('doctor.noVisits', 'No visits recorded')}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Timeline Tab ─── */

function TimelineTab({
  doctorId,
  doctorName,
  shifts,
  initialAvailability,
}: {
  doctorId: number;
  doctorName: string;
  shifts: Array<{
    id: number;
    dayOfWeek: number;
    day_of_week?: number;
    shiftName: string;
    shift_name?: string;
    startTime: string;
    start_time?: string;
    endTime: string;
    end_time?: string;
  }>;
  initialAvailability: Array<{
    id: number;
    date: string;
    isAvailable: number;
    is_available: number;
    reason?: string;
  }>;
}) {
  const { t } = useTranslation(['doctor', 'common']);
  const qc = useQueryClient();

  // Fetch timeline events from the new API
  const { data: timelineData, isLoading: timelineLoading } = useApiQuery<{ events: Array<{
    id: number;
    date: string;
    type: string;
    start_time?: string;
    end_time?: string;
    reason?: string;
  }> }>(
    ['doctors', 'detail', String(doctorId), 'timeline'],
    `/api/doctor-schedule/${doctorId}/timeline`,
    { enabled: true },
  );

  // Parse regular schedule from shifts
  const regularSchedule = useMemo(() => {
    if (shifts.length === 0) return null;
    const dayMap = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const daysWithShifts = shifts.map(s => dayMap[s.dayOfWeek ?? s.day_of_week ?? 0]);
    // Get the most common time range
    const firstShift = shifts[0];
    return {
      days: daysWithShifts,
      startTime: (firstShift.startTime ?? firstShift.start_time ?? '09:00').slice(0, 5),
      endTime: (firstShift.endTime ?? firstShift.end_time ?? '17:00').slice(0, 5),
    };
  }, [shifts]);

  // Convert availability to timeline events
  const events = useMemo(() => {
    type EventType = 'available' | 'on_leave' | 'not_coming' | 'scheduled' | 'emergency_leave';
    const timeline: Array<{
      id?: number;
      date: string;
      type: EventType | string;
      start_time?: string;
      end_time?: string;
      reason?: string;
    }> = [...(timelineData?.events ?? [])];
    // Add from legacy availability
    initialAvailability.forEach(a => {
      if (!timeline.find(e => e.date === a.date)) {
        timeline.push({
          date: a.date,
          type: ((a.isAvailable ?? a.is_available) === 0 ? 'on_leave' : 'available') as EventType,
          reason: a.reason,
        });
      }
    });
    return timeline;
  }, [timelineData, initialAvailability]);

  const addEvent = useApiMutation<unknown, {
    date: string;
    type: string;
    startTime?: string;
    endTime?: string;
    reason?: string;
  }>(
    'post',
    `/api/doctor-schedule/${doctorId}/timeline`,
    {
      onSuccess: () => {
        toast.success(t('doctor.eventAdded', 'Event added'));
        qc.invalidateQueries({ queryKey: ['doctors', 'detail', String(doctorId), 'timeline'] });
      },
      onError: () => toast.error(t('doctor.eventFailed', 'Failed to add event')),
    },
  );

  const updateEvent = useApiMutation<unknown, {
    eventId: number;
    type?: string;
    startTime?: string;
    endTime?: string;
    reason?: string;
  }>(
    'put',
    ({ eventId }) => `/api/doctor-schedule/${doctorId}/timeline/${eventId}`,
    {
      onSuccess: () => {
        toast.success(t('doctor.eventUpdated', 'Event updated'));
        qc.invalidateQueries({ queryKey: ['doctors', 'detail', String(doctorId), 'timeline'] });
      },
      onError: () => toast.error(t('doctor.eventFailed', 'Failed to update event')),
    },
  );

  const deleteEvent = useApiMutation<unknown, number>(
    'delete',
    (eventId: number) => `/api/doctor-schedule/${doctorId}/timeline/${eventId}`,
    {
      onSuccess: () => {
        toast.success(t('doctor.eventDeleted', 'Event deleted'));
        qc.invalidateQueries({ queryKey: ['doctors', 'detail', String(doctorId), 'timeline'] });
      },
      onError: () => toast.error(t('doctor.eventFailed', 'Failed to delete event')),
    },
  );

  if (timelineLoading) {
    return <div className="card h-64 animate-pulse" />;
  }

  return (
    <DoctorTimeline
      doctorName={doctorName}
      regularSchedule={regularSchedule}
      events={events}
      onAddEvent={(event) => addEvent.mutate(event)}
      onUpdateEvent={(eventId, event) => updateEvent.mutate({ eventId, ...event })}
      onDeleteEvent={(eventId) => deleteEvent.mutate(eventId)}
    />
  );
}

/* ─── Availability Tab ─── */

function AvailabilityTab({
  doctorId,
  initialAvailability,
}: {
  doctorId: number;
  initialAvailability: Array<{
    id: number;
    date: string;
    isAvailable: number;
    is_available: number;
    reason?: string;
  }>;
}) {
  const { t } = useTranslation(['doctor', 'common']);
  const qc = useQueryClient();

  const { data } = useApiQuery<{ availability: typeof initialAvailability }>(
    ['doctors', 'detail', String(doctorId), 'availability'],
    `/api/doctor-schedule/${doctorId}/availability`,
  );

  const availability = data?.availability ?? initialAvailability;
  const activeAvailability = availability.filter(
    a => (a.isAvailable ?? a.is_available) === 0
  );

  const [date, setDate] = useState('');
  const [reason, setReason] = useState('');

  const addAvailability = useApiMutation(
    'post',
    `/api/doctor-schedule/${doctorId}/availability`,
    {
      onSuccess: () => {
        toast.success(t('doctor.availAdded', 'Availability override added'));
        qc.invalidateQueries({ queryKey: ['doctors', 'detail', String(doctorId), 'availability'] });
        setDate('');
        setReason('');
      },
      onError: () => toast.error(t('doctor.availFailed', 'Failed')),
    },
  );

  const removeAvailability = useApiMutation(
    'delete',
    (availId: number) => `/api/doctor-schedule/${doctorId}/availability/${availId}`,
    {
      onSuccess: () => {
        toast.success(t('doctor.availRemoved', 'Availability override removed'));
        qc.invalidateQueries({ queryKey: ['doctors', 'detail', String(doctorId), 'availability'] });
      },
      onError: () => toast.error(t('doctor.availFailed', 'Failed')),
    },
  );

  const handleAdd = () => {
    if (!date) {
      toast.error(t('doctor.dateRequired', 'Date is required'));
      return;
    }
    addAvailability.mutate({ date, isAvailable: false, reason: reason || undefined });
  };

  return (
    <div className="space-y-4">
      {/* Add override */}
      <div className="card p-4">
        <h4 className="text-sm font-semibold mb-3">{t('doctor.addOverride', 'Add Unavailability')}</h4>
        <div className="flex gap-3 flex-wrap items-end">
          <div>
            <label className="label">{t('doctor.date', 'Date')}</label>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="input"
            />
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="label">{t('doctor.reason', 'Reason')}</label>
            <input
              value={reason}
              onChange={e => setReason(e.target.value)}
              className="input"
              placeholder={t('doctor.reasonPlaceholder', 'Leave, Holiday, etc.')}
            />
          </div>
          <button onClick={handleAdd} disabled={addAvailability.isPending} className="btn-primary">
            <Calendar className="w-4 h-4" />
            {t('doctor.markUnavailable', 'Mark Unavailable')}
          </button>
        </div>
      </div>

      {/* Existing overrides */}
      {activeAvailability.length > 0 ? (
        <div className="card overflow-hidden">
          <table className="table-base">
            <thead>
              <tr>
                <th>{t('doctor.date', 'Date')}</th>
                <th>{t('doctor.reason', 'Reason')}</th>
                <th>{t('common.actions', 'Actions')}</th>
              </tr>
            </thead>
            <tbody>
              {activeAvailability.map(a => (
                <tr key={a.id}>
                  <td className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-red-500" />
                    <span>{a.date}</span>
                  </td>
                  <td className="text-[var(--color-text-muted)]">{a.reason || '—'}</td>
                  <td>
                    <button
                      onClick={() => removeAvailability.mutate(a.id)}
                      className="btn-ghost !px-2 !py-1 text-xs text-red-500"
                    >
                      {t('doctor.clearUnavail', 'Clear')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card p-8 text-center">
          <p className="text-[var(--color-text-muted)]">{t('doctor.noOverrides', 'No unavailability overrides')}</p>
        </div>
      )}
    </div>
  );
}
