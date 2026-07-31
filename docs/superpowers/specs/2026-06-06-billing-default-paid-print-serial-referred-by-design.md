# Billing Default Paid Zero, Auto-Print, Visit Serial, and Referred-By Design

> Date: 2026-06-06
> Scope: Billing counter, appointment scheduler, bill print page, and a new referral_hospitals table for test-bill "referred by" tracking
> Goal: Reduce manual steps at the counter (auto-navigate to print, paid defaults to 0, manual control), surface the daily visit serial prominently on every invoice, and let reception tag test bills with a referrer (self / hospital / doctor) where hospitals are managed in a small admin table

## Why Now

The front desk is the slowest part of the visit. Reception has to type paid amounts that almost match the total, click a "print after save" checkbox they always want anyway, find the invoice in the bill list to print it, and then somehow tell the patient their serial. On the print page the invoice number is small and there is no referrer line, so the lab has to ask "who sent you?" on every test bill. This change removes that friction.

## Product Outcome

After this change:

- The billing counter starts with paid = 0 for every bill; reception types whatever was actually paid. A one-click "Fill full" helper is still there for the common case.
- Every successful bill save opens the print page in a new tab automatically. No checkbox.
- The bill print page shows the visit's daily queue serial in a large, prominent style above the existing invoice number. e.g. `#5` is the first thing the patient sees.
- The invoice banner for appointment/consultation items reads `APPOINTMENT INVOICE` / `অ্যাপয়েন্টমেন্ট ইনভয়েস` (was `DOCTOR CONSULTATION`).
- The appointment scheduler has a third serial-choice mode: free-text manual entry, with duplicate checking.
- Test bills (any bill with at least one test/lab item) carry a "Referred by" tag. Reception picks Self, a hospital (from a manageable list), or a doctor. The tag shows on the printed invoice.
- Admins can add/edit/disable referral hospitals from the billing master page (e.g. "Barguna Govt College / BGH").

## Guiding Principles

- Keep the request handler thin; this is mostly form + render changes plus one new CRUD table.
- Reuse the existing `referring_doctor_id` column on bills for the doctor case; do not duplicate.
- Reuse the existing `appointments.token_no` / `queue_entries.token_number` for the visit serial; do not invent a new field.
- The referred-by hospitals table is tenant-scoped (multi-tenant safe).
- Bilingual labels (English + Bengali) wherever a user-facing string is added.

## Non-Goals

- No changes to payment gateway integration, deposit handling, or counter sessions.
- No new appointment type or queue logic. The token is still auto-assigned; we are just adding a manual override input.
- No analytics or reporting on referral sources (out of scope for this change).
- No migration of existing bills; historical bills without referred_by will render without that line.

## Design

### Part 1 — Paid = 0 default for all bills

**File:** `web/src/pages/BillingCounterPage.tsx`

Replace the auto-fill useEffect (around line 493-497) so that the `paidAmount` state starts blank on a fresh bill. The user types whatever was paid; the form remains a fully manual "paid amount" field.

Keep a small helper button next to the paid-amount input labelled `Fill full` (localized) that fills the input with `max(0, total - depositDeducted)`. This preserves the one-click convenience without making it the default.

Drop the "Print after save" checkbox UI and its `shouldPrintAfterSave` state (see Part 2).

```ts
// REMOVED useEffect:
// useEffect(() => {
//   if (billMode === 'paid' && lines.length > 0 && paidAmount === '') {
//     setPaidAmount(String(Math.max(0, totals.total - totals.deposit)));
//   }
// }, [...]);

// ADD: small button next to paid input
<button type="button" onClick={() => setPaidAmount(String(Math.max(0, totals.total - totals.deposit)))}>
  {t('counter.fillFull', { defaultValue: 'Fill full' })}
</button>
```

### Part 2 — Always navigate to print page after save

**File:** `web/src/pages/BillingCounterPage.tsx`

In the createInvoice mutation's `onSuccess` (around line 499-518), drop the `shouldPrintAfterSave` guard. Always open the print page in a new tab if the response has a `billId`.

