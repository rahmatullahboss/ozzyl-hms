# IPD Billing UI/UX Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify IPD billing into a single ProvisionalBillingModal + separate DischargeModal, remove inline billing, add admin PIN for large discounts.

**Architecture:** Single modal (ProvisionalBillingModal) used from all entry points (F4, Sidebar, IPBillingPage). Separate DischargeModal for discharge flow with 4-step process. Backend validates admin PIN for discounts > 20%.

**Tech Stack:** React, TypeScript, Hono, D1 (Cloudflare), Tailwind CSS, react-i18next

---

## File Structure

### Files to Modify

| File | Change |
|------|--------|
| `web/src/pages/ReceptionDashboard.tsx` | Enhance ProvisionalBillingModal with new design (magic cards, tabs, better layout) |
| `web/src/components/reception/ReceptionPatientDrawer.tsx` | Remove IPD Quick Bill section (lines 1304-1456) |
| `web/src/components/reception/IpdDischargeDialog.tsx` | Replace with new DischargeModal component |
| `web/src/pages/IPBillingPage.tsx` | Remove inline billing, use same ProvisionalBillingModal |
| `src/routes/tenant/ipBilling.ts` | Add admin_pin validation for discounts > 20% |

### Files to Create

| File | Purpose |
|------|---------|
| `web/src/components/reception/DischargeModal.tsx` | New discharge modal with 4-step flow |

---

## Task 1: Enhance ProvisionalBillingModal with New Design

**Files:**
- Modify: `web/src/pages/ReceptionDashboard.tsx` (lines 4725-5208)

**Goal:** Update ProvisionalBillingModal to match the blueprint design with magic cards, tabs, and better layout.

- [ ] **Step 1: Update Section 2 - Magic Cards**

Replace the current financial widgets (lines 4993-5034) with the new 3-card design:

```tsx
{/* Section 2: Magic Cards */}
<div className="grid grid-cols-3 gap-4">
  {/* Total Deposit Card */}
  <div className="rounded-xl border-2 border-emerald-200 bg-emerald-50 p-5 text-center">
    <div className="text-sm font-medium text-emerald-600 mb-2">
      {t('heading.totalDeposit', { ns: 'reception', defaultValue: 'মোট জমা' })}
    </div>
    <div className="font-data text-3xl font-bold text-emerald-700">
      {formatBDT(depositBalance)}
    </div>
    {depositTotal > 0 && depositUsed > 0 && (
      <div className="mt-2 text-xs text-emerald-600">
        {t('info.totalDeposit', { defaultValue: 'Total' })}: {formatBDT(depositTotal)} | 
        {t('info.depositUsed', { defaultValue: 'Used' })}: -{formatBDT(depositUsed)}
      </div>
    )}
  </div>

  {/* Total Cost Card */}
  <div className="rounded-xl border-2 border-gray-200 bg-gray-50 p-5 text-center">
    <div className="text-sm font-medium text-gray-500 mb-2">
      {t('heading.totalCost', { ns: 'reception', defaultValue: 'মোট খরচ' })}
    </div>
    <div className="font-data text-3xl font-bold text-gray-700">
      {formatBDT(totalBilled)}
    </div>
  </div>

  {/* Net Balance Card */}
  <div className={`rounded-xl border-2 p-5 text-center ${
    netPayable > 0 
      ? 'border-red-200 bg-red-50' 
      : 'border-emerald-200 bg-emerald-50'
  }`}>
    <div className="text-sm font-medium text-gray-500 mb-2">
      {t('heading.netBalance', { ns: 'reception', defaultValue: 'বর্তমান ব্যালেন্স' })}
    </div>
    <div className={`font-data text-3xl font-bold ${
      netPayable > 0 ? 'text-red-700' : 'text-emerald-700'
    }`}>
      {netPayable > 0 ? '-' : ''}{formatBDT(netPayable > 0 ? netPayable : Math.abs(depositBalance - totalBilled))}
    </div>
    {netPayable > 0 && (
      <div className="mt-2 text-xs text-red-600 animate-pulse">
        {t('info.urgentCollectDeposit', { defaultValue: 'জরুরি ভিত্তিতে অ্যাডভান্স কালেক্ট করুন' })}
      </div>
    )}
  </div>
</div>
```

