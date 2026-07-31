# Doctor Today Breakdown Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each doctor row in the Hospital Admin Dashboard's "Doctor Today" card clickable, opening a modal that breaks down the math behind the doctor's net hospital income (patients, patient revenue, test revenue, commission, net).

**Architecture:** Add a new `DoctorTodayBreakdownModal` component that uses the shared `Modal`. `HospitalAdminDashboard.tsx` tracks the selected doctor in local state, passes it to the modal, and wires `onClick` on each row. The "Unassigned / No Doctor" row stays non-clickable. No backend, schema, or API changes.

**Tech Stack:** React + TypeScript + Tailwind (frontend), Vitest + @testing-library/react (tests).

**Spec:** `docs/superpowers/specs/2026-06-06-doctor-today-breakdown-modal-design.md`

---

## File Structure

| File | Responsibility | Change |
|------|---------------|--------|
| `web/src/components/dashboard/DoctorTodayBreakdownModal.tsx` | Renders the shared `Modal` with the doctor's revenue/commission breakdown | **New** |
| `web/src/components/dashboard/DoctorTodayBreakdownModal.test.tsx` | Unit tests for the modal (rendering, math, default values) | **New** |
| `web/src/pages/HospitalAdminDashboard.tsx` | Wires row clicks to state and renders the modal | Modify (`onClick` + `useState` + render) |
| `web/src/pages/HospitalAdminDashboard.test.tsx` | Adds 3 new test cases for click → modal flow | Modify (test additions) |

No backend. No migrations. No API changes.

---

## Task 1: Create the `DoctorTodayBreakdownModal` component

**Files:**
- Create: `web/src/components/dashboard/DoctorTodayBreakdownModal.tsx`

- [ ] **Step 1.1: Create the component file with full implementation**

Create `web/src/components/dashboard/DoctorTodayBreakdownModal.tsx` with the following contents:

```tsx
import Modal from '../shared/Modal';

export interface DoctorDailySummary {
  doctor_id?: number;
  doctor_name?: string;
  patient_count?: number;
  doctor_visit_count?: number;
  doctor_visit_amount?: number;
  test_count?: number;
  test_order_count?: number;
  test_collection_amount?: number;
  commission_amount?: number;
}

interface Props {
  doctor: DoctorDailySummary | null;
  today: string;
  onClose: () => void;
}

function formatCurrency(amount: number): string {
  return `৳${Number(amount || 0).toLocaleString()}`;
}

export default function DoctorTodayBreakdownModal({ doctor, today, onClose }: Props) {
  if (!doctor) return null;

  const name = doctor.doctor_name ?? 'Unknown doctor';
  const patients = Number(doctor.patient_count || 0);
  const tests = Number(doctor.test_count || doctor.test_order_count || 0);
  const visitAmount = Number(doctor.doctor_visit_amount || 0);
  const testAmount = Number(doctor.test_collection_amount || 0);
  const totalCollection = visitAmount + testAmount;
  const commission = Number(doctor.commission_amount || 0);
  const netIncome = totalCollection - commission;

  return (
    <Modal title={name} onClose={onClose}>
      <p className="text-xs text-[var(--color-text-muted)] -mt-2">Today — {today}</p>

      <div className="space-y-2 text-sm">
        <Row label="Patients seen" value={patients.toString()} />
        <Row label="Tests ordered" value={tests.toString()} />
      </div>

      <div className="border-t border-[var(--color-border)] pt-3 mt-1 space-y-2 text-sm">
        <Row label="Revenue from patients" value={formatCurrency(visitAmount)} />
        <Row label="Revenue from tests" value={formatCurrency(testAmount)} />
        <Row label="Total collection" value={formatCurrency(totalCollection)} bold />
      </div>

      <div className="border-t border-[var(--color-border)] pt-3 space-y-2 text-sm">
        <Row
          label="Commission paid out"
          value={formatCurrency(commission)}
          valueClassName="text-amber-700"
        />
      </div>

      <div className="border-t border-[var(--color-border)] pt-3">
        <Row
          label="Net hospital income"
          value={formatCurrency(netIncome)}
          labelClassName="font-semibold"
          valueClassName={`font-data text-xl font-bold ${netIncome >= 0 ? 'text-emerald-700' : 'text-[var(--color-error)]'}`}
        />
      </div>
    </Modal>
  );
}

function Row({
  label,
  value,
  bold = false,
  labelClassName = '',
  valueClassName = '',
}: {
  label: string;
  value: string;
  bold?: boolean;
  labelClassName?: string;
  valueClassName?: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className={`text-[var(--color-text-secondary)] ${labelClassName}`}>{label}</span>
      <span className={`font-data ${bold ? 'font-semibold' : ''} ${valueClassName}`}>{value}</span>
    </div>
  );
}
```

