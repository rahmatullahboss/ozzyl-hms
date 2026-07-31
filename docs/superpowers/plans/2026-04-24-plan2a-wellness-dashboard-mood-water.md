# Plan 2A: Wellness Dashboard, Mood Tracker, Water Intake

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the home wellness dashboard with rings, and the first two tracking features (mood + water)

**Architecture:** Each feature follows Clean Architecture. Wellness data is offline-first via Drift WellnessDatabase. BLoC for state.

**Tech Stack:** flutter_bloc, drift, fl_chart, lottie

**Depends on:** Plan 1 (all parts) completed

---

### Task 1: Mood Tracker — domain + data

**Files:**
- Create: `apps/ozzyl_health/lib/features/mood_tracker/domain/entities/mood_entry.dart`
- Create: `apps/ozzyl_health/lib/features/mood_tracker/domain/repositories/mood_repository.dart`
- Create: `apps/ozzyl_health/lib/features/mood_tracker/data/datasources/mood_local_datasource.dart`
- Create: `apps/ozzyl_health/lib/features/mood_tracker/data/repositories/mood_repository_impl.dart`

- [ ] **Step 1: Write domain entity**

```dart
// apps/ozzyl_health/lib/features/mood_tracker/domain/entities/mood_entry.dart
class MoodEntry {
  final int? id;
  final DateTime timestamp;
  final int moodLevel;
  final String? notes;
  final String? tags;

  const MoodEntry({
    this.id,
    required this.timestamp,
    required this.moodLevel,
    this.notes,
    this.tags,
  });
}
```

- [ ] **Step 2: Write abstract repository**

```dart
// apps/ozzyl_health/lib/features/mood_tracker/domain/repositories/mood_repository.dart
import '../entities/mood_entry.dart';

abstract class MoodRepository {
  Future<List<MoodEntry>> getEntries({DateTime? from, DateTime? to});
  Future<MoodEntry?> getLatestEntry();
  Future<void> addEntry(MoodEntry entry);
  Future<void> deleteEntry(int id);
  Stream<List<MoodEntry>> watchTodayEntries();
}
```

- [ ] **Step 3: Write local datasource**

```dart
// apps/ozzyl_health/lib/features/mood_tracker/data/datasources/mood_local_datasource.dart
import 'package:drift/drift.dart';
import '../../../../core/database/wellness_database.dart';
import '../../domain/entities/mood_entry.dart';

class MoodLocalDatasource {
  final WellnessDatabase _db;

  MoodLocalDatasource(this._db);

  Future<List<MoodEntry>> getEntries({DateTime? from, DateTime? to}) async {
    var query = _db.select(_db.moodEntries);
    if (from != null) {
      query = query..where((t) => t.timestamp.isBiggerOrEqualValue(from));
    }
    if (to != null) {
      query = query..where((t) => t.timestamp.isSmallerOrEqualValue(to));
    }
    query = query..orderBy([(t) => OrderingTerm.desc(t.timestamp)]);

    final rows = await query.get();
    return rows.map(_toEntity).toList();
  }

  Future<MoodEntry?> getLatestEntry() async {
    final query = _db.select(_db.moodEntries)
      ..orderBy([(t) => OrderingTerm.desc(t.timestamp)])
      ..limit(1);
    final row = await query.getSingleOrNull();
    return row != null ? _toEntity(row) : null;
  }

  Future<void> addEntry(MoodEntry entry) async {
    await _db.into(_db.moodEntries).insert(
          MoodEntriesCompanion.insert(
            moodLevel: entry.moodLevel,
            notes: Value(entry.notes),
            tags: Value(entry.tags),
          ),
        );
    await _addToSyncQueue('mood_entries', 'insert');
  }

  Future<void> deleteEntry(int id) async {
    await (_db.delete(_db.moodEntries)..where((t) => t.id.equals(id))).go();
    await _addToSyncQueue('mood_entries', 'delete');
  }

  Stream<List<MoodEntry>> watchTodayEntries() {
    final now = DateTime.now();
    final startOfDay = DateTime(now.year, now.month, now.day);
    final endOfDay = startOfDay.add(const Duration(days: 1));

    final query = _db.select(_db.moodEntries)
      ..where((t) => t.timestamp.isBiggerOrEqualValue(startOfDay))
      ..where((t) => t.timestamp.isSmallerThanValue(endOfDay))
      ..orderBy([(t) => OrderingTerm.desc(t.timestamp)]);

    return query.watch().map((rows) => rows.map(_toEntity).toList());
  }

  Future<void> _addToSyncQueue(String table, String action) async {
    await _db.into(_db.syncQueue).insert(
          SyncQueueCompanion.insert(
            tableName: table,
            rowId: 0,
            action: action,
          ),
        );
  }

  MoodEntry _toEntity(MoodEntrie row) {
    return MoodEntry(
      id: row.id,
      timestamp: row.timestamp,
      moodLevel: row.moodLevel,
      notes: row.notes,
      tags: row.tags,
    );
  }
}
```

