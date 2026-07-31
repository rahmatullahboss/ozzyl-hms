# Prescription Fulfilment and Patient-App Marketplace Foundation Design

**Date:** 2026-05-26
**Status:** Approved concept, written-spec review pending
**Scope:** Doctor prescription safety foundation, optional hospital dispensing, and future Ozzyl patient-app medicine ordering boundaries.

## 1. Goal

Make the prescription a durable clinical record that can later be viewed and used in the Ozzyl patient app without requiring the patient to purchase medicine from the issuing hospital.

This design fixes the immediate unsafe in-house dispensing path while establishing a clean boundary for future online ordering:

- doctors prescribe solely on clinical need;
- patients may buy outside the hospital, use a hospital pharmacy, or place an online order through Ozzyl;
- Ozzyl may receive a disclosed platform fee from a completed patient-chosen commercial order;
- doctors receive no medicine-order commission and commercial data does not influence prescribing.

## 2. Non-Negotiable Principles

### Clinical independence

`prescriptions` and `prescription_items` are clinical truth. A final prescription records what the doctor issued. Fulfilment, stock, delivery, product substitution, commercial agreements, or commission must not alter that issued record.

The prescribing experience must not use partner commission to rank medicines, encourage a brand, or disclose commercial revenue to the doctor as a prescribing incentive.

### Patient choice

A final prescription does not require in-house dispensing. The patient may:

- purchase from an external pharmacy without any Ozzyl fulfilment event;
- ask an in-house hospital pharmacy to dispense;
- in a future patient app, select an eligible Ozzyl order provider.

### Safe substitution

The selected product for an order is separate from the prescribed item. Alternatives may only be offered when the mapped product is equivalent for the ordering purpose, including generic ingredient, strength, dosage form, and route. The UI must show prescribed and selected products side by side and capture patient confirmation.

Controlled or high-risk substitution is out of the automatic substitution path unless a future reviewed policy explicitly permits it.

### Commercial transparency

An Ozzyl platform fee may arise only from a patient-chosen fulfilled order. It must be tracked against the commercial order, never against prescription issuance or doctor activity.

## 3. Existing State and Problem

The backend already exposes final prescriptions to the patient portal, and the global portal can list prescriptions across linked hospitals.

The current in-house dispensing UI is unsafe because it:

1. records a pharmacy sale that reduces stock;
2. separately changes prescription dispense status.

If the second request fails, stock and medication fulfilment evidence can disagree.

The current prescription delivery fields also model only a single delivery directly on a prescription. A patient-app marketplace needs multiple independent orders and providers per prescription.

## 4. Recommended Architecture

### 4.1 Prescription domain

The existing prescription remains the clinical source of truth:

- `draft`: being authored;
- `final`: issued and clinically immutable;
- `cancelled`: clinically withdrawn through an audited path.

Dispensing must no longer move a clinically issued prescription from `final` to `dispensed` or `completed`. Legacy values remain readable for backward compatibility and migration handling, but new fulfilment writes do not create them.

### 4.2 Medication order and fulfilment domain

Create a new commercial/operational aggregate linked to a final prescription:

#### `medication_orders`

Stores one patient-selected fulfilment attempt.

Key fields:

- `id`, `tenant_id`, `prescription_id`, `patient_id`
- `channel`: `hospital_counter` or future `patient_app`
- `provider_type`: `hospital_pharmacy` or future `ozzyl_partner`
- `provider_tenant_id` / `partner_provider_id`, nullable as appropriate
- `status`: `pending`, `confirmed`, `partially_fulfilled`, `fulfilled`, `cancelled`, `refunded`
- `payment_status`, `delivery_status`, delivery contact fields where needed
- `patient_consent_at`, `substitution_consent_at`
- `idempotency_key`
- `created_by`, timestamps

#### `medication_order_items`

Stores the mapping between an immutable prescribed item and the selected/dispensed product.

Key fields:

- `order_id`, `prescription_item_id`
- prescribed snapshot: medicine name, dosage/strength/form/route when available
- selected product reference and snapshot: product/medicine id, brand, generic, manufacturer, strength, dosage form, route
- `requested_quantity`, `fulfilled_quantity`, `unit_price`, `line_total`
- `is_alternative`, `equivalence_basis`, `patient_confirmed_alternative`

#### `medication_platform_fees` (future commercial-order phase)

This future table tracks Ozzyl earnings only after a patient-app commercial order reaches the contractual earning state. It is deliberately not created in the immediate hospital-dispensing foundation; partner agreements, payment, refunds, and settlement requirements must be reviewed before that commercial phase is implemented.

Key fields:

- `medication_order_id`, `partner_provider_id`
- agreement/rule reference
- gross order value, fee method, fee amount
- state: `pending`, `earned`, `reversed`, `settled`
- cancellation/refund reversal reference

It must not contain a `doctor_id` beneficiary for medicine orders.

### 4.3 Provider model

The future partner must be modelled as an authorised fulfilment provider, not assumed to be a manufacturer. A pharmaceutical manufacturer may have a commercial relationship with Ozzyl, but the actual seller/dispenser/delivery provider must be legally authorised for that activity before prescription data or an order is shared.

## 5. Immediate Implementation Scope

This phase implements the production-critical foundation, not the complete patient-app marketplace:

1. Remove the two-request in-house dispensing path.
2. Add medication order/order item storage sufficient for in-house dispensing and future provider extension.
3. Add one server-side endpoint for dispensing a final prescription from the hospital pharmacy.
4. Keep prescription clinical status `final` when hospital fulfilment occurs.
5. Record fulfilment summary through the new order aggregate; any retained legacy `dispense_status` field is compatibility-only and must not be interpreted as prescription validity.
6. Ensure no hospital stock/sale is created merely because a prescription is final or viewed in the portal.
7. Leave Ozzyl partner browsing, online payment, delivery orchestration, and commission settlement UI for a later commercial-order phase.
8. Harden consultation completion separately so clinical issuance and visit completion cannot falsely appear wholly successful after a partial failure.

## 6. In-House Hospital Dispensing Flow

### Preconditions

- prescription exists in the same tenant;
- prescription is clinically `final`;
- caller has pharmacist or hospital-admin dispensing permission;
- payment has been received at the hospital counter and its validated method is recorded;
- each requested order item references a prescription item;
- requested quantity is positive and does not exceed remaining fulfilled quantity;
- selected hospital medicine/product is mapped appropriately;
- available non-expired stock exists.

### Atomic command

The frontend calls one endpoint such as:

`POST /api/prescriptions/:id/hospital-dispense`

The backend validates all inputs, then atomically commits:

- `medication_orders` creation or idempotent recovery;
- `medication_order_items` creation/fulfilment quantities;
- stock deduction and stock movements;
- pharmacy sale/invoice linkage using existing financial conventions;
- validated counter payment method without assuming cash;
- fulfilment/audit records.

On any failed statement, the dispense operation returns an error without a committed stock decrease or recorded fulfilment. Duplicate idempotency keys return the original result without reducing stock again.

### Response

The response includes:

- medication order ID;
- receipt/sale reference if applicable;
- fulfilment status of this order;
- aggregate remaining quantities for the prescription.

It does not change the prescription's clinical status from `final`.

## 7. Future Patient-App Online Order Flow

The patient app will show final prescriptions from the existing patient-authorised record flow. From a final prescription, the patient may choose `Order Medicine`.

Future flow:

1. Resolve orderable prescription items and eligible equivalent products.
2. Present neutral provider/product choices with price, availability, fulfilment provider, and commercial disclosure.
3. Capture patient selection and consent, particularly for an alternative product.
4. Create a `patient_app` medication order without changing the clinical prescription.
5. Send only the minimum order-specific prescription data to the selected authorised provider.
6. Update delivery/payment/fulfilment on the order.
7. Earn or reverse Ozzyl's fee based on completed/refunded order rules.

The patient may choose a non-partner/outside pharmacy; in that case no platform order or hospital inventory event is required.

## 8. Security, Privacy and Ethics Controls

- Patient portal/order routes enforce patient ownership or valid managed-family authority.
- Staff routes enforce tenant scope and least-privilege fulfilment permissions.
- Provider access is order-scoped, consented, time-bound where feasible, and never grants full chart access.
- Audit events capture prescription read for order, patient alternative consent, stock fulfilment, delivery status, fee accrual and reversal.
- Logs must not include unnecessary prescription or patient details.
- Doctors do not receive order commissions.
- Clinical search/templates/suggestions do not use Ozzyl partner commission signals.
- Patient-facing product selection discloses platform/partner commercial relationship.

## 9. Error Handling and Migration Strategy

- Existing prescriptions with `dispensed`/`completed` clinical status remain readable; a follow-up migration/report may normalise them after operational reconciliation.
- Current prescription-level delivery fields are retained for read compatibility during transition; new prescription-level delivery mutations are retired and no new capability depends on them.
- Existing legacy `pharmacy_prescriptions` is not copied into as a second clinical truth source.
- Implementation must explicitly test failure after validation, duplicate submissions, partial fulfilment, outside purchase/no-dispense behavior, and cross-tenant access.

## 10. Testing and Release Gates

### Backend tests

- final prescription does not create a sale or alter stock by itself;
- successful hospital dispense creates one order, deducts stock and preserves clinical `final` status;
- partial dispense records remaining quantities accurately;
- duplicate request is idempotent;
- hospital counter fulfilment rejects missing/invalid payment method and records the chosen method without defaulting to cash;
- failure inside dispense leaves no committed stock/order mismatch;
- cross-tenant and unauthorised dispense are denied;
- partner/Ozzyl commission cannot be associated with doctor beneficiary;
- refund/cancellation reverses commercial fee in the later marketplace phase.

### Frontend tests

- in-house dispensing UI uses the single atomic endpoint;
- prescription UI does not imply compulsory hospital purchase;
- future patient-app model can show prescribed versus selected alternative distinctly.

### Release gate

No production deploy until targeted tests, type-check, build, and relevant full-suite gates pass, and pharmacy/clinical UAT confirms the real operational workflow.

## 11. Deferred Work

- full patient mobile-app order UI;
- partner onboarding and licence verification workflow;
- online payment and delivery integrations;
- provider settlement and Ozzyl commission administration;
- commercial product ranking/search policy;
- reconciled legacy-data status migration.

These follow the foundation; they must not be simulated by overloading the prescription record.
