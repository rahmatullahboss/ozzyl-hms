import { useMemo, useState } from 'react';
import { CalendarDays, Save, Stethoscope, CheckCircle2, XCircle, Clock, AlertCircle, Users, ChevronDown, ChevronUp, ChevronLeft, ChevronRight } from 'lucide-react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import DashboardLayout from '../components/DashboardLayout';
import ReceptionTopBar from '../components/reception/ReceptionTopBar';
import { useApiMutation, useApiQuery, useQueryClient } from '../hooks/useApiQuery';
import { getTodayGMT6, getWeekDates, formatDateForAPI } from '../lib/date-utils';

type DoctorStatusType = 'available' | 'on_leave' | 'not_coming' | 'scheduled' | 'emergency_leave';

interface DoctorToday {
  id: number;
  name: string;
  specialty?: string | null;
  department?: string | null;
  is_available: number;
  status_type: string;
  reason: string;
  max_serial?: number | null;
  serial_count?: number;
}

const STATUS_CONFIG: Record<DoctorStatusType, { label: string; color: string; bgColor: string; icon: typeof CheckCircle2 }> = {
  available: { label: 'Available', color: 'text-emerald-700', bgColor: 'bg-emerald-100', icon: CheckCircle2 },
  on_leave: { label: 'On Leave', color: 'text-amber-700', bgColor: 'bg-amber-100', icon: Clock },
  not_coming: { label: 'Not Coming', color: 'text-rose-700', bgColor: 'bg-rose-100', icon: XCircle },
  scheduled: { label: 'Scheduled', color: 'text-blue-700', bgColor: 'bg-blue-100', icon: Clock },
  emergency_leave: { label: 'Emergency Leave', color: 'text-red-700', bgColor: 'bg-red-100', icon: AlertCircle },
};

