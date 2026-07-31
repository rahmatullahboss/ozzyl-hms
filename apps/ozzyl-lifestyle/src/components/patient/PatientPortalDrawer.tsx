import { Activity, Calendar, LogOut, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { PatientDashboardTabId } from '../../lib/patientPortalNav';
import {
  getPatientPortalSectionShortcuts,
  PATIENT_PORTAL_PRIMARY_NAV,
} from '../../lib/patientPortalNav';

interface PatientPortalDrawerProps {
  activeTab: PatientDashboardTabId;
  isOpen: boolean;
  navigationLabel: string;
  bookAppointmentLabel: string;
  signOutLabel: string;
  onBookAppointment: () => void;
  onClose: () => void;
  onLogout: () => void;
  onTabChange: (tab: PatientDashboardTabId) => void;
}

export function PatientPortalDrawer({
  activeTab,
  isOpen,
  navigationLabel,
  bookAppointmentLabel,
  signOutLabel,
  onBookAppointment,
  onClose,
  onLogout,
  onTabChange,
}: PatientPortalDrawerProps) {
  const { t } = useTranslation('patientPortal');
  if (!isOpen) return null;
  const shortcuts = getPatientPortalSectionShortcuts(activeTab);

  return (
    <div className="fixed inset-0 z-[60] lg:hidden flex">
      <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className="patient-shell-drawer animate-in slide-in-from-left duration-300">
        <div className="px-4 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-teal-600 flex items-center justify-center shadow-md shadow-cyan-500/20">
              <Activity className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-slate-900">Ozzyl Health</span>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-all"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-3 pt-6 mb-2">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest pl-2">{navigationLabel}</p>
        </div>

        <nav className="flex-1 px-3 space-y-1 overflow-y-auto">
          {PATIENT_PORTAL_PRIMARY_NAV.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  onTabChange(tab.id);
                  onClose();
                }}
                className={`w-full px-3 py-3 rounded-xl flex items-center gap-3 text-sm font-medium transition-all ${
                  activeTab === tab.id
                    ? 'bg-emerald-50 text-emerald-700 shadow-sm'
                    : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
                }`}
              >
                <Icon className="w-5 h-5" />
                {t(tab.labelKey)}
              </button>
            );
          })}

          {shortcuts.map((section) => {
            const Icon = section.icon;
            return (
              <button
                key={section.id}
                onClick={() => {
                  onTabChange(section.id);
                  onClose();
                }}
                className={`w-full px-3 py-3 rounded-xl flex items-center gap-3 text-sm font-medium transition-all ${
                  activeTab === section.id
                    ? 'bg-emerald-50 text-emerald-700 shadow-sm'
                    : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-left leading-tight">{t(section.labelKey)}</span>
              </button>
            );
          })}
        </nav>

        <div className="mt-auto p-4 border-t border-slate-100 space-y-2">
          <button
            onClick={() => {
              onBookAppointment();
              onClose();
            }}
            className="w-full py-3 px-3 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-500 text-white font-semibold text-sm shadow-md shadow-emerald-500/20 flex items-center justify-center gap-2"
          >
            <Calendar className="w-4 h-4" />
            {bookAppointmentLabel}
          </button>
          <button
            onClick={onLogout}
            className="w-full text-rose-600 px-3 py-3 hover:bg-rose-50 transition-all rounded-xl flex items-center gap-3 text-sm font-medium"
          >
            <LogOut className="w-5 h-5" />
            {signOutLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
