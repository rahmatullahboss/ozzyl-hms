# Patient Paid-Visit and IPD Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show canonical paid-appointment history during booking, mark follow-up consultation invoices, and improve IPD patient context with age, admission time, and normalized doctor names.

**Architecture:** Extend the existing appointment fee-preview response rather than adding a second booking API. Reuse the positive-payment doctor-visit definition already used by returning-patient eligibility, expose normalized appointment type through the bill detail payload, and keep presentation helpers in focused frontend utility modules.

**Tech Stack:** Cloudflare Workers/Hono, D1 SQL, TypeScript, React 19, Vitest, Testing Library, Tailwind CSS.

## Global Constraints

- Last visit means the latest doctor appointment/doctor-visit invoice with a positive payment.
- Clinical check-in/completion status does not determine paid-visit context.
- Selected doctor history is primary; latest history with any other doctor is secondary.
- Consultation invoice follow-up marker recognizes `old_patient`, `follow_up`, and `followup`.
- IPD age badge uses compact English format such as `35Y`.
- Date-only values must not fabricate a time.
- Doctor display must contain exactly one `Dr.` prefix where a prefix is required.
- Do not change accounting, payment finalization, eligibility windows, migrations, or production state.

---

### Task 1: Canonical paid-appointment context in fee preview

**Files:**
- Modify: `src/routes/tenant/appointments.ts:332-480,1358-1387`
- Test: `test/appointment-eligibility.test.ts`

**Interfaces:**
- Produces: `paidVisitContext.selectedDoctor` and `paidVisitContext.latestAnyDoctor` on `GET /appointments/fee-preview`.
- Each record contains `appointmentId`, `doctorId`, `doctorName`, `appointmentType`, `appointmentDate`, and `paidAt`.

- [ ] **Step 1: Add failing response-contract tests**

Add tests that seed two paid doctor appointments for one patient, one with the selected doctor and one with another doctor, plus one unpaid newer appointment. Assert:

```ts
expect(body.paidVisitContext.selectedDoctor).toMatchObject({
  doctorId: 1,
  appointmentType: 'old_patient',
  appointmentDate: '2026-05-14',
  paidAt: '2026-05-14 10:30:00',
});
expect(body.paidVisitContext.latestAnyDoctor).toMatchObject({
  doctorId: 2,
  appointmentDate: '2026-05-15',
});
```

Also assert the unpaid appointment is not selected and a patient with no positive payment returns both fields as `null`.

- [ ] **Step 2: Run the focused backend test and confirm failure**

Run: `pnpm vitest run test/appointment-eligibility.test.ts`

Expected: FAIL because `paidVisitContext` is absent.

- [ ] **Step 3: Add a focused paid-context loader**

Implement a helper near `evaluateAppointmentEligibility`:

```ts
type PaidAppointmentContextRow = {
  appointment_id: number;
  doctor_id: number | null;
  doctor_name: string | null;
  appointment_type: string | null;
  appointment_date: string | null;
  paid_at: string;
};

async function loadPaidAppointmentContext(
  d1: D1Database,
  input: { tenantId: string; patientId: number; doctorId?: number | null },
) {
  // Query finalized, active doctor-visit invoice linkage with positive payments.
  // Aggregate MAX(payment timestamp) per appointment/bill before ordering.
  // Return selectedDoctor and latestAnyDoctor.
}
```

Use the existing joins through `bills`, `payments`, `billing_provisional_items`, `visits`, and `appointments`. Filter cancelled/refunded/draft bills and inactive/cancelled provisional rows. Do not filter by appointment clinical status.

- [ ] **Step 4: Return the context from fee preview**

After eligibility resolution:

```ts
const paidVisitContext = data.patientId
  ? await loadPaidAppointmentContext(c.env.DB, {
      tenantId,
      patientId: data.patientId,
      doctorId: data.doctorId,
    })
  : { selectedDoctor: null, latestAnyDoctor: null };

return c.json({ charge, eligibility, paidVisitContext });
```

- [ ] **Step 5: Run focused backend tests**