- [ ] **Step 2: Update Section 4 - Ledger Table with Tabs**

Replace the current ledger (lines 5075-5146) with tabbed design:

```tsx
{/* Section 4: Ledger Table */}
<div className="rounded-lg border border-[var(--color-border)] overflow-hidden">
  {/* Tab Headers */}
  <div className="flex border-b border-[var(--color-border)]">
    <button
      className={`flex-1 px-4 py-2.5 text-sm font-medium ${
        activeTab === 'running' 
          ? 'bg-white border-b-2 border-blue-500 text-blue-600' 
          : 'bg-gray-50 text-gray-500 hover:bg-gray-100'
      }`}
      onClick={() => setActiveTab('running')}
    >
      {t('tab.runningCharges', { defaultValue: 'Running Charges' })}
    </button>
    <button
      className={`flex-1 px-4 py-2.5 text-sm font-medium ${
        activeTab === 'settled' 
          ? 'bg-white border-b-2 border-blue-500 text-blue-600' 
          : 'bg-gray-50 text-gray-500 hover:bg-gray-100'
      }`}
      onClick={() => setActiveTab('settled')}
    >
      {t('tab.settledBills', { defaultValue: 'Settled Bills' })}
    </button>
  </div>

  {/* Tab Content */}
  {activeTab === 'running' ? (
    // Running charges table (existing pendingItems + bedCharges)
    <div className="max-h-64 overflow-y-auto">
      <table className="w-full text-sm">
        {/* ... existing table code ... */}
      </table>
    </div>
  ) : (
    // Settled bills (fetched separately)
    <div className="p-6 text-center text-sm text-[var(--color-text-muted)]">
      {t('info.noSettledBills', { defaultValue: 'No settled bills yet' })}
    </div>
  )}

  {/* Summary row */}
  {(pendingItems.length > 0 || bedCharges.length > 0) && (
    <div className="flex justify-between items-center px-4 py-3 border-t border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
      <span className="text-sm font-medium">{t('heading.totalCharges', { ns: 'reception' })}</span>
      <span className="font-data text-lg font-bold">{formatBDT(totalBilled)}</span>
    </div>
  )}
</div>
```

- [ ] **Step 3: Add state for tabs**

Add state variable at the top of the component:

```tsx
const [activeTab, setActiveTab] = useState<'running' | 'settled'>('running');
```

- [ ] **Step 4: Verify the modal still works**

Run: `pnpm dev` and test opening the modal from F4 button.

---

## Task 2: Remove Inline Billing from ReceptionPatientDrawer

**Files:**
- Modify: `web/src/components/reception/ReceptionPatientDrawer.tsx` (lines 1304-1456)

**Goal:** Remove the IPD Quick Bill section completely, keep only "Manage Provisional Bill" button.

- [ ] **Step 1: Remove IPD Quick Bill section**

Delete lines 1304-1456 (the entire `{actionMode === 'ipdBill' && data?.activeAdmission ? (...) : null}` block).

- [ ] **Step 2: Remove related state variables**

Remove these state variables (around lines 100-200):
- `serviceSearch`, `setServiceSearch`
- `services`, `setServices`
- `servicesLoading`, `setServicesLoading`
- `cart`, `setCart`
- `ipdDiscountAmount`, `setIpdDiscountAmount`
- `ipdDiscountPercent`, `setIpdDiscountPercent`
- `ipdUseDeposit`, `setIpdUseDeposit`
- `ipdPayAmount`, `setIpdPayAmount`
- `ipdPaymentMethod`, `setIpdPaymentMethod`
- `ipdBillProcessing`, `setIpdBillProcessing`

- [ ] **Step 3: Remove related functions**

