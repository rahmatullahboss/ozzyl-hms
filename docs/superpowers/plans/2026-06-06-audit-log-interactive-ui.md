# Audit Log Interactive UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat audit activity list with a 2-group (Cash & Transactions / Other Activity) card-based UI on both `HospitalAdminDashboard` and `SystemAuditLog` pages, using a shared utility and shared components.

**Architecture:** Extract group definitions + entry-shaping logic into `web/src/lib/auditGroups.ts` (single source of truth). Build two small presentational components (`AuditEntryCard`, `AuditGroupCard`). Refactor both pages to consume them. No backend changes — group classification is purely client-side from `table_name`.

**Tech Stack:** React 19, TypeScript, Tailwind CSS, vitest + @testing-library/react, i18next, lucide-react.

**Spec:** `docs/superpowers/specs/2026-06-06-audit-log-interactive-design.md`

---

## File Structure

### New files
- `web/src/lib/auditGroups.ts` — group definitions, `getAuditGroup()`, `toAuditEntry()`, color/icon/label constants, types
- `web/src/lib/auditGroups.test.ts` — unit tests for `getAuditGroup()` and `toAuditEntry()`
- `web/src/components/AuditEntryCard.tsx` — single compact entry card
- `web/src/components/AuditEntryCard.test.tsx` — render + click handler test
- `web/src/components/AuditGroupCard.tsx` — group container with header + entry list
- `web/src/components/AuditGroupCard.test.tsx` — selected state + max items + footer link test

### Modified files
- `web/src/pages/SystemAuditLog.tsx` — drop in-file group/color definitions, import from `auditGroups`, render 2 group filter cards + `AuditEntryCard` list (no more `<table>`)
- `web/src/pages/SystemAuditLog.test.ts` — update assertions to expect 2 group labels (`Cash & Transactions`, `Other Activity`) instead of 5
- `web/src/pages/HospitalAdminDashboard.tsx` — replace lines 1681–1775 with two `AuditGroupCard`s; add `useMemo` to split `recentActivity` by group
- `web/public/locales/en/dashboard.json` — add `auditGroup.cash.label`, `auditGroup.cash.description`, `auditGroup.other.label`, `auditGroup.other.description`
- `web/public/locales/bn/dashboard.json` — add the same keys in Bengali

---

## Task 1: Create `auditGroups.ts` shared utility

**Files:**
- Create: `web/src/lib/auditGroups.ts`
- Test: `web/src/lib/auditGroups.test.ts`

- [ ] **Step 1.1: Write the failing test**

```ts
// web/src/lib/auditGroups.test.ts
import { describe, expect, it } from 'vitest';
import { getAuditGroup, toAuditEntry, type RawAuditEntry } from './auditGroups';

describe('auditGroups', () => {
  it('classifies cash-related tables into the cash group', () => {
    expect(getAuditGroup('bills')).toBe('cash');
    expect(getAuditGroup('billing_deposits')).toBe('cash');
    expect(getAuditGroup('cash_drawer_movements')).toBe('cash');
    expect(getAuditGroup('expenses')).toBe('cash');
    expect(getAuditGroup('billing_handovers')).toBe('cash');
    expect(getAuditGroup('payments')).toBe('cash');
    expect(getAuditGroup('emp_cash_transactions')).toBe('cash');
    expect(getAuditGroup('billing_counter_sessions')).toBe('cash');
    expect(getAuditGroup('billing')).toBe('cash');
  });

  it('classifies everything else as the other group', () => {
    expect(getAuditGroup('patients')).toBe('other');
    expect(getAuditGroup('settings')).toBe('other');
    expect(getAuditGroup('staff')).toBe('other');
    expect(getAuditGroup('prescriptions')).toBe('other');
    expect(getAuditGroup('pharmacy')).toBe('other');
    expect(getAuditGroup('token_reservations')).toBe('other');
    expect(getAuditGroup('admissions')).toBe('other');
    expect(getAuditGroup('')).toBe('other');
    expect(getAuditGroup('something_unknown')).toBe('other');
  });

  it('normalizes table names by lowercasing and trimming', () => {
    expect(getAuditGroup('  BILLS  ')).toBe('cash');
    expect(getAuditGroup('Billing_Handovers')).toBe('cash');
  });

  it('shapes a RawAuditEntry into an AuditEntry with cash grouping', () => {
    const row: RawAuditEntry = {
      id: 1,
      user_id: 5,
      user_name: 'Nusrat Jahan Sony',
      action: 'PAYMENT',
      table_name: 'bills',
      record_id: 5196,
      old_value: null,
      new_value: JSON.stringify({ amount: 5000, status: 'paid' }),
      ip_address: '127.0.0.1',
      created_at: '2026-06-04T17:23:11Z',
    };
    const entry = toAuditEntry(row);
    expect(entry.groupKey).toBe('cash');
    expect(entry.actionLabel).toBe('PAYMENT');
    expect(entry.entityLabel).toBe('Invoice/Bill');
    expect(entry.entity_id).toBe(5196);
    expect(entry.details).toContain('৳5,000');
    expect(entry.details).toContain('paid');
  });

  it('shapes a RawAuditEntry into an AuditEntry with other grouping for settings', () => {
    const row: RawAuditEntry = {
      id: 2,
      user_id: 1,
      user_name: 'Admin',
      action: 'UPDATE',
      table_name: 'settings',
      record_id: 3,
      old_value: JSON.stringify({ sms: false }),
      new_value: JSON.stringify({ sms: true }),
      ip_address: null,
      created_at: '2026-06-05T11:15:00Z',
    };
    const entry = toAuditEntry(row);
    expect(entry.groupKey).toBe('other');
    expect(entry.actionLabel).toBe('Updated');
    expect(entry.entityLabel).toBe('Settings');
  });
});
```