Run: `pnpm vitest run test/appointment-eligibility.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the backend slice**

```bash
git add src/routes/tenant/appointments.ts test/appointment-eligibility.test.ts
git commit -m "feat(appointments): expose paid visit context"
```

---

### Task 2: Appointment booking popup paid-history panel

**Files:**
- Modify: `web/src/pages/AppointmentScheduler.tsx:79-93,225-334,376-443`
- Test: `web/src/pages/AppointmentScheduler.test.ts`

**Interfaces:**
- Consumes: `AppointmentFeePreviewResponse.paidVisitContext` from Task 1.
- Produces: primary selected-doctor history and optional secondary other-doctor history.

- [ ] **Step 1: Add failing helper/rendering tests**

Export a pure formatter/selector for deterministic tests:

```ts
export function getPaidVisitContextDisplay(
  context: AppointmentFeePreviewResponse['paidVisitContext'],
): {
  primary: PaidVisitRecord | null;
  secondary: PaidVisitRecord | null;
} {
  // secondary is omitted when it is the same appointment as primary
}
```

Test selected-doctor primary, different-doctor secondary, duplicate suppression, and null context.

- [ ] **Step 2: Run the focused frontend test and confirm failure**

Run: `pnpm --dir web test -- src/pages/AppointmentScheduler.test.ts`

Expected: FAIL because the type/helper does not exist.

- [ ] **Step 3: Store fee-preview context in the modal**

Extend the response type:

```ts
interface PaidVisitRecord {
  appointmentId: number;
  doctorId: number | null;
  doctorName: string | null;
  appointmentType: string | null;
  appointmentDate: string | null;
  paidAt: string;
}

interface AppointmentFeePreviewResponse {
  // existing fields
  paidVisitContext?: {
    selectedDoctor: PaidVisitRecord | null;
    latestAnyDoctor: PaidVisitRecord | null;
  };
}
```

Add state and set it inside the existing fee-preview effect. Clear it when no patient/doctor is selected or when the request fails.

- [ ] **Step 4: Render the compact context panel**

Under the selected patient card, render only when primary or secondary exists. Use:

```tsx
<div className="rounded-lg border border-purple-200 bg-purple-50/70 p-3 text-xs dark:border-purple-900/60 dark:bg-purple-950/30">
  <div className="font-semibold text-purple-900 dark:text-purple-100">Last paid with selected doctor</div>
  <div>Paid: {formatDisplayDateTime(primary.paidAt)}</div>
  <div>Appointment: {formatDisplayDate(primary.appointmentDate)}</div>
</div>
```

Render the secondary line with “Latest paid appointment with another doctor” only when different. Include normalized doctor name and humanized appointment type.

- [ ] **Step 5: Run focused tests**

Run: `pnpm --dir web test -- src/pages/AppointmentScheduler.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the popup slice**

```bash
git add web/src/pages/AppointmentScheduler.tsx web/src/pages/AppointmentScheduler.test.ts
git commit -m "feat(appointments): show paid visit history while booking"
```

---

### Task 3: Consultation invoice follow-up marker and doctor normalization

**Files:**
- Create: `web/src/lib/doctorName.ts`
- Create: `web/src/lib/doctorName.test.ts`
- Modify: `src/routes/tenant/billing.ts:822-877`
- Modify: `web/src/components/invoice/types.ts:23-30`
- Modify: `web/src/components/invoice/ConsultationInvoiceBody.tsx`
- Modify: `web/src/pages/BillPrint.tsx:1017-1040`
- Test: `web/src/pages/BillPrint.test.ts`

**Interfaces:**
- Produces: `formatDoctorDisplayName(value?: string | null): string | null`.
- Extends `InvoiceAppointmentInfo` with `appointmentType?: string | null`.

- [ ] **Step 1: Write failing doctor-name tests**

