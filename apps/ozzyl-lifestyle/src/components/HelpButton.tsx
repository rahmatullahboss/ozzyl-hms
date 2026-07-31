import { HelpCircle } from 'lucide-react';

interface HelpButtonProps {
  onClick: () => void;
  className?: string;
}

/**
 * The small "?" button that triggers the Help Panel.
 * Drop it into any page header section.
 */
export default function HelpButton({ onClick, className = '' }: HelpButtonProps) {
  return (
    <button
      onClick={onClick}
      title="Help & Tutorial"
      aria-label="Open help panel"
      className={`btn-ghost p-2 rounded-lg flex items-center gap-1.5 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] hover:bg-[var(--color-primary-light)] transition-colors ${className}`}
    >
      <HelpCircle className="w-5 h-5" />
      <span className="hidden sm:inline text-sm font-medium">Help</span>
    </button>
  );
}
