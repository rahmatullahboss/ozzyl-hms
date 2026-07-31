import { useState, useCallback, memo } from 'react';
import { Pill, Search, Clock, Calendar, Route, ClipboardList, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export interface QuickRxItem {
  medicine_name: string;
  dosage: string;
  frequency: string;
  duration: string;
  instructions: string;
  route?: string;
  medicineId?: number | null;
}

interface QuickPrescriptionFormProps {
  rxItems: QuickRxItem[];
  onAddItem: (item?: Partial<QuickRxItem>) => void;
  onUpdateItem: (index: number, field: keyof QuickRxItem, value: string) => void;
  onRemoveItem: (index: number) => void;
  rxSearch: string;
  onRxSearchChange: (value: string) => void;
  rxResults: { name: string; generic?: string | null; manufacturer?: string | null; strength?: string | null; dosage_form?: string | null; default_frequency?: string | null; default_duration?: string | null; default_instructions?: string | null }[];
  onSelectMedicine: (medicine: QuickPrescriptionFormProps['rxResults'][number]) => void;
}

const DOSAGE_BUTTONS = [
  { value: '1+0+0', label: '1+0+0', description: 'Once daily morning' },
  { value: '0+1+0', label: '0+1+0', description: 'Once daily noon' },
  { value: '0+0+1', label: '0+0+1', description: 'Once daily night' },
  { value: '1+0+1', label: '1+0+1', description: 'Twice daily' },
  { value: '1+1+1', label: '1+1+1', description: 'Three times daily' },
  { value: '½+0+½', label: '½+0+½', description: 'Half dose twice' },
  { value: 'SOS', label: 'SOS', description: 'As needed' },
  { value: 'Stat', label: 'Stat', description: 'Immediately' },
  { value: 'Weekly', label: 'Weekly', description: 'Once weekly' },
  { value: 'Monthly', label: 'Monthly', description: 'Once monthly' },
];

const MEAL_TIMING_BUTTONS = [
  { value: 'খাবার আগে', label: 'খাবার আগে', description: 'Before meal' },
  { value: 'খাবার পরে', label: 'খাবার পরে', description: 'After meal' },
  { value: 'খালি পেটে', label: 'খালি পেটে', description: 'Empty stomach' },
  { value: 'রাতে ঘুমানোর আগে', label: 'রাতে ঘুমানোর আগে', description: 'Before sleep' },
  { value: 'প্রয়োজন হলে', label: 'প্রয়োজন হলে', description: 'When needed' },
];

const DURATION_BUTTONS = [
  { value: '৩ দিন', label: '৩ দিন', description: '3 days' },
  { value: '৫ দিন', label: '৫ দিন', description: '5 days' },
  { value: '৭ দিন', label: '৭ দিন', description: '7 days' },
  { value: '১০ দিন', label: '১০ দিন', description: '10 days' },
  { value: '১৪ দিন', label: '১৪ দিন', description: '14 days' },
  { value: '১ মাস', label: '১ মাস', description: '1 month' },
  { value: 'চলবে', label: 'চলবে', description: 'Continue' },
];

const ROUTE_OPTIONS = [
  { value: 'Oral', label: 'Oral' },
  { value: 'IV', label: 'IV' },
  { value: 'IM', label: 'IM' },
  { value: 'SC', label: 'SC' },
  { value: 'Inhalation', label: 'Inhalation' },
  { value: 'Topical', label: 'Topical' },
  { value: 'Eye drop', label: 'Eye drop' },
  { value: 'Ear drop', label: 'Ear drop' },
  { value: 'Nasal', label: 'Nasal' },
  { value: 'PR', label: 'PR' },
];

const INSTRUCTION_SEP = '\u001F';

const INSTRUCTION_CHECKBOXES = [
  { value: 'কোর্স সম্পূর্ণ করবেন', label: 'কোর্স সম্পূর্ণ করবেন', description: 'Complete the course' },
  { value: 'বেশি পানি খাবেন', label: 'বেশি পানি খাবেন', description: 'Drink plenty of water' },
  { value: 'ঘুম ঘুম ভাব হতে পারে', label: 'ঘুম ঘুম ভাব হতে পারে', description: 'May cause drowsiness' },
  { value: 'গাড়ি চালাবেন না', label: 'গাড়ি চালাবেন না', description: 'Don\'t drive' },
  { value: 'খাবারের সাথে খাবেন', label: 'খাবারের সাথে খাবেন', description: 'Take with food' },
];

export const QuickPrescriptionForm = memo(function QuickPrescriptionForm({
  rxItems,
  onAddItem,
  onUpdateItem,
  onRemoveItem,
  rxSearch,
  onRxSearchChange,
  rxResults,
  onSelectMedicine,
}: QuickPrescriptionFormProps) {
  const { t } = useTranslation(['dashboard', 'common']);
  const [selectedItemIndex, setSelectedItemIndex] = useState<number | null>(null);

  const activeIndex = selectedItemIndex ?? (rxItems.length > 0 ? rxItems.length - 1 : null);

  const handleDosageClick = useCallback((dosage: string) => {
    if (activeIndex !== null && activeIndex < rxItems.length) {
      onUpdateItem(activeIndex, 'dosage', dosage);
    }
  }, [activeIndex, rxItems.length, onUpdateItem]);

  const handleMealTimingClick = useCallback((timing: string) => {
    if (activeIndex !== null && activeIndex < rxItems.length) {
      const currentInstructions = rxItems[activeIndex].instructions;
      const newInstructions = currentInstructions
        ? `${currentInstructions}${INSTRUCTION_SEP}${timing}`
        : timing;
      onUpdateItem(activeIndex, 'instructions', newInstructions);
    }
  }, [activeIndex, rxItems, onUpdateItem]);

  const handleDurationClick = useCallback((duration: string) => {
    if (activeIndex !== null && activeIndex < rxItems.length) {
      onUpdateItem(activeIndex, 'duration', duration);
    }
  }, [activeIndex, rxItems.length, onUpdateItem]);

  const handleRouteChange = useCallback((route: string) => {
    if (activeIndex !== null && activeIndex < rxItems.length) {
      onUpdateItem(activeIndex, 'route', route);
    }
  }, [activeIndex, rxItems.length, onUpdateItem]);

  const handleInstructionToggle = useCallback((instruction: string) => {
    if (activeIndex !== null && activeIndex < rxItems.length) {
      const currentInstructions = rxItems[activeIndex].instructions;
      const instructionsList = currentInstructions
        ? currentInstructions.split(INSTRUCTION_SEP).filter(Boolean)
        : [];
      const exists = instructionsList.includes(instruction);
      const newInstructions = exists
        ? instructionsList.filter(i => i !== instruction).join(INSTRUCTION_SEP)
        : [...instructionsList, instruction].join(INSTRUCTION_SEP);
      onUpdateItem(activeIndex, 'instructions', newInstructions);
    }
  }, [activeIndex, rxItems, onUpdateItem]);

  const handleSelectMedicine = useCallback((medicine: QuickPrescriptionFormProps['rxResults'][number]) => {
    onSelectMedicine(medicine);
    onRxSearchChange('');
    if (rxItems.length > 0) {
      setSelectedItemIndex(rxItems.length);
    }
  }, [onSelectMedicine, onRxSearchChange, rxItems.length]);

  return (
    <div className="space-y-3">
      <div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--color-text-muted)]" />
          <input
            className="input text-sm pl-9"
            value={rxSearch}
            onChange={(e) => onRxSearchChange(e.target.value)}
            placeholder={t('searchMedicine', { defaultValue: 'Search medicine by brand or generic' })}
            aria-label={t('searchMedicine', { defaultValue: 'Search medicine' })}
          />
        </div>
        {rxResults.length > 0 && (
          <div className="mt-1 max-h-44 overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] shadow-sm">
            {rxResults.slice(0, 7).map((medicine, index) => (
              <button
                key={`${medicine.name}-${index}`}
                type="button"
                onClick={() => handleSelectMedicine(medicine)}
                className="w-full px-3 py-2 text-left text-sm hover:bg-[var(--color-surface)]"
              >
                <span className="font-medium text-[var(--color-text)]">{medicine.name}</span>
                <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">
                  {[medicine.strength, medicine.dosage_form].filter(Boolean).map((detail) => (
                    <span key={detail} className="rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[11px] text-[var(--color-text)]">
                      {detail}
                    </span>
                  ))}
                </span>
                {(medicine.generic || medicine.manufacturer) && (
                  <span className="mt-1 block text-xs text-[var(--color-text-muted)]">
                    {[medicine.generic, medicine.manufacturer].filter(Boolean).join(' · ')}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)]">
        {rxItems.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-[var(--color-text-muted)]">
            <Pill className="mx-auto mb-2 h-7 w-7 opacity-30" />
            {t('noMedicineAdded', { defaultValue: 'No medicine added. Search or tap a quick medicine.' })}
          </div>
        ) : (
          <div className="divide-y divide-[var(--color-border)]">
            {rxItems.map((rxItem, index) => (
              <div
                key={`${rxItem.medicine_name}-${index}`}
                className={`space-y-2 p-3 cursor-pointer ${activeIndex === index ? 'bg-[var(--color-primary)]/10' : ''}`}
                onClick={() => setSelectedItemIndex(index)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSelectedItemIndex(index); }}
              >
                <div className="flex items-center gap-2">
                  <input
                    className="input flex-1 text-sm"
                    value={rxItem.medicine_name}
                    onChange={(event) => {
                      event.stopPropagation();
                      onUpdateItem(index, 'medicine_name', event.target.value);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    placeholder={t('medicineName', { defaultValue: 'Medicine name' })}
                  />
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveItem(index);
                      if (selectedItemIndex === index) setSelectedItemIndex(null);
                    }}
                    className="btn-ghost p-2 text-red-500"
                    aria-label={t('removeMedicine', { defaultValue: 'Remove medicine' })}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    className="input text-xs"
                    value={rxItem.dosage}
                    onChange={(event) => {
                      event.stopPropagation();
                      onUpdateItem(index, 'dosage', event.target.value);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    placeholder={t('dose', { defaultValue: 'Dose' })}
                  />
                  <input
                    className="input text-xs"
                    value={rxItem.frequency}
                    onChange={(event) => {
                      event.stopPropagation();
                      onUpdateItem(index, 'frequency', event.target.value);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    placeholder={t('frequency', { defaultValue: 'Frequency' })}
                  />
                  <input
                    className="input text-xs"
                    value={rxItem.duration}
                    onChange={(event) => {
                      event.stopPropagation();
                      onUpdateItem(index, 'duration', event.target.value);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    placeholder={t('duration', { defaultValue: 'Duration' })}
                  />
                  <input
                    className="input text-xs"
                    value={rxItem.instructions}
                    onChange={(event) => {
                      event.stopPropagation();
                      onUpdateItem(index, 'instructions', event.target.value);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    placeholder={t('instruction', { defaultValue: 'Instruction' })}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <button type="button" onClick={() => onAddItem()} className="btn-ghost w-full justify-center text-xs">
        <Plus className="h-3.5 w-3.5" />
        {t('addBlankMedicine', { defaultValue: 'Add blank medicine' })}
      </button>

      {activeIndex !== null && activeIndex < rxItems.length && (
        <div className="space-y-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-[var(--color-text-muted)] mb-2 flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              {t('quickDosage', { defaultValue: 'Quick Dosage' })}
            </p>
            <div className="flex flex-wrap gap-2">
              {DOSAGE_BUTTONS.map((btn) => (
                <button
                  key={btn.value}
                  type="button"
                  onClick={() => handleDosageClick(btn.value)}
                  title={btn.description}
                  className={`rounded-full px-3 py-1 text-xs font-medium ${
                    rxItems[activeIndex].dosage === btn.value
                      ? 'bg-blue-600 text-white'
                      : 'bg-blue-50 text-blue-700 hover:bg-blue-100'
                  }`}
                >
                  {btn.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs uppercase tracking-wide text-[var(--color-text-muted)] mb-2 flex items-center gap-1">
              <Calendar className="h-3.5 w-3.5" />
              {t('mealTiming', { defaultValue: 'Meal Timing' })}
            </p>
            <div className="flex flex-wrap gap-2">
              {MEAL_TIMING_BUTTONS.map((btn) => (
                <button
                  key={btn.value}
                  type="button"
                  onClick={() => handleMealTimingClick(btn.value)}
                  title={btn.description}
                  className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100"
                >
                  {btn.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs uppercase tracking-wide text-[var(--color-text-muted)] mb-2 flex items-center gap-1">
              <Calendar className="h-3.5 w-3.5" />
              {t('quickDuration', { defaultValue: 'Quick Duration' })}
            </p>
            <div className="flex flex-wrap gap-2">
              {DURATION_BUTTONS.map((btn) => (
                <button
                  key={btn.value}
                  type="button"
                  onClick={() => handleDurationClick(btn.value)}
                  title={btn.description}
                  className={`rounded-full px-3 py-1 text-xs font-medium ${
                    rxItems[activeIndex].duration === btn.value
                      ? 'bg-purple-600 text-white'
                      : 'bg-purple-50 text-purple-700 hover:bg-purple-100'
                  }`}
                >
                  {btn.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs uppercase tracking-wide text-[var(--color-text-muted)] mb-2 flex items-center gap-1">
              <Route className="h-3.5 w-3.5" />
              {t('route', { defaultValue: 'Route' })}
            </p>
            <div className="flex flex-wrap gap-2">
              {ROUTE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => handleRouteChange(option.value)}
                  className={`rounded-full px-3 py-1 text-xs font-medium ${
                    rxItems[activeIndex].route === option.value
                      ? 'bg-emerald-600 text-white'
                      : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs uppercase tracking-wide text-[var(--color-text-muted)] mb-2 flex items-center gap-1">
              <ClipboardList className="h-3.5 w-3.5" />
              {t('medicineInstructions', { defaultValue: 'Medicine Instructions' })}
            </p>
            <div className="flex flex-wrap gap-2">
              {INSTRUCTION_CHECKBOXES.map((item) => {
                const isSelected = rxItems[activeIndex].instructions
                  ?.split(INSTRUCTION_SEP)
                  .filter(Boolean)
                  .includes(item.value);
                return (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => handleInstructionToggle(item.value)}
                    title={item.description}
                    className={`rounded-full px-3 py-1 text-xs font-medium ${
                      isSelected
                        ? 'bg-rose-600 text-white'
                        : 'bg-rose-50 text-rose-700 hover:bg-rose-100'
                    }`}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
