import { useTranslation } from 'react-i18next';

export interface ProcedureNoteData {
  site: string;
  procedureDetails: string;
  findings: string;
  complications: string;
  freeText: string;
}

interface Props {
  data: ProcedureNoteData;
  onChange: (field: keyof ProcedureNoteData, value: string) => void;
  disabled?: boolean;
}

export default function ProcedureNote({ data, onChange, disabled }: Props) {
  const { t } = useTranslation(['clinical']);

  return (
    <div className="space-y-4">
      <div>
        <label className="label">{t('notes.fields.site', 'Site')}</label>
        <input
          type="text"
          className="input"
          value={data.site}
          onChange={e => onChange('site', e.target.value)}
          placeholder={t('notes.placeholders.site', 'Procedure site')}
          disabled={disabled}
        />
      </div>
      <div>
        <label className="label">{t('notes.fields.procedureDetails', 'Procedure Details')}</label>
        <textarea
          className="input min-h-[80px]"
          value={data.procedureDetails}
          onChange={e => onChange('procedureDetails', e.target.value)}
          placeholder={t('notes.placeholders.procedureDetails', 'Detailed procedure description...')}
          disabled={disabled}
        />
      </div>
      <div>
        <label className="label">{t('notes.fields.findings', 'Findings')}</label>
        <textarea
          className="input min-h-[80px]"
          value={data.findings}
          onChange={e => onChange('findings', e.target.value)}
          placeholder={t('notes.placeholders.findings', 'Procedure findings...')}
          disabled={disabled}
        />
      </div>
      <div>
        <label className="label">{t('notes.fields.complications', 'Complications')}</label>
        <textarea
          className="input min-h-[80px]"
          value={data.complications}
          onChange={e => onChange('complications', e.target.value)}
          placeholder={t('notes.placeholders.complications', 'Any complications encountered...')}
          disabled={disabled}
        />
      </div>
      <div>
        <label className="label">{t('notes.fields.freeText', 'Free Text')}</label>
        <textarea
          className="input min-h-[100px]"
          value={data.freeText}
          onChange={e => onChange('freeText', e.target.value)}
          placeholder={t('notes.placeholders.freeText', 'Additional notes...')}
          disabled={disabled}
        />
      </div>
    </div>
  );
}