export default function DoctorStatusPage({ role = 'reception' }: { role?: string }) {
  const { t } = useTranslation('reception');
  const queryClient = useQueryClient();
  const [selectedDate, setSelectedDate] = useState(getTodayGMT6());
  const [currentWeekStart, setCurrentWeekStart] = useState(getTodayGMT6());
  const [filterStatus, setFilterStatus] = useState<DoctorStatusType | 'all'>('all');
  const [editingDoctor, setEditingDoctor] = useState<number | null>(null);
  const [expandedCards, setExpandedCards] = useState<Set<number>>(new Set());
  const [localReason, setLocalReason] = useState<Record<number, string>>({});
  const [localMaxSerial, setLocalMaxSerial] = useState<Record<number, number | null>>({});
  const [showTimeline, setShowTimeline] = useState(false);

  const key = ['reception', 'doctors-today', selectedDate] as const;

  const { data, isLoading } = useApiQuery<{ date: string; doctors: DoctorToday[] }>(
    key,
    `/api/reception/doctors/today?date=${selectedDate}${filterStatus !== 'all' ? `&status_type=${filterStatus}` : ''}`,
  );

  // Week navigation
  const weekDates = useMemo(() => getWeekDates(currentWeekStart), [currentWeekStart]);
  const prevWeek = () => {
    const d = new Date(currentWeekStart + 'T00:00:00');
    d.setDate(d.getDate() - 7);
    setCurrentWeekStart(formatDateForAPI(d));
  };
  const nextWeek = () => {
    const d = new Date(currentWeekStart + 'T00:00:00');
    d.setDate(d.getDate() + 7);
    setCurrentWeekStart(formatDateForAPI(d));
  };

  const updateStatus = useApiMutation<unknown, { doctorId: number; statusType?: DoctorStatusType; reason?: string | null; maxSerial?: number | null; isAvailable?: boolean; date?: string }>(
    'patch',
    (payload) => `/api/reception/doctors/${payload.doctorId}/today?date=${payload.date || selectedDate}`,
    {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: key });
        toast.success(t('doctorStatusPage.statusUpdated', 'Status updated'));
      },
      onError: (error) => toast.error(error.message),
    },
  );

  const bulkUpdateStatus = useApiMutation<unknown, { updates: Array<{ doctorId: number; statusType: DoctorStatusType; reason?: string | null }> }>(
    'post',
    () => `/api/reception/doctors/bulk-status?date=${selectedDate}`,
    {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: key });
        toast.success(t('doctorStatusPage.bulkUpdateSuccessful', 'Bulk update successful'));
      },
      onError: (error) => toast.error(error.message),
    },
  );

  const doctors = useMemo(() => data?.doctors ?? [], [data]);

  const stats = useMemo(() => ({
    total: doctors.length,
    available: doctors.filter(d => d.status_type === 'available').length,
    onLeave: doctors.filter(d => ['on_leave', 'emergency_leave'].includes(d.status_type)).length,
    notComing: doctors.filter(d => d.status_type === 'not_coming').length,
  }), [doctors]);

  const toggleExpanded = (id: number) => {
    setExpandedCards(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleStatusChange = (doctor: DoctorToday, newStatus: DoctorStatusType, date?: string) => {
    updateStatus.mutate({
      doctorId: doctor.id,
      statusType: newStatus,
      reason: doctor.reason || undefined,
      isAvailable: newStatus === 'available',
      date,
    });
  };

  const handleEditStart = (doctor: DoctorToday) => {
    setEditingDoctor(doctor.id);
    setLocalReason(prev => ({ ...prev, [doctor.id]: doctor.reason || '' }));
    setLocalMaxSerial(prev => ({ ...prev, [doctor.id]: doctor.max_serial ?? null }));
  };

  const handleSaveDetails = (doctor: DoctorToday) => {
    updateStatus.mutate({
      doctorId: doctor.id,
      statusType: doctor.status_type as DoctorStatusType,
      reason: localReason[doctor.id] || null,
      maxSerial: localMaxSerial[doctor.id],
    });
    setEditingDoctor(null);
  };

  const handleBulkAction = (statusType: DoctorStatusType, doctorIds: number[]) => {
    if (doctorIds.length === 0) {
      toast.error(t('doctorStatusPage.selectDoctorsFirst', 'Select doctors first'));
      return;
    }
    bulkUpdateStatus.mutate({
      updates: doctorIds.map(id => ({ doctorId: id, statusType }))
    });
  };

  return (
    <DashboardLayout role={role}>
      <div className="mx-auto max-w-screen-2xl space-y-5">
        <ReceptionTopBar role={role} />

        <div className="page-header items-start">
          <div>
            <div className="flex items-center gap-2">
              <Stethoscope className="h-6 w-6 text-[var(--color-primary)]" />
              <h1 className="page-title">{t('doctorStatusPage.title', 'Doctor Status Management')}</h1>
            </div>
            <p className="section-subtitle mt-1">{t('doctorStatusPage.subtitle', 'Manage doctor availability, leave, and scheduling.')}</p>
          </div>
          <div className="flex items-center gap-3">
            {/* View Toggle */}
            <div className="flex items-center gap-1 rounded-lg border border-[var(--color-border)] bg-white p-1 dark:bg-slate-800">
              <button
                type="button"
                onClick={() => setShowTimeline(false)}
                className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
                  !showTimeline
                    ? 'bg-[var(--color-primary)] text-white'
                    : 'text-[var(--color-text-muted)] hover:bg-[var(--color-bg-secondary)]'
                }`}
              >
                {t('doctorStatusPage.viewCards', 'Cards')}
              </button>
              <button
                type="button"
                onClick={() => setShowTimeline(true)}
                className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
                  showTimeline
                    ? 'bg-[var(--color-primary)] text-white'
                    : 'text-[var(--color-text-muted)] hover:bg-[var(--color-bg-secondary)]'
                }`}
              >
                {t('doctorStatusPage.viewTimeline', 'Timeline')}
              </button>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="input"
              />
            </div>
            <div className="inline-flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-sm dark:bg-slate-800">
              <CalendarDays className="h-4 w-4 text-[var(--color-primary)]" />
              {selectedDate}
            </div>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="card flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100">
              <Users className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <div className="text-2xl font-bold">{stats.total}</div>
              <div className="text-xs text-[var(--color-text-muted)]">{t('doctorStatusPage.totalDoctors', 'Total Doctors')}</div>
            </div>
          </div>
          <div className="card flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            </div>
            <div>
              <div className="text-2xl font-bold">{stats.available}</div>
              <div className="text-xs text-[var(--color-text-muted)]">{t('doctorStatusPage.available', 'Available')}</div>
            </div>
          </div>
          <div className="card flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100">
              <Clock className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <div className="text-2xl font-bold">{stats.onLeave}</div>
              <div className="text-xs text-[var(--color-text-muted)]">{t('doctorStatusPage.onLeave', 'On Leave')}</div>
            </div>
          </div>
          <div className="card flex items-center gap-3 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-rose-100">
              <XCircle className="h-5 w-5 text-rose-600" />
            </div>
            <div>
              <div className="text-2xl font-bold">{stats.notComing}</div>
              <div className="text-xs text-[var(--color-text-muted)]">{t('doctorStatusPage.notComing', 'Not Coming')}</div>
            </div>
          </div>
        </div>

        {/* Bulk Actions */}
        <div className="card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-semibold">{t('doctorStatusPage.quickActions', 'Quick Actions')}</h3>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => handleBulkAction('available', doctors.map(d => d.id))}
              disabled={bulkUpdateStatus.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-100 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-200 disabled:opacity-50"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              {t('doctorStatusPage.markAllAvailable', 'Mark All Available')}
            </button>
            <button
              type="button"
              onClick={() => handleBulkAction('on_leave', doctors.map(d => d.id))}
              disabled={bulkUpdateStatus.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-100 px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-200 disabled:opacity-50"
            >
              <Clock className="h-3.5 w-3.5" />
              {t('doctorStatusPage.markAllOnLeave', 'Mark All On Leave')}
            </button>
            <button
              type="button"
              onClick={() => handleBulkAction('not_coming', doctors.map(d => d.id))}
              disabled={bulkUpdateStatus.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-rose-100 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-200 disabled:opacity-50"
            >
              <XCircle className="h-3.5 w-3.5" />
              {t('doctorStatusPage.markAllNotComing', 'Mark All Not Coming')}
            </button>
          </div>
        </div>

        {/* Timeline View */}
        {showTimeline && (
          <div className="card p-4">
            {/* Timeline Header */}
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold">{t('doctorStatusPage.weeklyTimeline', 'Weekly Schedule Timeline')}</h3>
              <div className="flex items-center gap-2">
                <button onClick={prevWeek} className="btn-ghost p-1.5">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button onClick={() => setCurrentWeekStart(getTodayGMT6())} className="btn-secondary btn-sm">
                  {t('doctorStatusPage.today', 'Today')}
                </button>
                <button onClick={nextWeek} className="btn-ghost p-1.5">
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Timeline Grid */}
            <div className="overflow-x-auto">
              <div className="min-w-[800px]">
                {/* Day Headers */}
                <div className="grid grid-cols-8 gap-2 border-b border-[var(--color-border)] pb-2 mb-2">
                  <div className="text-xs font-medium text-[var(--color-text-muted)]">{t('doctorStatusPage.doctor', 'Doctor')}</div>
                  {weekDates.map((dateStr) => {
                    const d = new Date(dateStr);
                    const isToday = dateStr === getTodayGMT6();
                    return (
                      <div
                        key={dateStr}
                        className={`text-center p-2 rounded-lg ${isToday ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-bg-secondary)]'}`}
                      >
                        <div className="text-[10px] font-medium">{t('doctorStatusPage.days.' + d.toLocaleString('en-GB', { weekday: 'short' }).toLowerCase(), d.toLocaleString('en-GB', { weekday: 'short' }))}</div>
                        <div className="text-sm font-bold">{d.getDate()}</div>
                      </div>
                    );
                  })}
                </div>

                {/* Doctor Rows */}
                {doctors.map((doctor) => {
                  const statusConfig = STATUS_CONFIG[doctor.status_type as DoctorStatusType] || STATUS_CONFIG.available;
                  const StatusIcon = statusConfig.icon;
                  return (
                    <div key={doctor.id} className="grid grid-cols-8 gap-2 py-2 border-b border-[var(--color-border)] last:border-0 items-center">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-[var(--color-bg-secondary)] flex items-center justify-center text-xs font-bold">
                          {doctor.name.charAt(0)}
                        </div>
                        <div className="text-sm font-medium truncate">{doctor.name}</div>
                      </div>
                      {weekDates.map((dateStr) => {
                        const isToday = dateStr === getTodayGMT6();
                        const isPast = dateStr < getTodayGMT6();
                        return (
                          <div
                            key={dateStr}
                            className={`p-2 rounded-lg min-h-[50px] flex flex-col items-center justify-center cursor-pointer hover:ring-2 hover:ring-[var(--color-primary)] transition-all ${
                              isToday ? 'ring-2 ring-[var(--color-primary)]' : ''
                            } ${isPast ? 'opacity-50' : ''}`}
                            onClick={() => !isPast && handleStatusChange(doctor, doctor.status_type === 'available' ? 'on_leave' : 'available', dateStr)}
                          >
                            <StatusIcon className={`w-4 h-4 ${statusConfig.color}`} />
                            <span className="text-[10px] mt-1 text-center">{t('doctorStatusPage.status.' + doctor.status_type, statusConfig.label)}</span>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}

                {/* Quick Status Change for Selected Date */}
                <div className="mt-4 p-3 bg-[var(--color-bg-secondary)] rounded-lg">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">
                      {t('doctorStatusPage.quickChangeFor', 'Quick change for {{date}}', { date: selectedDate })}:
                    </span>
                    <div className="flex gap-2">
                      {(['available', 'on_leave', 'not_coming'] as DoctorStatusType[]).map((status) => {
                        const config = STATUS_CONFIG[status];
                        const Icon = config.icon;
                        return (
                          <button
                            key={status}
                            onClick={() => {
                              doctors.forEach(d => {
                                handleStatusChange(d, status, selectedDate);
                              });
                            }}
                            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium ${config.bgColor} ${config.color} hover:opacity-80`}
                          >
                            <Icon className="w-3.5 h-3.5" />
                            {t('doctorStatusPage.status.' + status, config.label)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Filter */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-[var(--color-text-muted)]">{t('doctorStatusPage.filter', 'Filter:')}</span>
          {(['all', 'available', 'on_leave', 'not_coming', 'emergency_leave'] as const).map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => setFilterStatus(status)}
              className={`rounded-lg px-3 py-1 text-xs font-medium transition-colors ${
                filterStatus === status
                  ? 'bg-[var(--color-primary)] text-white'
                  : 'bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)] hover:bg-gray-200'
              }`}
            >
              {status === 'all' ? t('doctorStatusPage.all', 'All') : t('doctorStatusPage.status.' + status, STATUS_CONFIG[status as DoctorStatusType]?.label || status)}
            </button>
          ))}
        </div>

        {/* Cards View */}
        {!showTimeline && (
          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {isLoading ? (
              [...Array(6)].map((_, index) => (
                <div key={index} className="card h-44 animate-pulse" />
              ))
            ) : doctors.length === 0 ? (
              <div className="col-span-full py-12 text-center text-[var(--color-text-muted)]">
                <Users className="mx-auto mb-3 h-12 w-12 opacity-30" />
                <p>{t('doctorStatusPage.noDoctorsFound', 'No doctors found for this date')}</p>
              </div>
            ) : (
              doctors.map((doctor) => {
                const statusConfig = STATUS_CONFIG[doctor.status_type as DoctorStatusType] || STATUS_CONFIG.available;
                const StatusIcon = statusConfig.icon;
                const isExpanded = expandedCards.has(doctor.id);
                const isEditing = editingDoctor === doctor.id;

                return (
                  <div key={doctor.id} className="card overflow-hidden">
                    {/* Header */}
                    <div className="flex items-start justify-between p-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--color-bg-secondary)] text-lg font-bold">
                          {doctor.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <h2 className="font-semibold">{doctor.name}</h2>
                          <p className="text-sm text-[var(--color-text-muted)]">{doctor.specialty || doctor.department || t('doctorStatusPage.doctorFallback', 'Doctor')}</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => toggleExpanded(doctor.id)}
                        className="rounded-lg p-1.5 hover:bg-[var(--color-bg-secondary)]"
                      >
                        {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </button>
                    </div>

                    {/* Status Badge */}
                    <div className="px-4 pb-3">
                      <div className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${statusConfig.bgColor} ${statusConfig.color}`}>
                        <StatusIcon className="h-3.5 w-3.5" />
                        {t('doctorStatusPage.status.' + doctor.status_type, statusConfig.label)}
                      </div>
                      {doctor.reason && (
                        <p className="mt-2 text-xs text-[var(--color-text-muted)]">{doctor.reason}</p>
                      )}
                    </div>

                    {/* Quick Stats */}
                    <div className="grid grid-cols-2 gap-3 border-t border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4">
                      <div>
                        <div className="text-xs text-[var(--color-text-muted)]">{t('doctorStatusPage.todaySerial', 'Today Serial')}</div>
                        <div className="font-data text-lg font-semibold">{doctor.serial_count ?? 0}</div>
                      </div>
                      <div>
                        <div className="text-xs text-[var(--color-text-muted)]">{t('doctorStatusPage.maxSerial', 'Max Serial')}</div>
                        <div className="font-data text-lg font-semibold">{doctor.max_serial ?? '∞'}</div>
                      </div>
                    </div>

                    {/* Expanded Edit Section */}
                    {isExpanded && (
                      <div className="border-t border-[var(--color-border)] p-4">
                        <h4 className="mb-3 text-sm font-semibold">{t('doctorStatusPage.changeStatus', 'Change Status')}</h4>
                        <div className="mb-4 flex flex-wrap gap-2">
                          {(Object.entries(STATUS_CONFIG) as [DoctorStatusType, typeof STATUS_CONFIG[DoctorStatusType]][]).map(([status, config]) => {
                            const Icon = config.icon;
                            return (
                              <button
                                key={status}
                                type="button"
                                onClick={() => handleStatusChange(doctor, status)}
                                disabled={updateStatus.isPending}
                                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                                  doctor.status_type === status
                                    ? `${config.bgColor} ${config.color}`
                                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                }`}
                              >
                                <Icon className="h-3.5 w-3.5" />
                                {t('doctorStatusPage.status.' + status, config.label)}
                              </button>
                            );
                          })}
                        </div>

                        {/* Edit Details */}
                        {isEditing ? (
                          <div className="space-y-3">
                            <div>
                              <label className="label">{t('doctorStatusPage.reasonOptional', 'Reason (optional)')}</label>
                              <input
                                className="input"
                                type="text"
                                value={localReason[doctor.id] || ''}
                                onChange={(e) => setLocalReason(prev => ({ ...prev, [doctor.id]: e.target.value }))}
                                placeholder={t('doctorStatusPage.reasonPlaceholder', 'e.g., Annual leave, Personal work...')}
                              />
                            </div>
                            <div>
                              <label className="label">{t('doctorStatusPage.maxSerial', 'Max Serial')}</label>
                              <input
                                className="input"
                                type="number"
                                min="0"
                                value={localMaxSerial[doctor.id] ?? ''}
                                onChange={(e) => setLocalMaxSerial(prev => ({ ...prev, [doctor.id]: e.target.value === '' ? null : Math.max(0, Number(e.target.value) || 0) }))}
                                placeholder={t('doctorStatusPage.maxSerialPlaceholder', 'Leave empty for unlimited')}
                              />
                            </div>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => handleSaveDetails(doctor)}
                                disabled={updateStatus.isPending}
                                className="btn btn-primary btn-sm"
                              >
                                <Save className="h-3.5 w-3.5" />
                                {t('doctorStatusPage.save', 'Save')}
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingDoctor(null)}
                                className="btn btn-secondary btn-sm"
                              >
                                {t('doctorStatusPage.cancel', 'Cancel')}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleEditStart(doctor)}
                            className="btn btn-secondary btn-sm"
                          >
                            {t('doctorStatusPage.editDetails', 'Edit Details')}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </section>
        )}
      </div>
    </DashboardLayout>
  );
}