- [ ] **Step 4: Write repository impl**

```dart
// apps/ozzyl_health/lib/features/mood_tracker/data/repositories/mood_repository_impl.dart
import '../../domain/entities/mood_entry.dart';
import '../../domain/repositories/mood_repository.dart';
import '../datasources/mood_local_datasource.dart';

class MoodRepositoryImpl implements MoodRepository {
  final MoodLocalDatasource _localDatasource;

  MoodRepositoryImpl(this._localDatasource);

  @override
  Future<List<MoodEntry>> getEntries({DateTime? from, DateTime? to}) =>
      _localDatasource.getEntries(from: from, to: to);

  @override
  Future<MoodEntry?> getLatestEntry() => _localDatasource.getLatestEntry();

  @override
  Future<void> addEntry(MoodEntry entry) => _localDatasource.addEntry(entry);

  @override
  Future<void> deleteEntry(int id) => _localDatasource.deleteEntry(id);

  @override
  Stream<List<MoodEntry>> watchTodayEntries() =>
      _localDatasource.watchTodayEntries();
}
```

- [ ] **Step 5: Commit**

```bash
git add apps/ozzyl_health/lib/features/mood_tracker/
git commit -m "feat(mood): add mood tracker domain + data layer with Drift datasource"
```

---

### Task 2: Mood Tracker — BLoC + UI

**Files:**
- Create: `apps/ozzyl_health/lib/features/mood_tracker/presentation/bloc/mood_bloc.dart`
- Create: `apps/ozzyl_health/lib/features/mood_tracker/presentation/bloc/mood_event.dart`
- Create: `apps/ozzyl_health/lib/features/mood_tracker/presentation/bloc/mood_state.dart`
- Create: `apps/ozzyl_health/lib/features/mood_tracker/presentation/pages/mood_tracker_page.dart`
- Create: `apps/ozzyl_health/lib/features/mood_tracker/presentation/widgets/mood_selector.dart`
- Create: `apps/ozzyl_health/lib/features/mood_tracker/presentation/widgets/mood_chart.dart`

- [ ] **Step 1: Write events + states**

```dart
// apps/ozzyl_health/lib/features/mood_tracker/presentation/bloc/mood_event.dart
import 'package:freezed_annotation/freezed_annotation.dart';

part 'mood_event.freezed.dart';

@freezed
sealed class MoodEvent with _$MoodEvent {
  const factory MoodEvent.loadEntries({DateTime? from, DateTime? to}) = LoadMoodEntries;
  const factory MoodEvent.addEntry({
    required int moodLevel,
    String? notes,
    String? tags,
  }) = AddMoodEntry;
  const factory MoodEvent.deleteEntry(int id) = DeleteMoodEntry;
}
```

```dart
// apps/ozzyl_health/lib/features/mood_tracker/presentation/bloc/mood_state.dart
import 'package:freezed_annotation/freezed_annotation.dart';
import '../../domain/entities/mood_entry.dart';

part 'mood_state.freezed.dart';

@freezed
sealed class MoodState with _$MoodState {
  const factory MoodState.initial() = MoodInitial;
  const factory MoodState.loading() = MoodLoading;
  const factory MoodState.loaded(List<MoodEntry> entries) = MoodLoaded;
  const factory MoodState.error(String message) = MoodError;
}
```

- [ ] **Step 2: Write BLoC**

```dart
// apps/ozzyl_health/lib/features/mood_tracker/presentation/bloc/mood_bloc.dart
import 'package:flutter_bloc/flutter_bloc.dart';
import '../../domain/entities/mood_entry.dart';
import '../../domain/repositories/mood_repository.dart';
import 'mood_event.dart';
import 'mood_state.dart';

class MoodBloc extends Bloc<MoodEvent, MoodState> {
  final MoodRepository _repository;

  MoodBloc(this._repository) : super(const MoodState.initial()) {
    on<LoadMoodEntries>(_onLoad);
    on<AddMoodEntry>(_onAdd);
    on<DeleteMoodEntry>(_onDelete);
  }

  Future<void> _onLoad(LoadMoodEntries event, Emitter<MoodState> emit) async {
    emit(const MoodState.loading());
    try {
      final entries = await _repository.getEntries(from: event.from, to: event.to);
      emit(MoodState.loaded(entries));
    } catch (e) {
      emit(MoodState.error(e.toString()));
    }
  }

  Future<void> _onAdd(AddMoodEntry event, Emitter<MoodState> emit) async {
    try {
      await _repository.addEntry(
        MoodEntry(
          timestamp: DateTime.now(),
          moodLevel: event.moodLevel,
          notes: event.notes,
          tags: event.tags,
        ),
      );
      add(const MoodEvent.loadEntries());
    } catch (e) {
      emit(MoodState.error(e.toString()));
    }
  }

  Future<void> _onDelete(DeleteMoodEntry event, Emitter<MoodState> emit) async {
    try {
      await _repository.deleteEntry(event.id);
      add(const MoodEvent.loadEntries());
    } catch (e) {
      emit(MoodState.error(e.toString()));
    }
  }
}
```

