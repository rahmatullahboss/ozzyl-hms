import { HelpCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface HelpButtonProps {
  onClick: () => void;
  className?: string;
}

/**
 * The small "?" button that triggers the Help Panel.
 * Drop it into any page header section.
 */
export default function HelpButton({ onClick, className = '' }: HelpButtonProps) {
  const { t } = useTranslation('common');

  return (
    <button
      onClick={onClick}
      title={t('help.openTutorial', { defaultValue: 'Help and tutorial' })}
      aria-label={t('help.openPanel', { defaultValue: 'Open help panel' })}
      className={`btn-ghost p-2 rounded-lg flex items-center gap-1.5 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] hover:bg-[var(--color-primary-light)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] ${className}`}
    >
      <HelpCircle className="w-5 h-5" />
      <span className="hidden sm:inline text-sm font-medium">
        {t('help.label', { defaultValue: 'Help' })}
      </span>
    </button>
  );
}
