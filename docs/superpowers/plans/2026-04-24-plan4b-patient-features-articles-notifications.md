# Plan 4B: Appointments, Prescriptions, Lab Results, Health Records, Family, Articles, Notifications

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete all hospital-connected patient features and the content/notification layer

**Architecture:** All hospital features are API-first with CacheDatabase for offline reading. Each feature follows Clean Architecture. Articles are public (no auth). Notifications use Firebase Messaging.

**Tech Stack:** flutter_bloc, dio, drift, firebase_messaging ^15.0.0, pdf ^3.0.0

**Depends on:** Plan 1 + Plan 4A completed (ApiClient, CacheDB, hospital models, auth)

---

### Task 1: Appointments (browse doctors, book, cancel)

**Files:**
- Create: `apps/ozzyl_health/lib/features/appointments/domain/entities/appointment.dart`
- Create: `apps/ozzyl_health/lib/features/appointments/domain/repositories/appointment_repository.dart`
- Create: `apps/ozzyl_health/lib/features/appointments/data/datasources/appointment_remote_datasource.dart`
- Create: `apps/ozzyl_health/lib/features/appointments/data/datasources/appointment_cache_datasource.dart`
- Create: `apps/ozzyl_health/lib/features/appointments/data/repositories/appointment_repository_impl.dart`
- Create: `apps/ozzyl_health/lib/features/appointments/presentation/bloc/appointment_bloc.dart`
- Create: `apps/ozzyl_health/lib/features/appointments/presentation/bloc/appointment_event.dart`
- Create: `apps/ozzyl_health/lib/features/appointments/presentation/bloc/appointment_state.dart`
- Create: `apps/ozzyl_health/lib/features/appointments/presentation/pages/appointments_page.dart`
- Create: `apps/ozzyl_health/lib/features/appointments/presentation/pages/book_appointment_page.dart`

- [ ] **Step 1: Write Freezed appointment model in ozzyl_core**

```dart
// packages/ozzyl_core/lib/src/models/appointment_models.dart
import 'package:freezed_annotation/freezed_annotation.dart';
part 'appointment_models.freezed.dart';
part 'appointment_models.g.dart';

@freezed
sealed class Appointment with _$Appointment {
  const factory Appointment({
    required String id,
    required String patientId,
    required String doctorId,
    required String doctorName,
    String? doctorSpecialty,
    required DateTime dateTime,
    required String status, // scheduled, completed, cancelled, no_show
    String? notes,
    String? hospitalName,
  }) = _Appointment;
  factory Appointment.fromJson(Map<String, dynamic> json) => _$AppointmentFromJson(json);
}

@freezed
sealed class TimeSlot with _$TimeSlot {
  const factory TimeSlot({
    required DateTime dateTime,
    required bool available,
  }) = _TimeSlot;
  factory TimeSlot.fromJson(Map<String, dynamic> json) => _$TimeSlotFromJson(json);
}
```

- [ ] **Step 2: Write remote + cache datasources**

Remote datasource:
- `getUpcoming()` → `GET /api/v1/appointments?status=scheduled&upcoming=true`
- `getHistory()` → `GET /api/v1/appointments?status=completed,cancelled`
- `getSlots(doctorId, date)` → `GET /api/v1/appointments/slots?doctorId=X&date=Y`
- `book(doctorId, dateTime, notes)` → `POST /api/v1/appointments`
- `cancel(appointmentId)` → `PATCH /api/v1/appointments/:id { status: 'cancelled' }`

Cache datasource: store/read from `cached_appointments` table in CacheDatabase.

- [ ] **Step 3: Write repository with online/offline fallback**

Same pattern as HospitalRepository — try remote, fallback to cache.

- [ ] **Step 4: Write BLoC**

Events: loadUpcoming, loadHistory, loadSlots(doctorId, date), book(doctorId, dateTime, notes), cancel(id).
States: initial, loading, loaded(upcoming, history), slotsLoaded(slots), error.

- [ ] **Step 5: Write AppointmentsPage**

Tabs: Upcoming | History. Each shows appointment cards with doctor name, date/time, status chip. Upcoming cards have cancel button. FAB to book new appointment.

