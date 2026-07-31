import { useEffect, useRef } from 'react';
import { X, BookOpen, Lightbulb } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { helpContent, type HelpPageKey } from '../data/helpContent';

interface HelpPanelProps {
  pageKey: HelpPageKey;
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Slide-in help drawer that shows contextual tutorial content.
 * Usage:
 *   const [helpOpen, setHelpOpen] = useState(false);
 *   <HelpButton onClick={() => setHelpOpen(true)} />
 *   <HelpPanel pageKey="pharmacy" isOpen={helpOpen} onClose={() => setHelpOpen(false)} />
 */
export default function HelpPanel({ pageKey, isOpen, onClose }: HelpPanelProps) {
  const { i18n } = useTranslation();
  const lang = (i18n.language?.startsWith('bn') ? 'bn' : 'en') as 'en' | 'bn';
  const content = helpContent[pageKey]?.[lang] ?? helpContent[pageKey]?.['en'];
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    if (isOpen) document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  // Trap focus inside panel when open
  useEffect(() => {
    if (isOpen && panelRef.current) {
      panelRef.current.focus();
    }
  }, [isOpen]);

  if (!content) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-40 transition-opacity duration-300 ${isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
        style={{ background: 'rgba(0,0,0,0.35)' }}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={content.title}
        className={`
          fixed top-0 right-0 z-50 h-full w-full max-w-md
          bg-[var(--color-surface)] shadow-2xl
          flex flex-col outline-none
          transition-transform duration-300 ease-in-out
          ${isOpen ? 'translate-x-0' : 'translate-x-full'}
        `}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-[var(--color-border)] bg-gradient-to-r from-[var(--color-primary)] to-[var(--color-primary-dark,#005fa3)] text-white rounded-none">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-bold text-base leading-tight">{content.title}</h2>
              <p className="text-xs opacity-80 mt-0.5">{content.subtitle}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/20 transition-colors ml-2 shrink-0"
            aria-label="Close help"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">

          {/* Steps */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-widest text-[var(--color-text-muted)] mb-3">
              {lang === 'bn' ? 'ধাপে ধাপে নির্দেশিকা' : 'Step-by-Step Guide'}
            </h3>
            <ol className="space-y-3">
              {content.steps.map((step, idx) => (
                <li key={idx} className="flex gap-3">
                  {/* Step number + icon */}
                  <div className="flex flex-col items-center">
                    <div className="w-8 h-8 rounded-full bg-[var(--color-primary-light)] text-[var(--color-primary)] flex items-center justify-center text-base shrink-0 font-bold">
                      {step.icon}
                    </div>
                    {idx < content.steps.length - 1 && (
                      <div className="w-px flex-1 bg-[var(--color-border)] mt-1 mb-0.5" />
                    )}
                  </div>
                  {/* Text */}
                  <div className="pb-3">
                    <p className="font-semibold text-sm text-[var(--color-text-primary)]">{step.title}</p>
                    <p className="text-sm text-[var(--color-text-secondary)] mt-0.5 leading-relaxed">{step.description}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          {/* Tips */}
          {content.tips && content.tips.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-widest text-[var(--color-text-muted)] mb-3 flex items-center gap-1.5">
                <Lightbulb className="w-3.5 h-3.5" />
                {lang === 'bn' ? 'কাজের টিপস' : 'Pro Tips'}
              </h3>
              <ul className="space-y-2">
                {content.tips.map((tip, idx) => (
                  <li key={idx} className="flex gap-2 text-sm text-[var(--color-text-secondary)] bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
                    <span className="text-amber-500 shrink-0 mt-0.5">💡</span>
                    <span>{tip}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[var(--color-border)] bg-[var(--color-surface-secondary,var(--color-surface))]">
          <p className="text-xs text-center text-[var(--color-text-muted)]">
            {lang === 'bn'
              ? 'আরো সাহায্যের জন্য আপনার সিস্টেম অ্যাডমিনের সাথে যোগাযোগ করুন'
              : 'For additional support, contact your system administrator'}
          </p>
        </div>
      </div>
    </>
  );
}