```ts
onSuccess: (res) => {
  toast.success(res.invoiceNo ? t('counter.invoiceCreated', { invoiceNo: res.invoiceNo }) : res.message);
  if (res.billId) {
    window.open(`/h/${slug}/billing/${res.billId}/print`, '_blank');
  }
  // ... existing reset code, minus setShouldPrintAfterSave
}
```

Remove the `shouldPrintAfterSave` state declaration, the `setShouldPrintAfterSave` calls in onSuccess and onError, and the JSX block at line 1564-1574. The form no longer has a print opt-out.

If the popup is blocked, the success toast still confirms the save. We do not retry or show a different error.

### Part 3 — Visit/queue serial large on invoice

**Backend:** `src/routes/tenant/billing.ts` (GET `/api/billing/:id`, around line 719-774)

Extend the bills SELECT to join visits and appointments, plus a fallback to queue_entries for walk-in visits that do not have an appointment:

```sql
SELECT b.*, b.total AS total_amount, b.paid AS paid_amount,
       COALESCE(b.due, MAX(0, COALESCE(b.total, 0) - COALESCE(b.paid, 0))) AS outstanding,
       p.name as patient_name, p.patient_code, p.mobile, p.address, p.age, p.gender,
       u.name as approved_by_name,
       COALESCE(qe.token_number, a.token_no) AS visit_serial,
       a.appt_no AS appt_no
FROM bills b
JOIN patients p ON b.patient_id = p.id
LEFT JOIN users u ON b.approved_by = u.id
LEFT JOIN visits v ON v.id = b.visit_id
LEFT JOIN appointments a ON a.id = v.appointment_id
LEFT JOIN queue_entries qe
  ON qe.appointment_id = a.id AND qe.tenant_id = b.tenant_id
  AND qe.status NOT IN ('completed', 'cancelled')
WHERE b.id = ? AND b.tenant_id = ?
```

Return `visit_serial` and `appt_no` in the response body so the front end can show them.

**Frontend:** `web/src/pages/BillPrint.tsx`

Extend `BillDetail`:

```ts
interface BillDetail {
  // ... existing fields
  visit_serial?: number | null;
  appt_no?: string | null;
}
```

In the header (around line 342-359), render the visit serial large above the invoice number when present:

```tsx
{bill.visit_serial != null && (
  <div className="text-right">
    <p className="text-xs uppercase tracking-wider text-gray-500">
      {printLang === 'bn' ? 'সিরিয়াল নং' : 'Serial'}
    </p>
    <p className="font-mono text-5xl font-extrabold text-gray-900 leading-none">
      #{bill.visit_serial}
    </p>
  </div>
)}
```

The existing invoice number line stays where it is (smaller, in the same right-side area).

### Part 4 — Free-text manual serial input in appointment scheduler

**Schema:** `src/schemas/appointment.ts`

Extend the create-appointment schema with a flag that distinguishes "manual free text" from "reserved range pick":

```ts
export const createAppointmentSchema = z.object({
  // ... existing fields
  requestedTokenNo: z.number().int().min(1).max(9999).optional(),
  forceTokenNo: z.boolean().default(false),  // NEW
});
```

`forceTokenNo: false` keeps the existing "must be inside a reserved range" behavior. `forceTokenNo: true` skips that check and only validates against existing tokens for the same doctor + date.

**Backend:** `src/routes/tenant/appointments.ts` (around line 1343-1366)

Branch on `data.forceTokenNo`:

```ts
if (data.requestedTokenNo) {
  if (!data.forceTokenNo) {
    // existing reserved-range check (unchanged)
  }
  // always check duplicate against existing appointments
  const taken = await c.env.DB.prepare(`
    SELECT id FROM appointments
    WHERE tenant_id = ? AND appt_date = ? AND doctor_id = ? AND token_no = ?
      AND status NOT IN ('cancelled', 'no_show')
  `).bind(...).first();

  if (taken) {
    throw new HTTPException(409, { message: `Token ${data.requestedTokenNo} is already assigned for that day.` });
  }
  tokenNo = data.requestedTokenNo;
} else {
  tokenNo = await getNextAvailableToken(...);
}
```