- [ ] **Step 3: Write MoodSelector widget**

```dart
// apps/ozzyl_health/lib/features/mood_tracker/presentation/widgets/mood_selector.dart
import 'package:flutter/material.dart';
import 'package:ozzyl_core/ozzyl_core.dart';

class MoodSelector extends StatelessWidget {
  final int? selectedMood;
  final ValueChanged<int> onSelected;

  const MoodSelector({super.key, this.selectedMood, required this.onSelected});

  static const _moods = [
    (1, '😢', 'Bad', AppColors.moodBad),
    (2, '😟', 'Low', AppColors.moodLow),
    (3, '😐', 'Okay', AppColors.moodOkay),
    (4, '😊', 'Good', AppColors.moodGood),
    (5, '😄', 'Great', AppColors.moodGreat),
  ];

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceEvenly,
      children: _moods.map((m) {
        final (level, emoji, label, color) = m;
        final isSelected = selectedMood == level;
        return GestureDetector(
          onTap: () => onSelected(level),
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 200),
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: isSelected ? color.withOpacity(0.2) : Colors.transparent,
              borderRadius: BorderRadius.circular(16),
              border: isSelected ? Border.all(color: color, width: 2) : null,
            ),
            child: Column(
              children: [
                Text(emoji, style: TextStyle(fontSize: isSelected ? 36 : 28)),
                const SizedBox(height: 4),
                Text(
                  label,
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: isSelected ? FontWeight.w600 : FontWeight.w400,
                    color: isSelected ? color : AppColors.textSecondary,
                  ),
                ),
              ],
            ),
          ),
        );
      }).toList(),
    );
  }
}
```

- [ ] **Step 4: Write MoodChart widget**

```dart
// apps/ozzyl_health/lib/features/mood_tracker/presentation/widgets/mood_chart.dart
import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:ozzyl_core/ozzyl_core.dart';
import '../../domain/entities/mood_entry.dart';

class MoodChart extends StatelessWidget {
  final List<MoodEntry> entries;

  const MoodChart({super.key, required this.entries});

  @override
  Widget build(BuildContext context) {
    if (entries.isEmpty) {
      return const SizedBox(
        height: 200,
        child: Center(child: Text('No mood data yet')),
      );
    }

    final spots = entries.reversed.toList().asMap().entries.map((e) {
      return FlSpot(e.key.toDouble(), e.value.moodLevel.toDouble());
    }).toList();

    return SizedBox(
      height: 200,
      child: LineChart(
        LineChartData(
          gridData: const FlGridData(show: false),
          titlesData: const FlTitlesData(show: false),
          borderData: FlBorderData(show: false),
          minY: 0,
          maxY: 6,
          lineBarsData: [
            LineChartBarData(
              spots: spots,
              isCurved: true,
              color: AppColors.primary,
              barWidth: 3,
              dotData: FlDotData(
                show: true,
                getDotPainter: (spot, _, __, ___) {
                  final color = _colorForMood(spot.y.toInt());
                  return FlDotCirclePainter(
                    radius: 5,
                    color: color,
                    strokeWidth: 2,
                    strokeColor: Colors.white,
                  );
                },
              ),
              belowBarData: BarAreaData(
                show: true,
                color: AppColors.primary.withOpacity(0.1),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Color _colorForMood(int level) {
    return switch (level) {
      1 => AppColors.moodBad,
      2 => AppColors.moodLow,
      3 => AppColors.moodOkay,
      4 => AppColors.moodGood,
      5 => AppColors.moodGreat,
      _ => AppColors.textSecondary,
    };
  }
}
```

- [ ] **Step 5: Write MoodTrackerPage**

