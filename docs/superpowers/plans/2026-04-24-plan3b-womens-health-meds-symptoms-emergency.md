# Plan 3B: Women's Health, Medication Reminders, Symptom Checker, Emergency

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build remaining health tools — period tracker, medication reminders with local notifications, AI symptom checker, emergency SOS

**Architecture:** Same Clean Architecture pattern. Med reminders use flutter_local_notifications for scheduled alerts. Symptom checker calls existing `/api/v1/ai` endpoint.

**Tech Stack:** flutter_bloc, drift, flutter_local_notifications ^18.0.0, url_launcher ^6.0.0

**Depends on:** Plan 1 completed

---

### Task 1: Women's Health (Period Tracker)

**Files:**
- Create: `apps/ozzyl_health/lib/features/womens_health/domain/entities/period_entry.dart`
- Create: `apps/ozzyl_health/lib/features/womens_health/domain/repositories/period_repository.dart`
- Create: `apps/ozzyl_health/lib/features/womens_health/data/datasources/period_local_datasource.dart`
- Create: `apps/ozzyl_health/lib/features/womens_health/data/repositories/period_repository_impl.dart`
- Create: `apps/ozzyl_health/lib/features/womens_health/presentation/bloc/period_bloc.dart`
- Create: `apps/ozzyl_health/lib/features/womens_health/presentation/bloc/period_event.dart`
- Create: `apps/ozzyl_health/lib/features/womens_health/presentation/bloc/period_state.dart`
- Create: `apps/ozzyl_health/lib/features/womens_health/presentation/pages/period_tracker_page.dart`

- [ ] **Step 1: Domain + data layers**

```dart
// domain/entities/period_entry.dart
class PeriodEntry {
  final int? id;
  final DateTime date;
  final int flowLevel; // 0=spotting, 1=light, 2=medium, 3=heavy, 4=very heavy
  final String? symptoms;
  final String? notes;
  const PeriodEntry({this.id, required this.date, required this.flowLevel, this.symptoms, this.notes});
}
```

```dart
// domain/repositories/period_repository.dart
import '../entities/period_entry.dart';

abstract class PeriodRepository {
  Future<List<PeriodEntry>> getEntries({int limit = 90});
  Future<void> addEntry(PeriodEntry entry);
  Future<void> deleteEntry(int id);
  Future<int?> predictNextCycleDay();
  Future<int> getAverageCycleLength();
}
```

```dart
// data/datasources/period_local_datasource.dart
import 'package:drift/drift.dart';
import '../../../../core/database/wellness_database.dart';
import '../../domain/entities/period_entry.dart';

class PeriodLocalDatasource {
  final WellnessDatabase _db;
  PeriodLocalDatasource(this._db);

  Future<List<PeriodEntry>> getEntries({int limit = 90}) async {
    final query = _db.select(_db.periodTracking)
      ..orderBy([(t) => OrderingTerm.desc(t.date)])
      ..limit(limit);
    final rows = await query.get();
    return rows.map((r) => PeriodEntry(
      id: r.id, date: r.date, flowLevel: r.flowLevel, symptoms: r.symptoms, notes: r.notes,
    )).toList();
  }

  Future<void> addEntry(PeriodEntry entry) async {
    await _db.into(_db.periodTracking).insert(PeriodTrackingCompanion.insert(
      date: entry.date, flowLevel: entry.flowLevel,
      symptoms: Value(entry.symptoms), notes: Value(entry.notes),
    ));
  }

  Future<void> deleteEntry(int id) async {
    await (_db.delete(_db.periodTracking)..where((t) => t.id.equals(id))).go();
  }

  Future<int> getAverageCycleLength() async {
    final entries = await getEntries(limit: 180);
    if (entries.length < 2) return 28;
    // Find cycle starts (first day of each period)
    final starts = <DateTime>[];
    DateTime? lastDate;
    for (final e in entries.reversed) {
      if (lastDate == null || e.date.difference(lastDate).inDays > 3) {
        starts.add(e.date);
      }
      lastDate = e.date;
    }
    if (starts.length < 2) return 28;
    int totalDays = 0;
    for (int i = 1; i < starts.length; i++) {
      totalDays += starts[i].difference(starts[i - 1]).inDays;
    }
    return totalDays ~/ (starts.length - 1);
  }

  Future<int?> predictNextCycleDay() async {
    final entries = await getEntries(limit: 90);
    if (entries.isEmpty) return null;
    final avgCycle = await getAverageCycleLength();
    final lastPeriodStart = entries.first.date;
    final nextStart = lastPeriodStart.add(Duration(days: avgCycle));
    return nextStart.difference(DateTime.now()).inDays;
  }
}
```