**Frontend:** `web/src/pages/AppointmentScheduler.tsx`

Replace the single "Serial choice" select (line 494-508) with a 3-mode control:

```tsx
<div className="space-y-2">
  <label className="text-sm font-medium">{t('appointments.serialChoice', { defaultValue: 'Serial choice' })}</label>
  <div className="flex gap-2">
    <label className="flex items-center gap-1 text-sm">
      <input type="radio" name="serialMode" value="auto"
             checked={serialMode === 'auto'} onChange={() => setSerialMode('auto')} />
      {t('appointments.serialAuto', { defaultValue: 'Auto' })}
    </label>
    <label className="flex items-center gap-1 text-sm">
      <input type="radio" name="serialMode" value="reserved"
             checked={serialMode === 'reserved'} onChange={() => setSerialMode('reserved')} />
      {t('appointments.serialReserved', { defaultValue: 'Reserved' })}
    </label>
    <label className="flex items-center gap-1 text-sm">
      <input type="radio" name="serialMode" value="manual"
             checked={serialMode === 'manual'} onChange={() => setSerialMode('manual')} />
      {t('appointments.serialManual', { defaultValue: 'Manual' })}
    </label>
  </div>

  {serialMode === 'auto' && (
    <p className="text-xs text-muted">{nextRegularHint}</p>
  )}

  {serialMode === 'reserved' && (
    <select className="input w-full" value={requestedTokenNo}
            onChange={(e) => setRequestedTokenNo(e.target.value ? Number(e.target.value) : '')}>
      <option value="">{t('appointments.pickReserved', { defaultValue: 'Pick a reserved serial…' })}</option>
      {availableTokens.map(t => (
        <option key={t.token_no} value={t.token_no}>
          #{t.token_no}{t.label ? ` (${t.label})` : ''}
        </option>
      ))}
    </select>
  )}

  {serialMode === 'manual' && (
    <input type="number" min="1" max="9999" className="input w-full"
           value={manualToken}
           onChange={(e) => setManualToken(e.target.value ? Number(e.target.value) : '')}
           placeholder={t('appointments.manualSerialPlaceholder', { defaultValue: 'Type any number 1-9999' })} />
  )}
</div>
```

State changes:
- Add `serialMode: 'auto' | 'reserved' | 'manual'`, default `'auto'`.
- Add `manualToken: number | ''`, default `''`.
- On submit, compute `requestedTokenNo` and `forceTokenNo`:
  - `auto` → `{ requestedTokenNo: undefined, forceTokenNo: false }`
  - `reserved` → `{ requestedTokenNo: <selected>, forceTokenNo: false }`
  - `manual` → `{ requestedTokenNo: manualToken, forceTokenNo: true }`

Error handling: on 409 from the backend, toast the message and refresh the availability query so the user sees the taken numbers.

### Part 5 — Replace "consultation" with "appointment" on the invoice banner

**File:** `web/src/lib/print/invoiceCategory.ts` (line 45)

Change only the displayed label. The internal `InvoiceCategoryKey` of `'consultation'` stays as-is to keep the existing `doctor_visit`/`consultation`/`opd`/`visit` mappings intact.

```ts
const LABELS: Record<InvoiceCategoryKey, Record<InvoiceLang, string>> = {
  consultation: { en: 'APPOINTMENT INVOICE', bn: 'অ্যাপয়েন্টমেন্ট ইনভয়েস' },
  // ... others unchanged
};
```

The other parts of the page (per-line `item_category` text, line descriptions, totals) stay as they are. Only the top banner is affected.

### Part 6 — "Referred by" on test bills

#### 6.1 New table `referral_hospitals`

**Migration:** `migrations/0296_bills_referred_by_and_hospitals.sql` (next available number):

```sql
CREATE TABLE IF NOT EXISTS referral_hospitals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  short_code TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_referral_hospitals_tenant_active
  ON referral_hospitals(tenant_id, is_active);
```

```sql
ALTER TABLE bills ADD COLUMN referred_by_type TEXT;
  -- values: 'self' | 'hospital' | 'doctor' | null
ALTER TABLE bills ADD COLUMN referred_by_hospital_id INTEGER
  REFERENCES referral_hospitals(id);
```