```dart
// apps/ozzyl_health/lib/features/mood_tracker/presentation/pages/mood_tracker_page.dart
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:ozzyl_core/ozzyl_core.dart';
import '../bloc/mood_bloc.dart';
import '../bloc/mood_event.dart';
import '../bloc/mood_state.dart';
import '../widgets/mood_selector.dart';
import '../widgets/mood_chart.dart';

class MoodTrackerPage extends StatefulWidget {
  const MoodTrackerPage({super.key});

  @override
  State<MoodTrackerPage> createState() => _MoodTrackerPageState();
}

class _MoodTrackerPageState extends State<MoodTrackerPage> {
  int? _selectedMood;
  final _notesController = TextEditingController();

  @override
  void dispose() {
    _notesController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Mood Tracker')),
      body: BlocBuilder<MoodBloc, MoodState>(
        builder: (context, state) {
          return SingleChildScrollView(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  'How are you feeling?',
                  style: Theme.of(context).textTheme.headlineMedium,
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 24),
                MoodSelector(
                  selectedMood: _selectedMood,
                  onSelected: (m) => setState(() => _selectedMood = m),
                ),
                const SizedBox(height: 24),
                if (_selectedMood != null) ...[
                  TextField(
                    controller: _notesController,
                    decoration: const InputDecoration(
                      labelText: 'Notes (optional)',
                      hintText: 'What made you feel this way?',
                    ),
                    maxLines: 3,
                  ),
                  const SizedBox(height: 16),
                  ElevatedButton(
                    onPressed: _onSave,
                    child: const Text('Save Mood'),
                  ),
                ],
                const SizedBox(height: 32),
                Text(
                  'Recent Trend',
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                const SizedBox(height: 16),
                if (state is MoodLoaded)
                  MoodChart(entries: state.entries)
                else if (state is MoodLoading)
                  const Center(child: CircularProgressIndicator())
                else
                  const Center(child: Text('Log your first mood!')),
              ],
            ),
          );
        },
      ),
    );
  }

  void _onSave() {
    if (_selectedMood == null) return;
    context.read<MoodBloc>().add(
          MoodEvent.addEntry(
            moodLevel: _selectedMood!,
            notes: _notesController.text.trim().isEmpty
                ? null
                : _notesController.text.trim(),
          ),
        );
    setState(() => _selectedMood = null);
    _notesController.clear();
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Mood saved!'), backgroundColor: AppColors.success),
    );
  }
}
```

- [ ] **Step 6: Run code generation**

Run: `cd apps/ozzyl_health && dart run build_runner build --delete-conflicting-outputs`

- [ ] **Step 7: Commit**

```bash
git add apps/ozzyl_health/lib/features/mood_tracker/
git commit -m "feat(mood): add MoodBloc, MoodSelector, MoodChart, MoodTrackerPage"
```

---

### Task 3: Water Intake — full feature

**Files:**
- Create: `apps/ozzyl_health/lib/features/water_intake/domain/entities/water_log.dart`
- Create: `apps/ozzyl_health/lib/features/water_intake/domain/repositories/water_repository.dart`
- Create: `apps/ozzyl_health/lib/features/water_intake/data/datasources/water_local_datasource.dart`
- Create: `apps/ozzyl_health/lib/features/water_intake/data/repositories/water_repository_impl.dart`
- Create: `apps/ozzyl_health/lib/features/water_intake/presentation/bloc/water_bloc.dart`
- Create: `apps/ozzyl_health/lib/features/water_intake/presentation/bloc/water_event.dart`
- Create: `apps/ozzyl_health/lib/features/water_intake/presentation/bloc/water_state.dart`
- Create: `apps/ozzyl_health/lib/features/water_intake/presentation/pages/water_intake_page.dart`
- Create: `apps/ozzyl_health/lib/features/water_intake/presentation/widgets/water_glass.dart`

- [ ] **Step 1: Write domain layer**

```dart
// apps/ozzyl_health/lib/features/water_intake/domain/entities/water_log.dart
class WaterLog {
  final int? id;
  final DateTime timestamp;
  final int amountMl;

  const WaterLog({this.id, required this.timestamp, required this.amountMl});
}
```

```dart
// apps/ozzyl_health/lib/features/water_intake/domain/repositories/water_repository.dart
import '../entities/water_log.dart';

abstract class WaterRepository {
  Future<List<WaterLog>> getTodayLogs();
  Future<int> getTodayTotal();
  Future<void> addLog(int amountMl);
  Future<void> deleteLog(int id);
  Stream<int> watchTodayTotal();
}
```

- [ ] **Step 2: Write data layer**

```dart
// apps/ozzyl_health/lib/features/water_intake/data/datasources/water_local_datasource.dart
import 'package:drift/drift.dart';
import '../../../../core/database/wellness_database.dart';
import '../../domain/entities/water_log.dart';

class WaterLocalDatasource {
  final WellnessDatabase _db;

  WaterLocalDatasource(this._db);

  Future<List<WaterLog>> getTodayLogs() async {
    final now = DateTime.now();
    final start = DateTime(now.year, now.month, now.day);
    final end = start.add(const Duration(days: 1));

    final query = _db.select(_db.waterLogs)
      ..where((t) => t.timestamp.isBiggerOrEqualValue(start))
      ..where((t) => t.timestamp.isSmallerThanValue(end))
      ..orderBy([(t) => OrderingTerm.desc(t.timestamp)]);

    final rows = await query.get();
    return rows
        .map((r) => WaterLog(id: r.id, timestamp: r.timestamp, amountMl: r.amountMl))
        .toList();
  }

  Future<int> getTodayTotal() async {
    final logs = await getTodayLogs();
    return logs.fold<int>(0, (sum, log) => sum + log.amountMl);
  }

  Future<void> addLog(int amountMl) async {
    await _db.into(_db.waterLogs).insert(
          WaterLogsCompanion.insert(amountMl: amountMl),
        );
  }

  Future<void> deleteLog(int id) async {
    await (_db.delete(_db.waterLogs)..where((t) => t.id.equals(id))).go();
  }

  Stream<int> watchTodayTotal() {
    final now = DateTime.now();
    final start = DateTime(now.year, now.month, now.day);
    final end = start.add(const Duration(days: 1));

    final query = _db.select(_db.waterLogs)
      ..where((t) => t.timestamp.isBiggerOrEqualValue(start))
      ..where((t) => t.timestamp.isSmallerThanValue(end));

    return query.watch().map(
          (rows) => rows.fold<int>(0, (sum, r) => sum + r.amountMl),
        );
  }
}
```

