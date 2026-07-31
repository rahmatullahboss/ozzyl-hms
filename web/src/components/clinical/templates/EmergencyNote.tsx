import { useTranslation } from 'react-i18next';

export interface EmergencyNoteData {
  modeOfArrival: string;
  broughtBy: string;
  phoneNumber: string;
  triageTime: string;
  triagedBy: string;
  trauma: boolean;
  disposition: string;
  erCourseDescription: string;
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
}

interface Props {
  data: EmergencyNoteData;
  onChange: (field: keyof EmergencyNoteData, value: string | boolean) => void;
  disabled?: boolean;
}

export default function EmergencyNote({ data, onChange, disabled }: Props) {
  const { t } = useTranslation(['clinical']);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="label">{t('notes.fields.modeOfArrival', 'Mode of Arrival')}</label>
          <select
            className="input"
            value={data.modeOfArrival}
            onChange={e => onChange('modeOfArrival', e.target.value)}
            disabled={disabled}
          >
            <option value="">{t('notes.placeholders.selectMode', 'Select mode...')}</option>
            <option value="ambulance">{t('notes.arrivalModes.ambulance', 'Ambulance')}</option>
            <option value="walk-in">{t('notes.arrivalModes.walkIn', 'Walk-in')}</option>
            <option value="referred">{t('notes.arrivalModes.referred', 'Referred')}</option>
            <option value="police">{t('notes.arrivalModes.police', 'Police')}</option>
          </select>
        </div>
        <div>
          <label className="label">{t('notes.fields.broughtBy', 'Brought By')}</label>
          <input
            type="text"
            className="input"
            value={data.broughtBy}
            onChange={e => onChange('broughtBy', e.target.value)}
            placeholder={t('notes.placeholders.broughtBy', 'Name of person')}
            disabled={disabled}
          />
        </div>
        <div>
          <label className="label">{t('notes.fields.phoneNumber', 'Phone Number')}</label>
          <input
            type="text"
            className="input"
            value={data.phoneNumber}
            onChange={e => onChange('phoneNumber', e.target.value)}
            placeholder={t('notes.placeholders.phoneNumber', 'Contact number')}
            disabled={disabled}
          />
        </div>
        <div>
          <label className="label">{t('notes.fields.triageTime', 'Triage Time')}</label>
          <input
            type="datetime-local"
            className="input"
            value={data.triageTime}
            onChange={e => onChange('triageTime', e.target.value)}
            disabled={disabled}
          />
        </div>
        <div>
          <label className="label">{t('notes.fields.triagedBy', 'Triaged By')}</label>
          <input
            type="text"
            className="input"
            value={data.triagedBy}
            onChange={e => onChange('triagedBy', e.target.value)}
            placeholder={t('notes.placeholders.triagedBy', 'Staff name')}
            disabled={disabled}
          />
        </div>
        <div>
          <label className="label">{t('notes.fields.disposition', 'Disposition')}</label>
          <select
            className="input"
            value={data.disposition}
            onChange={e => onChange('disposition', e.target.value)}
            disabled={disabled}
          >
            <option value="">{t('notes.placeholders.selectDisposition', 'Select disposition...')}</option>
            <option value="admit">{t('notes.dispositions.admit', 'Admit')}</option>
            <option value="discharge">{t('notes.dispositions.discharge', 'Discharge')}</option>
            <option value="transfer">{t('notes.dispositions.transfer', 'Transfer')}</option>
            <option value="AMA">{t('notes.dispositions.ama', 'AMA')}</option>
            <option value="expired">{t('notes.dispositions.expired', 'Expired')}</option>
          </select>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="trauma"
          checked={data.trauma}
          onChange={e => onChange('trauma', e.target.checked)}
          disabled={disabled}
          className="rounded"
        />
        <label htmlFor="trauma" className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {t('notes.fields.trauma', 'Trauma')}
        </label>
      </div>

      <div>
        <label className="label">{t('notes.fields.erCourseDescription', 'ER Course Description')}</label>
        <textarea
          className="input min-h-[80px]"
          value={data.erCourseDescription}
          onChange={e => onChange('erCourseDescription', e.target.value)}
          placeholder={t('notes.placeholders.erCourseDescription', 'Description of ER course...')}
          disabled={disabled}
        />
      </div>
      <div>
        <label className="label">{t('notes.fields.subjective', 'Subjective')}</label>
        <textarea
          className="input min-h-[80px]"
          value={data.subjective}
          onChange={e => onChange('subjective', e.target.value)}
          placeholder={t('notes.placeholders.subjective', 'Patient reported symptoms...')}
          disabled={disabled}
        />
      </div>
      <div>
        <label className="label">{t('notes.fields.objective', 'Objective')}</label>
        <textarea
          className="input min-h-[80px]"
          value={data.objective}
          onChange={e => onChange('objective', e.target.value)}
          placeholder={t('notes.placeholders.objective', 'Physical examination findings...')}
          disabled={disabled}
        />
      </div>
      <div>
        <label className="label">{t('notes.fields.assessment', 'Assessment')}</label>
        <textarea
          className="input min-h-[80px]"
          value={data.assessment}
          onChange={e => onChange('assessment', e.target.value)}
          placeholder={t('notes.placeholders.assessment', 'Clinical impression...')}
          disabled={disabled}
        />
      </div>
      <div>
        <label className="label">{t('notes.fields.plan', 'Plan')}</label>
        <textarea
          className="input min-h-[80px]"
          value={data.plan}
          onChange={e => onChange('plan', e.target.value)}
          placeholder={t('notes.placeholders.plan', 'Treatment plan...')}
          disabled={disabled}
        />
      </div>
    </div>
  );
}