Remove these functions:
- `addToCart()`
- `handleIpdBillSubmit()`
- `resetIpdForm()`
- Any useEffect that fetches services

- [ ] **Step 4: Remove unused imports**

Remove imports that are no longer needed:
- `Search`, `Plus`, `Trash2` from lucide-react (if not used elsewhere)
- `ServiceCatalogItem` type
- Any related API calls

- [ ] **Step 5: Verify the drawer works**

Run: `pnpm dev` and test opening the patient drawer, clicking "Manage Provisional Bill" button.

---

## Task 3: Create New DischargeModal Component

**Files:**
- Create: `web/src/components/reception/DischargeModal.tsx`

**Goal:** Create a new discharge modal with 4-step flow matching the blueprint.

- [ ] **Step 1: Create DischargeModal.tsx**

```tsx
import { useState } from 'react';
import { X, AlertTriangle, Wallet, CreditCard, CheckCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useApiMutation, useQueryClient } from '../../hooks/useApiQuery';
import { api } from '../../lib/apiClient';

type AdmissionInfo = {
  admissionId: number;
  admissionNo?: string | null;
  patientName?: string | null;
  patientId: number;
  wardName?: string | null;
  bedNumber?: string | null;
};

type FinancialSummary = {
  totalCharges: number;
  discountPercent: number;
  afterDiscount: number;
  depositBalance: number;
  netPayable: number;
  refundAmount: number;
};

function money(value: unknown) {
  return Number(value ?? 0).toLocaleString('en-IN');
}

export default function DischargeModal({
  admission,
  financial,
  onClose,
  onSuccess,
}: {
  admission: AdmissionInfo;
  financial: FinancialSummary;
  onClose: () => void;
  onSuccess?: () => void;
}) {
  const { t } = useTranslation(['reception', 'ipd', 'common']);
  const queryClient = useQueryClient();

  // Discount state
  const [discountPercent, setDiscountPercent] = useState(String(financial.discountPercent));
  const [adminPin, setAdminPin] = useState('');
  const [showPinInput, setShowPinInput] = useState(false);

  // Payment state
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [tenderAmount, setTenderAmount] = useState('');
  const [remarks, setRemarks] = useState('');

  // Calculate values
  const discountAmt = Math.round(financial.totalCharges * (Number(discountPercent) / 100) * 100) / 100;
  const afterDiscount = Math.max(0, financial.totalCharges - discountAmt);
  const netPayable = Math.max(0, afterDiscount - financial.depositBalance);
  const refundAmount = Math.max(0, financial.depositBalance - afterDiscount);
  const change = Math.max(0, Number(tenderAmount) - netPayable);

  // Discharge mutation
  const dischargeMutation = useApiMutation(
    async () => {
      const response = await api.post('/api/ip-billing/discharge-bill', {
        admission_id: admission.admissionId,
        discount_percent: Number(discountPercent),
        deposit_deducted: Math.min(financial.depositBalance, afterDiscount),
        payment_mode: paymentMethod,
        paid_amount: netPayable,
        admin_pin: Number(discountPercent) > 20 ? adminPin : undefined,
        remarks,
      });
      return response;
    },
    {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['ip-billing'] });
        queryClient.invalidateQueries({ queryKey: ['admissions'] });
        onSuccess?.();
        onClose();
      },
    }
  );

  const handleDiscountChange = (value: string) => {
    const numValue = Math.min(100, Math.max(0, Number(value) || 0));
    setDiscountPercent(String(numValue));
    if (numValue > 20) {
      setShowPinInput(true);
    } else {
      setShowPinInput(false);
      setAdminPin('');
    }
  };

  const handleSubmit = () => {
    if (Number(discountPercent) > 20 && !adminPin) {
      alert(t('error.adminPinRequired', { defaultValue: 'Admin PIN required for discounts above 20%' }));
      return;
    }
    dischargeMutation.mutate();
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/50 p-4 pt-8 backdrop-blur-sm"
      data-testid="discharge-modal"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-800">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-[var(--color-text)]">
                {t('modal.dischargeSettlement', { defaultValue: 'Discharge & Final Settlement' })}
              </h2>
              <p className="text-sm text-[var(--color-text-muted)]">
                {admission.patientName} ({admission.admissionNo})
              </p>
            </div>
          </div>
          <button type="button" className="btn-ghost p-1.5" onClick={onClose}>
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Step 1: Bill Summary */}
        <div className="mb-6 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-5">
          <h3 className="font-semibold mb-4">{t('step.billSummary', { defaultValue: 'Bill Summary' })}</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span>{t('form.totalCharges', { defaultValue: 'Total Charges' })}</span>
              <span className="font-data">৳{money(financial.totalCharges)}</span>
            </div>
            <div className="flex justify-between text-red-600">
              <span>{t('form.discount', { defaultValue: 'Discount' })} ({discountPercent}%)</span>
              <span className="font-data">-৳{money(discountAmt)}</span>
            </div>
            <div className="flex justify-between font-medium">
              <span>{t('form.afterDiscount', { defaultValue: 'After Discount' })}</span>
              <span className="font-data">৳{money(afterDiscount)}</span>
            </div>
            {financial.depositBalance > 0 && (
              <div className="flex justify-between text-emerald-600">
                <span>{t('form.advanceDeposit', { defaultValue: 'Advance Deposit' })}</span>
                <span className="font-data">-৳{money(Math.min(financial.depositBalance, afterDiscount))}</span>
              </div>
            )}
            <div className="border-t border-[var(--color-border)] pt-2 mt-2">
              {refundAmount > 0 ? (
                <div className="flex justify-between font-semibold text-blue-600">
                  <span>{t('form.refundAmount', { defaultValue: 'Refund Amount' })}</span>
                  <span className="font-data">৳{money(refundAmount)}</span>
                </div>
              ) : (
                <div className="flex justify-between font-semibold text-red-600">
                  <span>{t('form.netPayable', { defaultValue: 'Net Payable' })}</span>
                  <span className="font-data">৳{money(netPayable)}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Step 2: Discount Section */}
        <div className="mb-6 rounded-xl border border-[var(--color-border)] p-5">
          <h3 className="font-semibold mb-4">{t('step.discount', { defaultValue: 'Discount' })}</h3>
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <label className="label text-xs">{t('form.discountPercent', { defaultValue: 'Discount %' })}</label>
              <input
                className="input h-10"
                type="number"
                min={0}
                max={100}
                value={discountPercent}
                onChange={(e) => handleDiscountChange(e.target.value)}
                placeholder="0"
              />
            </div>
            {showPinInput && (
              <div className="flex-1">
                <label className="label text-xs">
                  {t('form.adminPin', { defaultValue: 'Admin PIN (required for >20%)' })}
                </label>
                <input
                  className="input h-10"
                  type="password"
                  value={adminPin}
                  onChange={(e) => setAdminPin(e.target.value)}
                  placeholder="Enter admin PIN"
                />
              </div>
            )}
          </div>
        </div>

        {/* Step 3: Payment */}
        <div className="mb-6 rounded-xl border border-[var(--color-border)] p-5">
          <h3 className="font-semibold mb-4">{t('step.payment', { defaultValue: 'Payment' })}</h3>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="label text-xs">{t('form.paymentMethod', { defaultValue: 'Payment Method' })}</label>
              <select
                className="input h-10"
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
              >
                <option value="cash">{t('select.cash', { defaultValue: 'Cash' })}</option>
                <option value="bkash">{t('select.bkash', { defaultValue: 'bKash' })}</option>
                <option value="nagad">{t('select.nagad', { defaultValue: 'Nagad' })}</option>
                <option value="card">{t('select.card', { defaultValue: 'Card' })}</option>
                <option value="bank">{t('select.bank', { defaultValue: 'Bank' })}</option>
              </select>
            </div>
            <div>
              <label className="label text-xs">{t('form.tenderAmount', { defaultValue: 'Tender Amount' })}</label>
              <input
                className="input h-10 font-data"
                type="number"
                min={0}
                value={tenderAmount}
                onChange={(e) => setTenderAmount(e.target.value)}
                placeholder="0"
              />
            </div>
            <div>
              <label className="label text-xs">{t('form.change', { defaultValue: 'Change' })}</label>
              <div className="input h-10 font-data bg-gray-50 flex items-center">
                ৳{money(change)}
              </div>
            </div>
          </div>
          <div className="mt-4">
            <label className="label text-xs">{t('form.remarks', { defaultValue: 'Remarks' })}</label>
            <input
              className="input h-10"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder={t('form.optionalNote', { defaultValue: 'Optional note...' })}
            />
          </div>
        </div>

        {/* Step 4: Submit Button */}
        <button
          className="btn-primary w-full h-12 text-base font-semibold"
          onClick={handleSubmit}
          disabled={dischargeMutation.isLoading}
        >
          {dischargeMutation.isLoading ? (
            t('btn.processing', { defaultValue: 'Processing...' })
          ) : (
            <>
              <CheckCircle className="h-5 w-5 mr-2" />
              {t('btn.completeSettlement', { defaultValue: '✅ Complete Settlement & Discharge' })}
            </>
          )}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify component compiles**

Run: `pnpm typecheck` to ensure no type errors.

---

## Task 4: Add Admin PIN Validation to Backend

**Files:**
- Modify: `src/routes/tenant/ipBilling.ts` (lines 692-701)

**Goal:** Add admin_pin field to discharge endpoint and validate for discounts > 20%.

- [ ] **Step 1: Update schema to include admin_pin**

Update the zod schema (line 692-701):

```typescript
ipBilling.post('/discharge-bill', requireRole(...IP_BILLING_ROLES), zValidator('json', z.object({
  admission_id: z.number().int().positive(),
  discount_percent: z.number().min(0).max(100).default(0),
  deposit_deducted: z.number().min(0).default(0),
  payment_mode: z.string().default('cash'),
  paid_amount: z.number().min(0).default(0),
  discharge_condition_id: z.number().int().positive().optional(),
  discharge_type: z.string().optional(),
  remarks: z.string().optional(),
  admin_pin: z.string().optional(), // New field
})), async (c) => {
```

- [ ] **Step 2: Add PIN validation logic**

After line 705 (`const data = c.req.valid('json');`), add:

```typescript
// Validate admin PIN for discounts > 20%
if (data.discount_percent > 20) {
  if (!data.admin_pin) {
    throw new HTTPException(400, { 
      message: 'Admin PIN is required for discounts above 20%' 
    });
  }
  
  // Validate PIN against stored admin PINs
  const adminUser = await db.$client.prepare(`
    SELECT id FROM users 
    WHERE tenant_id = ? 
    AND pin = ? 
    AND role IN ('md', 'director', 'hospital_admin')
    AND is_active = 1
  `).bind(tenantId, data.admin_pin).first();
  
  if (!adminUser) {
    throw new HTTPException(403, { 
      message: 'Invalid admin PIN. Only MD, Director, or Hospital Admin can approve discounts above 20%' 
    });
  }
}
```

- [ ] **Step 3: Verify backend compiles**

Run: `pnpm typecheck` to ensure no type errors.

---

## Task 5: Update IPBillingPage to Use Same Modal

**Files:**
- Modify: `web/src/pages/IPBillingPage.tsx`

**Goal:** Remove inline billing from IPBillingPage detail view, use same ProvisionalBillingModal.

- [ ] **Step 1: Find and remove inline billing sections**

Search for any inline billing forms or item addition forms in the detail view and remove them. Replace with a button that opens ProvisionalBillingModal.

- [ ] **Step 2: Add import for ProvisionalBillingModal**

If not already imported, add the import for ProvisionalBillingModal from ReceptionDashboard or extract it to a shared component.

- [ ] **Step 3: Add "Manage Bill" button in detail view**

Add a button that opens the ProvisionalBillingModal with the current admission ID.

- [ ] **Step 4: Verify IPBillingPage works**

Run: `pnpm dev` and test the IPBillingPage detail view.

---

## Task 6: Replace IpdDischargeDialog with DischargeModal

**Files:**
- Modify: `web/src/components/reception/ReceptionPatientDrawer.tsx`
- Modify: `web/src/pages/AdmissionIPD.tsx`
- Delete: `web/src/components/reception/IpdDischargeDialog.tsx`

**Goal:** Replace all uses of IpdDischargeDialog with the new DischargeModal.

- [ ] **Step 1: Update ReceptionPatientDrawer**

Replace the discharge section (lines 1459-1550) with a button that opens DischargeModal:

```tsx
{actionMode === 'discharge' && data?.activeAdmission && (
  <DischargeModal
    admission={{
      admissionId: data.activeAdmission.id,
      admissionNo: data.activeAdmission.admission_no,
      patientName: patient?.name,
      patientId: patient?.id,
      wardName: data.activeAdmission.ward_name,
      bedNumber: data.activeAdmission.bed_number,
    }}
    financial={{
      totalCharges: ipdPendingData?.summary?.grand_total ?? 0,
      discountPercent: 0,
      afterDiscount: ipdPendingData?.summary?.grand_total ?? 0,
      depositBalance: ipdPendingData?.summary?.deposit_balance ?? 0,
      netPayable: ipdPendingData?.summary?.net_payable ?? 0,
      refundAmount: Math.max(0, (ipdPendingData?.summary?.deposit_balance ?? 0) - (ipdPendingData?.summary?.grand_total ?? 0)),
    }}
    onClose={() => setActionMode(null)}
    onSuccess={() => {
      queryClient.invalidateQueries({ queryKey: ['patient-drawer'] });
    }}
  />
)}
```

- [ ] **Step 2: Update AdmissionIPD page**

Similar changes to use DischargeModal instead of IpdDischargeDialog.

- [ ] **Step 3: Delete IpdDischargeDialog.tsx**

Once all references are removed, delete the old file.

- [ ] **Step 4: Verify discharge flow works**

Run: `pnpm dev` and test the discharge flow from both entry points.

---

## Task 7: Final Testing & Cleanup

- [ ] **Step 1: Test all entry points**

1. Dashboard F4 button → ProvisionalBillingModal opens
2. Sidebar "Manage Provisional Bill" → ProvisionalBillingModal opens
3. IPBillingPage "Manage Bill" → ProvisionalBillingModal opens
4. Sidebar "Initiate Discharge" → DischargeModal opens
5. IPBillingPage "Discharge" → DischargeModal opens

- [ ] **Step 2: Test discount validation**

1. Apply 10% discount → No PIN required
2. Apply 25% discount → PIN input appears
3. Submit without PIN → Error message
4. Submit with invalid PIN → Error message
5. Submit with valid PIN → Success

- [ ] **Step 3: Test discharge automation**

1. Complete discharge
2. Verify invoice created
3. Verify patient status = discharged
4. Verify bed status = cleaning

- [ ] **Step 4: Run lint and typecheck**

```bash
pnpm lint
pnpm typecheck
```

- [ ] **Step 5: Commit all changes**

```bash
git add .
git commit -m "feat: IPD billing UI/UX redesign - single modal, discharge flow, admin PIN"
```

---

## Success Criteria Checklist

- [ ] Single ProvisionalBillingModal used from all entry points
- [ ] No inline billing in ReceptionPatientDrawer
- [ ] Discharge flow in separate DischargeModal with 4 steps
- [ ] Admin PIN required for discounts > 20%
- [ ] Backend automation on discharge (invoice, status, bed release)
- [ ] All entry points work (F4, Sidebar, IPBillingPage)
- [ ] Lint and typecheck pass