```dart
// apps/ozzyl_health/lib/features/water_intake/data/repositories/water_repository_impl.dart
import '../../domain/entities/water_log.dart';
import '../../domain/repositories/water_repository.dart';
import '../datasources/water_local_datasource.dart';

class WaterRepositoryImpl implements WaterRepository {
  final WaterLocalDatasource _local;

  WaterRepositoryImpl(this._local);

  @override
  Future<List<WaterLog>> getTodayLogs() => _local.getTodayLogs();

  @override
  Future<int> getTodayTotal() => _local.getTodayTotal();

  @override
  Future<void> addLog(int amountMl) => _local.addLog(amountMl);

  @override
  Future<void> deleteLog(int id) => _local.deleteLog(id);

  @override
  Stream<int> watchTodayTotal() => _local.watchTodayTotal();
}
```

- [ ] **Step 3: Write BLoC**

```dart
// apps/ozzyl_health/lib/features/water_intake/presentation/bloc/water_event.dart
import 'package:freezed_annotation/freezed_annotation.dart';

part 'water_event.freezed.dart';

@freezed
sealed class WaterEvent with _$WaterEvent {
  const factory WaterEvent.loadToday() = LoadTodayWater;
  const factory WaterEvent.addWater(int amountMl) = AddWater;
  const factory WaterEvent.deleteLog(int id) = DeleteWaterLog;
}
```

```dart
// apps/ozzyl_health/lib/features/water_intake/presentation/bloc/water_state.dart
import 'package:freezed_annotation/freezed_annotation.dart';
import '../../domain/entities/water_log.dart';

part 'water_state.freezed.dart';

@freezed
sealed class WaterState with _$WaterState {
  const factory WaterState.initial() = WaterInitial;
  const factory WaterState.loading() = WaterLoading;
  const factory WaterState.loaded({
    required List<WaterLog> logs,
    required int totalMl,
    @Default(2500) int goalMl,
  }) = WaterLoaded;
  const factory WaterState.error(String message) = WaterError;
}
```

```dart
// apps/ozzyl_health/lib/features/water_intake/presentation/bloc/water_bloc.dart
import 'package:flutter_bloc/flutter_bloc.dart';
import '../../domain/repositories/water_repository.dart';
import 'water_event.dart';
import 'water_state.dart';

class WaterBloc extends Bloc<WaterEvent, WaterState> {
  final WaterRepository _repository;

  WaterBloc(this._repository) : super(const WaterState.initial()) {
    on<LoadTodayWater>(_onLoad);
    on<AddWater>(_onAdd);
    on<DeleteWaterLog>(_onDelete);
  }

  Future<void> _onLoad(LoadTodayWater event, Emitter<WaterState> emit) async {
    emit(const WaterState.loading());
    try {
      final logs = await _repository.getTodayLogs();
      final total = await _repository.getTodayTotal();
      emit(WaterState.loaded(logs: logs, totalMl: total));
    } catch (e) {
      emit(WaterState.error(e.toString()));
    }
  }

  Future<void> _onAdd(AddWater event, Emitter<WaterState> emit) async {
    try {
      await _repository.addLog(event.amountMl);
      add(const WaterEvent.loadToday());
    } catch (e) {
      emit(WaterState.error(e.toString()));
    }
  }

  Future<void> _onDelete(DeleteWaterLog event, Emitter<WaterState> emit) async {
    try {
      await _repository.deleteLog(event.id);
      add(const WaterEvent.loadToday());
    } catch (e) {
      emit(WaterState.error(e.toString()));
    }
  }
}
```

- [ ] **Step 4: Write WaterGlass animated widget**

