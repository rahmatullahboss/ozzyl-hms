# OpenEMR Patient Portal (Onsite Portal)

OpenEMR's onsite patient portal is the patient-facing web app at
`/portal/`. It is a hybrid:

- The "primary" surface (login, account registration, dashboard,
  most widgets) is server-rendered PHP, with Twig for layout and
  legacy AngularJS 1.8 for the messaging widget.
- A secondary surface at `/portal/patient/` is a Phreeze-based MVC
  REST app that the main surface delegates to for JSON APIs.

This document maps out the file layout, the login flow, the
account-registration flow, the messaging widget, the payment
integration, the e-signature integration, and the audit trail.

- Source root: `openemr-reference/portal/`
- Spec: ONC §170.315(e)(1) View, download, transmit; §(e)(2)
  Ambulatory summary; §(e)(3) Patient education; §(e)(4) Secure
  messaging; §(e)(5) Image viewing; §(e)(6) Family health history.

## Table of contents

- [Two surfaces: server-rendered and Phreeze](#two-surfaces)
- [Directory layout](#directory-layout)
- [Login flow](#login-flow)
- [One-time autologin via encrypted tokens](#one-time-autologin-via-encrypted-tokens)
- [Home page (dashboard)](#home-page-dashboard)
- [Widget endpoints](#widget-endpoints)
- [Messaging (AngularJS 1.8)](#messaging-angularjs-18)
- [Account / registration (4-step wizard)](#account--registration-4-step-wizard)
- [E-signature](#e-signature)
- [Payments (Stripe, Authorize.Net, Rainforest)](#payments-stripe-authorizenet-rainforest)
- [Reports and custom reports](#reports-and-custom-reports)
- [Audit (`onsite_portal_activity`)](#audit-onsite_portal_activity)
- [Logout](#logout)
- [The Phreeze MVC at `/portal/patient/`](#the-phreeze-mvc-at-portalpatient)

## Two surfaces

| Path | Stack | Purpose |
|------|-------|---------|
| `/portal/index.php` (and everything else in `portal/`) | Server-rendered PHP + Twig + AngularJS 1.8 | Login, dashboard, account, most widgets |
| `/portal/patient/` | Phreeze MVC + jQuery Mobile + AngularJS | The "patient data" REST API that the main surface (and external clients) call for JSON |

The two share the same `OpenEMR` session via `SessionUtil::setAppCookie(SessionUtil::PORTAL_SESSION_ID)`.
The Phreeze surface is documented by its `_machine_config.php` /
`_app_config.php` / `_global_config.php` files inside
`portal/patient/`.

## Directory layout

```
portal/
├── index.php                    # Login screen + autologin handling
├── get_patient_info.php         # Login form submission handler
├── home.php                     # Dashboard (Twig-rendered cards)
├── verify_session.php           # Shared session verification helper
├── logout.php                   # Session destroy
├── get_allergies.php            # Allergy widget (server-side HTML)
├── get_amendments.php           # Amendment widget
├── get_lab_results.php          # Lab results widget
├── get_medications.php          # Active medication widget
├── get_patient_documents.php    # Documents widget
├── get_prescriptions.php        # Prescriptions widget
├── get_problems.php             # Problem list widget
├── get_pro.php                  # PRO / survey widget
├── get_profile.php              # Patient profile widget
├── add_edit_event_user.php      # Appointment add/edit
├── find_appt_popup_user.php     # Appointment search
├── import_template.php          # Import helper
├── import_template_ui.php       # Import UI
├── questionnaire_render.php     # PRO questionnaire renderer
├── portal_payment.php           # Payment entry point
├── portal_payment.js            # Stripe JS
├── portal_payment.authorizenet.js
├── portal_payment.rainforest.php
├── account/
│   ├── account.php              # Registration AJAX endpoint
│   ├── account.lib.php          # Registration helpers
│   ├── register.php             # Registration landing page
│   ├── index_reset.php          # Password reset flow
│   └── verify.php               # Email verification
├── lib/
│   ├── appsql.class.php         # Portal activity table
│   ├── doc_lib.php              # Document helpers
│   ├── download_template.php    # CCDA download helper
│   ├── patient_groups.php       # Patient group / cohort lookups
│   ├── paylib.php               # Payment helpers
│   ├── persist.php              # State persistence helper
│   ├── portal_mail.inc.php      # Portal-side mail helpers
│   └── track_portal_events.php  # Audit helpers
├── messaging/
│   ├── messages.php             # Messaging UI
│   ├── handle_note.php          # Note send/receive endpoint
│   └── secure_chat.php          # WebSocket-backed secure chat
├── patient/                     # Phreeze MVC app
├── report/
│   ├── document_downloads_action.php
│   ├── pat_ledger.php
│   ├── portal_custom_report.php
│   └── portal_patient_report.php
├── sign/
│   ├── assets/                  # E-signature JS/CSS
│   ├── css/                     # Stylesheets
│   └── lib/                     # Signature pad
└── images/
```

The portal is a *single-tenant* piece of code; it reads the site id
from the session (set by the request URL) and routes everything
through OpenEMR globals.

## Login flow

The portal login flow is split across two scripts:

1. **`portal/index.php`** renders the login page. It:
   - Starts the portal session (`SessionUtil::setAppCookie(SessionUtil::PORTAL_SESSION_ID)`).
   - Renders the login form with CSRF protection and the optional
     Google reCAPTCHA widget (when `portal_onsite_two_register` and
     the reCAPTCHA keys are configured).
   - Handles the one-time autologin token if `?service_auth=...` is
     set in the URL (see below).
   - Sets `$session->set('itsme', true)` so the form post can detect
     it came from this script (defense in depth against CSRF).

2. **`portal/get_patient_info.php`** handles the form post:
   - Requires `$session->get('itsme') === true`. If not, the session
     is destroyed and the user is bounced to the login page.
   - Validates the username and password fields.
   - Validates the CSRF token (`CsrfUtils::verifyCsrfToken(...)`).
   - Optionally validates the `passaddon` field when
     `enforce_signin_email` is enabled (one-time email code).
   - Sets the language choice from the form.
   - Sets `$session->set('itsme', true)` (so a refresh doesn't break).
   - Calls `ApplicationTable::authPortalLogin($username, $password)`
     to authenticate the patient. On success, sets
     `$session->set('pid', <pid>)`,
     `$session->set('ptName', <full name>)`, etc.
   - Handles the "force password update" redirect.
   - Handles the "force email verification" redirect.
   - Redirects to `home.php` on success or back to `index.php` with
     an error query on failure.

3. **`portal/home.php`** is the dashboard. It requires
   `verify_session.php` (which checks `$session->get('pid')` and
   `$session->get('patient_portal_onsite_two')`), loads the global
   templates, and renders the cards.

## One-time autologin via encrypted tokens

External systems (e.g. email links, kiosk apps) can grant a patient
access to the portal without forcing them through the password
screen. The flow uses `OneTimeAuth`:

1. The caller POSTs to a server-side endpoint that creates a
   `OneTimeAuth` token for the patient's pid and includes the
   action intent (e.g. `enforce_auth_pin`).
2. The caller emails / SMSes the patient a link of the form
   `https://<host>/portal/index.php?service_auth=<token>`.
3. The patient clicks the link. `portal/index.php` detects the
   `service_auth` query param, sets up a CSRF key, and renders
   `portal/login/autologin.html.twig` — a tiny page that auto-POSTs
   the token to itself with the CSRF key attached.
4. The auto-POST is detected on the second pass through
   `portal/index.php`. The token is decoded with
   `OneTimeAuth::decodePortalOneTime()`, the patient pid is
   extracted, and the session is populated as if the patient had
   just logged in.
5. The patient is redirected to `home.php`.

The `service_auth` token is single-use and short-lived. The CSRF
step in between defeats a naive same-site cookie issue (the email
client is a different origin, so a same-site cookie would be
stripped — the auto-POST fixes that).

## Home page (dashboard)

`portal/home.php` is the dashboard. It:

1. Requires `verify_session.php` (which calls `session_start()` if
   not started, then checks that the `pid` and
   `patient_portal_onsite_two` session flags are set).
2. Reads `landOn` from the session or query string and stores the
   requested deep-link target (`#profilecard`, `#appointmentcard`,
   etc.).
3. Renders the Twig dashboard template. The template is composed of
   "cards" — each card is a small Twig partial that pulls data
   through a corresponding `get_*.php` widget endpoint.

The supported `landOn` values include `ClinicalDocuments`,
`Appointments`, `MakePayment`, `SecureMessaging`, `HealthSnapshot`,
`Profile`, `BillingSummary`, `MedicalReports`, `PROAssessment`,
`Settings`, `Help`, `Logout`.

## Widget endpoints

Each `get_*.php` file is a tiny server-side renderer that
produces an HTML fragment (or a JSON blob for the Angular
widgets). All of them require `verify_session.php` and use the
session's `pid` to scope their queries.

| Endpoint | Source data | Notes |
|----------|-------------|-------|
| `get_allergies.php` | `lists` where `type='allergy'` | HTML table |
| `get_medications.php` | `prescriptions` where `active=1` and `patient_id=<pid>` | HTML table |
| `get_lab_results.php` | `procedure_result` | HTML table |
| `get_prescriptions.php` | `prescriptions` (all, including non-active) | HTML table |
| `get_problems.php` | `lists` where `type='medical_problem'` | HTML table |
| `get_pro.php` | `extension_observation` where `category='survey'` | Renders the PRO questionnaire |
| `get_amendments.php` | `amendments` | HTML table |
| `get_profile.php` | `patient_data` | HTML form |
| `get_patient_documents.php` | `documents` | HTML list of download links |

Each widget honors the `$pid` from the session — a patient cannot
view another patient's data. The widgets also call
`ApplicationTable::logPortalEvent(...)` to record the access in
`onsite_portal_activity`.

## Messaging (AngularJS 1.8)

`portal/messaging/messages.php` is the UI shell; the
interactive logic is in `secure_chat.php` and the AngularJS
app that the Twig template embeds.

The Angular app makes REST calls to `portal/messaging/handle_note.php`,
which:

- Accepts the standard messaging actions (`getInbox`, `getSent`,
  `send`, `reply`, `forward`, `delete`).
- Looks up the `pnotes` table scoped to the patient's pid.
- Logs each action in `onsite_portal_activity`.
- Returns JSON for the AngularJS app to render.

`secure_chat.php` provides a real-time channel via the OpenEMR
WebSocket abstraction (server-side `WSHandler` is invoked
client-side through the AngularJS `PortalChatService`).

The messaging widget also supports outbound SMS and email when
`oefax_enable_sms` and `oe_enable_email` are configured
respectively.

## Account / registration (4-step wizard)

`portal/account/` contains the patient self-service registration
flow. The four steps are:

1. **Email / phone verification.** The patient enters contact
   information; OpenEMR sends a one-time code by email or SMS.
   `account.php?action=verify_email` is the AJAX endpoint.
2. **Identity match.** The patient enters demographic details
   (name, DOB, etc.); OpenEMR matches them against the
   `patient_data` table and either finds an existing patient or
   requires manual staff review.
3. **Username + password.** The patient picks a username and
   password. `account.php?action=userIsUnique` is the AJAX
   endpoint that prevents duplicates.
4. **Security questions + MFA.** Optional TOTP or security
   questions, depending on the portal's `enforce_*` globals.

The wizard is rendered by `register.php`; the AJAX endpoints are
in `account.php` and use the `portal_account` action vocabulary.

`account.lib.php` contains the helper functions — `verifyEmail()`,
`cleanupRegistrationSession()`, `processRecaptcha()`, and the
`registerPatient()` function that ultimately creates the
`patient_access_onsite` row.

Password reset (forgot password) is in `index_reset.php`; email
verification (re-send the verification email) is in `verify.php`.

## E-signature

`portal/sign/` contains a small client-side library for capturing
patient signatures. The signature is captured as a base64 PNG in
the browser and posted to one of the report endpoints
(`portal/report/portal_custom_report.php`) which calls
`CcdaGeneratorService` (or directly embeds the PNG in the
generated C-CDA `<authorization>` element).

The library is intentionally tiny — no external dependencies. It
relies on the browser's `<canvas>` API.

## Payments (Stripe, Authorize.Net, Rainforest)

`portal/portal_payment.php` is the payment entry point. It
exposes a tabbed UI for three payment processors:

- **Stripe** — `portal_payment.js` is the Stripe Elements client;
  `portal_payment.php` calls `Stripe::createPaymentIntent(...)`
  on the server side.
- **Authorize.Net** — `portal_payment.authorizenet.js` builds the
  Accept Hosted form iframe. The server side uses the
  `AuthNetPaymentProcessor` class.
- **Rainforest** (aka Clover hosted checkout) — `portal_payment.rainforest.php`
  is the API shim. Used by some US clinics that want a hosted
  gateway with low PCI scope.

`lib/paylib.php` is the helper that decides which processor to
use based on globals (`portal_payment_method`, etc.) and
abstracts the create-charge / refund / list-receipt operations.

The patient ledger is rendered by `portal/report/pat_ledger.php`.
It pulls from the `transactions` table and the
`ar_activity` table.

## Reports and custom reports

`portal/report/`:

- `portal_patient_report.php` — the patient-side "my reports" page.
- `portal_custom_report.php` — runs a custom report (admin-defined
  via the Reports module) and renders the result as a printable
  HTML page.
- `document_downloads_action.php` — the server-side endpoint for
  the document-downloads card (downloads a ZIP of all documents
  for a date range).
- `pat_ledger.php` — the patient ledger (charges, payments, balance).

## Audit (`onsite_portal_activity`)

The portal writes a row to the `onsite_portal_activity` table for
every action: login, login failure, autologin, password change,
demographic update, document download, message send, payment,
etc. The columns are:

| Column | Meaning |
|--------|---------|
| `id` | Primary key |
| `date` | Timestamp |
| `patient_id` | The pid of the patient who acted |
| `activity` | A free-form action code (`login`, `logout`, `view`, `download`, `send`, `pay`, ...) |
| `require_login` | Whether the activity required a login (most do) |
| `pending_action` | Optional structured detail (JSON in some rows) |
| `ip` | Request IP |
| `user_agent` | Request User-Agent |

The `ApplicationTable` class in `portal/lib/appsql.class.php` is
the wrapper. The `logit->portalLog($activity, $requireLogin, ...)`
method is called from every endpoint that performs a
patient-visible action.

The audit table is also exposed to the admin under
Reports → Portal Activity.

## Logout

`portal/logout.php`:

1. Writes a final `logout` row to `onsite_portal_activity`.
2. Calls `SessionUtil::portalSessionCookieDestroy()` which removes
   the `PortalOpenEMR` cookie and unsets the relevant session keys.
3. Optionally revokes any active refresh tokens (via
   `TrustedUserService`).
4. Redirects to `/portal/index.php?logout=1` so the login page
   shows a "you've been logged out" message.

## The Phreeze MVC at `/portal/patient/`

`portal/patient/` is a Phreeze (a small PHP MVC framework) app
that backs the JSON APIs the main portal surface uses. The
relevant files:

- `index.php` — front controller.
- `_app_config.php` — Phreeze routing config (controllers → actions).
- `_global_config.php` — environment / DB config.
- `_machine_config.php` — machine-level overrides.
- `fwk/` — Phreeze framework (the small MVC + ActiveRecord
  pattern).
- `libs/` — project-specific libs.
- `scripts/` — build / CLI scripts.
- `templates/` — Phreeze views (the only place the Phreeze side
  actually renders HTML).

The Phreeze app shares the portal session via
`session_id()` + `session_start()` and exposes JSON for the
AngularJS widgets to consume.

## See also

- `doc/interop/smart-on-fhir.md` — How SMART apps use the same
  portal session
- `doc/interop/portal-vs-api.md` — How the portal auth differs
  from the REST API auth
- `doc/api/rest-api.md` — The `/portal/patient/...` REST routes
- `doc/interop/ccda.md` — The CCDA download widget