Notes:
- The `DoctorDailySummary` interface is exported with all fields optional to stay structurally compatible with the dashboard's existing local `DoctorDailySummary` interface (defined at `HospitalAdminDashboard.tsx:155-166`). Both have the same field set, so the dashboard can pass `doctorSummaries[i]` directly without type assertion.
- The component is `null` when `doctor` is null, so the dashboard doesn't need a guard before rendering.
- `Row` is a small local helper to keep the breakdown grid-aligned without writing four `flex justify-between` blocks.

- [ ] **Step 1.2: Verify TypeScript compiles**

Run:
```bash
cd /Users/rahmatullahzisan/Desktop/Dev/hms && pnpm tsc --noEmit -p web/tsconfig.json 2>&1 | head -40
```

Expected: no errors related to the new file. Pre-existing errors (if any) are not our concern — note them and continue.

- [ ] **Step 1.3: Commit**

```bash
cd /Users/rahmatullahzisan/Desktop/Dev/hms && git add web/src/components/dashboard/DoctorTodayBreakdownModal.tsx && git commit -m "feat(dashboard): DoctorTodayBreakdownModal component"
```

---

## Task 2: Add unit tests for the modal

**Files:**
- Create: `web/src/components/dashboard/DoctorTodayBreakdownModal.test.tsx`

- [ ] **Step 2.1: Create the test file**

Create `web/src/components/dashboard/DoctorTodayBreakdownModal.test.tsx` with the following contents:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import DoctorTodayBreakdownModal, { type DoctorDailySummary } from './DoctorTodayBreakdownModal';

const baseDoctor: DoctorDailySummary = {
  doctor_id: 11,
  doctor_name: 'Dr. Example Three',
  patient_count: 1,
  doctor_visit_count: 1,
  doctor_visit_amount: 1000,
  test_count: 1,
  test_order_count: 1,
  test_collection_amount: 200,
  commission_amount: 700,
};