```dart
// apps/ozzyl_health/lib/features/water_intake/presentation/widgets/water_glass.dart
import 'package:flutter/material.dart';
import 'package:ozzyl_core/ozzyl_core.dart';

class WaterGlass extends StatelessWidget {
  final int currentMl;
  final int goalMl;

  const WaterGlass({super.key, required this.currentMl, required this.goalMl});

  @override
  Widget build(BuildContext context) {
    final percentage = (currentMl / goalMl).clamp(0.0, 1.0);

    return SizedBox(
      width: 160,
      height: 240,
      child: Stack(
        alignment: Alignment.bottomCenter,
        children: [
          Container(
            width: 120,
            height: 200,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: AppColors.waterRing, width: 3),
            ),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(17),
              child: Align(
                alignment: Alignment.bottomCenter,
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 500),
                  curve: Curves.easeInOut,
                  width: double.infinity,
                  height: 194 * percentage,
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      begin: Alignment.topCenter,
                      end: Alignment.bottomCenter,
                      colors: [
                        AppColors.waterRing.withOpacity(0.4),
                        AppColors.waterRing.withOpacity(0.8),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
          Positioned(
            bottom: 80,
            child: Column(
              children: [
                Text(
                  '${currentMl}ml',
                  style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                        color: percentage > 0.5 ? Colors.white : AppColors.textPrimary,
                        fontWeight: FontWeight.w700,
                      ),
                ),
                Text(
                  '/ ${goalMl}ml',
                  style: TextStyle(
                    color: percentage > 0.5
                        ? Colors.white70
                        : AppColors.textSecondary,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
```

- [ ] **Step 5: Write WaterIntakePage**

```dart
// apps/ozzyl_health/lib/features/water_intake/presentation/pages/water_intake_page.dart
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:ozzyl_core/ozzyl_core.dart';
import '../bloc/water_bloc.dart';
import '../bloc/water_event.dart';
import '../bloc/water_state.dart';
import '../widgets/water_glass.dart';

class WaterIntakePage extends StatelessWidget {
  const WaterIntakePage({super.key});

  static const _quickAmounts = [100, 200, 250, 500];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Water Intake')),
      body: BlocBuilder<WaterBloc, WaterState>(
        builder: (context, state) {
          final totalMl = state is WaterLoaded ? state.totalMl : 0;
          final goalMl = state is WaterLoaded ? state.goalMl : 2500;

          return SingleChildScrollView(
            padding: const EdgeInsets.all(16),
            child: Column(
              children: [
                const SizedBox(height: 16),
                Center(child: WaterGlass(currentMl: totalMl, goalMl: goalMl)),
                const SizedBox(height: 32),
                Text(
                  'Quick Add',
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                const SizedBox(height: 16),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                  children: _quickAmounts.map((ml) {
                    return _QuickAddButton(
                      amountMl: ml,
                      onTap: () {
                        context.read<WaterBloc>().add(WaterEvent.addWater(ml));
                      },
                    );
                  }).toList(),
                ),
                const SizedBox(height: 32),
                if (state is WaterLoaded && state.logs.isNotEmpty) ...[
                  Text(
                    'Today\'s Logs',
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                  const SizedBox(height: 8),
                  ...state.logs.map(
                    (log) => ListTile(
                      leading: const Icon(Icons.water_drop, color: AppColors.waterRing),
                      title: Text('${log.amountMl}ml'),
                      subtitle: Text(
                        '${log.timestamp.hour.toString().padLeft(2, '0')}:${log.timestamp.minute.toString().padLeft(2, '0')}',
                      ),
                      trailing: IconButton(
                        icon: const Icon(Icons.delete_outline, color: AppColors.error),
                        onPressed: () {
                          if (log.id != null) {
                            context
                                .read<WaterBloc>()
                                .add(WaterEvent.deleteLog(log.id!));
                          }
                        },
                      ),
                    ),
                  ),
                ],
              ],
            ),
          );
        },
      ),
    );
  }
}

class _QuickAddButton extends StatelessWidget {
  final int amountMl;
  final VoidCallback onTap;

  const _QuickAddButton({required this.amountMl, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(16),
      child: Container(
        width: 72,
        padding: const EdgeInsets.symmetric(vertical: 16),
        decoration: BoxDecoration(
          color: AppColors.waterRing.withOpacity(0.1),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: AppColors.waterRing.withOpacity(0.3)),
        ),
        child: Column(
          children: [
            const Icon(Icons.water_drop, color: AppColors.waterRing),
            const SizedBox(height: 4),
            Text(
              '${amountMl}ml',
              style: const TextStyle(
                fontWeight: FontWeight.w600,
                color: AppColors.waterRing,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
```

- [ ] **Step 6: Run code generation**

Run: `cd apps/ozzyl_health && dart run build_runner build --delete-conflicting-outputs`

- [ ] **Step 7: Commit**

```bash
git add apps/ozzyl_health/lib/features/water_intake/
git commit -m "feat(water): add water intake tracker with glass animation + quick-add buttons"
```

---

### Task 4: Wellness Dashboard (Home tab)