```dart
// data/repositories/period_repository_impl.dart
import '../../domain/entities/period_entry.dart';
import '../../domain/repositories/period_repository.dart';
import '../datasources/period_local_datasource.dart';

class PeriodRepositoryImpl implements PeriodRepository {
  final PeriodLocalDatasource _local;
  PeriodRepositoryImpl(this._local);
  @override Future<List<PeriodEntry>> getEntries({int limit = 90}) => _local.getEntries(limit: limit);
  @override Future<void> addEntry(PeriodEntry entry) => _local.addEntry(entry);
  @override Future<void> deleteEntry(int id) => _local.deleteEntry(id);
  @override Future<int?> predictNextCycleDay() => _local.predictNextCycleDay();
  @override Future<int> getAverageCycleLength() => _local.getAverageCycleLength();
}
```

- [ ] **Step 2: BLoC + PeriodTrackerPage**

Follow the same BLoC pattern as mood/water (events: load, add, delete; states: initial, loading, loaded with entries + prediction + avgCycle, error). The PeriodTrackerPage should have:
- Flow level selector (5 levels with color coding)
- Symptoms multi-select chips (cramps, headache, fatigue, bloating, mood swings)
- Calendar-style view showing logged days
- Prediction card ("Next period in ~X days")
- Average cycle length display

- [ ] **Step 3: Wire route + commit**

```dart
GoRoute(path: 'womens', builder: (context, state) => const PeriodTrackerPage()),
```

```bash
git add apps/ozzyl_health/lib/features/womens_health/
git commit -m "feat(womens): add period tracker with cycle prediction, flow levels, symptoms"
```

---

### Task 2: Medication Reminders

**Files:**
- Create: `apps/ozzyl_health/lib/features/medication_reminders/domain/entities/medication.dart`
- Create: `apps/ozzyl_health/lib/features/medication_reminders/domain/repositories/medication_repository.dart`
- Create: `apps/ozzyl_health/lib/features/medication_reminders/data/datasources/medication_local_datasource.dart`
- Create: `apps/ozzyl_health/lib/features/medication_reminders/data/repositories/medication_repository_impl.dart`
- Create: `apps/ozzyl_health/lib/features/medication_reminders/presentation/bloc/medication_bloc.dart`
- Create: `apps/ozzyl_health/lib/features/medication_reminders/presentation/bloc/medication_event.dart`
- Create: `apps/ozzyl_health/lib/features/medication_reminders/presentation/bloc/medication_state.dart`
- Create: `apps/ozzyl_health/lib/features/medication_reminders/presentation/pages/medication_page.dart`
- Create: `apps/ozzyl_health/lib/core/services/notification_service.dart`

- [ ] **Step 1: Write NotificationService**

```dart
// apps/ozzyl_health/lib/core/services/notification_service.dart
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter/material.dart';

class NotificationService {
  final FlutterLocalNotificationsPlugin _plugin = FlutterLocalNotificationsPlugin();

  Future<void> init() async {
    const android = AndroidInitializationSettings('@mipmap/ic_launcher');
    const ios = DarwinInitializationSettings(requestAlertPermission: true, requestBadgePermission: true, requestSoundPermission: true);
    await _plugin.initialize(const InitializationSettings(android: android, iOS: ios));
  }

  Future<void> scheduleDailyReminder({
    required int id, required String title, required String body,
    required TimeOfDay time,
  }) async {
    await _plugin.zonedSchedule(
      id, title, body,
      _nextInstanceOfTime(time),
      const NotificationDetails(
        android: AndroidNotificationDetails('med_reminders', 'Medication Reminders',
          importance: Importance.high, priority: Priority.high),
        iOS: DarwinNotificationDetails(),
      ),
      androidScheduleMode: AndroidScheduleMode.inexactAllowWhileIdle,
      matchDateTimeComponents: DateTimeComponents.time,
    );
  }

  Future<void> cancelReminder(int id) async {
    await _plugin.cancel(id);
  }

  Future<void> cancelAll() async {
    await _plugin.cancelAll();
  }

  TZDateTime _nextInstanceOfTime(TimeOfDay time) {
    final now = TZDateTime.now(local);
    var scheduled = TZDateTime(local, now.year, now.month, now.day, time.hour, time.minute);
    if (scheduled.isBefore(now)) scheduled = scheduled.add(const Duration(days: 1));
    return scheduled;
  }
}
```