- [ ] **Step 6: Write BookAppointmentPage**

Steps: 1) Select doctor from hospital → 2) Pick date → 3) Pick available time slot → 4) Add notes → 5) Confirm. Uses the slots API.

- [ ] **Step 7: Wire routes + commit**

```dart
// Inside hospital branch or as standalone
GoRoute(path: '/appointments', builder: (context, state) => const AppointmentsPage()),
GoRoute(path: '/appointments/book', builder: (context, state) => const BookAppointmentPage()),
```

```bash
git add packages/ozzyl_core/ apps/ozzyl_health/lib/features/appointments/
git commit -m "feat(appointments): add booking flow, upcoming/history, time slot selection"
```

---

### Task 2: Prescriptions (view, refill, PDF)

**Files:**
- Create: `apps/ozzyl_health/lib/features/prescriptions/domain/entities/prescription.dart`
- Create: `apps/ozzyl_health/lib/features/prescriptions/domain/repositories/prescription_repository.dart`
- Create: `apps/ozzyl_health/lib/features/prescriptions/data/datasources/prescription_remote_datasource.dart`
- Create: `apps/ozzyl_health/lib/features/prescriptions/data/repositories/prescription_repository_impl.dart`
- Create: `apps/ozzyl_health/lib/features/prescriptions/presentation/bloc/prescription_bloc.dart`
- Create: `apps/ozzyl_health/lib/features/prescriptions/presentation/bloc/prescription_event.dart`
- Create: `apps/ozzyl_health/lib/features/prescriptions/presentation/bloc/prescription_state.dart`
- Create: `apps/ozzyl_health/lib/features/prescriptions/presentation/pages/prescriptions_page.dart`

- [ ] **Step 1: Model in ozzyl_core**

```dart
// packages/ozzyl_core/lib/src/models/prescription_models.dart
@freezed
sealed class Prescription with _$Prescription {
  const factory Prescription({
    required String id,
    required String patientId,
    required String doctorName,
    required DateTime date,
    required String status, // active, completed, cancelled
    @Default([]) List<PrescriptionItem> items,
    String? pdfUrl,
    String? hospitalName,
  }) = _Prescription;
  factory Prescription.fromJson(Map<String, dynamic> json) => _$PrescriptionFromJson(json);
}

@freezed
sealed class PrescriptionItem with _$PrescriptionItem {
  const factory PrescriptionItem({
    required String medicineName,
    required String dosage,
    required String frequency,
    required String duration,
    String? instructions,
  }) = _PrescriptionItem;
  factory PrescriptionItem.fromJson(Map<String, dynamic> json) => _$PrescriptionItemFromJson(json);
}
```

- [ ] **Step 2: Remote datasource + repository**

- `getAll()` → `GET /api/v1/prescriptions`
- `getActive()` → `GET /api/v1/prescriptions?status=active`
- `requestRefill(id)` → `POST /api/v1/prescriptions/:id/refill`
- `getPdf(id)` → `GET /api/v1/prescriptions/:id/pdf` (returns URL)

Repository: online/offline with CacheDatabase.

- [ ] **Step 3: BLoC + PrescriptionsPage**

Events: load, requestRefill(id).
States: initial, loading, loaded(active, completed), error.

PrescriptionsPage: Tabs (Active | Completed). Each prescription card shows doctor name, date, medicines list, status. Active ones have "Request Refill" button. Tap to expand details. "View PDF" button opens PDF viewer or downloads.

- [ ] **Step 4: Wire route + commit**

```bash
git add packages/ozzyl_core/ apps/ozzyl_health/lib/features/prescriptions/
git commit -m "feat(prescriptions): add prescription list, refill request, PDF viewer"
```

---

### Task 3: Lab Results (view, PDF)