Sync to `tenant-schema.sql` / `schema.sql` so fresh local installs include both.

**Schema:** `src/db/schema/schema.ts` — export the new table and add the two new bill columns:

```ts
export const referralHospitals = sqliteTable('referral_hospitals', {
  id: integer().primaryKey({ autoIncrement: true }),
  tenantId: text('tenant_id').notNull(),
  name: text().notNull(),
  shortCode: text('short_code'),
  isActive: integer('is_active').notNull().default(1),
  createdBy: integer('created_by'),
  createdAt: text('created_at').notNull().default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: text('updated_at').notNull().default(sql`(CURRENT_TIMESTAMP)`),
});

export const bills = sqliteTable('bills', {
  // ... existing
  referredByType: text('referred_by_type'),
  referredByHospitalId: integer('referred_by_hospital_id'),
  // (no referredByName column — the doctor case reuses referringDoctorId + the staff join)
});
```

#### 6.2 Hospital CRUD endpoints

**New file:** `src/routes/tenant/referralHospitals.ts` (~80 lines), mounted under `/api/referral-hospitals`:

- `GET  /` — list (optional `?search=`, `?active=true|false`); admin sees inactive too, non-admin sees active only.
- `POST /` — create; requires `billing:write` permission; body `{ name, shortCode? }`.
- `PUT  /:id` — update; same permission.
- `DELETE /:id` — soft-delete; sets `is_active = 0`; same permission.

All routes tenant-scoped via existing middleware. Soft-delete only; we never hard-delete a hospital that has been used on a bill.

Wire into `src/routes/tenant/index.ts` (or wherever tenant routes are aggregated).

#### 6.3 Bill form integration

**Schema:** `src/schemas/billingCounter.ts` — extend the counter invoice schema:

```ts
export const billingCounterInvoiceSchema = z.object({
  // ... existing
  referredByType: z.enum(['self', 'hospital', 'doctor']).optional(),
  referredByHospitalId: z.number().int().positive().optional(),
}).refine(
  (data) => !(data.referredByType === 'hospital' && !data.referredByHospitalId),
  { message: 'Select a hospital when referred-by type is hospital', path: ['referredByHospitalId'] },
);
```

Doctor case: keep using existing `referringDoctorId`. Self case: send `referredByType: 'self'` only.

**Backend:** `src/routes/tenant/billingCounter.ts` — extend the bills INSERT to include the two new columns. No business logic shift; just a wider payload.

**UI:** `web/src/pages/BillingCounterPage.tsx`

The "Referred by" section is shown only when the bill contains at least one item whose `itemCategory` is `test` or `lab` (categories that produce a test invoice). For consultation-only or medicine-only bills the section is hidden.

```tsx
{hasTestItem(lines) && (
  <section className="rounded-lg border p-3 space-y-2">
    <h3 className="text-sm font-semibold">{t('counter.referredBy', { defaultValue: 'Referred by' })}</h3>
    <div className="flex gap-3">
      {(['self', 'hospital', 'doctor'] as const).map(opt => (
        <label key={opt} className="flex items-center gap-1 text-sm">
          <input type="radio" name="referredBy" value={opt}
                 checked={referredByType === opt}
                 onChange={() => setReferredByType(opt)} />
          {t(`counter.referredBy.${opt}`, { defaultValue: { self: 'Self', hospital: 'Hospital', doctor: 'Doctor' }[opt] })}
        </label>
      ))}
    </div>

    {referredByType === 'hospital' && (
      <HospitalCombobox value={referredByHospitalId} onChange={setReferredByHospitalId} />
    )}

    {referredByType === 'doctor' && (
      <DoctorCombobox value={referringDoctorId} onChange={setReferringDoctorId} />
    )}
  </section>
)}
```

`HospitalCombobox` is a small reusable component (~40 lines) that:
- debounces a search query,
- calls `GET /api/referral-hospitals?search=…&active=true`,
- shows a dropdown of results with `name (short_code)`,
- on selection stores the hospital `id`.