- [ ] **Step 1.2: Run test to verify it fails**

```bash
cd web && npx vitest run src/lib/auditGroups.test.ts
```
Expected: FAIL — module `./auditGroups` does not exist.

- [ ] **Step 1.3: Implement the utility**

```ts
// web/src/lib/auditGroups.ts
import type { ReactElement } from 'react';
import { Banknote, Activity } from 'lucide-react';

export type AuditGroupKey = 'cash' | 'other';

export interface RawAuditEntry {
  id: number;
  user_id: number | null;
  user_name?: string;
  action: string;
  table_name?: string | null;
  record_id?: string | number | null;
  old_value?: string | null;
  new_value?: string | null;
  ip_address?: string | null;
  created_at: string;
}

export interface AuditEntry {
  id: number;
  user_id: number | null;
  user_name?: string;
  action: string;
  actionLabel: string;
  entity: string;
  entityLabel: string;
  groupKey: AuditGroupKey;
  groupLabel: string;
  entity_id: string | number | null;
  details: string;
  created_at: string;
}

export interface AuditGroup {
  key: AuditGroupKey;
  labelKey: string;
  descriptionKey: string;
  color: 'emerald' | 'blue';
  icon: ReactElement;
  entities: string[];
}

const CASH_TABLES = new Set<string>([
  'bills',
  'billing',
  'billing_deposits',
  'billing_counter_sessions',
  'billing_handovers',
  'cash_drawer_movements',
  'expenses',
  'payments',
  'emp_cash_transactions',
]);

export const AUDIT_GROUPS: AuditGroup[] = [
  {
    key: 'cash',
    labelKey: 'dashboard:auditGroup.cash.label',
    descriptionKey: 'dashboard:auditGroup.cash.description',
    color: 'emerald',
    icon: Banknote({ className: 'w-4 h-4' }) as ReactElement,
    entities: [...CASH_TABLES],
  },
  {
    key: 'other',
    labelKey: 'dashboard:auditGroup.other.label',
    descriptionKey: 'dashboard:auditGroup.other.description',
    color: 'blue',
    icon: Activity({ className: 'w-4 h-4' }) as ReactElement,
    entities: [],
  },
];

const GROUP_LABELS: Record<AuditGroupKey, string> = {
  cash: 'Cash & Transactions',
  other: 'Other Activity',
};

export function getAuditGroup(tableName: string | null | undefined): AuditGroupKey {
  const key = String(tableName ?? '').trim().toLowerCase();
  if (CASH_TABLES.has(key)) return 'cash';
  return 'other';
}

export const ACTION_COLORS: Record<string, string> = {
  create: 'bg-emerald-100 text-emerald-700',
  insert: 'bg-emerald-100 text-emerald-700',
  upsert: 'bg-emerald-100 text-emerald-700',
  payment: 'bg-blue-100 text-blue-700',
  update: 'bg-blue-100 text-blue-700',
  delete: 'bg-red-100 text-red-700',
  login: 'bg-gray-100 text-gray-600',
  logout: 'bg-gray-100 text-gray-600',
  cancel: 'bg-red-100 text-red-700',
  approve: 'bg-emerald-100 text-emerald-700',
  reject: 'bg-red-100 text-red-700',
};

export const ENTITY_LABELS: Record<string, string> = {
  patients: 'Patient',
  bills: 'Invoice/Bill',
  billing: 'Invoice/Bill',
  cash_drawer_movements: 'Cash Drawer Movement',
  expenses: 'Expense',
  billing_counter_sessions: 'Billing Counter Session',
  billing_handovers: 'Cash Handover',
  prescriptions: 'Prescription',
  admissions: 'Admission',
  lab_orders: 'Lab Order',
  pharmacy: 'Pharmacy',
  staff: 'Staff',
  users: 'User Access',
  discharge_summaries: 'Discharge Summary',
  doctor_schedules: 'Doctor Schedule',
  settings: 'Settings',
};

export const ACTION_LABELS: Record<string, string> = {
  create: 'Created',
  insert: 'Created',
  upsert: 'Saved',
  update: 'Updated',
  delete: 'Deleted',
  cancel: 'Cancelled',
  approve: 'Approved',
  reject: 'Rejected',
  login: 'Logged in',
  logout: 'Logged out',
  payment: 'PAYMENT',
};

function normalizeKey(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase();
}

function humanize(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function parseJsonObject(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function formatAuditDetails(row: RawAuditEntry): string {
  const next = parseJsonObject(row.new_value);
  const previous = parseJsonObject(row.old_value);
  const parts: string[] = [];

  const reason = next.reason ?? next.cancel_reason ?? previous.reason;
  if (reason) parts.push(`Reason: ${String(reason)}`);

  const status = next.status ?? next.payment_status;
  if (status) parts.push(`Status: ${String(status)}`);

  const amount = next.amount ?? next.total ?? next.total_amount ?? next.handover_amount;
  if (amount !== undefined && amount !== null && amount !== '') {
    parts.push(`Amount: ৳${Number(amount).toLocaleString()}`);
  }

  const invoice = next.invoiceNo ?? next.invoice_no ?? next.bill_no;
  if (invoice) parts.push(`Invoice: ${String(invoice)}`);

  if (parts.length > 0) return parts.join(' · ');
  if (row.ip_address) return `IP: ${row.ip_address}`;
  return 'No extra details';
}

export function toAuditEntry(row: RawAuditEntry): AuditEntry {
  const action = normalizeKey(row.action);
  const entity = normalizeKey(row.table_name) || 'unknown';
  const entityLabel = ENTITY_LABELS[entity] ?? humanize(entity);
  const actionLabel = ACTION_LABELS[action] ?? humanize(action);
  const groupKey = getAuditGroup(entity);

  return {
    id: row.id,
    user_id: row.user_id,
    user_name: row.user_name,
    action,
    actionLabel,
    entity,
    entityLabel,
    groupKey,
    groupLabel: GROUP_LABELS[groupKey],
    entity_id: row.record_id ?? null,
    details: formatAuditDetails(row),
    created_at: row.created_at,
  };
}
```