**Files:**
- Create: `apps/ozzyl_health/lib/features/lab_results/domain/entities/lab_result.dart`
- Create: `apps/ozzyl_health/lib/features/lab_results/domain/repositories/lab_repository.dart`
- Create: `apps/ozzyl_health/lib/features/lab_results/data/datasources/lab_remote_datasource.dart`
- Create: `apps/ozzyl_health/lib/features/lab_results/data/repositories/lab_repository_impl.dart`
- Create: `apps/ozzyl_health/lib/features/lab_results/presentation/bloc/lab_bloc.dart`
- Create: `apps/ozzyl_health/lib/features/lab_results/presentation/bloc/lab_event.dart`
- Create: `apps/ozzyl_health/lib/features/lab_results/presentation/bloc/lab_state.dart`
- Create: `apps/ozzyl_health/lib/features/lab_results/presentation/pages/lab_results_page.dart`
- Create: `apps/ozzyl_health/lib/features/lab_results/presentation/pages/lab_result_detail_page.dart`

- [ ] **Step 1: Model in ozzyl_core**

```dart
// packages/ozzyl_core/lib/src/models/lab_models.dart
@freezed
sealed class LabResult with _$LabResult {
  const factory LabResult({
    required String id,
    required String testName,
    required DateTime date,
    required String status, // pending, completed
    String? result,
    String? unit,
    String? referenceRange,
    bool? isAbnormal,
    String? pdfUrl,
    String? orderedBy,
  }) = _LabResult;
  factory LabResult.fromJson(Map<String, dynamic> json) => _$LabResultFromJson(json);
}
```

- [ ] **Step 2: Remote datasource + repository (same pattern)**

- `getAll()` → `GET /api/v1/lab/results`
- `getDetail(id)` → `GET /api/v1/lab/results/:id`
- Repository with offline cache.

- [ ] **Step 3: BLoC + Pages**

LabResultsPage: List of results, grouped by date. Status chips (pending=yellow, completed=green). Abnormal results highlighted red. Tap → detail page with full result, reference range, PDF download.

- [ ] **Step 4: Wire route + commit**

```bash
git add packages/ozzyl_core/ apps/ozzyl_health/lib/features/lab_results/
git commit -m "feat(labs): add lab results list, detail page, abnormal highlighting, PDF"
```

---

### Task 4: Health Records (allergies, medications, diagnoses, vaccines)

**Files:**
- Create: `apps/ozzyl_health/lib/features/health_records/domain/entities/health_record.dart`
- Create: `apps/ozzyl_health/lib/features/health_records/domain/repositories/health_records_repository.dart`
- Create: `apps/ozzyl_health/lib/features/health_records/data/datasources/health_records_remote_datasource.dart`
- Create: `apps/ozzyl_health/lib/features/health_records/data/repositories/health_records_repository_impl.dart`
- Create: `apps/ozzyl_health/lib/features/health_records/presentation/bloc/records_bloc.dart`
- Create: `apps/ozzyl_health/lib/features/health_records/presentation/pages/health_records_page.dart`

- [ ] **Step 1: Models**

```dart
// packages/ozzyl_core/lib/src/models/health_record_models.dart
@freezed
sealed class PatientHealthRecords with _$PatientHealthRecords {
  const factory PatientHealthRecords({
    @Default([]) List<Allergy> allergies,
    @Default([]) List<ActiveMedication> medications,
    @Default([]) List<Diagnosis> diagnoses,
    @Default([]) List<Immunization> immunizations,
  }) = _PatientHealthRecords;
  factory PatientHealthRecords.fromJson(Map<String, dynamic> json) => _$PatientHealthRecordsFromJson(json);
}

@freezed sealed class Allergy with _$Allergy {
  const factory Allergy({required String name, String? severity, String? reaction}) = _Allergy;
  factory Allergy.fromJson(Map<String, dynamic> json) => _$AllergyFromJson(json);
}

@freezed sealed class ActiveMedication with _$ActiveMedication {
  const factory ActiveMedication({required String name, String? dosage, String? frequency, String? prescribedBy}) = _ActiveMedication;
  factory ActiveMedication.fromJson(Map<String, dynamic> json) => _$ActiveMedicationFromJson(json);
}

@freezed sealed class Diagnosis with _$Diagnosis {
  const factory Diagnosis({required String name, String? icdCode, DateTime? date, String? status}) = _Diagnosis;
  factory Diagnosis.fromJson(Map<String, dynamic> json) => _$DiagnosisFromJson(json);
}

@freezed sealed class Immunization with _$Immunization {
  const factory Immunization({required String name, DateTime? date, String? provider}) = _Immunization;
  factory Immunization.fromJson(Map<String, dynamic> json) => _$ImmunizationFromJson(json);
}
```

