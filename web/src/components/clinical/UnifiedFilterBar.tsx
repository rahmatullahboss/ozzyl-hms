import { useState } from 'react';
import { X, ChevronDown, Calendar, Filter, ChevronUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export interface FilterState {
  dateRange: { start: string; end: string } | null;
  preset: 'today' | '7d' | '30d' | '6m' | '1y' | 'custom' | null;
  providerId: number | null;
  encounterType: string | null;
  eventType: string | null;
}

interface UnifiedFilterBarProps {
  filters: FilterState;
  onFilterChange: (filters: FilterState) => void;
  providers?: { id: number; name: string }[];
  showEncounterType?: boolean;
  showEventType?: boolean;
  compact?: boolean;
}

const PRESETS = [
  { key: 'today' as const, label: 'Today' },
  { key: '7d' as const, label: '7D' },
  { key: '30d' as const, label: '30D' },
  { key: '6m' as const, label: '6M' },
  { key: '1y' as const, label: '1Y' },
  { key: 'custom' as const, label: 'Custom' },
];

const ENCOUNTER_TYPES = [
  { value: 'OPD', label: 'OPD' },
  { value: 'IPD', label: 'IPD' },
  { value: 'Emergency', label: 'Emergency' },
  { value: 'Telehealth', label: 'Telehealth' },
];

const EVENT_TYPES = [
  { key: 'visits', label: 'Visits' },
  { key: 'prescriptions', label: 'Prescriptions' },
  { key: 'labs', label: 'Labs' },
  { key: 'admissions', label: 'Admissions' },
  { key: 'documents', label: 'Documents' },
];

const EMPTY_FILTERS: FilterState = {
  dateRange: null,
  preset: null,
  providerId: null,
  encounterType: null,
  eventType: null,
};

function computePresetRange(preset: string): { start: string; end: string } {
  const now = new Date();
  const end = now.toISOString().slice(0, 10);
  let start: string;
  switch (preset) {
    case 'today':
      start = end;
      break;
    case '7d': {
      const d = new Date(now);
      d.setDate(d.getDate() - 7);
      start = d.toISOString().slice(0, 10);
      break;
    }
    case '30d': {
      const d = new Date(now);
      d.setDate(d.getDate() - 30);
      start = d.toISOString().slice(0, 10);
      break;
    }
    case '6m': {
      const d = new Date(now);
      d.setMonth(d.getMonth() - 6);
      start = d.toISOString().slice(0, 10);
      break;
    }
    case '1y': {
      const d = new Date(now);
      d.setFullYear(d.getFullYear() - 1);
      start = d.toISOString().slice(0, 10);
      break;
    }
    default:
      start = end;
  }
  return { start, end };
}

export default function UnifiedFilterBar({
  filters,
  onFilterChange,
  providers = [],
  showEncounterType = false,
  showEventType = false,
  compact = false,
}: UnifiedFilterBarProps) {
  const { t } = useTranslation(['common']);
  const [mobileOpen, setMobileOpen] = useState(false);

  const hasActiveFilter =
    filters.preset !== null ||
    filters.providerId !== null ||
    filters.encounterType !== null ||
    filters.eventType !== null ||
    filters.dateRange !== null;

  const handlePreset = (preset: FilterState['preset']) => {
    if (filters.preset === preset) {
      onFilterChange({ ...filters, preset: null, dateRange: null });
    } else if (preset === 'custom') {
      onFilterChange({ ...filters, preset: 'custom' });
    } else {
      const range = computePresetRange(preset!);
      onFilterChange({ ...filters, preset, dateRange: range });
    }
  };

  const handleProvider = (providerId: number | null) => {
    onFilterChange({ ...filters, providerId });
  };

  const handleEncounterType = (encounterType: string | null) => {
    onFilterChange({ ...filters, encounterType });
  };

  const handleEventType = (eventType: string | null) => {
    onFilterChange({ ...filters, eventType });
  };

  const handleDateChange = (field: 'start' | 'end', value: string) => {
    const current = filters.dateRange ?? { start: '', end: '' };
    onFilterChange({
      ...filters,
      dateRange: { ...current, [field]: value },
      preset: 'custom',
    });
  };

  const clearFilter = (key: keyof FilterState) => {
    onFilterChange({ ...filters, [key]: null });
  };

  const clearAll = () => {
    onFilterChange({ ...EMPTY_FILTERS });
  };

  const activeChips: { key: string; label: string; onRemove: () => void }[] = [];
  if (filters.preset) {
    const presetLabel = PRESETS.find((p) => p.key === filters.preset)?.label ?? filters.preset;
    activeChips.push({
      key: 'preset',
      label: presetLabel,
      onRemove: () => clearFilter('preset'),
    });
  }
  if (filters.providerId !== null) {
    const providerName = providers.find((p) => p.id === filters.providerId)?.name ?? `ID: ${filters.providerId}`;
    activeChips.push({
      key: 'providerId',
      label: providerName,
      onRemove: () => clearFilter('providerId'),
    });
  }
  if (filters.encounterType) {
    activeChips.push({
      key: 'encounterType',
      label: filters.encounterType,
      onRemove: () => clearFilter('encounterType'),
    });
  }
  if (filters.eventType) {
    activeChips.push({
      key: 'eventType',
      label: filters.eventType,
      onRemove: () => clearFilter('eventType'),
    });
  }

  return (
    <div
      data-testid="unified-filter-bar"
      className={`rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 space-y-3 ${compact ? 'compact' : ''}`}
    >
      {/* Mobile toggle */}
      <div className="flex items-center justify-between md:hidden">
        <div className="flex items-center gap-1.5 text-sm font-medium text-[var(--color-text)]">
          <Filter className="w-4 h-4" />
          {t('filters', { defaultValue: 'Filters' })}
        </div>
        <button
          type="button"
          onClick={() => setMobileOpen(!mobileOpen)}
          className="p-1 rounded hover:bg-gray-100"
          aria-label={mobileOpen ? 'Collapse filters' : 'Expand filters'}
        >
          {mobileOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {/* Filter controls - always visible on md+, toggle on mobile */}
      <div className={`space-y-3 ${mobileOpen ? 'block' : 'hidden'} md:block`}>
        {/* Date presets row */}
        <div className="flex flex-wrap items-center gap-2">
          <Calendar className="w-4 h-4 text-[var(--color-text-muted)] hidden md:block" />
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => handlePreset(p.key)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition ${
                filters.preset === p.key
                  ? 'bg-[var(--color-primary)] text-white active'
                  : 'bg-gray-100 text-[var(--color-text-muted)] hover:bg-gray-200'
              }`}
            >
              {t(`preset.${p.key}`, { defaultValue: p.label })}
            </button>
          ))}
        </div>

        {/* Custom date inputs */}
        {filters.preset === 'custom' && (
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs text-[var(--color-text-muted)]">
              {t('startDate', { defaultValue: 'Start Date' })}
              <input
                type="date"
                aria-label={t('startDate', { defaultValue: 'Start Date' })}
                value={filters.dateRange?.start ?? ''}
                onChange={(e) => handleDateChange('start', e.target.value)}
                className="ml-1 px-2 py-1 text-xs border border-[var(--color-border)] rounded-md bg-[var(--color-surface)]"
              />
            </label>
            <label className="text-xs text-[var(--color-text-muted)]">
              {t('endDate', { defaultValue: 'End Date' })}
              <input
                type="date"
                aria-label={t('endDate', { defaultValue: 'End Date' })}
                value={filters.dateRange?.end ?? ''}
                onChange={(e) => handleDateChange('end', e.target.value)}
                className="ml-1 px-2 py-1 text-xs border border-[var(--color-border)] rounded-md bg-[var(--color-surface)]"
              />
            </label>
          </div>
        )}

        {/* Dropdowns row */}
        <div className="flex flex-wrap items-center gap-3">
          {providers.length > 0 && (
            <label className="text-xs text-[var(--color-text-muted)] flex items-center gap-1">
              {t('provider', { defaultValue: 'Provider' })}
              <select
                aria-label={t('provider', { defaultValue: 'Provider' })}
                value={filters.providerId ?? ''}
                onChange={(e) => handleProvider(e.target.value ? Number(e.target.value) : null)}
                className="ml-1 px-2 py-1.5 text-xs border border-[var(--color-border)] rounded-md bg-[var(--color-surface)]"
              >
                <option value="">{t('all', { defaultValue: 'All' })}</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          {showEncounterType && (
            <label className="text-xs text-[var(--color-text-muted)] flex items-center gap-1">
              {t('encounterType', { defaultValue: 'Encounter Type' })}
              <select
                aria-label={t('encounterType', { defaultValue: 'Encounter Type' })}
                value={filters.encounterType ?? ''}
                onChange={(e) => handleEncounterType(e.target.value || null)}
                className="ml-1 px-2 py-1.5 text-xs border border-[var(--color-border)] rounded-md bg-[var(--color-surface)]"
              >
                <option value="">{t('all', { defaultValue: 'All' })}</option>
                {ENCOUNTER_TYPES.map((et) => (
                  <option key={et.value} value={et.value}>
                    {t(`encounter.${et.value.toLowerCase()}`, { defaultValue: et.label })}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {/* Event type pills */}
        {showEventType && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => handleEventType(null)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition ${
                filters.eventType === null
                  ? 'bg-[var(--color-primary)] text-white active'
                  : 'bg-gray-100 text-[var(--color-text-muted)] hover:bg-gray-200'
              }`}
            >
              {t('all', { defaultValue: 'All' })}
            </button>
            {EVENT_TYPES.map((et) => (
              <button
                key={et.key}
                type="button"
                onClick={() => handleEventType(filters.eventType === et.key ? null : et.key)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition ${
                  filters.eventType === et.key
                    ? 'bg-[var(--color-primary)] text-white active'
                    : 'bg-gray-100 text-[var(--color-text-muted)] hover:bg-gray-200'
                }`}
              >
                {t(`eventType.${et.key}`, { defaultValue: et.label })}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Active filter chips + Clear All */}
      {hasActiveFilter && (
        <div data-testid="active-filters" className="flex flex-wrap items-center gap-2 pt-2 border-t border-[var(--color-border)]">
          {activeChips.map((chip) => (
            <span
              key={chip.key}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs bg-blue-50 text-blue-700 border border-blue-200"
            >
              {chip.label}
              <button
                type="button"
                aria-label={`Remove ${chip.label}`}
                onClick={chip.onRemove}
                className="hover:bg-blue-100 rounded-full p-0.5"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
          <button
            type="button"
            onClick={clearAll}
            className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] underline"
          >
            {t('clearAll', { defaultValue: 'Clear All' })}
          </button>
        </div>
      )}
    </div>
  );
}