Note: `Banknote()` and `Activity()` are called as functions (not JSX) so the type is `ReactElement` for the constant. If the project doesn't have `@types/lucide-react` v0.577+ supporting function calls, fall back to JSX:
```ts
icon: <Banknote className="w-4 h-4" />,
```
Adjust the test for `icon` accordingly (no test asserts on the icon type).

- [ ] **Step 1.4: Run test to verify it passes**

```bash
cd web && npx vitest run src/lib/auditGroups.test.ts
```
Expected: PASS — 5 tests green.

- [ ] **Step 1.5: Commit**

```bash
git add web/src/lib/auditGroups.ts web/src/lib/auditGroups.test.ts
git commit -m "feat(audit): add shared audit group utility"
```

---

## Task 2: Add i18n keys for group labels

**Files:**
- Modify: `web/public/locales/en/dashboard.json`
- Modify: `web/public/locales/bn/dashboard.json`

- [ ] **Step 2.1: Add English keys**

Open `web/public/locales/en/dashboard.json` and add at the end of the object (before the closing `}`):
```json
  "auditGroup": {
    "cash": {
      "label": "Cash & Transactions",
      "description": "Bills, deposits, cash drawer, handovers, expenses"
    },
    "other": {
      "label": "Other Activity",
      "description": "Patients, settings, operations and everything else"
    },
    "viewAll": "View all →"
  }
```

- [ ] **Step 2.2: Add Bengali keys**

Open `web/public/locales/bn/dashboard.json` and add at the end of the object (before the closing `}`):
```json
  "auditGroup": {
    "cash": {
      "label": "ক্যাশ ও লেনদেন",
      "description": "বিল, ডিপোজিট, ক্যাশ ড্রয়ার, হ্যান্ডওভার, খরচ"
    },
    "other": {
      "label": "অন্যান্য কার্যক্রম",
      "description": "রোগী, সেটিংস, অপারেশন এবং অন্যান্য সব"
    },
    "viewAll": "সব দেখুন →"
  }
```

- [ ] **Step 2.3: Commit**

```bash
git add web/public/locales/en/dashboard.json web/public/locales/bn/dashboard.json
git commit -m "feat(i18n): add audit group labels in en and bn"
```

---

## Task 3: Build `AuditEntryCard` component

**Files:**
- Create: `web/src/components/AuditEntryCard.tsx`
- Test: `web/src/components/AuditEntryCard.test.tsx`

- [ ] **Step 3.1: Write the failing test**

