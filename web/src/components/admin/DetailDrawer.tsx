import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface DetailDrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: 'sm' | 'md' | 'lg';
  loading?: boolean;
}

const widthClasses = {
  sm: 'w-screen sm:w-96',
  md: 'w-screen sm:w-[32rem]',
  lg: 'w-screen sm:w-[42rem]',
};

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export function DrawerField({ label, value, className = '' }: { label: string; value: ReactNode; className?: string }) {
  return (
    <div className={`py-2 ${className}`}>
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-0.5 text-sm font-semibold text-slate-900">{value ?? '-'}</div>
    </div>
  );
}

export function DrawerSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-4">
      <h3 className="mb-2 border-b border-slate-200 pb-2 text-sm font-bold text-slate-800">{title}</h3>
      {children}
    </section>
  );
}

export default function DetailDrawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  width = 'md',
  loading = false,
}: DetailDrawerProps) {
  const { t } = useTranslation('common');
  const titleId = useId();
  const subtitleId = useId();
  const drawerRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusFrame = window.requestAnimationFrame(() => {
      const focusable = drawerRef.current?.querySelector<HTMLElement>(
        'button:not([disabled]):not([data-drawer-close]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      (focusable ?? closeRef.current)?.focus();
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (document.querySelector('[data-approval-decision-dialog="true"]')) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !drawerRef.current) return;
      const focusable = Array.from(drawerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocusRef.current?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40" role="presentation">
      <div
        className="absolute inset-0 bg-slate-950/35 backdrop-blur-[1px]"
        aria-hidden="true"
        onClick={onClose}
      />
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitle ? subtitleId : undefined}
        className={`fixed inset-0 z-50 flex h-full flex-col border-l border-slate-200 bg-white shadow-2xl sm:inset-y-0 sm:left-auto sm:right-0 ${widthClasses[width]}`}
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <h2 id={titleId} className="truncate text-lg font-bold text-slate-950">{title}</h2>
            {subtitle && <p id={subtitleId} className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
          </div>
          <button
            ref={closeRef}
            data-drawer-close
            type="button"
            onClick={onClose}
            aria-label={`Close ${title}`}
            className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-600 transition hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          {loading ? (
            <div className="flex items-center justify-center py-12" role="status">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
              <span className="sr-only">{t('details.loading')}</span>
            </div>
          ) : children}
        </div>

        {footer && (
          <footer className="border-t border-slate-200 bg-white px-4 py-3 sm:px-6">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}
