# Patient Paid-Visit and IPD Context Design

Date: 2026-07-26

## Goal

Make patient context immediately visible during appointment booking, consultation invoice printing, and IPD running-bill selection.

## Confirmed behavior

1. **Last visit source of truth**
   - A visit counts only when a positive payment was recorded for a doctor appointment/doctor-visit invoice.
   - Whether the patient later checked in, completed the consultation, cancelled after payment, or was not seen is not used to determine this context.
   - The system returns both the payment timestamp and the related appointment date.

2. **Appointment booking context**
   - After a patient and doctor are selected, show the selected doctor's latest paid appointment as the primary context.
   - If the patient has a more recent paid appointment with another doctor, show it as secondary context.
   - The card displays doctor, payment date/time, appointment date, and appointment type.
   - The fee-preview/eligibility endpoint remains the single server-side source for this booking context.

3. **Appointment invoice follow-up marker**
   - Consultation invoices display a visible `Follow-up` badge when the linked appointment is a follow-up/old-patient appointment.
   - The billing API includes the normalized appointment type in the invoice appointment payload.

4. **IPD running-bill patient context**
   - Add patient date of birth to `/api/ip-billing/patients`.
   - Show a compact English age badge such as `35Y` beside the patient name.
   - Show admission date and time, not date only, in the patient list and selected-patient summary.
   - The main IP billing table also uses date-time for admission where the same timestamp is available.

5. **Doctor-name normalization**
   - Introduce one shared display helper that removes any repeated leading `Dr`/`Dr.` prefixes and adds exactly one `Dr.` prefix where the UI requires it.
   - Apply it to IPD running-bill patient rows/summary and consultation invoice doctor rendering.

## Data design

### Paid appointment context

The backend query is based on finalized, non-cancelled doctor-visit bills with at least one positive payment. It links bills to appointments through visit or finalized provisional appointment references.

Return shape:

```ts
paidVisitContext?: {
  selectedDoctor: {
    appointmentId: number;
    doctorId: number | null;
    doctorName: string | null;
    appointmentType: string | null;
    appointmentDate: string | null;
    paidAt: string;
  } | null;
  latestAnyDoctor: {
    appointmentId: number;
    doctorId: number | null;
    doctorName: string | null;
    appointmentType: string | null;
    appointmentDate: string | null;
    paidAt: string;
  } | null;
}
```

`selectedDoctor` is filtered by the currently selected doctor. `latestAnyDoctor` is patient-wide. Duplicate rows caused by multiple invoice items or payment joins are collapsed per appointment/bill before ordering by the latest positive payment timestamp.

### Invoice appointment type

Extend `InvoiceAppointmentInfo` with:

```ts
appointmentType?: string | null;
```

The billing detail query selects `a.appointment_type` and returns it with the appointment payload.

### IPD patient list

Extend `PBAdmittedPatient` and the IP billing patient query with:

```ts
date_of_birth?: string | null;
```

## UI design

### Appointment popup

Under the selected patient card, show a compact context panel only when paid appointment context exists:

- `Last paid with selected doctor` — primary line.
- `Latest paid appointment with another doctor` — secondary line only when it differs from the selected-doctor record.
- Display `Paid: DD Mon YYYY, hh:mm AM/PM` and `Appointment: DD Mon YYYY`.

No context panel is shown for a patient with no positive doctor-appointment payment.

### Consultation invoice

Within Appointment Details, render a purple `Follow-up` badge when appointment type is `old_patient`, `follow_up`, or normalized equivalent `followup`.

### IPD patient list

Patient name row:

```text
Patient Name   35Y
```

Secondary metadata includes normalized doctor name. Right-side admission metadata uses full date-time.

## Error and fallback behavior

- Missing DOB: omit the age badge.
- Invalid DOB: omit the age badge.
- Missing payment context: omit the booking context panel.
- Missing doctor: show the existing not-assigned fallback.
- Date-only admission values remain valid and render without a fabricated time.
- Existing fee eligibility behavior is preserved; this change adds context and reuses the positive-payment definition.

## Testing

1. Backend appointment tests verify selected-doctor and any-doctor paid contexts use positive payments and ignore unpaid appointments.
2. AppointmentScheduler tests verify primary and secondary paid context rendering.
3. Billing API and ConsultationInvoiceBody tests verify follow-up appointment type and badge rendering.
4. IP billing route tests verify DOB is returned.
5. ProvisionalBillingModal tests verify `35Y`, date-time display, and single normalized `Dr.` prefix.
6. IPBillingPage tests verify admission date-time rendering.
7. Run focused tests, web TypeScript check, web build, and relevant backend integration tests before integration.

## Scope boundary

This task does not change payment accounting, appointment payment finalization, follow-up fee rules, or clinical visit status. It only exposes canonical paid-appointment context and improves patient/doctor/admission presentation.