describe('DoctorTodayBreakdownModal', () => {
  it('renders nothing when doctor is null', () => {
    const { container } = render(
      <DoctorTodayBreakdownModal doctor={null} today="2026-06-06" onClose={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('shows the doctor name, today subtitle, and all breakdown rows for a real doctor', () => {
    render(
      <DoctorTodayBreakdownModal doctor={baseDoctor} today="2026-06-06" onClose={vi.fn()} />,
    );

    expect(screen.getByText('Dr. Example Three')).toBeInTheDocument();
    expect(screen.getByText('Today — 2026-06-06')).toBeInTheDocument();

    expect(screen.getByText('Patients seen')).toBeInTheDocument();
    expect(screen.getByText('Tests ordered')).toBeInTheDocument();

    expect(screen.getByText('Revenue from patients')).toBeInTheDocument();
    expect(screen.getByText('৳1,000')).toBeInTheDocument();
    expect(screen.getByText('Revenue from tests')).toBeInTheDocument();
    expect(screen.getByText('৳200')).toBeInTheDocument();
    expect(screen.getByText('Total collection')).toBeInTheDocument();
    expect(screen.getByText('৳1,200')).toBeInTheDocument();

    expect(screen.getByText('Commission paid out')).toBeInTheDocument();
    expect(screen.getByText('৳700')).toBeInTheDocument();

    expect(screen.getByText('Net hospital income')).toBeInTheDocument();
    expect(screen.getByText('৳500')).toBeInTheDocument();
  });

  it('defaults missing fields to zero and still computes the net', () => {
    const sparse: DoctorDailySummary = {
      doctor_id: 12,
      doctor_name: 'Dr. Sparse',
    };
    render(<DoctorTodayBreakdownModal doctor={sparse} today="2026-06-06" onClose={vi.fn()} />);

    expect(screen.getByText('Dr. Sparse')).toBeInTheDocument();
    expect(screen.getByText('Patients seen')).toBeInTheDocument();
    expect(screen.getByText('Tests ordered')).toBeInTheDocument();
    expect(screen.getAllByText('৳0').length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText('Net hospital income')).toBeInTheDocument();
  });

  it('shows the real (possibly negative) net when commission exceeds collection', () => {
    const lossy: DoctorDailySummary = {
      ...baseDoctor,
      doctor_visit_amount: 100,
      test_collection_amount: 0,
      commission_amount: 500,
    };
    render(<DoctorTodayBreakdownModal doctor={lossy} today="2026-06-06" onClose={vi.fn()} />);

    expect(screen.getByText('Total collection').nextElementSibling).toHaveTextContent('৳100');
    expect(screen.getByText('Net hospital income').nextElementSibling).toHaveTextContent('৳-400');
  });

  it('invokes onClose when Escape is pressed', () => {
    const onClose = vi.fn();
    render(
      <DoctorTodayBreakdownModal doctor={baseDoctor} today="2026-06-06" onClose={onClose} />,
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
```

Notes:
- The "Patients seen" / "Revenue from patients" rows are simple `<div>` with two `<span>` children; `.nextElementSibling` reaches the value `<span>`. If Tailwind class names change, this still works because we read text content, not classes.
- The negative-net case verifies we are **not** flooring at zero (per spec).
- Escape behaviour is inherited from shared `Modal`.

- [ ] **Step 2.2: Run the test file to verify all tests pass**

Run:
```bash
cd /Users/rahmatullahzisan/Desktop/Dev/hms && pnpm vitest run web/src/components/dashboard/DoctorTodayBreakdownModal.test.tsx 2>&1 | tail -30
```

Expected: 5 tests pass, 0 fail.

- [ ] **Step 2.3: Commit**

```bash
cd /Users/rahmatullahzisan/Desktop/Dev/hms && git add web/src/components/dashboard/DoctorTodayBreakdownModal.test.tsx && git commit -m "test(dashboard): cover DoctorTodayBreakdownModal breakdown and net math"
```

---

## Task 3: Wire the click handler and modal into `HospitalAdminDashboard`

**Files:**
- Modify: `web/src/pages/HospitalAdminDashboard.tsx` (state, click handler, modal render)

- [ ] **Step 3.1: Add the import and state**

In `web/src/pages/HospitalAdminDashboard.tsx`:

1. Add to the import block (anywhere among existing `import` statements, after `Modal` is NOT used so we don't need to import it):
   ```ts
   import DoctorTodayBreakdownModal, { type DoctorDailySummary as BreakdownDoctor } from '../components/dashboard/DoctorTodayBreakdownModal';
   ```

2. Add `useState` (already imported at line 3). Just add a new state line near the other `useState` calls (search for the existing `useState` calls around line 495):
   ```ts
   const [selectedDoctor, setSelectedDoctor] = useState<BreakdownDoctor | null>(null);
   ```

- [ ] **Step 3.2: Make the doctor `<tr>` clickable and skip the unassigned row**

In `web/src/pages/HospitalAdminDashboard.tsx` at the doctor table render (lines 1400-1416), replace:

```tsx
                  {topDoctorSummaries.map((doctor) => {
                    const patients = Number(doctor.patient_count || 0);
                    const tests = Number(doctor.test_count || doctor.test_order_count || 0);
                    const commission = Number(doctor.commission_amount || 0);
                    const collection = Number(doctor.doctor_visit_amount || 0) + Number(doctor.test_collection_amount || 0);
                    const netIncome = Math.max(collection - commission, 0);

                    return (
                      <tr key={doctor.doctor_id}>
                        <td className="font-medium">{doctor.doctor_name}</td>
                        <td className="text-right font-data">{patients.toLocaleString()} patients</td>
                        <td className="text-right font-data">{tests.toLocaleString()} tests</td>
                        <td className="text-right font-data text-amber-700">{formatCurrency(commission)} commission</td>
                        <td className="text-right font-data text-emerald-700">{formatCurrency(netIncome)} net hospital income</td>
                      </tr>
                    );
                  })}
```

with:

```tsx
                  {topDoctorSummaries.map((doctor) => {
                    const patients = Number(doctor.patient_count || 0);
                    const tests = Number(doctor.test_count || doctor.test_order_count || 0);
                    const commission = Number(doctor.commission_amount || 0);
                    const collection = Number(doctor.doctor_visit_amount || 0) + Number(doctor.test_collection_amount || 0);
                    const netIncome = Math.max(collection - commission, 0);
                    const isAssigned = doctor.doctor_id !== null && doctor.doctor_id !== undefined && doctor.doctor_id !== 0;

                    return (
                      <tr
                        key={doctor.doctor_id}
                        className={isAssigned ? 'cursor-pointer hover:bg-[var(--color-bg-secondary)]' : ''}
                        onClick={isAssigned ? () => setSelectedDoctor(doctor) : undefined}
                        data-testid={isAssigned ? 'doctor-row' : 'unassigned-row'}
                      >
                        <td className="font-medium">{doctor.doctor_name}</td>
                        <td className="text-right font-data">{patients.toLocaleString()} patients</td>
                        <td className="text-right font-data">{tests.toLocaleString()} tests</td>
                        <td className="text-right font-data text-amber-700">{formatCurrency(commission)} commission</td>
                        <td className="text-right font-data text-emerald-700">{formatCurrency(netIncome)} net hospital income</td>
                      </tr>
                    );
                  })}
```

Notes:
- `data-testid` lets the new test cases target the right rows without relying on text that already contains names like "Dr. Example Three".
- The unassigned row has `doctor_id === 0` (or null) and is rendered as a non-clickable row.

- [ ] **Step 3.3: Render the modal at the end of the component**

At the very end of the `HospitalAdminDashboard` component's JSX (just before the final `</DashboardLayout>`), insert:

```tsx
        <DoctorTodayBreakdownModal
          doctor={selectedDoctor}
          today={getTodayGMT6()}
          onClose={() => setSelectedDoctor(null)}
        />
```

`getTodayGMT6` is already imported at the top of the file (verify with `grep -n "getTodayGMT6" web/src/pages/HospitalAdminDashboard.tsx`; if absent, add the import:
```ts
import { getTodayGMT6 } from '../lib/date-utils';
```).

- [ ] **Step 3.4: Verify TypeScript compiles**

Run:
```bash
cd /Users/rahmatullahzisan/Desktop/Dev/hms && pnpm tsc --noEmit -p web/tsconfig.json 2>&1 | grep -E "HospitalAdminDashboard|DoctorTodayBreakdownModal" | head -20
```

Expected: no errors.

- [ ] **Step 3.5: Run the existing test suite for the dashboard to ensure nothing broke**

Run:
```bash
cd /Users/rahmatullahzisan/Desktop/Dev/hms && pnpm vitest run web/src/pages/HospitalAdminDashboard.test.tsx 2>&1 | tail -20
```

Expected: all existing tests still pass.

- [ ] **Step 3.6: Commit**

```bash
cd /Users/rahmatullahzisan/Desktop/Dev/hms && git add web/src/pages/HospitalAdminDashboard.tsx && git commit -m "feat(dashboard): open DoctorToday breakdown modal on doctor row click"
```

---

## Task 4: Add dashboard-level tests for the click → modal flow

**Files:**
- Modify: `web/src/pages/HospitalAdminDashboard.test.tsx`

- [ ] **Step 4.1: Add two doctor rows to the existing `dailyCollectionData` mock and capture them in a variable**

In `web/src/pages/HospitalAdminDashboard.test.tsx`, the `useApiQuery` mock currently returns a single doctor named "Dr. Hasan" in the `/api/reports/daily-collection` branch (lines 187-206). Replace that block with one that returns two assigned doctors plus the unassigned placeholder so we can test all three click behaviours.

Replace:
```ts
              : path.startsWith('/api/reports/daily-collection')
                ? {
                    doctor_summaries: [
                      {
                        doctor_id: 11,
                        doctor_name: 'Dr. Hasan',
                        patient_count: 4,
                        doctor_visit_count: 3,
                        doctor_visit_amount: 1800,
                        test_count: 5,
                        test_order_count: 2,
                        test_collection_amount: 3200,
                        commission_amount: 700,
                      },
                    ],
                    service_summary: {
                      doctor_visit_amount: 1800,
                      test_amount: 3200,
                    },
                  }
```

with:
```ts
              : path.startsWith('/api/reports/daily-collection')
                ? {
                    doctor_summaries: [
                      {
                        doctor_id: 11,
                        doctor_name: 'Dr. Hasan',
                        patient_count: 4,
                        doctor_visit_count: 3,
                        doctor_visit_amount: 1800,
                        test_count: 5,
                        test_order_count: 2,
                        test_collection_amount: 3200,
                        commission_amount: 700,
                      },
                      {
                        doctor_id: 0,
                        doctor_name: 'Unassigned / No Doctor',
                        patient_count: 0,
                        doctor_visit_amount: 0,
                        test_count: 0,
                        test_collection_amount: 0,
                        commission_amount: 0,
                      },
                    ],
                    service_summary: {
                      doctor_visit_amount: 1800,
                      test_amount: 3200,
                    },
                  }
```

The existing tests that only assert presence of the doctor table or specific money values should still pass (Dr. Hasan's numbers are unchanged, and the new unassigned row uses `doctor_id: 0`).

- [ ] **Step 4.2: Add a new `describe` block at the end of the file with three click-flow tests**

Find the closing `});` of the top-level `describe('HospitalAdminDashboard', ...)` block (around line 358-362). Insert the following just before the final `});`:

```tsx
  describe('Doctor Today breakdown modal', () => {
    it('opens the modal with the doctor name and breakdown when a real doctor row is clicked', () => {
      render(<HospitalAdminDashboard role="hospital_admin" />);

      const drHasanRow = screen.getByTestId('doctor-row');
      fireEvent.click(drHasanRow);

      expect(screen.getByText('Dr. Hasan')).toBeInTheDocument();
      expect(screen.getByText('Patients seen')).toBeInTheDocument();
      expect(screen.getByText('Tests ordered')).toBeInTheDocument();

      expect(screen.getByText('৳1,800')).toBeInTheDocument();
      expect(screen.getByText('৳3,200')).toBeInTheDocument();
      expect(screen.getByText('৳5,000')).toBeInTheDocument();
      expect(screen.getByText('৳700')).toBeInTheDocument();
      expect(screen.getByText('৳4,300')).toBeInTheDocument();
    });

    it('does not open the modal when the Unassigned row is clicked', () => {
      render(<HospitalAdminDashboard role="hospital_admin" />);

      const unassignedRow = screen.getByTestId('unassigned-row');
      fireEvent.click(unassignedRow);

      expect(screen.queryByText('Today —')).not.toBeInTheDocument();
      expect(screen.queryByText('Net hospital income')).not.toBeInTheDocument();
    });

    it('closes the modal when Escape is pressed', () => {
      render(<HospitalAdminDashboard role="hospital_admin" />);

      fireEvent.click(screen.getAllByTestId('doctor-row')[0]);
      expect(screen.getByText('Today —')).toBeInTheDocument();

      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.queryByText('Today —')).not.toBeInTheDocument();
    });
  });
```

- [ ] **Step 4.3: Run the dashboard test file to verify all tests pass**

Run:
```bash
cd /Users/rahmatullahzisan/Desktop/Dev/hms && pnpm vitest run web/src/pages/HospitalAdminDashboard.test.tsx 2>&1 | tail -25
```

Expected: every existing test still passes, plus the 3 new ones, total pass count goes up by 3.

- [ ] **Step 4.4: Commit**

```bash
cd /Users/rahmatullahzisan/Desktop/Dev/hms && git add web/src/pages/HospitalAdminDashboard.test.tsx && git commit -m "test(dashboard): cover Doctor Today modal click flow and unassigned row"
```

---

## Task 5: Final verification

- [ ] **Step 5.1: Run the full web test suite to ensure no regressions**

Run:
```bash
cd /Users/rahmatullahzisan/Desktop/Dev/hms && pnpm vitest run --project=web 2>&1 | tail -25
```

Expected: 0 failures. If a pre-existing flaky test is unrelated, note it and continue.

- [ ] **Step 5.2: Run the linter on the modified files**

Run:
```bash
cd /Users/rahmatullahzisan/Desktop/Dev/hms && pnpm lint web/src/components/dashboard/DoctorTodayBreakdownModal.tsx web/src/components/dashboard/DoctorTodayBreakdownModal.test.tsx web/src/pages/HospitalAdminDashboard.tsx web/src/pages/HospitalAdminDashboard.test.tsx 2>&1 | tail -20
```

Expected: no errors. Fix any reported issues (unused imports, missing `data-testid` types, etc.) and re-run.

- [ ] **Step 5.3: Verify the dashboard still mounts by inspecting dev build output**

Run:
```bash
cd /Users/rahmatullahzisan/Desktop/Dev/hms && pnpm --filter web build 2>&1 | tail -10
```

Expected: build succeeds.

- [ ] **Step 5.4: Print a summary commit**

No code changes here. Confirm with:
```bash
cd /Users/rahmatullahzisan/Desktop/Dev/hms && git log --oneline -5
```

Expected: the four feature commits from Tasks 1-4 are visible at the top.

- [ ] **Step 5.5: Done — push the branch (do NOT push; user will push)**

Inform the user that implementation is complete and tests pass. The user will decide when to push and deploy to production per `AGENTS.md` (`pnpm build && wrangler deploy --env production`).
