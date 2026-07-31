import { Activity, Bell, Menu, Settings } from 'lucide-react';

interface PatientPortalHeaderProps {
  language: string;
  onChangeLanguage: (language: 'en' | 'bn') => void;
  onOpenMenu: () => void;
  userInitial: string;
}

export function PatientPortalHeader({
  language,
  onChangeLanguage,
  onOpenMenu,
  userInitial,
}: PatientPortalHeaderProps) {
  return (
    <header className="patient-shell-topbar">
      <div className="flex justify-between items-center w-full px-4 md:px-8 py-3.5 max-w-screen-2xl mx-auto">
        <div className="flex items-center gap-3">
          <button
            onClick={onOpenMenu}
            className="lg:hidden p-2 -ml-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-all"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-600 to-emerald-500 flex items-center justify-center shadow-md shadow-emerald-500/20">
            <Activity className="w-4.5 h-4.5 text-white" />
          </div>
          <span className="text-lg font-bold tracking-tight text-emerald-800 hidden sm:block">Ozzyl Health</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-slate-100 rounded-lg p-0.5 border border-slate-200 shadow-sm mr-2 sm:mr-0">
            <button
              onClick={() => onChangeLanguage('en')}
              className={`flex items-center justify-center px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-md text-xs font-semibold transition-all ${
                language === 'en'
                  ? 'bg-white text-emerald-700 shadow-sm ring-1 ring-slate-200/50'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
              aria-label="English"
            >
              EN
            </button>
            <button
              onClick={() => onChangeLanguage('bn')}
              className={`flex items-center justify-center px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-md text-xs font-semibold transition-all ${
                language === 'bn'
                  ? 'bg-white text-emerald-700 shadow-sm ring-1 ring-slate-200/50'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
              aria-label="Bangla"
            >
              বাংলা
            </button>
          </div>
          <button className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-all">
            <Bell className="w-5 h-5" />
          </button>
          <button className="hidden md:block p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-all">
            <Settings className="w-5 h-5" />
          </button>
          <div className="w-9 h-9 rounded-full bg-emerald-100 border-2 border-emerald-200 flex items-center justify-center text-emerald-700 font-bold text-sm shadow-sm">
            {userInitial}
          </div>
        </div>
      </div>
    </header>
  );
}
