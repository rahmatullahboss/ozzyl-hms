interface SectionSubTab {
  id: string;
  label: string;
}

interface SectionSubTabsProps {
  tabs: SectionSubTab[];
  activeId: string;
  onChange: (id: string) => void;
}

export function SectionSubTabs({ tabs, activeId, onChange }: SectionSubTabsProps) {
  return (
    <div className="flex gap-1.5 overflow-x-auto scrollbar-none py-1 -mx-1 px-1">
      {tabs.map((tab) => {
        const isActive = tab.id === activeId;
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className={`shrink-0 px-4 py-2 rounded-xl text-sm font-semibold transition-all duration-200 ${
              isActive
                ? 'bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-md shadow-emerald-500/20'
                : 'bg-white/70 text-slate-500 hover:bg-white hover:text-slate-700 hover:shadow-sm border border-slate-100'
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
