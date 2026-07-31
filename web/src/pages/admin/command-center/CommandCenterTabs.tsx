import type { KeyboardEvent } from 'react';
import {
  Activity,
  BedDouble,
  ClipboardList,
  FlaskConical,
  LayoutDashboard,
  PackageSearch,
  Stethoscope,
  WalletCards,
  type LucideIcon,
} from 'lucide-react';
import {
  COMMAND_CENTER_TABS,
  type CommandCenterTab,
} from './commandCenterUrlState';

const TAB_LABELS: Record<CommandCenterTab, string> = {
  overview: 'Overview',
  money: 'Money',
  doctors: 'Doctors',
  patients: 'Patients',
  ipd: 'IPD',
  diagnostics: 'Diagnostics',
  inventory: 'Inventory',
  audit: 'Audit',
};

const TAB_ICONS: Record<CommandCenterTab, LucideIcon> = {
  overview: LayoutDashboard,
  money: WalletCards,
  doctors: Stethoscope,
  patients: ClipboardList,
  ipd: BedDouble,
  diagnostics: FlaskConical,
  inventory: PackageSearch,
  audit: Activity,
};

export interface CommandCenterTabChangeOptions {
  focusWorkspace?: boolean;
}

interface Props {
  activeTab: CommandCenterTab;
  onChange: (tab: CommandCenterTab, options?: CommandCenterTabChangeOptions) => void;
}

export function commandCenterTabLabel(tab: CommandCenterTab): string {
  return TAB_LABELS[tab];
}

export default function CommandCenterTabs({ activeTab, onChange }: Props) {
  const selectAt = (index: number) => {
    const normalized = (index + COMMAND_CENTER_TABS.length) % COMMAND_CENTER_TABS.length;
    const tab = COMMAND_CENTER_TABS[normalized];
    onChange(tab, { focusWorkspace: true });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      selectAt(index + 1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      selectAt(index - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      selectAt(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      selectAt(COMMAND_CENTER_TABS.length - 1);
    }
  };

  return (
    <nav
      className="overflow-x-auto rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-2 shadow-sm"
      aria-label="Admin Command Center workspaces"
    >
      <div className="flex min-w-max gap-1" role="tablist" aria-label="Workspaces">
        {COMMAND_CENTER_TABS.map((tab, index) => {
          const Icon = TAB_ICONS[tab];
          const active = tab === activeTab;
          return (
            <button
              key={tab}
              id={`command-center-tab-${tab}`}
              type="button"
              role="tab"
              aria-controls={`command-center-panel-${tab}`}
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              onClick={() => onChange(tab, { focusWorkspace: false })}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition-colors duration-200 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 ${active
                ? 'bg-[var(--color-primary)] text-white shadow-sm'
                : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-muted)] hover:text-[var(--color-text-primary)]'}`}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              <span>{TAB_LABELS[tab]}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
