import { Link } from 'react-router';
import { CalendarDays, Users, FileText, Video, Clock, Pill } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface QuickActionsProps {
  basePath: string;
}

const ACTION_STYLES: Record<string, { bg: string; icon: string }> = {
  indigo: { bg: 'bg-indigo-50', icon: 'text-indigo-600' },
  teal: { bg: 'bg-teal-50', icon: 'text-teal-600' },
  emerald: { bg: 'bg-emerald-50', icon: 'text-emerald-600' },
  purple: { bg: 'bg-purple-50', icon: 'text-purple-600' },
  amber: { bg: 'bg-amber-50', icon: 'text-amber-600' },
  rose: { bg: 'bg-rose-50', icon: 'text-rose-600' },
};

export function QuickActions({ basePath }: QuickActionsProps) {
  const { t } = useTranslation(['dashboard', 'common']);

  const actions = [
    {
      icon: CalendarDays,
      label: t('appointments', { defaultValue: 'Appointments' }),
      desc: t('viewManageSchedule', { defaultValue: 'View & manage schedule' }),
      to: `${basePath}/appointments`,
      color: 'indigo',
    },
    {
      icon: Users,
      label: t('patients', { defaultValue: 'Patients' }),
      desc: t('searchPatientRecords', { defaultValue: 'Search patient records' }),
      to: `${basePath}/patients`,
      color: 'teal',
    },
    {
      icon: Pill,
      label: t('prescriptions', { defaultValue: 'Prescriptions' }),
      desc: t('writeRx', { defaultValue: 'Write new prescription' }),
      to: `${basePath}/prescriptions/new`,
      color: 'emerald',
    },
    {
      icon: Video,
      label: t('telemedicine', { defaultValue: 'Telemedicine' }),
      desc: t('startVirtualConsult', { defaultValue: 'Start virtual consultation' }),
      to: `${basePath}/telemedicine`,
      color: 'purple',
    },
    {
      icon: FileText,
      label: t('clinicalNotes', { defaultValue: 'Clinical Notes' }),
      desc: t('openPatientChart', { defaultValue: 'Patient chart & notes' }),
      to: `${basePath}/patients`,
      color: 'amber',
    },
    {
      icon: Clock,
      label: t('mySchedule', { defaultValue: 'My Schedule' }),
      desc: t('manageWeeklySlots', { defaultValue: 'Manage weekly slots' }),
      to: `${basePath}/doctor-schedule`,
      color: 'rose',
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      {actions.map((action) => (
        (() => {
          const style = ACTION_STYLES[action.color] ?? ACTION_STYLES.indigo;
          return (
        <Link
          key={action.to}
          to={action.to}
          className="card p-4 flex flex-col items-center text-center gap-2 hover:shadow-md hover:border-[var(--color-primary)]/30 transition-all group cursor-pointer"
        >
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${style.bg}`}>
            <action.icon className={`w-5 h-5 ${style.icon}`} />
          </div>
          <div>
            <div className="text-xs font-semibold text-[var(--color-text)] group-hover:text-[var(--color-primary)] transition-colors">
              {action.label}
            </div>
            <div className="text-[10px] text-[var(--color-text-muted)] mt-0.5 line-clamp-2">
              {action.desc}
            </div>
          </div>
        </Link>
          );
        })()
      ))}
    </div>
  );
}