- [ ] **Step 2: Domain + data layers**

```dart
// domain/entities/medication.dart
class Medication {
  final int? id;
  final String name;
  final String dosage;
  final String frequency; // daily, twice_daily, weekly
  final String times; // JSON array of HH:mm strings
  final bool active;
  const Medication({this.id, required this.name, required this.dosage, required this.frequency, required this.times, this.active = true});
}
```

```dart
// domain/repositories/medication_repository.dart
import '../entities/medication.dart';

abstract class MedicationRepository {
  Future<List<Medication>> getActive();
  Future<void> add(Medication med);
  Future<void> toggleActive(int id, bool active);
  Future<void> delete(int id);
}
```

Data layer follows same Drift pattern — query `medication_reminders` table, map to entity.

- [ ] **Step 3: BLoC + MedicationPage**

BLoC events: load, add, toggleActive, delete. States: initial, loading, loaded(List<Medication>), error.

MedicationPage should have:
- List of active medications with toggle switch
- Add medication dialog (name, dosage, frequency selector, time pickers)
- Each medication shows next reminder time
- Swipe to delete

- [ ] **Step 4: Register NotificationService in DI + wire route**

```dart
sl.registerLazySingleton<NotificationService>(() => NotificationService());
// Call init in main.dart after initDependencies
```

```dart
GoRoute(path: 'medication', builder: (context, state) => const MedicationPage()),
```

```bash
git add apps/ozzyl_health/lib/features/medication_reminders/ apps/ozzyl_health/lib/core/services/
git commit -m "feat(meds): add medication reminders with local notifications"
```

---

### Task 3: Symptom Checker (AI-powered)

**Files:**
- Create: `apps/ozzyl_health/lib/features/symptom_checker/presentation/pages/symptom_checker_page.dart`
- Create: `apps/ozzyl_health/lib/features/symptom_checker/data/datasources/symptom_remote_datasource.dart`

- [ ] **Step 1: Write remote datasource**

```dart
// data/datasources/symptom_remote_datasource.dart
import 'package:ozzyl_core/ozzyl_core.dart';

class SymptomRemoteDatasource {
  final ApiClient _apiClient;
  SymptomRemoteDatasource(this._apiClient);

  Future<String> analyzeSymptoms(List<String> symptoms, {String? additionalContext}) async {
    final response = await _apiClient.dio.post(
      ApiConstants.ai,
      data: {
        'action': 'symptom_check',
        'symptoms': symptoms,
        'context': additionalContext,
      },
    );
    return response.data['analysis'] as String;
  }
}
```

- [ ] **Step 2: Write SymptomCheckerPage**

