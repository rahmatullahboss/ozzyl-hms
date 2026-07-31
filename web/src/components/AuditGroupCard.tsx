import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import AuditEntryCard from './AuditEntryCard';
import type { AuditEntry, AuditGroup } from '../lib/auditGroups';

const COLOR_CLASSES = {
  emerald: {
    border: 'border-emerald-300',
    borderSelected: 'border-emerald-500 ring-2 ring-emerald-200',
    bgSelected: 'bg-emerald-50/60',
    badge: 'bg-emerald-100 text-emerald-700',
    icon: 'text-emerald-600',
  },
  blue: {
    border: 'border-blue-300',
    borderSelected: 'border-blue-500 ring-2 ring-blue-200',
    bgSelected: 'bg-blue-50/60',
    badge: 'bg-blue-100 text-blue-700',
    icon: 'text-blue-600',
  },
} as const;

export default function AuditGroupCard({
  group,
  entries,
  selected = false,
  onToggle,
  maxItems = 5,
  href,
}: {
  group: AuditGroup;
  entries: AuditEntry[];
  selected?: boolean;
  onToggle?: () => void;
  maxItems?: number;
  href?: string;
}) {
  const { t } = useTranslation('dashboard');
  const colors = COLOR_CLASSES[group.color];
  const label = t(group.labelKey, { defaultValue: group.key === 'cash' ? 'Cash & Transactions' : 'Other Activity' });
  const description = t(group.descriptionKey, { defaultValue: '' });
  const visible = entries.slice(0, maxItems);
  const overflow = entries.length - visible.length;

  const interactiveProps = onToggle
    ? {
        role: 'button' as const,
        tabIndex: 0,
        onClick: onToggle,
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle();
          }
        },
      }
    : {};

  return (
    <div
      data-group-card
      className={`card overflow-hidden border-2 transition ${
        onToggle ? 'cursor-pointer' : ''
      } ${selected ? `${colors.borderSelected} ${colors.bgSelected}` : colors.border}`}
      {...interactiveProps}
    >
      <div className="w-full text-left px-4 py-3 flex items-start justify-between gap-3 hover:bg-[var(--color-bg)] transition">
        <div className="flex items-start gap-3 min-w-0">
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-white ${colors.icon}`}>
            {group.icon}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[var(--color-text-primary)] truncate">{label}</p>
            <p className="text-xs text-[var(--color-text-muted)] truncate">{description}</p>
          </div>
        </div>
        <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${colors.badge}`}>
          {entries.length}
        </span>
      </div>

      <div className="border-t border-[var(--color-border)]">
        {visible.length === 0 ? (
          <p className="px-4 py-3 text-xs text-[var(--color-text-muted)]">
            {t('auditGroup.empty', {
              defaultValue: group.key === 'cash' ? 'No cash activity in the last fetch' : 'No other activity in the last fetch',
            })}
          </p>
        ) : (
          <ul className="divide-y divide-[var(--color-border)]">
            {visible.map((entry) => (
              <li key={entry.id}>
                <AuditEntryCard entry={entry} dense />
              </li>
            ))}
          </ul>
        )}
      </div>

      {(overflow > 0 || href) && (
        <div className="px-4 py-2 border-t border-[var(--color-border)] bg-[var(--color-bg)] text-xs">
          {href ? (
            <Link
              to={href}
              onClick={(e) => e.stopPropagation()}
              className="flex items-center justify-between text-[var(--color-primary)] hover:underline font-medium"
            >
              <span>{t('auditGroup.viewAll', { defaultValue: 'View all →' })}</span>
              {overflow > 0 && <span className="text-[var(--color-text-muted)]">+{overflow}</span>}
            </Link>
          ) : overflow > 0 ? (
            <span className="text-[var(--color-text-muted)]">+{overflow} {t('auditGroup.more', { defaultValue: 'more' })}</span>
          ) : null}
        </div>
      )}
    </div>
  );
}
