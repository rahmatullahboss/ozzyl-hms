import { Calendar, LogOut, Smartphone } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { PatientDashboardTabId } from '../../lib/patientPortalNav';
import {
  getPatientPortalSectionShortcuts,
  PATIENT_PORTAL_PRIMARY_NAV,
} from '../../lib/patientPortalNav';

interface PatientPortalSidebarProps {
  activeTab: PatientDashboardTabId;
  canDownloadAndroidApp: boolean;
  navigationLabel: string;
  bookAppointmentLabel: string;
  signOutLabel: string;
  onBookAppointment: () => void;
  onLogout: () => void;
  onTabChange: (tab: PatientDashboardTabId) => void;
}

export function PatientPortalSidebar({
  activeTab,
  canDownloadAndroidApp,
  navigationLabel,
  bookAppointmentLabel,
  signOutLabel,
  onBookAppointment,
  onLogout,
  onTabChange,
}: PatientPortalSidebarProps) {
  const { t } = useTranslation('patientPortal');
  const shortcuts = getPatientPortalSectionShortcuts(activeTab);

  return (
    <aside className="patient-shell-sidebar">
      <div className="mb-6 px-3 pt-4">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">{navigationLabel}</p>
      </div>
      <nav className="flex-1 overflow-y-auto">
        <div className="patient-shell-nav-group">
          {PATIENT_PORTAL_PRIMARY_NAV.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                onClick={() => onTabChange(item.id)}
                className={`patient-shell-nav-button flex items-center gap-3 ${
                  activeTab === item.id
                    ? 'patient-shell-nav-button-active'
                    : 'patient-shell-nav-button-idle hover:bg-slate-50'
                }`}
              >
                <Icon className="w-4.5 h-4.5" />
                {t(item.labelKey)}
              </button>
            );
          })}
        </div>
        <div className="patient-shell-nav-group">
          {shortcuts.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                onClick={() => onTabChange(item.id)}
                className={`patient-shell-nav-button flex items-center gap-3 ${
                  activeTab === item.id
                    ? 'patient-shell-nav-button-active'
                    : 'patient-shell-nav-button-idle hover:bg-slate-50'
                }`}
              >
                <Icon className="w-4.5 h-4.5" />
                <span className="text-left leading-tight">{t(item.labelKey)}</span>
              </button>
            );
          })}
        </div>
      </nav>
      <div className="mt-auto px-1 py-5 border-t border-slate-200/80 space-y-2">
        {canDownloadAndroidApp && (
          <a
            href="/api/downloads/android"
            className="w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-slate-900 text-white font-semibold text-sm shadow-md hover:bg-slate-800 transition-all mb-2"
            download
          >
            <Smartphone className="w-4 h-4" />
            {t('pwa.getAndroidApp')}
          </a>
        )}
        <button
          onClick={onBookAppointment}
          className="w-full py-2.5 px-3 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-500 text-white font-semibold text-sm shadow-md shadow-emerald-500/20 hover:opacity-90 transition-all flex items-center justify-center gap-2"
        >
          <Calendar className="w-4 h-4" />
          {bookAppointmentLabel}
        </button>
        <button
          onClick={onLogout}
          className="w-full text-rose-600 px-3 py-2.5 hover:bg-rose-50 transition-all rounded-xl flex items-center gap-3 text-sm font-medium"
        >
          <LogOut className="w-4 h-4" />
          {signOutLabel}
        </button>
      </div>
    </aside>
  );
}