```ts
expect(formatDoctorDisplayName('Dr. Rahman')).toBe('Dr. Rahman');
expect(formatDoctorDisplayName('Dr Dr. Rahman')).toBe('Dr. Rahman');
expect(formatDoctorDisplayName('Rahman')).toBe('Dr. Rahman');
expect(formatDoctorDisplayName(null)).toBeNull();
```

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm --dir web test -- src/lib/doctorName.test.ts`

Expected: FAIL because the module is missing.

- [ ] **Step 3: Implement the shared normalizer**

```ts
export function stripDoctorPrefix(value?: string | null): string | null {
  const normalized = String(value ?? '').trim().replace(/^(?:dr\.?\s*)+/i, '').trim();
  return normalized || null;
}

export function formatDoctorDisplayName(value?: string | null): string | null {
  const name = stripDoctorPrefix(value);
  return name ? `Dr. ${name}` : null;
}
```

- [ ] **Step 4: Add appointment type to the bill detail response**

Select `a.appointment_type AS appointment_type` and include:

```ts
appointmentType: (bill.appointment_type as string | null) ?? null,
```

Extend `InvoiceAppointmentInfo` accordingly.

- [ ] **Step 5: Add failing invoice marker coverage**

In `BillPrint.test.ts`, assert consultation invoice source passes `appointmentType`, and add component-level/source coverage that follow-up variants produce visible `Follow-up` text while `new_patient` does not.

- [ ] **Step 6: Render the marker and normalized doctor**

In `ConsultationInvoiceBody`, compute:

```ts
const normalizedType = appointment?.appointmentType?.toLowerCase().replace(/[-\s]/g, '_');
const isFollowUp = ['old_patient', 'follow_up', 'followup'].includes(normalizedType ?? '');
const doctorDisplayName = formatDoctorDisplayName(appointment?.doctorName);
```

Use `doctorDisplayName` in both doctor detail and item subtitle. Render a purple pill beside the appointment section title when `isFollowUp`.

- [ ] **Step 7: Run focused tests**

Run: `pnpm --dir web test -- src/lib/doctorName.test.ts src/pages/BillPrint.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit the invoice slice**

```bash
git add src/routes/tenant/billing.ts web/src/lib/doctorName.ts web/src/lib/doctorName.test.ts web/src/components/invoice/types.ts web/src/components/invoice/ConsultationInvoiceBody.tsx web/src/pages/BillPrint.tsx web/src/pages/BillPrint.test.ts
git commit -m "feat(billing): mark follow-up consultation invoices"
```

---

### Task 4: IPD age badge, admission date-time, and normalized doctor display

**Files:**
- Modify: `src/routes/tenant/ipBilling.ts:337-410`
- Modify: `web/src/components/reception/ProvisionalBillingModal.tsx`
- Modify: `web/src/components/reception/ProvisionalBillingModal.test.tsx`
- Modify: `web/src/pages/IPBillingPage.tsx`
- Modify: `web/src/pages/IPBillingPage.doctor-rounds.test.tsx`

**Interfaces:**
- Consumes: `formatAgeFromDateOfBirth`, `formatDisplayDateTime`, and `formatDoctorDisplayName`.
- Extends IPD patient rows with `date_of_birth?: string | null`.

- [ ] **Step 1: Add failing IP billing route coverage**

Update the route test fixture/expectation to require `date_of_birth` from `patients.date_of_birth` in the normal query and `NULL AS date_of_birth` in fallback output.

Run: `pnpm vitest run test/integration/routes/ip-billing.test.ts`

Expected: FAIL because the field is absent.

- [ ] **Step 2: Return DOB from the backend**

Normal query:

```sql
p.patient_code, p.date_of_birth,
```

Fallback query:

```sql
NULL AS patient_code, NULL AS date_of_birth,
```

- [ ] **Step 3: Add failing modal presentation tests**

Use a patient with:

```ts
date_of_birth: '1991-07-26',
admitted_date: '2026-07-26T08:45:00+06:00',
doctor_name: 'Dr. Dr Rahman',
```

Assert the list/selected summary contains `35Y`, includes `08:45`, and contains `Dr. Rahman` but not `Dr. Dr`.

Run: `pnpm --dir web test -- src/components/reception/ProvisionalBillingModal.test.tsx`

Expected: FAIL.