```dart
// presentation/pages/symptom_checker_page.dart
import 'package:flutter/material.dart';
import 'package:ozzyl_core/ozzyl_core.dart';
import '../../../../core/di/injection.dart';
import '../../data/datasources/symptom_remote_datasource.dart';

class SymptomCheckerPage extends StatefulWidget {
  const SymptomCheckerPage({super.key});
  @override
  State<SymptomCheckerPage> createState() => _SymptomCheckerPageState();
}

class _SymptomCheckerPageState extends State<SymptomCheckerPage> {
  final _selectedSymptoms = <String>{};
  final _contextController = TextEditingController();
  String? _analysis;
  bool _loading = false;

  static const _commonSymptoms = [
    'Headache', 'Fever', 'Cough', 'Sore Throat', 'Fatigue',
    'Nausea', 'Dizziness', 'Body Ache', 'Shortness of Breath',
    'Chest Pain', 'Abdominal Pain', 'Diarrhea', 'Vomiting',
    'Runny Nose', 'Joint Pain', 'Back Pain', 'Skin Rash',
  ];

  @override
  void dispose() { _contextController.dispose(); super.dispose(); }

  Future<void> _analyze() async {
    if (_selectedSymptoms.isEmpty) return;
    setState(() { _loading = true; _analysis = null; });
    try {
      final datasource = SymptomRemoteDatasource(sl<ApiClient>());
      final result = await datasource.analyzeSymptoms(
        _selectedSymptoms.toList(),
        additionalContext: _contextController.text.trim().isEmpty ? null : _contextController.text.trim(),
      );
      setState(() => _analysis = result);
    } catch (e) {
      setState(() => _analysis = 'Unable to analyze symptoms. Please check your internet connection.');
    } finally {
      setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Symptom Checker')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Card(
              color: AppColors.warning.withOpacity(0.1),
              child: const Padding(
                padding: EdgeInsets.all(12),
                child: Text(
                  'This is not a medical diagnosis. Please consult a doctor for proper evaluation.',
                  style: TextStyle(fontSize: 13),
                ),
              ),
            ),
            const SizedBox(height: 16),
            Text('Select your symptoms', style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 12),
            Wrap(
              spacing: 8, runSpacing: 8,
              children: _commonSymptoms.map((s) => FilterChip(
                label: Text(s),
                selected: _selectedSymptoms.contains(s),
                selectedColor: AppColors.primary.withOpacity(0.2),
                onSelected: (v) => setState(() => v ? _selectedSymptoms.add(s) : _selectedSymptoms.remove(s)),
              )).toList(),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _contextController,
              decoration: const InputDecoration(labelText: 'Additional details (optional)', hintText: 'Duration, severity, other info...'),
              maxLines: 3,
            ),
            const SizedBox(height: 16),
            ElevatedButton(
              onPressed: _selectedSymptoms.isNotEmpty && !_loading ? _analyze : null,
              child: _loading
                  ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                  : const Text('Analyze Symptoms'),
            ),
            if (_analysis != null) ...[
              const SizedBox(height: 24),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(children: [
                        const Icon(Icons.medical_information, color: AppColors.primary),
                        const SizedBox(width: 8),
                        Text('Analysis', style: Theme.of(context).textTheme.titleMedium),
                      ]),
                      const SizedBox(height: 12),
                      Text(_analysis!),
                    ],
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
```

- [ ] **Step 3: Wire route + commit**

```dart
GoRoute(path: 'symptoms', builder: (context, state) => const SymptomCheckerPage()),
```

```bash
git add apps/ozzyl_health/lib/features/symptom_checker/
git commit -m "feat(symptoms): add AI symptom checker with common symptom chips"
```

---

### Task 4: Emergency (SOS, contacts, allergy card)

**Files:**
- Create: `apps/ozzyl_health/lib/features/emergency/presentation/pages/emergency_page.dart`

- [ ] **Step 1: Write EmergencyPage**

