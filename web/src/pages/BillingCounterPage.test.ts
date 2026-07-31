import { describe, expect, it } from 'vitest';

describe('BillingCounterPage', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./BillingCounterPage');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });

  it('shows code, age, and mobile through the shared patient identity formatter', async () => {
    const source = await import('./BillingCounterPage?raw');
    const text = String(source.default ?? '');
    expect(text).toContain("import { formatPatientIdentityText } from '../lib/patientIdentity'");
    expect(text).toContain("formatPatientIdentityText(patient, t('counter.noCode'))");
    expect(text).toContain('`${patient.name} (${formatPatientIdentityText(patient)})`');
  });

  it('does not auto-fill paid amount from totals inside a useEffect', async () => {
    const source = await import('./BillingCounterPage?raw');
    const text = String(source.default ?? '');
    expect(text).not.toMatch(/useEffect\([^)]*\{\s*[\s\S]*?setPaidAmount\(String\(Math\.max\(0, totals\.total/);
  });

  it('exposes a "Fill full" helper that sets paid amount to total', async () => {
    const source = await import('./BillingCounterPage?raw');
    const text = String(source.default ?? '');
    expect(text).toMatch(/Fill full/);
    expect(text).toMatch(/onClick=\{\(\) => setPaidAmount\(String\(Math\.max\(0, totals\.total - totals\.deposit\)\)\)\}/);
  });

  it('always opens the print page in a new tab after save', async () => {
    const source = await import('./BillingCounterPage?raw');
    const text = String(source.default ?? '');
    expect(text).toMatch(/window\.open\(`\/h\/\$\{slug\}\/billing\/\$\{res\.billId\}\/print`, '_blank'\)/);
    expect(text).not.toMatch(/shouldPrintAfterSave/);
  });

  it('renders a "Referred by" section with self, hospital, and doctor radios', async () => {
    const source = await import('./BillingCounterPage?raw');
    const text = String(source.default ?? '');
    expect(text).toMatch(/referred-by-type/);
    expect(text).toMatch(/referredBySelf/);
    expect(text).toMatch(/referredByHospital/);
    expect(text).toMatch(/referredByDoctor/);
    expect(text).toMatch(/HospitalCombobox/);
    expect(text).toMatch(/DoctorCombobox/);
  });

  it('wires referredByType, referredByHospitalId, and referringDoctorId into the POST body', async () => {
    const source = await import('./BillingCounterPage?raw');
    const text = String(source.default ?? '');
    expect(text).toMatch(/referredByType/);
    expect(text).toMatch(/referredByHospitalId/);
    expect(text).toMatch(/referringDoctorId: referringDoctorId \?\? undefined/);
  });

  it('clears patient-specific referrer and prescriber state when the billing patient changes', async () => {
    const source = await import('./BillingCounterPage?raw');
    const text = String(source.default ?? '');
    expect(text).toContain('const selectBillingPatient = useCallback((patient: PatientOption) =>');
    expect(text).toContain("setReferredByType('self')");
    expect(text).toContain('setReferredByDoctor(null)');
    expect(text).toContain("prescriberDoctorId: ''");
    expect(text).toContain('selectBillingPatient(urlPatientData.patient)');
    expect(text).toContain('selectBillingPatient(patient)');
    expect(text).toContain("disabled={referredByType !== 'doctor' || !referredByDoctor}");
  });

  it('clears stale referral state when walk-in or a visit without a doctor is selected', async () => {
    const source = await import('./BillingCounterPage?raw');
    const text = String(source.default ?? '');

    expect(text).toMatch(/const selected = visitsData\?\.visits\?\.find[\s\S]*if \(selected\?\.doctor_id\)[\s\S]*else \{[\s\S]*clearBillingReferralState\(\)/);
  });

  it('keeps scheme benefit controls collapsed and uses preview for suggested discounts', async () => {
    const source = await import('./BillingCounterPage?raw');
    const text = String(source.default ?? '');
    expect(text).toMatch(/Scheme \/ Benefit/);
    expect(text).toMatch(/apply-scheme-preview/);
    expect(text).toMatch(/applySuggestedSchemeDiscount/);
    expect(text).toMatch(/reasonForDiscountSource/);
  });

  it('wires explicit doctor-waiver source allocation and preview into invoice creation', async () => {
    const source = await import('./BillingCounterPage?raw');
    const text = String(source.default ?? '');

    expect(text).toContain("from '../components/reception/DiscountAllocationEditor'");
    expect(text).toContain('/api/discounts/doctor-waiver-preview');
    expect(text).toContain('doctorAvailableWaiverAmount');
    expect(text).toMatch(/setDoctorAvailableWaiverAmount\(Number\(preview\.maximumDoctorWaiverAmount/);
    expect(text).toContain('getDiscountAllocationPayload');
    expect(text).toContain('hasBalancedDiscountAllocations');
    expect(text).toContain('discountAllocations: schemePreview?.eligible');
    expect(text).toContain('selectedDoctorId: referringDoctorId');
    expect(text).toContain('quantity: line.quantity');
    expect(text).toContain('totalDiscount: 0');
    expect(text).not.toContain('if (!referringDoctorId || totals.discount <= 0 || lines.length === 0');
    expect(text).toContain('discountSourceIntent: schemePreview?.eligible && totals.discount > 0');
    expect(text).toContain(': discountSourceIntent ?? undefined');
    expect(text).toContain('performerReserveAmount: doctorWaiverQuote?.performerReserveAmount');
    expect(text).toContain('protectedCommissionAmount: doctorWaiverQuote?.protectedCommissionAmount');
  });

  it('keeps doctor waiver submission blocked until the preview is verified', async () => {
    const source = await import('./BillingCounterPage?raw');
    const text = String(source.default ?? '');

    expect(text).toContain('doctorWaiverLoading: doctorWaiverPreviewPending');
    expect(text).toContain('doctorWaiverPreviewFailed');
    expect(text).toContain('verifiedPreviewKey: doctorWaiverVerifiedPreviewKey');
    expect(text).toContain('const doctorWaiverPaymentBlocked = doctorWaiverPreviewStatus.paymentBlocked;');
    expect(text).toContain('Doctor waiver verification is still in progress.');
    expect(text).toContain('Doctor waiver could not be verified. Select Doctor waiver again to retry.');
    expect(text).toMatch(/disabled=\{createInvoice\.isPending \|\| doctorWaiverPaymentBlocked \|\| !activeSession\}/);
    expect(text).toContain('disabled:cursor-not-allowed disabled:opacity-50');
  });

  it('wires optional appointment scheme benefit preview without changing normal Pay cash', async () => {
    const source = await import('./BillingCounterPage?raw');
    const text = String(source.default ?? '');
    expect(text).toMatch(/appointmentBenefitDrafts/);
    expect(text).toMatch(/checkAppointmentSchemePreview/);
    expect(text).toMatch(/service_category: 'appointment_payment'/);
    expect(text).toMatch(/Optional: leave empty for normal appointment payment/);
    expect(text).toMatch(/schemeApplication: preview\?\.eligible/);
  });

  it('wires reception bank deposit requests to the active counter session', async () => {
    const source = await import('./BillingCounterPage?raw');
    const text = String(source.default ?? '');
    expect(text).toMatch(/bank-deposit-requests\?mine=true/);
    expect(text).toMatch(/bankDepositAttemptKey/);
    expect(text).toMatch(/Bank deposit amount/);
    expect(text).toMatch(/Request Deposit/);
    expect(text).toMatch(/proposedBankName: bankDepositBankName\.trim\(\)/);
    expect(text).toMatch(/idempotencyKey: bankDepositAttemptKey/);
  });

  it('does not load pending collections before a counter session is active', async () => {
    const source = await import('./BillingCounterPage?raw');
    const text = String(source.default ?? '');

    expect(text).toMatch(/pending-appointment-charges\?limit=12'[\s\S]*enabled: Boolean\(activeSession\)/);
    expect(text).toMatch(/pending-bills\?limit=12\$\{pendingBillDateParam\}&page=\$\{pendingBillPage\}`,[\s\S]*enabled: Boolean\(activeSession\)/);
  });

  it('renders take-over action for other active counters before activation', async () => {
    const source = await import('./BillingCounterPage?raw');
    const text = String(source.default ?? '');

    expect(text).toMatch(/sessions\/\$\{vars\.sessionId\}\/take-over/);
    expect(text).toMatch(/setTakeOverTarget\(s\)/);
    expect(text).toMatch(/Confirm Take Over/);
    expect(text).toMatch(/canTakeOverCounter/);
  });

  it('hard-gates collection and invoice workspace behind an active counter session', async () => {
    const source = await import('./BillingCounterPage?raw');
    const text = String(source.default ?? '');

    expect(text).toMatch(/\{activeSession \? \(/);
    expect(text).toMatch(/Counter activation required/);
    expect(text).toMatch(/Open a counter to unlock this workspace\./);
  });

  it('normalizes zero-settlement Pay now submissions to credit before posting', async () => {
    const source = await import('./BillingCounterPage?raw');
    const text = String(source.default ?? '');

    expect(text).toContain("import { resolveBillingInvoiceSubmissionMode } from '../lib/billingInvoiceMode'");
    expect(text).toContain('resolveBillingInvoiceSubmissionMode({');
    expect(text).toContain('billMode,');
    expect(text).not.toContain('billMode: totals.effectiveMode');
    expect(text).toContain('paidAmount: totals.paid');
    expect(text).toContain('depositDeducted: totals.deposit');
  });

  it('requires a non-cash transaction reference before paid invoice submission', async () => {
    const source = await import('./BillingCounterPage?raw');
    const text = String(source.default ?? '');

    expect(text).toContain("from '../lib/paymentReference'");
    expect(text).toContain('requiresPaymentReference(paymentMethod, totals.paid)');
    expect(text).toContain('normalizeExternalTransactionId(paymentMethod, totals.paid, externalTransactionId)');
  });

  it('clears stale settlement fields when switching to credit or provisional', async () => {
    const source = await import('./BillingCounterPage?raw');
    const text = String(source.default ?? '');

    expect(text).toContain('const handleBillModeChange =');
    expect(text).toMatch(/if \(mode !== 'paid'\)[\s\S]*setPaidAmount\(''\)[\s\S]*setDepositDeducted\(''\)[\s\S]*setExternalTransactionId\(''\)/);
    expect(text).toContain('onClick={() => handleBillModeChange(mode)}');
  });

  it('reports credit and partial invoice outcomes from the authoritative response', async () => {
    const source = await import('./BillingCounterPage?raw');
    const text = String(source.default ?? '');

    expect(text).toContain("res.mode === 'credit'");
    expect(text).toContain("res.status === 'partially_paid'");
    expect(text).toContain('Credit / Pay later');
  });

  it('preserves the invoice idempotency key after ambiguous network or server failures', async () => {
    const source = await import('./BillingCounterPage?raw');
    const text = String(source.default ?? '');

    expect(text).toContain("import { shouldRotateInvoiceAttemptKey } from '../lib/invoiceIdempotency'");
    expect(text).toMatch(/onError: \(error\) => \{[\s\S]*if \(shouldRotateInvoiceAttemptKey\(error\)\)[\s\S]*setInvoiceAttemptKey\(newInvoiceAttemptKey\(\)\)/);
  });
});
