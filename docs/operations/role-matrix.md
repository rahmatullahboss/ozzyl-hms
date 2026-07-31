# Hospital Role Matrix

This is the minimum role policy for first hospital setup.

| Role | Allowed | Restricted |
| --- | --- | --- |
| Reception | patient search, registration, appointment, basic billing intake | patient merge, refund, audit logs, clinical note edit |
| Doctor | encounter, prescription, clinical view for assigned hospital patients | refund, tenant settings, role management |
| Nurse | vitals, nursing notes, assigned care workflow | prescription creation, refund, audit logs |
| Lab | lab order processing, result entry, report publish | billing edit, patient merge, role management |
| Pharmacist | prescription read/dispense workflow | prescription creation, refund, audit logs |
| Accountant/Billing | invoices, payments, deposits, authorized cancellation/refund | clinical notes, patient merge |
| Hospital Admin | staff, settings, audit review, merge approval, operational overrides | direct clinical decision ownership |
| Director/MD | audit review, operational reports, sensitive approvals | daily shared-login use |
| Patient | own portal data, claim, correction request | hospital-generated clinical record edit |

Sensitive actions that must be audited:

- patient merge/unmerge
- bill cancel/refund/credit note
- deposit refund
- role/permission change
- document download/export
- emergency access
- consent grant/revoke