```dart
// presentation/pages/emergency_page.dart
import 'package:flutter/material.dart';
import 'package:ozzyl_core/ozzyl_core.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'dart:convert';

class EmergencyPage extends StatefulWidget {
  const EmergencyPage({super.key});
  @override
  State<EmergencyPage> createState() => _EmergencyPageState();
}

class _EmergencyPageState extends State<EmergencyPage> {
  String _bloodType = 'Unknown';
  List<String> _allergies = [];
  List<Map<String, String>> _contacts = [];

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  Future<void> _loadData() async {
    final prefs = await SharedPreferences.getInstance();
    setState(() {
      _bloodType = prefs.getString('blood_type') ?? 'Unknown';
      _allergies = prefs.getStringList('allergies') ?? [];
      final contactsJson = prefs.getString('emergency_contacts');
      if (contactsJson != null) {
        _contacts = (jsonDecode(contactsJson) as List).cast<Map<String, dynamic>>()
            .map((c) => c.map((k, v) => MapEntry(k, v.toString()))).toList();
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Emergency')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // SOS Button
          SizedBox(
            height: 120,
            child: ElevatedButton(
              onPressed: () => _callEmergency(),
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.error,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
              ),
              child: const Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.emergency, size: 40, color: Colors.white),
                  SizedBox(height: 8),
                  Text('SOS — Call Emergency', style: TextStyle(fontSize: 18, color: Colors.white, fontWeight: FontWeight.w700)),
                ],
              ),
            ),
          ),
          const SizedBox(height: 24),

          // Allergy Card
          Text('Allergy Card', style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 8),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(children: [
                    const Icon(Icons.bloodtype, color: AppColors.error),
                    const SizedBox(width: 8),
                    Text('Blood Type: $_bloodType', style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 16)),
                    const Spacer(),
                    IconButton(icon: const Icon(Icons.edit, size: 20), onPressed: () => _editBloodType()),
                  ]),
                  const Divider(),
                  const Text('Allergies:', style: TextStyle(fontWeight: FontWeight.w600)),
                  const SizedBox(height: 4),
                  if (_allergies.isEmpty)
                    const Text('None recorded', style: TextStyle(color: AppColors.textSecondary))
                  else
                    Wrap(spacing: 8, children: _allergies.map((a) => Chip(label: Text(a))).toList()),
                  TextButton(onPressed: _editAllergies, child: const Text('Edit Allergies')),
                ],
              ),
            ),
          ),
          const SizedBox(height: 24),

          // Emergency Contacts
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text('Emergency Contacts', style: Theme.of(context).textTheme.titleLarge),
              IconButton(icon: const Icon(Icons.add), onPressed: _addContact),
            ],
          ),
          const SizedBox(height: 8),
          if (_contacts.isEmpty)
            Card(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  children: [
                    const Icon(Icons.contacts, size: 48, color: AppColors.textSecondary),
                    const SizedBox(height: 8),
                    const Text('No emergency contacts'),
                    TextButton(onPressed: _addContact, child: const Text('Add Contact')),
                  ],
                ),
              ),
            )
          else
            ..._contacts.map((c) => Card(
              margin: const EdgeInsets.only(bottom: 8),
              child: ListTile(
                leading: const CircleAvatar(child: Icon(Icons.person)),
                title: Text(c['name'] ?? ''),
                subtitle: Text(c['phone'] ?? ''),
                trailing: IconButton(
                  icon: const Icon(Icons.call, color: AppColors.success),
                  onPressed: () => launchUrl(Uri.parse('tel:${c['phone']}')),
                ),
              ),
            )),
        ],
      ),
    );
  }

  Future<void> _callEmergency() async {
    if (_contacts.isNotEmpty) {
      await launchUrl(Uri.parse('tel:${_contacts.first['phone']}'));
    } else {
      await launchUrl(Uri.parse('tel:999'));
    }
  }

  void _editBloodType() {
    final types = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
    showDialog(
      context: context,
      builder: (ctx) => SimpleDialog(
        title: const Text('Blood Type'),
        children: types.map((t) => SimpleDialogOption(
          onPressed: () async {
            final prefs = await SharedPreferences.getInstance();
            await prefs.setString('blood_type', t);
            setState(() => _bloodType = t);
            Navigator.pop(ctx);
          },
          child: Text(t),
        )).toList(),
      ),
    );
  }

  void _editAllergies() {
    final ctrl = TextEditingController(text: _allergies.join(', '));
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Allergies'),
        content: TextField(controller: ctrl, decoration: const InputDecoration(hintText: 'Comma-separated: Penicillin, Peanuts')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          ElevatedButton(onPressed: () async {
            final list = ctrl.text.split(',').map((s) => s.trim()).where((s) => s.isNotEmpty).toList();
            final prefs = await SharedPreferences.getInstance();
            await prefs.setStringList('allergies', list);
            setState(() => _allergies = list);
            Navigator.pop(ctx);
          }, child: const Text('Save')),
        ],
      ),
    );
  }

  void _addContact() {
    final nameCtrl = TextEditingController();
    final phoneCtrl = TextEditingController();
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Emergency Contact'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(controller: nameCtrl, decoration: const InputDecoration(labelText: 'Name')),
            const SizedBox(height: 12),
            TextField(controller: phoneCtrl, decoration: const InputDecoration(labelText: 'Phone'), keyboardType: TextInputType.phone),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          ElevatedButton(onPressed: () async {
            if (nameCtrl.text.isNotEmpty && phoneCtrl.text.isNotEmpty) {
              _contacts.add({'name': nameCtrl.text, 'phone': phoneCtrl.text});
              final prefs = await SharedPreferences.getInstance();
              await prefs.setString('emergency_contacts', jsonEncode(_contacts));
              setState(() {});
              Navigator.pop(ctx);
            }
          }, child: const Text('Add')),
        ],
      ),
    );
  }
}
```

- [ ] **Step 2: Wire route + commit**

Add emergency to profile or wellness routes:
```dart
GoRoute(path: '/emergency', builder: (context, state) => const EmergencyPage()),
```

```bash
git add apps/ozzyl_health/lib/features/emergency/
git commit -m "feat(emergency): add SOS button, allergy card, emergency contacts"
```