- [ ] **Step 2: Datasource + repository**

Remote: `GET /api/v1/patient-phr/allergies`, `/medications`, `/diagnoses`, `/immunizations`
Cache in `cached_health_records` table.

- [ ] **Step 3: BLoC + HealthRecordsPage**

Four expandable sections: Allergies (with severity color), Medications (with dosage), Diagnoses (with ICD code), Immunizations (with dates). Share button to export as PDF.

- [ ] **Step 4: Wire + commit**

```bash
git add packages/ozzyl_core/ apps/ozzyl_health/lib/features/health_records/
git commit -m "feat(records): add health records page with allergies, meds, diagnoses, vaccines"
```

---

### Task 5: Family (linking, proxy access)

**Files:**
- Create: `apps/ozzyl_health/lib/features/family/domain/entities/family_member.dart`
- Create: `apps/ozzyl_health/lib/features/family/domain/repositories/family_repository.dart`
- Create: `apps/ozzyl_health/lib/features/family/data/datasources/family_remote_datasource.dart`
- Create: `apps/ozzyl_health/lib/features/family/data/repositories/family_repository_impl.dart`
- Create: `apps/ozzyl_health/lib/features/family/presentation/bloc/family_bloc.dart`
- Create: `apps/ozzyl_health/lib/features/family/presentation/pages/family_page.dart`

- [ ] **Step 1: Model + remote datasource**

```dart
@freezed sealed class FamilyMember with _$FamilyMember {
  const factory FamilyMember({
    required String id, required String name, required String relationship,
    String? email, String? phone, bool? hasAccount,
  }) = _FamilyMember;
  factory FamilyMember.fromJson(Map<String, dynamic> json) => _$FamilyMemberFromJson(json);
}
```

Remote: `GET /api/v1/patients/family`, `POST /api/v1/patients/family { name, relationship, email }`.

- [ ] **Step 2: BLoC + FamilyPage**