`DoctorCombobox` already exists in the codebase (used in the same page for the doctor consultation block) — reuse it.

#### 6.4 Display on test invoice

**Backend:** `src/routes/tenant/billing.ts` — extend the `GET /api/billing/:id` SQL to also LEFT JOIN `referral_hospitals rh ON rh.id = b.referred_by_hospital_id` and return:

```ts
referred_by_type: bill.referred_by_type,
referred_by_hospital: { id: number, name: string, short_code: string | null } | null,
```

**Frontend:** `web/src/pages/BillPrint.tsx` — extend `BillDetail`:

```ts
interface BillDetail {
  // ... existing
  referred_by_type?: 'self' | 'hospital' | 'doctor' | null;
  referred_by_hospital?: { id: number; name: string; short_code: string | null } | null;
}
```

Render under the patient info block (around line 372-380), only when the bill contains test items AND `referred_by_type` is set:

```tsx
{hasTestItems(items) && bill.referred_by_type && (
  <p className="text-sm text-gray-700">
    <span className="text-gray-500 text-xs">{printLang === 'bn' ? 'রেফার্ড বাই:' : 'Referred by:'}</span>{' '}
    <span className="font-medium">
      {bill.referred_by_type === 'self' && (printLang === 'bn' ? 'নিজে' : 'Self')}
      {bill.referred_by_type === 'hospital' && (
        <>
          {bill.referred_by_hospital?.name}
          {bill.referred_by_hospital?.short_code && ` (${bill.referred_by_hospital.short_code})`}
        </>
      )}
      {bill.referred_by_type === 'doctor' && /* doctor name lookup, see below */}
    </span>
  </p>
)}
```

For the doctor case, the existing GET response already joins `b.referring_doctor_id` against users; we just need to add the doctor name to the response (small change to the same SQL). Mirror the same pattern used in Part 3's join for the doctor name.

#### 6.5 Admin UI for managing hospitals

**File:** `web/src/pages/BillingMasterPage.tsx`

Add a new tab or sub-section `Referral Hospitals` with a small CRUD table:

- Columns: Name, Short code, Active, Created, Actions (Edit / Disable)
- Add button opens a modal with Name (required) + Short code (optional)
- Edit reuses the same modal in edit mode
- Disable calls `DELETE /api/referral-hospitals/:id` (soft-delete)

This is a standard list page; reuse the existing BillingMasterPage styling and patterns.

## Data Flow

### Test bill creation with referred-by
1. Reception adds a test item to the bill.
2. The "Referred by" section appears.
3. Reception picks Hospital → types "barguna" → selects "Barguna Govt College (BGH)".
4. Reception types paid amount (defaults to 0).
5. Reception clicks Create invoice.
6. POST `/api/billing-counter/invoices` carries `referredByType: 'hospital'`, `referredByHospitalId: 7`.
7. Backend INSERTs into `bills` with the new columns.
8. Response includes `billId`; frontend opens `/h/{slug}/billing/{billId}/print` in a new tab.
9. Print page GETs `/api/billing/{id}` → joins `referral_hospitals` → renders `Referred by: Barguna Govt College (BGH)`.

### Manual serial appointment booking
1. Reception picks doctor + date in the scheduler.
2. Serial panel shows Current / Next / Reserved.
3. Reception clicks Manual radio, types `42`.
4. POST `/api/appointments` with `requestedTokenNo: 42, forceTokenNo: true`.
5. Backend skips the reserved-range check, runs the duplicate check.
6. If taken: 409 + clear message; UI toasts and refreshes availability.
7. If free: token is stored on the appointment, queue_entries is updated, success toast shows `Booked #42`.

## Edge Cases