**Files:**
- Modify: `apps/ozzyl_health/lib/features/wellness_dashboard/presentation/pages/home_page.dart`
- Create: `apps/ozzyl_health/lib/features/wellness_dashboard/presentation/widgets/wellness_rings.dart`
- Create: `apps/ozzyl_health/lib/features/wellness_dashboard/presentation/widgets/quick_actions.dart`
- Create: `apps/ozzyl_health/lib/features/wellness_dashboard/presentation/widgets/streak_card.dart`

- [ ] **Step 1: Write WellnessRings widget**

```dart
// apps/ozzyl_health/lib/features/wellness_dashboard/presentation/widgets/wellness_rings.dart
import 'dart:math';
import 'package:flutter/material.dart';
import 'package:ozzyl_core/ozzyl_core.dart';

class WellnessRings extends StatelessWidget {
  final double stepsProgress;
  final double waterProgress;
  final double moodProgress;

  const WellnessRings({
    super.key,
    required this.stepsProgress,
    required this.waterProgress,
    required this.moodProgress,
  });

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 200,
      height: 200,
      child: CustomPaint(
        painter: _RingsPainter(
          stepsProgress: stepsProgress.clamp(0.0, 1.0),
          waterProgress: waterProgress.clamp(0.0, 1.0),
          moodProgress: moodProgress.clamp(0.0, 1.0),
        ),
        child: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                '${((stepsProgress + waterProgress + moodProgress) / 3 * 100).round()}%',
                style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                      fontWeight: FontWeight.w800,
                    ),
              ),
              Text(
                'Wellness',
                style: Theme.of(context).textTheme.bodyMedium,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _RingsPainter extends CustomPainter {
  final double stepsProgress;
  final double waterProgress;
  final double moodProgress;

  _RingsPainter({
    required this.stepsProgress,
    required this.waterProgress,
    required this.moodProgress,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    const strokeWidth = 12.0;
    const startAngle = -pi / 2;

    _drawRing(canvas, center, 90, strokeWidth, AppColors.stepsRing, stepsProgress, startAngle);
    _drawRing(canvas, center, 72, strokeWidth, AppColors.waterRing, waterProgress, startAngle);
    _drawRing(canvas, center, 54, strokeWidth, AppColors.moodRing, moodProgress, startAngle);
  }

  void _drawRing(
    Canvas canvas,
    Offset center,
    double radius,
    double strokeWidth,
    Color color,
    double progress,
    double startAngle,
  ) {
    final bgPaint = Paint()
      ..color = color.withOpacity(0.15)
      ..strokeWidth = strokeWidth
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round;

    final fgPaint = Paint()
      ..color = color
      ..strokeWidth = strokeWidth
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round;

    canvas.drawCircle(center, radius, bgPaint);
    canvas.drawArc(
      Rect.fromCircle(center: center, radius: radius),
      startAngle,
      2 * pi * progress,
      false,
      fgPaint,
    );
  }

  @override
  bool shouldRepaint(covariant _RingsPainter old) =>
      old.stepsProgress != stepsProgress ||
      old.waterProgress != waterProgress ||
      old.moodProgress != moodProgress;
}
```

- [ ] **Step 2: Write QuickActions widget**

```dart
// apps/ozzyl_health/lib/features/wellness_dashboard/presentation/widgets/quick_actions.dart
import 'package:flutter/material.dart';
import 'package:ozzyl_core/ozzyl_core.dart';

class QuickActions extends StatelessWidget {
  final VoidCallback onLogMood;
  final VoidCallback onLogWater;
  final VoidCallback onLogExercise;

  const QuickActions({
    super.key,
    required this.onLogMood,
    required this.onLogWater,
    required this.onLogExercise,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceEvenly,
      children: [
        _ActionButton(
          icon: Icons.mood,
          label: 'Mood',
          color: AppColors.moodRing,
          onTap: onLogMood,
        ),
        _ActionButton(
          icon: Icons.water_drop,
          label: 'Water',
          color: AppColors.waterRing,
          onTap: onLogWater,
        ),
        _ActionButton(
          icon: Icons.fitness_center,
          label: 'Exercise',
          color: AppColors.stepsRing,
          onTap: onLogExercise,
        ),
      ],
    );
  }
}

class _ActionButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final Color color;
  final VoidCallback onTap;

  const _ActionButton({
    required this.icon,
    required this.label,
    required this.color,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(16),
      child: Container(
        width: 96,
        padding: const EdgeInsets.symmetric(vertical: 16),
        decoration: BoxDecoration(
          color: color.withOpacity(0.1),
          borderRadius: BorderRadius.circular(16),
        ),
        child: Column(
          children: [
            Icon(icon, color: color, size: 32),
            const SizedBox(height: 8),
            Text(label, style: TextStyle(color: color, fontWeight: FontWeight.w600)),
          ],
        ),
      ),
    );
  }
}
```

- [ ] **Step 3: Write StreakCard widget**