List of family members with relationship labels. Add member dialog. Tap member to view their health summary (proxy access if they've granted permission).

- [ ] **Step 3: Wire + commit**

```bash
git add packages/ozzyl_core/ apps/ozzyl_health/lib/features/family/
git commit -m "feat(family): add family member list, add/link, proxy access"
```

---

### Task 6: Health Articles

**Files:**
- Create: `apps/ozzyl_health/lib/features/health_articles/domain/entities/article.dart`
- Create: `apps/ozzyl_health/lib/features/health_articles/data/datasources/articles_remote_datasource.dart`
- Create: `apps/ozzyl_health/lib/features/health_articles/presentation/bloc/articles_bloc.dart`
- Create: `apps/ozzyl_health/lib/features/health_articles/presentation/bloc/articles_event.dart`
- Create: `apps/ozzyl_health/lib/features/health_articles/presentation/bloc/articles_state.dart`
- Modify: `apps/ozzyl_health/lib/features/health_articles/presentation/pages/articles_page.dart`
- Create: `apps/ozzyl_health/lib/features/health_articles/presentation/pages/article_detail_page.dart`

- [ ] **Step 1: Model**

```dart
@freezed sealed class Article with _$Article {
  const factory Article({
    required String id, required String title, required String summary,
    required String content, required String category, String? imageUrl,
    required DateTime publishedAt, int? readTimeMin,
  }) = _Article;
  factory Article.fromJson(Map<String, dynamic> json) => _$ArticleFromJson(json);
}
```

- [ ] **Step 2: Remote datasource**

`GET /api/v1/public/health-articles?category=X&limit=20` (no auth required)

- [ ] **Step 3: BLoC + ArticlesPage + ArticleDetailPage**

ArticlesPage: Category chips (All, Nutrition, Fitness, Mental Health, Women's Health), article cards with image, title, summary, read time. Pull-to-refresh. Tap → detail page with full markdown content.

- [ ] **Step 4: Wire + commit**

```bash
git add apps/ozzyl_health/lib/features/health_articles/
git commit -m "feat(articles): add health articles with categories, detail page"
```

---

### Task 7: Push Notifications

**Files:**
- Create: `apps/ozzyl_health/lib/core/services/push_notification_service.dart`
- Modify: `apps/ozzyl_health/lib/main.dart`

- [ ] **Step 1: Write PushNotificationService**

```dart
// core/services/push_notification_service.dart
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:ozzyl_core/ozzyl_core.dart';

class PushNotificationService {
  final FirebaseMessaging _messaging = FirebaseMessaging.instance;
  final ApiClient _apiClient;

  PushNotificationService(this._apiClient);

  Future<void> init() async {
    final settings = await _messaging.requestPermission(
      alert: true, badge: true, sound: true,
    );
    if (settings.authorizationStatus == AuthorizationStatus.authorized) {
      final token = await _messaging.getToken();
      if (token != null) {
        await _registerToken(token);
      }
      _messaging.onTokenRefresh.listen(_registerToken);
    }

    FirebaseMessaging.onMessage.listen((message) {
      // Handle foreground notification
    });

    FirebaseMessaging.onMessageOpenedApp.listen((message) {
      // Handle notification tap — navigate to relevant page
    });
  }

  Future<void> _registerToken(String token) async {
    try {
      await _apiClient.dio.post(ApiConstants.pushNotifications, data: {'token': token, 'platform': 'fcm'});
    } catch (_) {}
  }
}
```

- [ ] **Step 2: Initialize in main.dart**

```dart
// After initDependencies:
await Firebase.initializeApp();
await sl<PushNotificationService>().init();
```

- [ ] **Step 3: Create notifications list page**

Simple page showing notification history from a local cache or API endpoint.

- [ ] **Step 4: Wire + commit**

```bash
git add apps/ozzyl_health/lib/core/services/ apps/ozzyl_health/lib/features/notifications/
git commit -m "feat(notifications): add Firebase push notifications + in-app notification list"
```

---

### Task 8: Backend API endpoints (new)

**Files:**
- Create: `src/routes/tenant/wellness.ts`
- Create: `src/routes/public/healthArticles.ts`

- [ ] **Step 1: Wellness sync endpoint**

```typescript
// POST /api/v1/wellness/sync
// Body: { mood: [], water: [], sleep: [], exercise: [], goals: [] }
// Bulk upsert wellness data from mobile
```

- [ ] **Step 2: Health articles endpoint**

```typescript
// GET /api/v1/public/health-articles?category=X&limit=20
// Returns articles list (public, no auth)
```

- [ ] **Step 3: Commit**

```bash
git add src/routes/
git commit -m "feat(api): add wellness sync + health articles public endpoints"
```

---

## All Plans Complete

### Summary of all plan files:

| Plan | File | Scope |
|---|---|---|
| 1A | `plan1a-scaffolding.md` | Project scaffold, ozzyl_core, theme, DI, navigation |
| 1B | `plan1b-networking-database.md` | Dio interceptors, Drift wellness + cache DBs |
| 1C | `plan1c-auth.md` | Auth (login, register, MFA, biometric, BLoC + tests) |
| 1D | `plan1d-i18n-profile-onboarding.md` | Localization, profile page, onboarding flow |
| 2A | `plan2a-wellness-dashboard-mood-water.md` | Dashboard, mood tracker, water intake |
| 2B | `plan2b-sleep-exercise-goals-gamification.md` | Sleep, exercise, steps, goals, gamification |
| 3A | `plan3a-assessments-mental-wellness.md` | PHQ-9, GAD-7, breathing, meditation, journal |
| 3B | `plan3b-womens-health-meds-symptoms-emergency.md` | Period tracker, med reminders, symptom checker, SOS |
| 4A | `plan4a-hospital-discovery-linking.md` | Hospital search, profiles, linking |
| 4B | `plan4b-patient-features-articles-notifications.md` | Appointments, Rx, labs, records, family, articles, push |

### Execution order:

```
Plan 1A → 1B → 1C → 1D (Foundation — sequential)
    ↓
Plan 2A → 2B (Wellness — sequential)
Plan 3A → 3B (Health Tools — sequential)
Plan 4A → 4B (Hospital — sequential)

Plans 2, 3, 4 can run in parallel after Plan 1 completes.
```