- **Walk-in visit with no appointment**: Part 3 SQL falls back to `queue_entries.token_number` (the live queue entry). If neither exists, `visit_serial` is null and the print page simply does not render the large serial.
- **Bill that has both test and consultation items**: "Referred by" section still appears (it is driven by `hasTestItem(lines)`, not "all items are test"). The invoice banner will read `APPOINTMENT INVOICE + LABORATORY TEST` (priority order: consultation first, then lab).
- **Bill that has only consultation items**: "Referred by" section hidden. Banner reads `APPOINTMENT INVOICE`.
- **Reception types a manual serial 0 or negative**: HTML `min="1"` + backend schema `min(1).max(9999)` rejects; UI shows the field-level error.
- **Reception types a manual serial that equals an auto-assignable number (not in any reserved range)**: Allowed — that's the point of the manual mode. Backend's reserved-range check is skipped, but the duplicate check still runs.
- **Referral hospital is soft-deleted while referenced by a bill**: Bills keep `referred_by_hospital_id`; the join returns null. The print page falls back to showing the type label only ("Hospital") — acceptable degradation.
- **Reception picks Hospital but the search returns no results**: They cannot submit; the field is required. The combobox shows "No matches" but no inline create-from-here; they must go to BillingMasterPage to add a new hospital. This is a deliberate scope decision (keeps the bill form lean).
- **Paid amount = 0 submitted explicitly on a "paid" mode bill**: Backend treats the bill as fully unpaid (due = total). Matches the existing "credit" behavior; we just remove the friction of picking credit mode when the receptionist knows paid is 0.
- **Test invoice where the user did not set referred_by_type**: The referred-by line is simply absent. No default is forced; the field is optional on a test bill. This avoids forcing reception to answer when they don't know.

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Manual serial conflict (409) | Toast: "Token 42 is already assigned for that day." Availability query refreshes. |
| Manual serial out of range | Schema rejects with clear path error. UI shows field-level message. |
| Referred-by hospital missing when type=hotel | Schema rejects with `referredByHospitalId` field error. |
| Referred-by hospital id refers to inactive record | Backend rejects with 400; UI shows the search is filtered to active by default but if a stale id is sent, the form surfaces the error. |
| Print popup blocked | Save still succeeds. Toast confirms. The print page is reachable from the bill list as a fallback. |
| `GET /api/billing/:id` join returns no row for hospital | Referred-by line falls back to type label only. |
| `referral_hospitals` GET fails (DB blip) | Combobox shows "Hospitals unavailable"; form still submittable with referred_by_type=self or doctor. |

## Testing

### Unit / component tests
- `web/src/pages/BillingCounterPage.test.ts`:
  - paid input starts blank
  - "Fill full" button fills the input
  - bill save opens print URL in new tab (mock `window.open`)
  - "Referred by" section is hidden when no test items, shown when a test item is added
  - Hospital combobox search calls `/api/referral-hospitals?search=…`
- `web/src/pages/AppointmentScheduler.test.ts`:
  - Manual mode accepts any 1-9999
  - 409 from backend surfaces a toast and refreshes availability
  - Submit payload includes `forceTokenNo: true` for manual mode, `false` for reserved
- `web/src/pages/BillPrint.test.ts`:
  - Renders large `#N` when `visit_serial` is present
  - Does not render the serial block when null
  - Renders "Referred by: Self" / "Hospital name (CODE)" / "Dr. Name" correctly
  - Renders `APPOINTMENT INVOICE` banner for consultation items
- `web/src/lib/print/invoiceCategory.test.ts`:
  - Label change to `APPOINTMENT INVOICE` / `অ্যাপয়েন্টমেন্ট ইনভয়েস`
- `web/src/pages/BillingMasterPage.test.ts` (extend):
  - Add hospital modal validates required name
  - Disable calls soft-delete endpoint

### Backend tests
- `GET /api/billing/:id` returns `visit_serial`, `appt_no`, `referred_by_type`, `referred_by_hospital` joined fields.
- `POST /api/billing-counter/invoices` accepts the new referred-by fields and persists them.
- `POST /api/referral-hospitals` creates a row; `GET` lists active by default.
- `POST /api/appointments` with `forceTokenNo: true` skips reserved-range check, still checks duplicates.
- `POST /api/appointments` with `forceTokenNo: false` and number outside any reserved range returns 400.

## Files Touched

**New files**
- `migrations/0296_bills_referred_by_and_hospitals.sql`
- `src/routes/tenant/referralHospitals.ts`
- `web/src/components/HospitalCombobox.tsx` (small reusable)

