import { useTranslation } from 'react-i18next';

export interface FreeTextNoteData {
  content: string;
}

interface Props {
  data: FreeTextNoteData;
  onChange: (field: keyof FreeTextNoteData, value: string) => void;
  disabled?: boolean;
}

export default function FreeTextNote({ data, onChange, disabled }: Props) {
  const { t } = useTranslation(['clinical']);

  return (
    <div className="space-y-4">
      <div>
        <label className="label">{t('notes.fields.freeText', 'Free Text')}</label>
        <textarea
          className="input min-h-[200px]"
          value={data.content}
          onChange={e => onChange('content', e.target.value)}
          placeholder={t('notes.placeholders.freeTextLarge', 'Enter clinical note...')}
          disabled={disabled}
        />
      </div>
    </div>
  );
}