```tsx
// web/src/components/AuditEntryCard.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import AuditEntryCard from './AuditEntryCard';
import type { AuditEntry } from '../lib/auditGroups';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => (typeof fallback === 'string' ? fallback : (fallback as any)?.defaultValue ?? _key),
  }),
}));

const baseEntry: AuditEntry = {
  id: 1,
  user_id: 5,
  user_name: 'Nusrat Jahan',
  action: 'create',
  actionLabel: 'Created',
  entity: 'bills',
  entityLabel: 'Invoice/Bill',
  groupKey: 'cash',
  groupLabel: 'Cash & Transactions',
  entity_id: 5196,
  details: 'Amount: ৳5,000',
  created_at: '2026-06-04T17:23:11Z',
};

describe('AuditEntryCard', () => {
  it('renders the action badge, user, entity label, record id, and time', () => {
    render(React.createElement(AuditEntryCard, { entry: baseEntry }));
    expect(screen.getByText('Created')).toBeInTheDocument();
    expect(screen.getByText('Nusrat Jahan')).toBeInTheDocument();
    expect(screen.getByText(/Invoice\/Bill/)).toBeInTheDocument();
    expect(screen.getByText(/#5196/)).toBeInTheDocument();
  });

  it('falls back to a placeholder when user_name is missing', () => {
    render(React.createElement(AuditEntryCard, { entry: { ...baseEntry, user_name: undefined, user_id: 9 } }));
    expect(screen.getByText(/User #9/)).toBeInTheDocument();
  });

  it('fires onClick when clicked', () => {
    const onClick = vi.fn();
    render(React.createElement(AuditEntryCard, { entry: baseEntry, onClick }));
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not crash when entity_id is null', () => {
    render(React.createElement(AuditEntryCard, { entry: { ...baseEntry, entity_id: null } }));
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3.2: Run test to verify it fails**

```bash
cd web && npx vitest run src/components/AuditEntryCard.test.tsx
```
Expected: FAIL — module `./AuditEntryCard` does not exist.

- [ ] **Step 3.3: Implement the component**

```tsx
// web/src/components/AuditEntryCard.tsx
import { useTranslation } from 'react-i18next';
import { ACTION_COLORS } from '../lib/auditGroups';
import type { AuditEntry } from '../lib/auditGroups';

function fmtTime(iso: string, locale: string): string {
  return new Date(iso).toLocaleString(
    locale === 'bn' ? 'bn-BD' : 'en-GB',
    { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }
  );
}

export default function AuditEntryCard({
  entry,
  onClick,
  dense = false,
}: {
  entry: AuditEntry;
  onClick?: () => void;
  dense?: boolean;
}) {
  const { t, i18n } = useTranslation('dashboard');
  const badgeClass = ACTION_COLORS[entry.action] ?? 'bg-gray-100 text-gray-700';
  const user = entry.user_name ?? t('userFallback', { defaultValue: `User #${entry.user_id ?? '?'}` });
  const recordId = entry.entity_id ? `#${entry.entity_id}` : '—';

  const content = (
    <div
      className={`flex items-center gap-3 ${dense ? 'py-2 px-3' : 'p-3'} hover:bg-[var(--color-bg)] transition rounded-lg`}
    >
      <span className={`px-2 py-0.5 rounded-full text-xs font-medium shrink-0 ${badgeClass}`}>
        {entry.actionLabel}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm truncate">
          <span className="font-medium text-[var(--color-text-primary)]">{user}</span>
          <span className="text-[var(--color-text-muted)]"> · {entry.entityLabel} {recordId}</span>
        </p>
        {entry.details && entry.details !== 'No extra details' && (
          <p className="text-xs text-[var(--color-text-muted)] truncate">{entry.details}</p>
        )}
      </div>
      <span className="text-xs text-[var(--color-text-muted)] font-data shrink-0">
        {fmtTime(entry.created_at, i18n.language)}
      </span>
    </div>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="w-full text-left rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]"
      >
        {content}
      </button>
    );
  }
  return content;
}
```

- [ ] **Step 3.4: Run test to verify it passes**

```bash
cd web && npx vitest run src/components/AuditEntryCard.test.tsx
```
Expected: PASS — 4 tests green.

- [ ] **Step 3.5: Commit**

```bash
git add web/src/components/AuditEntryCard.tsx web/src/components/AuditEntryCard.test.tsx
git commit -m "feat(audit): add AuditEntryCard component"
```

---

## Task 4: Build `AuditGroupCard` component

**Files:**
- Create: `web/src/components/AuditGroupCard.tsx`
- Test: `web/src/components/AuditGroupCard.test.tsx`

- [ ] **Step 4.1: Write the failing test**

```tsx
// web/src/components/AuditGroupCard.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import AuditGroupCard from './AuditGroupCard';
import { AUDIT_GROUPS } from '../lib/auditGroups';
import type { AuditEntry } from '../lib/auditGroups';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, fb?: string) => (typeof fb === 'string' ? fb : k) }),
}));