**Modified**
- `src/db/schema/schema.ts` — add `referralHospitals` table + 2 bill columns
- `tenant-schema.sql` / `schema.sql` — sync for fresh installs
- `src/schemas/billingCounter.ts` — extend counter invoice schema
- `src/schemas/appointment.ts` — add `forceTokenNo` field
- `src/routes/tenant/billing.ts` — extend GET `/api/billing/:id` SQL
- `src/routes/tenant/billingCounter.ts` — extend bills INSERT
- `src/routes/tenant/appointments.ts` — branch on `forceTokenNo`
- `src/routes/tenant/index.ts` (or aggregator) — mount `referralHospitals` routes
- `web/src/pages/BillingCounterPage.tsx` — Part 1, Part 2, Part 6 form
- `web/src/pages/BillPrint.tsx` — Part 3 serial + Part 6 referred-by render
- `web/src/pages/AppointmentScheduler.tsx` — Part 4 manual mode
- `web/src/pages/BillingMasterPage.tsx` — Part 6.5 admin UI
- `web/src/lib/print/invoiceCategory.ts` — Part 5 label
- Existing test files: `BillingCounterPage.test.ts`, `AppointmentScheduler.test.ts`, `BillPrint.test.ts`, `BillingMasterPage.test.ts`, `invoiceCategory.test.ts`

## Architecture Compliance

- All storage remains in D1 (relational truth). New `referral_hospitals` table is small, tenant-scoped, fits the existing pattern (e.g., `token_reservations`, `departments`).
- No Durable Objects or coordination changes — these are all simple CRUD + render changes.
- No new storage layers; no KV cache additions; no R2 use.
- Request handlers stay thin: the new SQL is a wider SELECT/INSERT, no orchestration added.
- Sensitive data handling unchanged. No new PHI surface area.
- Multi-tenant: `referral_hospitals.tenant_id` is required and indexed; the GET endpoint scopes by tenant via the existing middleware.
- Bilingual: every new user-facing string is added to both `en` and `bn` translation bundles.
- Commit-after-task: each sub-change (Parts 1-6) is a separate commit for clean rollback.

## Deployment

Cloud production:

```bash
pnpm build && wrangler deploy --env production
```

The new migration must be applied to the production D1 database before the new endpoints/routes can be relied on. Apply it via the standard `wrangler d1 migrations apply` flow used elsewhere in this repo.

Local server:

```bash
ssh pcare 'cd /opt/hms && HMS_LOCAL_APPLY_VERSIONED_MIGRATIONS=1 bash scripts/local-server/migrate.sh'
ssh pcare 'cd /opt/hms && docker compose --env-file /data/hms/config/local-server.env -f deploy/local-server/compose.yml up -d --build --remove-orphans'
```

Sync: `referral_hospitals` and the two new `bills` columns participate in local-to-cloud sync. Existing immutable `local_sync_outbox` events cover bill writes; for hospital CRUD we add a sync event at the write boundary in the new route. Stored fields: id, name, short_code, is_active, tenant_id, updated_at, idempotency_key.

## Verification

After deploy:

1. Open the billing counter, add a test item, observe the paid input is blank and the "Referred by" section is visible.
2. Click Create invoice; verify a new tab opens to the print page automatically.
3. On the print page verify:
   - Large `#N` serial in the header (if the bill is linked to a visit with a token)
   - Banner reads `APPOINTMENT INVOICE` for consultation items
   - `Referred by: …` line for test bills with referred-by set
4. Open AppointmentScheduler, pick a doctor + date, switch to Manual serial mode, type `42`, submit. Verify success toast shows `Booked #42` and the availability list now shows `42` as taken.
5. Submit the same `42` again from another booking. Verify 409 toast.
6. Open BillingMasterPage → Referral Hospitals tab. Add "Barguna Govt College" with short code "BGH". Verify it appears in the billing counter Hospital combobox.
7. Disable the same hospital. Verify the combobox no longer shows it; the print page for an existing bill with that hospital id shows the type label only.
