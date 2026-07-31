import { useEffect, useRef, type KeyboardEvent } from 'react';
import { AlertTriangle, Boxes, FlaskConical, LayoutDashboard } from 'lucide-react';
import {
  REAGENT_CONTROL_PRIMARY_TABS,
  type ReagentControlSection,
} from './reagentControlModel';

const ICONS = {
  overview: LayoutDashboard,
  stock: Boxes,
  recipes: FlaskConical,
  issues: AlertTriangle,
} as const;

export default function ReagentControlTabs({
  active,
  onChange,
}: {
  active: ReagentControlSection;
  onChange: (section: ReagentControlSection) => void;
}) {
  const focusRequestedRef = useRef(false);
  const tabRefs = useRef<Partial<Record<ReagentControlSection, HTMLButtonElement>>>({});

  useEffect(() => {
    if (!focusRequestedRef.current) return;
    tabRefs.current[active]?.focus();
    focusRequestedRef.current = false;
  }, [active]);

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | null = null;

    if (event.key === 'ArrowRight') nextIndex = (index + 1) % REAGENT_CONTROL_PRIMARY_TABS.length;
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + REAGENT_CONTROL_PRIMARY_TABS.length) % REAGENT_CONTROL_PRIMARY_TABS.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = REAGENT_CONTROL_PRIMARY_TABS.length - 1;

    if (nextIndex === null) return;
    event.preventDefault();
    focusRequestedRef.current = true;
    onChange(REAGENT_CONTROL_PRIMARY_TABS[nextIndex].id);
  }

  return (
    <div className="overflow-x-auto pb-1">
      <div
        role="tablist"
        aria-label="Reagent control sections"
        className="inline-flex min-w-full gap-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-1 sm:min-w-0"
      >
        {REAGENT_CONTROL_PRIMARY_TABS.map((tab, index) => {
          const Icon = ICONS[tab.id];
          const selected = active === tab.id;
          return (
            <button
              key={tab.id}
              ref={element => { if (element) tabRefs.current[tab.id] = element; }}
              id={`reagent-control-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`reagent-control-panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(tab.id)}
              onKeyDown={event => handleKeyDown(event, index)}
              className={`flex min-w-max flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition ${
                selected
                  ? 'bg-violet-600 text-white shadow-sm'
                  : 'text-[var(--color-text-muted)] hover:bg-[var(--color-bg-secondary)] hover:text-[var(--color-text)]'
              }`}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {tab.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