const entries: AuditEntry[] = [
  {
    id: 1, user_id: 1, user_name: 'Nusrat', action: 'create', actionLabel: 'Created',
    entity: 'bills', entityLabel: 'Invoice/Bill', groupKey: 'cash',
    groupLabel: 'Cash & Transactions', entity_id: 5196,
    details: 'Amount: ৳5,000', created_at: '2026-06-04T17:23:11Z',
  },
  {
    id: 2, user_id: 1, user_name: 'Nusrat', action: 'payment', actionLabel: 'PAYMENT',
    entity: 'bills', entityLabel: 'Invoice/Bill', groupKey: 'cash',
    groupLabel: 'Cash & Transactions', entity_id: 5195,
    details: 'Amount: ৳2,500', created_at: '2026-06-04T15:36:23Z',
  },
];

describe('AuditGroupCard', () => {
  it('renders the group label and count badge', () => {
    render(React.createElement(AuditGroupCard, {
      group: AUDIT_GROUPS[0], entries, maxItems: 5,
    }));
    expect(screen.getByText('Cash & Transactions')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('caps visible entries at maxItems', () => {
    const many: AuditEntry[] = Array.from({ length: 10 }, (_, i) => ({
      ...entries[0], id: i + 100, entity_id: 5000 + i,
    }));
    render(React.createElement(AuditGroupCard, {
      group: AUDIT_GROUPS[0], entries: many, maxItems: 3,
    }));
    expect(screen.getAllByText(/Nusrat/)).toHaveLength(3);
  });

  it('renders a footer link when href is provided', () => {
    render(React.createElement(AuditGroupCard, {
      group: AUDIT_GROUPS[0], entries, maxItems: 5, href: '/audit?group=cash',
    }));
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/audit?group=cash');
  });

  it('shows the selected visual state when selected is true', () => {
    const { container } = render(React.createElement(AuditGroupCard, {
      group: AUDIT_GROUPS[0], entries, maxItems: 5, selected: true,
    }));
    const card = container.querySelector('[data-group-card]');
    expect(card?.className).toMatch(/emerald/);
  });

  it('calls onToggle when the card header is clicked', () => {
    const onToggle = vi.fn();
    const { container } = render(React.createElement(AuditGroupCard, {
      group: AUDIT_GROUPS[0], entries, maxItems: 5, onToggle, selected: false,
    }));
    const card = container.querySelector('[data-group-card]');
    fireEvent.click(card!);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('shows an empty-state message when there are no entries', () => {
    render(React.createElement(AuditGroupCard, {
      group: AUDIT_GROUPS[0], entries: [], maxItems: 5,
    }));
    expect(screen.getByText(/No cash activity/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 4.2: Run test to verify it fails**

```bash
cd web && npx vitest run src/components/AuditGroupCard.test.tsx
```
Expected: FAIL — module `./AuditGroupCard` does not exist.

- [ ] **Step 4.3: Implement the component**

```tsx
// web/src/components/AuditGroupCard.tsx
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { ChevronRight } from 'lucide-react';
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

  const Wrapper = onToggle ? 'button' : 'div';
  const wrapperProps = onToggle
    ? { type: 'button' as const, onClick: onToggle }
    : {};

  return (
    <div
      data-group-card
      className={`card overflow-hidden border-2 transition ${
        selected ? `${colors.borderSelected} ${colors.bgSelected}` : colors.border
      }`}
    >
      <Wrapper
        {...wrapperProps}
        className="w-full text-left px-4 py-3 flex items-start justify-between gap-3 hover:bg-[var(--color-bg)] transition"
      >
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
      </Wrapper>

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
            <Link to={href} className="flex items-center justify-between text-[var(--color-primary)] hover:underline font-medium">
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
```

- [ ] **Step 4.4: Run test to verify it passes**

```bash
cd web && npx vitest run src/components/AuditGroupCard.test.tsx
```
Expected: PASS — 6 tests green.

- [ ] **Step 4.5: Commit**

```bash
git add web/src/components/AuditGroupCard.tsx web/src/components/AuditGroupCard.test.tsx
git commit -m "feat(audit): add AuditGroupCard component"
```

---

## Task 5: Refactor `SystemAuditLog.tsx` to use shared utility and card list

**Files:**
- Modify: `web/src/pages/SystemAuditLog.tsx`
- Modify: `web/src/pages/SystemAuditLog.test.ts`

- [ ] **Step 5.1: Update the test to expect 2 groups instead of 5**

Open `web/src/pages/SystemAuditLog.test.ts`. Replace the second `it(...)` block ("groups audit activity into monitorable admin categories") with:

```ts
  it('groups audit activity into cash vs other using the shared 2-group classifier', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        auditLogs: [
          {
            id: 21,
            user_id: 7,
            user_name: 'Audit Supervisor',
            action: 'CREATE',
            table_name: 'cash_drawer_movements',
            record_id: 42,
            old_value: null,
            new_value: JSON.stringify({ movementType: 'cash_out', amount: 1600, reason: 'adjust' }),
            ip_address: '127.0.0.1',
            created_at: '2026-06-05T10:15:00Z',
          },
          {
            id: 22,
            user_id: 8,
            user_name: 'Admin User',
            action: 'UPDATE',
            table_name: 'settings',
            record_id: 3,
            old_value: JSON.stringify({ sms: false }),
            new_value: JSON.stringify({ sms: true }),
            ip_address: '127.0.0.1',
            created_at: '2026-06-05T11:15:00Z',
          },
        ],
      },
      isLoading: false,
      isError: false,
    } as any);

    render(React.createElement(SystemAuditLog, { role: 'hospital_admin' }));

    expect(screen.getByText('Cash & Transactions')).toBeInTheDocument();
    expect(screen.getByText('Other Activity')).toBeInTheDocument();
    expect(screen.getByText('Cash Drawer Movement')).toBeInTheDocument();
    expect(screen.getByText(/Amount: ৳1,600/)).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });
```

- [ ] **Step 5.2: Run test to verify it fails (still has old assertions)**

```bash
cd web && npx vitest run src/pages/SystemAuditLog.test.ts
```
Expected: FAIL — `Settings & access` text no longer rendered.

- [ ] **Step 5.3: Refactor `SystemAuditLog.tsx`**

Replace the entire file with:

```tsx
// web/src/pages/SystemAuditLog.tsx
import { useState, useMemo } from 'react';
import { Link, useParams } from 'react-router';
import { ChevronRight, Download, Filter, Search, RefreshCw, Info } from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';
import AuditGroupCard from '../components/AuditGroupCard';
import AuditEntryCard from '../components/AuditEntryCard';
import { useTranslation } from 'react-i18next';
import { useApiQuery } from '../hooks/useApiQuery';
import { queryKeys } from '../lib/queryKeys';
import {
  AUDIT_GROUPS,
  toAuditEntry,
  type AuditGroupKey,
  type RawAuditEntry,
} from '../lib/auditGroups';

const ENTITY_OPTIONS = ['All', 'patients', 'bills', 'cash_drawer_movements', 'expenses', 'billing_counter_sessions', 'billing_handovers', 'prescriptions', 'admissions', 'lab_orders', 'pharmacy', 'staff', 'users', 'discharge_summaries', 'doctor_schedules', 'settings'];
const ACTION_OPTIONS = ['All', 'create', 'update', 'delete', 'upsert', 'cancel', 'approve', 'reject', 'login', 'logout', 'payment'];

function humanize(value: string): string {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function SystemAuditLog({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['common', 'dashboard']);
  const { slug = '' } = useParams<{ slug: string }>();
  const basePath = `/h/${slug}`;

  const [showFilters, setShowFilters] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [actionFilter, setActionFilter] = useState('All');
  const [entityFilter, setEntityFilter] = useState('All');
  const [groupFilter, setGroupFilter] = useState<AuditGroupKey | 'all'>('all');

  const { data: logsData, isLoading: loading } = useApiQuery<{ auditLogs: RawAuditEntry[] }>(
    queryKeys.auditLog.logs(),
    '/api/audit/logs',
  );

  const logs = useMemo(() => (logsData?.auditLogs ?? []).map(toAuditEntry), [logsData?.auditLogs]);

  const filtered = useMemo(() => {
    let data = logs;
    if (groupFilter !== 'all') data = data.filter((l) => l.groupKey === groupFilter);
    if (actionFilter !== 'All') data = data.filter((l) => l.action === actionFilter);
    if (entityFilter !== 'All') data = data.filter((l) => l.entity === entityFilter);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      data = data.filter((l) =>
        (l.user_name ?? '').toLowerCase().includes(q) ||
        (l.details ?? '').toLowerCase().includes(q) ||
        (l.entity_id?.toString() ?? '').toLowerCase().includes(q)
      );
    }
    return data;
  }, [logs, groupFilter, actionFilter, entityFilter, searchQuery]);

  const groupCounts = useMemo(() => {
    const counts: Record<AuditGroupKey, number> = { cash: 0, other: 0 };
    logs.forEach((log) => { counts[log.groupKey] = (counts[log.groupKey] ?? 0) + 1; });
    return counts;
  }, [logs]);

  const totalToday = logs.filter((l) => new Date(l.created_at).toDateString() === new Date().toDateString()).length;

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs text-[var(--color-text-muted)] flex items-center gap-1 mb-1">
              <Link to={`${basePath}/dashboard`} className="hover:underline">Dashboard</Link>
              <ChevronRight className="w-3 h-3" />
              <span className="text-[var(--color-text)] font-medium">Audit Log</span>
            </div>
            <h1 className="text-2xl font-bold text-[var(--color-text)]">{t('common:auditLog', { defaultValue: 'System Audit Log' })}</h1>
            <p className="text-sm text-[var(--color-text-muted)]">Track all system changes and user activity</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowFilters((f) => !f)} className="btn-secondary flex items-center gap-2">
              <Filter className="w-4 h-4" /> Filters
            </button>
            <a href="/api/audit/export" className="btn-secondary flex items-center gap-2">
              <Download className="w-4 h-4" /> Export CSV
            </a>
          </div>
        </div>

        {/* Group filter cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {AUDIT_GROUPS.map((group) => (
            <AuditGroupCard
              key={group.key}
              group={group}
              entries={logs.filter((l) => l.groupKey === group.key)}
              selected={groupFilter === group.key}
              onToggle={() => setGroupFilter(groupFilter === group.key ? 'all' : group.key)}
              maxItems={5}
            />
          ))}
        </div>

        {/* Filter bar */}
        {showFilters && (
          <div className="card p-4 flex flex-wrap items-end gap-3">
            <div>
              <label className="text-xs font-medium text-[var(--color-text-muted)] block mb-1">Action</label>
              <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}
                className="px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm">
                {ACTION_OPTIONS.map((o) => <option key={o} value={o}>{o === 'All' ? 'All Actions' : o}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-[var(--color-text-muted)] block mb-1">Entity</label>
              <select value={entityFilter} onChange={(e) => setEntityFilter(e.target.value)}
                className="px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm">
                {ENTITY_OPTIONS.map((o) => <option key={o} value={o}>{o === 'All' ? 'All Entities' : humanize(o)}</option>)}
              </select>
            </div>
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-4 h-4 text-[var(--color-text-muted)] absolute left-3 top-1/2 -translate-y-1/2" />
              <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by user, detail, or entity id"
                className="w-full pl-9 pr-3 py-2 border border-[var(--color-border)] rounded-lg text-sm" />
            </div>
            <button onClick={() => { setActionFilter('All'); setEntityFilter('All'); setSearchQuery(''); setGroupFilter('all'); }}
              className="text-sm text-[var(--color-primary)] hover:underline flex items-center gap-1">
              <RefreshCw className="w-3 h-3" /> Reset
            </button>
          </div>
        )}

        {/* Entry list (card-based, replaces the table) */}
        <div className="card overflow-hidden">
          {loading ? (
            <div className="animate-pulse h-64 bg-gray-50" />
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-[var(--color-text-muted)]">
              <Info className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">No audit records found</p>
            </div>
          ) : (
            <ul className="divide-y divide-[var(--color-border)]">
              {filtered.map((entry) => (
                <li key={entry.id} className="p-3">
                  <AuditEntryCard entry={entry} />
                </li>
              ))}
            </ul>
          )}
          <div className="px-4 py-3 bg-[var(--color-bg)] border-t border-[var(--color-border)] text-xs text-[var(--color-text-muted)]">
            Showing {filtered.length} of {logs.length} records · Today: {totalToday}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
```

- [ ] **Step 5.4: Run test to verify it passes**

```bash
cd web && npx vitest run src/pages/SystemAuditLog.test.ts
```
Expected: PASS — both tests green.

- [ ] **Step 5.5: Lint/typecheck the file**

```bash
cd web && npx tsc --noEmit
```
Expected: no errors related to `SystemAuditLog.tsx`.

- [ ] **Step 5.6: Commit**

```bash
git add web/src/pages/SystemAuditLog.tsx web/src/pages/SystemAuditLog.test.ts
git commit -m "refactor(audit): use shared utility and card list in SystemAuditLog"
```

---

## Task 6: Replace dashboard "Recent Activity" with two group cards

**Files:**
- Modify: `web/src/pages/HospitalAdminDashboard.tsx`

- [ ] **Step 6.1: Add the imports**

At the top of `web/src/pages/HospitalAdminDashboard.tsx`, locate the import block (around line 1–40). Add these new imports alongside the existing ones:

```tsx
import AuditGroupCard from '../components/AuditGroupCard';
import AuditEntryCard from '../components/AuditEntryCard';
import { AUDIT_GROUPS, getAuditGroup, toAuditEntry, type AuditGroupKey, type AuditEntry, type RawAuditEntry } from '../lib/auditGroups';
```

Also add a module-level helper near `formatTable` (around line 770):

```tsx
function toEnrichedEntry(a: RecentActivity): AuditEntry {
  return toAuditEntry({
    id: a.id,
    user_id: 0,
    user_name: a.userName,
    action: a.action,
    table_name: a.tableName,
    record_id: a.recordId,
    old_value: null,
    new_value: null,
    ip_address: null,
    created_at: a.createdAt,
  } satisfies RawAuditEntry);
}
```

- [ ] **Step 6.2: Add the useMemo split + state near the top of the component body**

Find the `const recentActivity = data?.recentActivity ?? [];` line (around line 492). Add directly below it:

```tsx
  const [activeGroup, setActiveGroup] = useState<AuditGroupKey | null>(null);
  const cashEntries = useMemo(
    () => recentActivity.filter((a) => getAuditGroup(a.tableName) === 'cash'),
    [recentActivity]
  );
  const otherEntries = useMemo(
    () => recentActivity.filter((a) => getAuditGroup(a.tableName) === 'other'),
    [recentActivity]
  );
  const visibleActivity = useMemo(() => {
    if (activeGroup === 'cash') return cashEntries;
    if (activeGroup === 'other') return otherEntries;
    return [...cashEntries, ...otherEntries];
  }, [activeGroup, cashEntries, otherEntries]);
```

- [ ] **Step 6.3: Replace the "Recent Activity" card body**

Find the block from line 1681 to 1774 (the `<div className="card overflow-hidden">` that contains the Recent Activity header, mobile card list, and desktop table). Replace the entire block with:

```tsx
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between px-4 sm:px-5 py-4 border-b border-[var(--color-border)]">
            <h3 className="section-title">{t('recentActivity', { defaultValue: 'Recent Activity' })}</h3>
            <button onClick={() => navigate(`${base}/audit`)} className="text-sm text-[var(--color-primary)] hover:underline font-medium">
              {t('viewAll', { defaultValue: 'View All' })} →
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4 border-b border-[var(--color-border)]">
            <AuditGroupCard
              group={AUDIT_GROUPS[0]}
              entries={cashEntries.map(toEnrichedEntry)}
              maxItems={3}
              selected={activeGroup === 'cash'}
              onToggle={() => setActiveGroup(activeGroup === 'cash' ? null : 'cash')}
              href={`${base}/audit?group=cash`}
            />
            <AuditGroupCard
              group={AUDIT_GROUPS[1]}
              entries={otherEntries.map(toEnrichedEntry)}
              maxItems={3}
              selected={activeGroup === 'other'}
              onToggle={() => setActiveGroup(activeGroup === 'other' ? null : 'other')}
              href={`${base}/audit?group=other`}
            />
          </div>

          {activeGroup && (
            <div className="divide-y divide-[var(--color-border)] max-h-[420px] overflow-y-auto">
              {visibleActivity.slice(0, 10).map((a) => (
                <AuditEntryCard key={a.id} entry={toEnrichedEntry(a)} />
              ))}
            </div>
          )}

          {loading && (
            <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="skeleton h-32 rounded-lg" />
              <div className="skeleton h-32 rounded-lg" />
            </div>
          )}
        </div>
```

- [ ] **Step 6.4: (Already added in Step 6.1)**

The `toEnrichedEntry` helper is added in Step 6.1 alongside the imports. Verify it is defined at module scope.

- [ ] **Step 6.5: Typecheck**

```bash
cd web && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 6.6: Run dashboard tests**

```bash
cd web && npx vitest run src/pages/HospitalAdminDashboard.test.tsx
```
Expected: PASS — the existing `recentActivity: []` mock keeps the empty path working; non-empty mock paths still pass because the new cards tolerate empty data.

- [ ] **Step 6.7: Commit**

```bash
git add web/src/pages/HospitalAdminDashboard.tsx
git commit -m "feat(dashboard): replace recent activity list with cash/other group cards"
```

---

## Task 7: Build verification

**Files:** none

- [ ] **Step 7.1: Run all web tests**

```bash
cd web && npx vitest run
```
Expected: all tests green, no regressions.

- [ ] **Step 7.2: Typecheck the whole project**

```bash
cd web && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 7.3: Production build**

```bash
cd web && npm run build
```
Expected: build succeeds.

- [ ] **Step 7.4: Commit (only if step 7.1–7.3 surfaced fixes)**

```bash
git add -A
git commit -m "chore: build verification fixes" || echo "Nothing to commit"
```

---

## Self-Review Checklist

Before declaring done, verify:

- [ ] `auditGroups.ts` is the only place that defines which `table_name` is "cash"
- [ ] Both pages import from `auditGroups` — no duplicate group definitions
- [ ] Dashboard widget shows 2 group cards, click toggles the filtered list
- [ ] `SystemAuditLog` shows 2 group cards at top, click filters the entry list
- [ ] Entry list is card-based (no `<table>`)
- [ ] i18n keys exist in both `en/dashboard.json` and `bn/dashboard.json`
- [ ] All new tests pass
- [ ] No backend changes
- [ ] `git log --oneline -10` shows 7 commits matching the task titles