- [ ] **Step 4: Implement modal display**

Extend `PBAdmittedPatient` with `date_of_birth`. Compute compact age with:

```ts
const ageLabel = p.date_of_birth
  ? formatAgeFromDateOfBirth(p.date_of_birth, 'en-GB')
  : null;
```

Place it beside the patient name in a small slate badge. Use `formatDisplayDateTime` for timestamp values and `formatDisplayDate` only for date-only values. Use `formatDoctorDisplayName` for doctor metadata.

- [ ] **Step 5: Update the main IP billing table**

Replace date-only admission rendering with a helper that preserves date-only inputs and uses date-time for timestamps:

```ts
export function formatAdmissionDisplay(value?: string | null) {
  if (!value) return '-';
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? formatDisplayDate(value)
    : formatDisplayDateTime(value);
}
```

Add/adjust the page test to assert time rendering.

- [ ] **Step 6: Run focused IPD tests**

Run: `pnpm --dir web test -- src/components/reception/ProvisionalBillingModal.test.tsx src/pages/IPBillingPage.doctor-rounds.test.tsx`

Run: `pnpm vitest run test/integration/routes/ip-billing.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit the IPD slice**

```bash
git add src/routes/tenant/ipBilling.ts web/src/components/reception/ProvisionalBillingModal.tsx web/src/components/reception/ProvisionalBillingModal.test.tsx web/src/pages/IPBillingPage.tsx web/src/pages/IPBillingPage.doctor-rounds.test.tsx test/integration/routes/ip-billing.test.ts
git commit -m "feat(ipd): show age and admission time in billing"
```

---

### Task 5: Regression verification and integration readiness

**Files:**
- Review all task-owned files.
- No production configuration or migration changes.

- [ ] **Step 1: Verify worktree ownership and diff**

Run: `pnpm worktree:check -- --mode=task --allow-dirty`

Expected: `WORKTREE_POLICY_OK`.

- [ ] **Step 2: Run all focused frontend tests**

Run:

```bash
pnpm --dir web test -- src/pages/AppointmentScheduler.test.ts src/lib/doctorName.test.ts src/pages/BillPrint.test.ts src/components/reception/ProvisionalBillingModal.test.tsx src/pages/IPBillingPage.doctor-rounds.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run focused backend tests**

Run:

```bash
pnpm vitest run test/appointment-eligibility.test.ts test/integration/routes/ip-billing.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run TypeScript and production build**

Run: `pnpm --dir web build`

Expected: TypeScript and Vite build complete successfully.

- [ ] **Step 5: Review complete branch diff**

Confirm only the approved spec, plan, backend route changes, frontend helpers/components, and tests are present. Confirm no migration, lockfile, generated artifact, or unrelated change.

- [ ] **Step 6: Commit any final test-only adjustments**

```bash
git add src/routes/tenant/appointments.ts src/routes/tenant/billing.ts src/routes/tenant/ipBilling.ts test/appointment-eligibility.test.ts test/integration/routes/ip-billing.test.ts web/src/pages/AppointmentScheduler.tsx web/src/pages/AppointmentScheduler.test.ts web/src/lib/doctorName.ts web/src/lib/doctorName.test.ts web/src/components/invoice/types.ts web/src/components/invoice/ConsultationInvoiceBody.tsx web/src/pages/BillPrint.tsx web/src/pages/BillPrint.test.ts web/src/components/reception/ProvisionalBillingModal.tsx web/src/components/reception/ProvisionalBillingModal.test.tsx web/src/pages/IPBillingPage.tsx web/src/pages/IPBillingPage.doctor-rounds.test.tsx
git commit -m "test: cover paid visit and IPD context"
```

Run this only when task-owned verification adjustments remain; skip the commit when the worktree is already clean.

- [ ] **Step 7: Integrate into local main**

From the clean main worktree:

```bash
pnpm worktree:check -- --mode=integration
git merge --ff-only feature/ipd-billing-age-badge-20260726
```

Run fresh focused tests and `pnpm --dir web build` on main. Do not push or deploy without separate authorization.
