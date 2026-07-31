import { useTranslation } from 'react-i18next';
import { PATIENT_PORTAL_BOTTOM_NAV, type BottomNavTabId } from '../../lib/patientPortalNav';

export type BottomNavTab = BottomNavTabId;

interface MobileBottomNavProps {
  activeTab: BottomNavTab | null;
  onTabChange: (tab: BottomNavTab) => void;
}

export default function MobileBottomNav({ activeTab, onTabChange }: MobileBottomNavProps) {
  const { t } = useTranslation('patientPortal');

  return (
    <nav className="fixed bottom-0 left-0 w-full z-50 lg:hidden">
      {/* Glassmorphic background */}
      <div className="flex justify-around items-center px-2 pb-[env(safe-area-inset-bottom,8px)] pt-2 bg-white/80 backdrop-blur-xl rounded-t-3xl shadow-[0_-4px_20px_rgba(0,0,0,0.05)] border-t border-slate-100/50">
        {PATIENT_PORTAL_BOTTOM_NAV.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`flex flex-col items-center justify-center py-1.5 px-3 rounded-2xl transition-all duration-200 min-w-[56px] ${
                isActive
                  ? 'bg-emerald-100 text-emerald-700 scale-95'
                  : 'text-slate-400 hover:text-slate-600 active:scale-95'
              }`}
            >
              <Icon
                className={`w-5 h-5 mb-0.5 ${isActive ? 'text-emerald-700' : 'text-slate-400'}`}
                fill={isActive ? 'currentColor' : 'none'}
                strokeWidth={isActive ? 2.5 : 2}
              />
              <span className={`text-[10px] font-semibold tracking-wide ${
                isActive ? 'text-emerald-700' : 'text-slate-400'
              }`}>
                {t(tab.labelKey)}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