```dart
// apps/ozzyl_health/lib/features/wellness_dashboard/presentation/widgets/streak_card.dart
import 'package:flutter/material.dart';
import 'package:ozzyl_core/ozzyl_core.dart';

class StreakCard extends StatelessWidget {
  final int streakDays;

  const StreakCard({super.key, required this.streakDays});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        gradient: AppColors.warmGradient,
        borderRadius: BorderRadius.circular(16),
      ),
      child: Row(
        children: [
          const Icon(Icons.local_fire_department, color: Colors.white, size: 40),
          const SizedBox(width: 16),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                '$streakDays day streak!',
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 20,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const Text(
                'Keep it going!',
                style: TextStyle(color: Colors.white70, fontSize: 14),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
```

- [ ] **Step 4: Update HomePage with dashboard**

```dart
// apps/ozzyl_health/lib/features/wellness_dashboard/presentation/pages/home_page.dart
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:ozzyl_core/ozzyl_core.dart';
import '../widgets/wellness_rings.dart';
import '../widgets/quick_actions.dart';
import '../widgets/streak_card.dart';

class HomePage extends StatelessWidget {
  const HomePage({super.key});

  @override
  Widget build(BuildContext context) {
    final hour = DateTime.now().hour;
    final greeting = hour < 12
        ? 'Good Morning'
        : hour < 17
            ? 'Good Afternoon'
            : 'Good Evening';

    return Scaffold(
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                greeting,
                style: Theme.of(context).textTheme.headlineMedium,
              ),
              const SizedBox(height: 4),
              Text(
                "Let's check your wellness today",
                style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                      color: AppColors.textSecondary,
                    ),
              ),
              const SizedBox(height: 24),

              // Wellness rings
              const Center(
                child: WellnessRings(
                  stepsProgress: 0.0,
                  waterProgress: 0.0,
                  moodProgress: 0.0,
                ),
              ),
              const SizedBox(height: 8),
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  _RingLegend(color: AppColors.stepsRing, label: 'Steps'),
                  const SizedBox(width: 16),
                  _RingLegend(color: AppColors.waterRing, label: 'Water'),
                  const SizedBox(width: 16),
                  _RingLegend(color: AppColors.moodRing, label: 'Mood'),
                ],
              ),
              const SizedBox(height: 32),

              // Quick actions
              QuickActions(
                onLogMood: () => context.push('/wellness/mood'),
                onLogWater: () => context.push('/wellness/water'),
                onLogExercise: () => context.push('/wellness/exercise'),
              ),
              const SizedBox(height: 24),

              // Streak
              const StreakCard(streakDays: 0),
              const SizedBox(height: 24),

              // Health goals placeholder
              Text(
                'Health Goals',
                style: Theme.of(context).textTheme.titleLarge,
              ),
              const SizedBox(height: 8),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Center(
                    child: Column(
                      children: [
                        Icon(Icons.flag_outlined,
                            size: 48, color: AppColors.textSecondary),
                        const SizedBox(height: 8),
                        const Text('No goals set yet'),
                        const SizedBox(height: 8),
                        TextButton(
                          onPressed: () {},
                          child: const Text('Set a goal'),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _RingLegend extends StatelessWidget {
  final Color color;
  final String label;
  const _RingLegend({required this.color, required this.label});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Container(width: 10, height: 10, decoration: BoxDecoration(color: color, shape: BoxShape.circle)),
        const SizedBox(width: 4),
        Text(label, style: Theme.of(context).textTheme.bodyMedium),
      ],
    );
  }
}
```

- [ ] **Step 5: Add wellness sub-routes to router**

Update the wellness branch in `app_router.dart`:
```dart
import '../../features/mood_tracker/presentation/pages/mood_tracker_page.dart';
import '../../features/water_intake/presentation/pages/water_intake_page.dart';

// Inside the wellness StatefulShellBranch:
StatefulShellBranch(
  routes: [
    GoRoute(
      path: '/wellness',
      builder: (context, state) => const WellnessPage(),
      routes: [
        GoRoute(
          path: 'mood',
          builder: (context, state) => const MoodTrackerPage(),
        ),
        GoRoute(
          path: 'water',
          builder: (context, state) => const WaterIntakePage(),
        ),
      ],
    ),
  ],
),
```

- [ ] **Step 6: Commit**

```bash
git add apps/ozzyl_health/
git commit -m "feat(dashboard): add wellness rings, quick actions, streak card, sub-routes"
```

---

## Plan 2A Complete

After Plan 2A, you have:
- Wellness dashboard with animated rings, quick actions, streak card
- Mood tracker (5-level selector, trend chart, notes)
- Water intake tracker (glass animation, quick-add buttons, daily log)
- All offline-first via Drift WellnessDatabase
- Routes wired: `/wellness/mood`, `/wellness/water`

**Next:** Plan 2B — Sleep, Exercise, Health Goals, Steps, Gamification
