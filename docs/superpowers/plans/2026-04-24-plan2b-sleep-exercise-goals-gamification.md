# Plan 2B: Sleep, Exercise, Steps, Health Goals, Gamification

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete the wellness tracking suite — sleep log, exercise log, step counter, health goals, and gamification (streaks, badges, wellness score)

**Architecture:** Each feature follows Clean Architecture with offline-first Drift storage. Gamification is a cross-cutting service.

**Tech Stack:** flutter_bloc, drift, fl_chart, pedometer ^4.0.0

**Depends on:** Plan 1 + Plan 2A completed

---

### Task 1: Sleep Log — full feature

**Files:**
- Create: `apps/ozzyl_health/lib/features/sleep_log/domain/entities/sleep_entry.dart`
- Create: `apps/ozzyl_health/lib/features/sleep_log/domain/repositories/sleep_repository.dart`
- Create: `apps/ozzyl_health/lib/features/sleep_log/data/datasources/sleep_local_datasource.dart`
- Create: `apps/ozzyl_health/lib/features/sleep_log/data/repositories/sleep_repository_impl.dart`
- Create: `apps/ozzyl_health/lib/features/sleep_log/presentation/bloc/sleep_bloc.dart`
- Create: `apps/ozzyl_health/lib/features/sleep_log/presentation/bloc/sleep_event.dart`
- Create: `apps/ozzyl_health/lib/features/sleep_log/presentation/bloc/sleep_state.dart`
- Create: `apps/ozzyl_health/lib/features/sleep_log/presentation/pages/sleep_log_page.dart`
- Create: `apps/ozzyl_health/lib/features/sleep_log/presentation/widgets/sleep_chart.dart`

- [ ] **Step 1: Write domain layer**

```dart
// apps/ozzyl_health/lib/features/sleep_log/domain/entities/sleep_entry.dart
class SleepEntry {
  final int? id;
  final DateTime date;
  final DateTime bedtime;
  final DateTime wakeTime;
  final int? quality;

  const SleepEntry({
    this.id,
    required this.date,
    required this.bedtime,
    required this.wakeTime,
    this.quality,
  });

  Duration get duration => wakeTime.difference(bedtime);
  double get hours => duration.inMinutes / 60.0;
}
```

```dart
// apps/ozzyl_health/lib/features/sleep_log/domain/repositories/sleep_repository.dart
import '../entities/sleep_entry.dart';

abstract class SleepRepository {
  Future<List<SleepEntry>> getEntries({int limit = 7});
  Future<SleepEntry?> getLastNight();
  Future<void> addEntry(SleepEntry entry);
  Future<void> deleteEntry(int id);
  Future<double> getAverageHours({int days = 7});
}
```

- [ ] **Step 2: Write data layer**

```dart
// apps/ozzyl_health/lib/features/sleep_log/data/datasources/sleep_local_datasource.dart
import 'package:drift/drift.dart';
import '../../../../core/database/wellness_database.dart';
import '../../domain/entities/sleep_entry.dart';

class SleepLocalDatasource {
  final WellnessDatabase _db;

  SleepLocalDatasource(this._db);

  Future<List<SleepEntry>> getEntries({int limit = 7}) async {
    final query = _db.select(_db.sleepLogs)
      ..orderBy([(t) => OrderingTerm.desc(t.date)])
      ..limit(limit);

    final rows = await query.get();
    return rows.map(_toEntity).toList();
  }

  Future<SleepEntry?> getLastNight() async {
    final query = _db.select(_db.sleepLogs)
      ..orderBy([(t) => OrderingTerm.desc(t.date)])
      ..limit(1);
    final row = await query.getSingleOrNull();
    return row != null ? _toEntity(row) : null;
  }

  Future<void> addEntry(SleepEntry entry) async {
    await _db.into(_db.sleepLogs).insert(
          SleepLogsCompanion.insert(
            date: entry.date,
            bedtime: entry.bedtime,
            wakeTime: entry.wakeTime,
            quality: Value(entry.quality),
          ),
        );
  }

  Future<void> deleteEntry(int id) async {
    await (_db.delete(_db.sleepLogs)..where((t) => t.id.equals(id))).go();
  }

  Future<double> getAverageHours({int days = 7}) async {
    final entries = await getEntries(limit: days);
    if (entries.isEmpty) return 0;
    final totalHours = entries.fold<double>(0, (sum, e) => sum + e.hours);
    return totalHours / entries.length;
  }

  SleepEntry _toEntity(SleepLog row) {
    return SleepEntry(
      id: row.id,
      date: row.date,
      bedtime: row.bedtime,
      wakeTime: row.wakeTime,
      quality: row.quality,
    );
  }
}
```

```dart
// apps/ozzyl_health/lib/features/sleep_log/data/repositories/sleep_repository_impl.dart
import '../../domain/entities/sleep_entry.dart';
import '../../domain/repositories/sleep_repository.dart';
import '../datasources/sleep_local_datasource.dart';

class SleepRepositoryImpl implements SleepRepository {
  final SleepLocalDatasource _local;
  SleepRepositoryImpl(this._local);

  @override
  Future<List<SleepEntry>> getEntries({int limit = 7}) => _local.getEntries(limit: limit);
  @override
  Future<SleepEntry?> getLastNight() => _local.getLastNight();
  @override
  Future<void> addEntry(SleepEntry entry) => _local.addEntry(entry);
  @override
  Future<void> deleteEntry(int id) => _local.deleteEntry(id);
  @override
  Future<double> getAverageHours({int days = 7}) => _local.getAverageHours(days: days);
}
```

- [ ] **Step 3: Write BLoC (events + states + bloc)**

```dart
// apps/ozzyl_health/lib/features/sleep_log/presentation/bloc/sleep_event.dart
import 'package:freezed_annotation/freezed_annotation.dart';
part 'sleep_event.freezed.dart';

@freezed
sealed class SleepEvent with _$SleepEvent {
  const factory SleepEvent.load() = LoadSleep;
  const factory SleepEvent.add({
    required DateTime bedtime,
    required DateTime wakeTime,
    int? quality,
  }) = AddSleep;
  const factory SleepEvent.delete(int id) = DeleteSleep;
}
```

```dart
// apps/ozzyl_health/lib/features/sleep_log/presentation/bloc/sleep_state.dart
import 'package:freezed_annotation/freezed_annotation.dart';
import '../../domain/entities/sleep_entry.dart';
part 'sleep_state.freezed.dart';

@freezed
sealed class SleepState with _$SleepState {
  const factory SleepState.initial() = SleepInitial;
  const factory SleepState.loading() = SleepLoading;
  const factory SleepState.loaded({
    required List<SleepEntry> entries,
    required double avgHours,
  }) = SleepLoaded;
  const factory SleepState.error(String message) = SleepError;
}
```

```dart
// apps/ozzyl_health/lib/features/sleep_log/presentation/bloc/sleep_bloc.dart
import 'package:flutter_bloc/flutter_bloc.dart';
import '../../domain/entities/sleep_entry.dart';
import '../../domain/repositories/sleep_repository.dart';
import 'sleep_event.dart';
import 'sleep_state.dart';

class SleepBloc extends Bloc<SleepEvent, SleepState> {
  final SleepRepository _repository;

  SleepBloc(this._repository) : super(const SleepState.initial()) {
    on<LoadSleep>(_onLoad);
    on<AddSleep>(_onAdd);
    on<DeleteSleep>(_onDelete);
  }

  Future<void> _onLoad(LoadSleep event, Emitter<SleepState> emit) async {
    emit(const SleepState.loading());
    try {
      final entries = await _repository.getEntries();
      final avg = await _repository.getAverageHours();
      emit(SleepState.loaded(entries: entries, avgHours: avg));
    } catch (e) {
      emit(SleepState.error(e.toString()));
    }
  }

  Future<void> _onAdd(AddSleep event, Emitter<SleepState> emit) async {
    try {
      await _repository.addEntry(SleepEntry(
        date: DateTime.now(),
        bedtime: event.bedtime,
        wakeTime: event.wakeTime,
        quality: event.quality,
      ));
      add(const SleepEvent.load());
    } catch (e) {
      emit(SleepState.error(e.toString()));
    }
  }

  Future<void> _onDelete(DeleteSleep event, Emitter<SleepState> emit) async {
    try {
      await _repository.deleteEntry(event.id);
      add(const SleepEvent.load());
    } catch (e) {
      emit(SleepState.error(e.toString()));
    }
  }
}
```

- [ ] **Step 4: Write SleepChart widget**

```dart
// apps/ozzyl_health/lib/features/sleep_log/presentation/widgets/sleep_chart.dart
import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:ozzyl_core/ozzyl_core.dart';
import '../../domain/entities/sleep_entry.dart';

class SleepChart extends StatelessWidget {
  final List<SleepEntry> entries;
  const SleepChart({super.key, required this.entries});

  @override
  Widget build(BuildContext context) {
    if (entries.isEmpty) {
      return const SizedBox(height: 200, child: Center(child: Text('No sleep data yet')));
    }

    final bars = entries.reversed.toList().asMap().entries.map((e) {
      final hours = e.value.hours;
      return BarChartGroupData(
        x: e.key,
        barRods: [
          BarChartRodData(
            toY: hours,
            color: hours >= 7 ? AppColors.success : hours >= 5 ? AppColors.warning : AppColors.error,
            width: 20,
            borderRadius: const BorderRadius.vertical(top: Radius.circular(6)),
          ),
        ],
      );
    }).toList();

    return SizedBox(
      height: 200,
      child: BarChart(
        BarChartData(
          barGroups: bars,
          gridData: const FlGridData(show: false),
          titlesData: const FlTitlesData(show: false),
          borderData: FlBorderData(show: false),
          maxY: 12,
        ),
      ),
    );
  }
}
```

- [ ] **Step 5: Write SleepLogPage**

```dart
// apps/ozzyl_health/lib/features/sleep_log/presentation/pages/sleep_log_page.dart
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:ozzyl_core/ozzyl_core.dart';
import '../bloc/sleep_bloc.dart';
import '../bloc/sleep_event.dart';
import '../bloc/sleep_state.dart';
import '../widgets/sleep_chart.dart';

class SleepLogPage extends StatefulWidget {
  const SleepLogPage({super.key});

  @override
  State<SleepLogPage> createState() => _SleepLogPageState();
}

class _SleepLogPageState extends State<SleepLogPage> {
  TimeOfDay _bedtime = const TimeOfDay(hour: 23, minute: 0);
  TimeOfDay _wakeTime = const TimeOfDay(hour: 7, minute: 0);
  int _quality = 3;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Sleep Log')),
      body: BlocBuilder<SleepBloc, SleepState>(
        builder: (context, state) {
          return SingleChildScrollView(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (state is SleepLoaded) ...[
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        children: [
                          Text('Avg ${state.avgHours.toStringAsFixed(1)} hrs/night',
                            style: Theme.of(context).textTheme.headlineMedium),
                          const SizedBox(height: 4),
                          Text('Last 7 nights', style: Theme.of(context).textTheme.bodyMedium),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 16),
                  SleepChart(entries: state.entries),
                  const SizedBox(height: 24),
                ],
                Text('Log Last Night', style: Theme.of(context).textTheme.titleLarge),
                const SizedBox(height: 16),
                Row(
                  children: [
                    Expanded(
                      child: _TimePickerTile(
                        label: 'Bedtime',
                        time: _bedtime,
                        icon: Icons.bedtime_outlined,
                        onTap: () async {
                          final t = await showTimePicker(context: context, initialTime: _bedtime);
                          if (t != null) setState(() => _bedtime = t);
                        },
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: _TimePickerTile(
                        label: 'Wake up',
                        time: _wakeTime,
                        icon: Icons.alarm,
                        onTap: () async {
                          final t = await showTimePicker(context: context, initialTime: _wakeTime);
                          if (t != null) setState(() => _wakeTime = t);
                        },
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                Text('Sleep Quality', style: Theme.of(context).textTheme.titleMedium),
                Slider(
                  value: _quality.toDouble(),
                  min: 1, max: 5, divisions: 4,
                  label: ['', 'Poor', 'Fair', 'Good', 'Great', 'Excellent'][_quality],
                  onChanged: (v) => setState(() => _quality = v.round()),
                ),
                const SizedBox(height: 16),
                ElevatedButton(
                  onPressed: () {
                    final now = DateTime.now();
                    final yesterday = now.subtract(const Duration(days: 1));
                    final bedtime = DateTime(yesterday.year, yesterday.month, yesterday.day, _bedtime.hour, _bedtime.minute);
                    final wakeTime = DateTime(now.year, now.month, now.day, _wakeTime.hour, _wakeTime.minute);
                    context.read<SleepBloc>().add(SleepEvent.add(
                      bedtime: bedtime, wakeTime: wakeTime, quality: _quality,
                    ));
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(content: Text('Sleep logged!'), backgroundColor: AppColors.success),
                    );
                  },
                  child: const Text('Save Sleep'),
                ),
              ],
            ),
          );
        },
      ),
    );
  }
}

class _TimePickerTile extends StatelessWidget {
  final String label;
  final TimeOfDay time;
  final IconData icon;
  final VoidCallback onTap;
  const _TimePickerTile({required this.label, required this.time, required this.icon, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          border: Border.all(color: AppColors.divider),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Column(
          children: [
            Icon(icon, color: AppColors.primary),
            const SizedBox(height: 8),
            Text(label, style: Theme.of(context).textTheme.bodyMedium),
            Text(time.format(context), style: Theme.of(context).textTheme.titleLarge),
          ],
        ),
      ),
    );
  }
}
```

- [ ] **Step 6: Run code gen + commit**

```bash
cd apps/ozzyl_health && dart run build_runner build --delete-conflicting-outputs
git add apps/ozzyl_health/lib/features/sleep_log/
git commit -m "feat(sleep): add sleep log with bar chart, time pickers, quality slider"
```

---

### Task 2: Exercise Log — full feature

**Files:**
- Create: `apps/ozzyl_health/lib/features/fitness/domain/entities/exercise_entry.dart`
- Create: `apps/ozzyl_health/lib/features/fitness/domain/repositories/exercise_repository.dart`
- Create: `apps/ozzyl_health/lib/features/fitness/data/datasources/exercise_local_datasource.dart`
- Create: `apps/ozzyl_health/lib/features/fitness/data/repositories/exercise_repository_impl.dart`
- Create: `apps/ozzyl_health/lib/features/fitness/presentation/bloc/exercise_bloc.dart`
- Create: `apps/ozzyl_health/lib/features/fitness/presentation/bloc/exercise_event.dart`
- Create: `apps/ozzyl_health/lib/features/fitness/presentation/bloc/exercise_state.dart`
- Create: `apps/ozzyl_health/lib/features/fitness/presentation/pages/exercise_log_page.dart`

- [ ] **Step 1: Write domain + data layers**

```dart
// apps/ozzyl_health/lib/features/fitness/domain/entities/exercise_entry.dart
class ExerciseEntry {
  final int? id;
  final DateTime timestamp;
  final String type;
  final int durationMin;
  final int? calories;

  const ExerciseEntry({
    this.id,
    required this.timestamp,
    required this.type,
    required this.durationMin,
    this.calories,
  });
}
```

```dart
// apps/ozzyl_health/lib/features/fitness/domain/repositories/exercise_repository.dart
import '../entities/exercise_entry.dart';

abstract class ExerciseRepository {
  Future<List<ExerciseEntry>> getTodayEntries();
  Future<List<ExerciseEntry>> getEntries({int limit = 14});
  Future<void> addEntry(ExerciseEntry entry);
  Future<void> deleteEntry(int id);
  Future<int> getTodayDuration();
}
```

```dart
// apps/ozzyl_health/lib/features/fitness/data/datasources/exercise_local_datasource.dart
import 'package:drift/drift.dart';
import '../../../../core/database/wellness_database.dart';
import '../../domain/entities/exercise_entry.dart';

class ExerciseLocalDatasource {
  final WellnessDatabase _db;
  ExerciseLocalDatasource(this._db);

  Future<List<ExerciseEntry>> getTodayEntries() async {
    final now = DateTime.now();
    final start = DateTime(now.year, now.month, now.day);
    final end = start.add(const Duration(days: 1));
    final query = _db.select(_db.exerciseLogs)
      ..where((t) => t.timestamp.isBiggerOrEqualValue(start))
      ..where((t) => t.timestamp.isSmallerThanValue(end))
      ..orderBy([(t) => OrderingTerm.desc(t.timestamp)]);
    final rows = await query.get();
    return rows.map(_toEntity).toList();
  }

  Future<List<ExerciseEntry>> getEntries({int limit = 14}) async {
    final query = _db.select(_db.exerciseLogs)
      ..orderBy([(t) => OrderingTerm.desc(t.timestamp)])
      ..limit(limit);
    final rows = await query.get();
    return rows.map(_toEntity).toList();
  }

  Future<void> addEntry(ExerciseEntry entry) async {
    await _db.into(_db.exerciseLogs).insert(ExerciseLogsCompanion.insert(
      type: entry.type,
      durationMin: entry.durationMin,
      calories: Value(entry.calories),
    ));
  }

  Future<void> deleteEntry(int id) async {
    await (_db.delete(_db.exerciseLogs)..where((t) => t.id.equals(id))).go();
  }

  Future<int> getTodayDuration() async {
    final entries = await getTodayEntries();
    return entries.fold<int>(0, (sum, e) => sum + e.durationMin);
  }

  ExerciseEntry _toEntity(ExerciseLog row) {
    return ExerciseEntry(
      id: row.id, timestamp: row.timestamp, type: row.type,
      durationMin: row.durationMin, calories: row.calories,
    );
  }
}
```

```dart
// apps/ozzyl_health/lib/features/fitness/data/repositories/exercise_repository_impl.dart
import '../../domain/entities/exercise_entry.dart';
import '../../domain/repositories/exercise_repository.dart';
import '../datasources/exercise_local_datasource.dart';

class ExerciseRepositoryImpl implements ExerciseRepository {
  final ExerciseLocalDatasource _local;
  ExerciseRepositoryImpl(this._local);

  @override
  Future<List<ExerciseEntry>> getTodayEntries() => _local.getTodayEntries();
  @override
  Future<List<ExerciseEntry>> getEntries({int limit = 14}) => _local.getEntries(limit: limit);
  @override
  Future<void> addEntry(ExerciseEntry entry) => _local.addEntry(entry);
  @override
  Future<void> deleteEntry(int id) => _local.deleteEntry(id);
  @override
  Future<int> getTodayDuration() => _local.getTodayDuration();
}
```

- [ ] **Step 2: Write BLoC**

```dart
// apps/ozzyl_health/lib/features/fitness/presentation/bloc/exercise_event.dart
import 'package:freezed_annotation/freezed_annotation.dart';
part 'exercise_event.freezed.dart';

@freezed
sealed class ExerciseEvent with _$ExerciseEvent {
  const factory ExerciseEvent.load() = LoadExercise;
  const factory ExerciseEvent.add({
    required String type,
    required int durationMin,
    int? calories,
  }) = AddExercise;
  const factory ExerciseEvent.delete(int id) = DeleteExercise;
}
```

```dart
// apps/ozzyl_health/lib/features/fitness/presentation/bloc/exercise_state.dart
import 'package:freezed_annotation/freezed_annotation.dart';
import '../../domain/entities/exercise_entry.dart';
part 'exercise_state.freezed.dart';

@freezed
sealed class ExerciseState with _$ExerciseState {
  const factory ExerciseState.initial() = ExerciseInitial;
  const factory ExerciseState.loading() = ExerciseLoading;
  const factory ExerciseState.loaded({
    required List<ExerciseEntry> entries,
    required int todayMinutes,
  }) = ExerciseLoaded;
  const factory ExerciseState.error(String message) = ExerciseError;
}
```

```dart
// apps/ozzyl_health/lib/features/fitness/presentation/bloc/exercise_bloc.dart
import 'package:flutter_bloc/flutter_bloc.dart';
import '../../domain/entities/exercise_entry.dart';
import '../../domain/repositories/exercise_repository.dart';
import 'exercise_event.dart';
import 'exercise_state.dart';

class ExerciseBloc extends Bloc<ExerciseEvent, ExerciseState> {
  final ExerciseRepository _repository;
  ExerciseBloc(this._repository) : super(const ExerciseState.initial()) {
    on<LoadExercise>(_onLoad);
    on<AddExercise>(_onAdd);
    on<DeleteExercise>(_onDelete);
  }

  Future<void> _onLoad(LoadExercise event, Emitter<ExerciseState> emit) async {
    emit(const ExerciseState.loading());
    try {
      final entries = await _repository.getTodayEntries();
      final mins = await _repository.getTodayDuration();
      emit(ExerciseState.loaded(entries: entries, todayMinutes: mins));
    } catch (e) {
      emit(ExerciseState.error(e.toString()));
    }
  }

  Future<void> _onAdd(AddExercise event, Emitter<ExerciseState> emit) async {
    try {
      await _repository.addEntry(ExerciseEntry(
        timestamp: DateTime.now(), type: event.type,
        durationMin: event.durationMin, calories: event.calories,
      ));
      add(const ExerciseEvent.load());
    } catch (e) {
      emit(ExerciseState.error(e.toString()));
    }
  }

  Future<void> _onDelete(DeleteExercise event, Emitter<ExerciseState> emit) async {
    try {
      await _repository.deleteEntry(event.id);
      add(const ExerciseEvent.load());
    } catch (e) {
      emit(ExerciseState.error(e.toString()));
    }
  }
}
```

- [ ] **Step 3: Write ExerciseLogPage**

```dart
// apps/ozzyl_health/lib/features/fitness/presentation/pages/exercise_log_page.dart
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:ozzyl_core/ozzyl_core.dart';
import '../bloc/exercise_bloc.dart';
import '../bloc/exercise_event.dart';
import '../bloc/exercise_state.dart';

class ExerciseLogPage extends StatefulWidget {
  const ExerciseLogPage({super.key});
  @override
  State<ExerciseLogPage> createState() => _ExerciseLogPageState();
}

class _ExerciseLogPageState extends State<ExerciseLogPage> {
  String _selectedType = 'Walking';
  int _duration = 30;

  static const _exerciseTypes = [
    ('Walking', Icons.directions_walk),
    ('Running', Icons.directions_run),
    ('Cycling', Icons.directions_bike),
    ('Swimming', Icons.pool),
    ('Yoga', Icons.self_improvement),
    ('Gym', Icons.fitness_center),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Exercise Log')),
      body: BlocBuilder<ExerciseBloc, ExerciseState>(
        builder: (context, state) {
          final todayMin = state is ExerciseLoaded ? state.todayMinutes : 0;
          return SingleChildScrollView(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(20),
                    child: Column(
                      children: [
                        Text('$todayMin min', style: Theme.of(context).textTheme.displayLarge?.copyWith(color: AppColors.stepsRing)),
                        const Text('exercised today'),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 24),
                Text('Activity Type', style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 12),
                Wrap(
                  spacing: 8, runSpacing: 8,
                  children: _exerciseTypes.map((e) {
                    final (name, icon) = e;
                    final selected = _selectedType == name;
                    return ChoiceChip(
                      avatar: Icon(icon, size: 18),
                      label: Text(name),
                      selected: selected,
                      selectedColor: AppColors.stepsRing.withOpacity(0.2),
                      onSelected: (_) => setState(() => _selectedType = name),
                    );
                  }).toList(),
                ),
                const SizedBox(height: 24),
                Text('Duration: $_duration min', style: Theme.of(context).textTheme.titleMedium),
                Slider(
                  value: _duration.toDouble(), min: 5, max: 120, divisions: 23,
                  label: '$_duration min',
                  onChanged: (v) => setState(() => _duration = v.round()),
                ),
                const SizedBox(height: 16),
                ElevatedButton(
                  onPressed: () {
                    context.read<ExerciseBloc>().add(ExerciseEvent.add(
                      type: _selectedType, durationMin: _duration,
                    ));
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(content: Text('Exercise logged!'), backgroundColor: AppColors.success),
                    );
                  },
                  child: const Text('Log Exercise'),
                ),
                const SizedBox(height: 24),
                if (state is ExerciseLoaded && state.entries.isNotEmpty) ...[
                  Text('Today\'s Activities', style: Theme.of(context).textTheme.titleLarge),
                  const SizedBox(height: 8),
                  ...state.entries.map((e) => ListTile(
                    leading: const Icon(Icons.fitness_center, color: AppColors.stepsRing),
                    title: Text(e.type),
                    subtitle: Text('${e.durationMin} min'),
                    trailing: IconButton(
                      icon: const Icon(Icons.delete_outline, color: AppColors.error),
                      onPressed: () {
                        if (e.id != null) context.read<ExerciseBloc>().add(ExerciseEvent.delete(e.id!));
                      },
                    ),
                  )),
                ],
              ],
            ),
          );
        },
      ),
    );
  }
}
```

- [ ] **Step 4: Run code gen + commit**

```bash
cd apps/ozzyl_health && dart run build_runner build --delete-conflicting-outputs
git add apps/ozzyl_health/lib/features/fitness/
git commit -m "feat(exercise): add exercise log with activity types, duration slider, daily total"
```

---

### Task 3: Daily Steps (pedometer)

**Files:**
- Create: `apps/ozzyl_health/lib/features/fitness/data/datasources/steps_datasource.dart`
- Create: `apps/ozzyl_health/lib/features/fitness/presentation/widgets/step_counter.dart`

- [ ] **Step 1: Write steps datasource**

```dart
// apps/ozzyl_health/lib/features/fitness/data/datasources/steps_datasource.dart
import 'dart:async';
import 'package:drift/drift.dart';
import 'package:pedometer/pedometer.dart';
import '../../../../core/database/wellness_database.dart';

class StepsDatasource {
  final WellnessDatabase _db;
  StreamSubscription<StepCount>? _subscription;

  StepsDatasource(this._db);

  void startListening() {
    _subscription = Pedometer.stepCountStream.listen((event) async {
      final now = DateTime.now();
      final today = DateTime(now.year, now.month, now.day);

      final existing = await (_db.select(_db.dailySteps)
            ..where((t) => t.date.equals(today)))
          .getSingleOrNull();

      if (existing != null) {
        await (_db.update(_db.dailySteps)..where((t) => t.id.equals(existing.id)))
            .write(DailyStepsCompanion(count: Value(event.steps)));
      } else {
        await _db.into(_db.dailySteps).insert(
              DailyStepsCompanion.insert(date: today, count: event.steps),
            );
      }
    });
  }

  Future<int> getTodaySteps() async {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final row = await (_db.select(_db.dailySteps)
          ..where((t) => t.date.equals(today)))
        .getSingleOrNull();
    return row?.count ?? 0;
  }

  void dispose() {
    _subscription?.cancel();
  }
}
```

- [ ] **Step 2: Write StepCounter widget**

```dart
// apps/ozzyl_health/lib/features/fitness/presentation/widgets/step_counter.dart
import 'package:flutter/material.dart';
import 'package:ozzyl_core/ozzyl_core.dart';

class StepCounter extends StatelessWidget {
  final int steps;
  final int goal;

  const StepCounter({super.key, required this.steps, this.goal = 10000});

  @override
  Widget build(BuildContext context) {
    final progress = (steps / goal).clamp(0.0, 1.0);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Row(
          children: [
            SizedBox(
              width: 56, height: 56,
              child: CircularProgressIndicator(
                value: progress,
                strokeWidth: 6,
                backgroundColor: AppColors.stepsRing.withOpacity(0.2),
                color: AppColors.stepsRing,
              ),
            ),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('$steps', style: Theme.of(context).textTheme.headlineMedium?.copyWith(fontWeight: FontWeight.w700)),
                  Text('/ $goal steps', style: Theme.of(context).textTheme.bodyMedium),
                ],
              ),
            ),
            Icon(Icons.directions_walk, color: AppColors.stepsRing, size: 32),
          ],
        ),
      ),
    );
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/ozzyl_health/lib/features/fitness/
git commit -m "feat(steps): add pedometer step counter with daily tracking"
```

---

### Task 4: Health Goals — full feature

**Files:**
- Create: `apps/ozzyl_health/lib/features/health_goals/domain/entities/health_goal.dart`
- Create: `apps/ozzyl_health/lib/features/health_goals/domain/repositories/goals_repository.dart`
- Create: `apps/ozzyl_health/lib/features/health_goals/data/datasources/goals_local_datasource.dart`
- Create: `apps/ozzyl_health/lib/features/health_goals/data/repositories/goals_repository_impl.dart`
- Create: `apps/ozzyl_health/lib/features/health_goals/presentation/bloc/goals_bloc.dart`
- Create: `apps/ozzyl_health/lib/features/health_goals/presentation/bloc/goals_event.dart`
- Create: `apps/ozzyl_health/lib/features/health_goals/presentation/bloc/goals_state.dart`
- Create: `apps/ozzyl_health/lib/features/health_goals/presentation/pages/health_goals_page.dart`

- [ ] **Step 1: Write domain + data layers (same pattern)**

```dart
// apps/ozzyl_health/lib/features/health_goals/domain/entities/health_goal.dart
class HealthGoal {
  final int? id;
  final String title;
  final double target;
  final double current;
  final String unit;
  final DateTime? deadline;
  final bool active;

  const HealthGoal({
    this.id, required this.title, required this.target,
    this.current = 0, required this.unit, this.deadline, this.active = true,
  });

  double get progress => target > 0 ? (current / target).clamp(0.0, 1.0) : 0;
  bool get isCompleted => current >= target;
}
```

```dart
// apps/ozzyl_health/lib/features/health_goals/domain/repositories/goals_repository.dart
import '../entities/health_goal.dart';

abstract class GoalsRepository {
  Future<List<HealthGoal>> getActiveGoals();
  Future<void> addGoal(HealthGoal goal);
  Future<void> updateProgress(int id, double current);
  Future<void> deleteGoal(int id);
}
```

```dart
// apps/ozzyl_health/lib/features/health_goals/data/datasources/goals_local_datasource.dart
import 'package:drift/drift.dart';
import '../../../../core/database/wellness_database.dart';
import '../../domain/entities/health_goal.dart';

class GoalsLocalDatasource {
  final WellnessDatabase _db;
  GoalsLocalDatasource(this._db);

  Future<List<HealthGoal>> getActiveGoals() async {
    final query = _db.select(_db.healthGoals)
      ..where((t) => t.active.equals(true));
    final rows = await query.get();
    return rows.map((r) => HealthGoal(
      id: r.id, title: r.title, target: r.target, current: r.current,
      unit: r.unit, deadline: r.deadline, active: r.active,
    )).toList();
  }

  Future<void> addGoal(HealthGoal goal) async {
    await _db.into(_db.healthGoals).insert(HealthGoalsCompanion.insert(
      title: goal.title, target: goal.target, unit: goal.unit,
      deadline: Value(goal.deadline),
    ));
  }

  Future<void> updateProgress(int id, double current) async {
    await (_db.update(_db.healthGoals)..where((t) => t.id.equals(id)))
        .write(HealthGoalsCompanion(current: Value(current)));
  }

  Future<void> deleteGoal(int id) async {
    await (_db.delete(_db.healthGoals)..where((t) => t.id.equals(id))).go();
  }
}
```

```dart
// apps/ozzyl_health/lib/features/health_goals/data/repositories/goals_repository_impl.dart
import '../../domain/entities/health_goal.dart';
import '../../domain/repositories/goals_repository.dart';
import '../datasources/goals_local_datasource.dart';

class GoalsRepositoryImpl implements GoalsRepository {
  final GoalsLocalDatasource _local;
  GoalsRepositoryImpl(this._local);

  @override
  Future<List<HealthGoal>> getActiveGoals() => _local.getActiveGoals();
  @override
  Future<void> addGoal(HealthGoal goal) => _local.addGoal(goal);
  @override
  Future<void> updateProgress(int id, double current) => _local.updateProgress(id, current);
  @override
  Future<void> deleteGoal(int id) => _local.deleteGoal(id);
}
```

- [ ] **Step 2: Write BLoC**

```dart
// apps/ozzyl_health/lib/features/health_goals/presentation/bloc/goals_event.dart
import 'package:freezed_annotation/freezed_annotation.dart';
part 'goals_event.freezed.dart';

@freezed
sealed class GoalsEvent with _$GoalsEvent {
  const factory GoalsEvent.load() = LoadGoals;
  const factory GoalsEvent.add({
    required String title, required double target,
    required String unit, DateTime? deadline,
  }) = AddGoal;
  const factory GoalsEvent.updateProgress({required int id, required double current}) = UpdateGoalProgress;
  const factory GoalsEvent.delete(int id) = DeleteGoal;
}
```

```dart
// apps/ozzyl_health/lib/features/health_goals/presentation/bloc/goals_state.dart
import 'package:freezed_annotation/freezed_annotation.dart';
import '../../domain/entities/health_goal.dart';
part 'goals_state.freezed.dart';

@freezed
sealed class GoalsState with _$GoalsState {
  const factory GoalsState.initial() = GoalsInitial;
  const factory GoalsState.loading() = GoalsLoading;
  const factory GoalsState.loaded(List<HealthGoal> goals) = GoalsLoaded;
  const factory GoalsState.error(String message) = GoalsError;
}
```

```dart
// apps/ozzyl_health/lib/features/health_goals/presentation/bloc/goals_bloc.dart
import 'package:flutter_bloc/flutter_bloc.dart';
import '../../domain/entities/health_goal.dart';
import '../../domain/repositories/goals_repository.dart';
import 'goals_event.dart';
import 'goals_state.dart';

class GoalsBloc extends Bloc<GoalsEvent, GoalsState> {
  final GoalsRepository _repository;
  GoalsBloc(this._repository) : super(const GoalsState.initial()) {
    on<LoadGoals>((event, emit) async {
      emit(const GoalsState.loading());
      try {
        final goals = await _repository.getActiveGoals();
        emit(GoalsState.loaded(goals));
      } catch (e) {
        emit(GoalsState.error(e.toString()));
      }
    });
    on<AddGoal>((event, emit) async {
      await _repository.addGoal(HealthGoal(
        title: event.title, target: event.target, unit: event.unit, deadline: event.deadline,
      ));
      add(const GoalsEvent.load());
    });
    on<UpdateGoalProgress>((event, emit) async {
      await _repository.updateProgress(event.id, event.current);
      add(const GoalsEvent.load());
    });
    on<DeleteGoal>((event, emit) async {
      await _repository.deleteGoal(event.id);
      add(const GoalsEvent.load());
    });
  }
}
```

- [ ] **Step 3: Write HealthGoalsPage**

```dart
// apps/ozzyl_health/lib/features/health_goals/presentation/pages/health_goals_page.dart
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:ozzyl_core/ozzyl_core.dart';
import '../bloc/goals_bloc.dart';
import '../bloc/goals_event.dart';
import '../bloc/goals_state.dart';

class HealthGoalsPage extends StatelessWidget {
  const HealthGoalsPage({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Health Goals')),
      floatingActionButton: FloatingActionButton(
        onPressed: () => _showAddGoalDialog(context),
        child: const Icon(Icons.add),
      ),
      body: BlocBuilder<GoalsBloc, GoalsState>(
        builder: (context, state) {
          if (state is GoalsLoading) return const Center(child: CircularProgressIndicator());
          if (state is GoalsLoaded && state.goals.isEmpty) {
            return Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.flag_outlined, size: 64, color: AppColors.textSecondary),
                  const SizedBox(height: 16),
                  const Text('No goals yet'),
                  const SizedBox(height: 8),
                  ElevatedButton(
                    onPressed: () => _showAddGoalDialog(context),
                    child: const Text('Set a Goal'),
                  ),
                ],
              ),
            );
          }
          if (state is GoalsLoaded) {
            return ListView.builder(
              padding: const EdgeInsets.all(16),
              itemCount: state.goals.length,
              itemBuilder: (context, i) {
                final goal = state.goals[i];
                return Card(
                  margin: const EdgeInsets.only(bottom: 12),
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Expanded(child: Text(goal.title, style: Theme.of(context).textTheme.titleMedium)),
                            if (goal.isCompleted)
                              const Icon(Icons.check_circle, color: AppColors.success),
                            IconButton(
                              icon: const Icon(Icons.delete_outline, size: 20),
                              onPressed: () {
                                if (goal.id != null) context.read<GoalsBloc>().add(GoalsEvent.delete(goal.id!));
                              },
                            ),
                          ],
                        ),
                        const SizedBox(height: 8),
                        LinearProgressIndicator(
                          value: goal.progress,
                          backgroundColor: AppColors.primary.withOpacity(0.15),
                          color: goal.isCompleted ? AppColors.success : AppColors.primary,
                          minHeight: 8,
                          borderRadius: BorderRadius.circular(4),
                        ),
                        const SizedBox(height: 8),
                        Text(
                          '${goal.current.toStringAsFixed(0)} / ${goal.target.toStringAsFixed(0)} ${goal.unit}',
                          style: Theme.of(context).textTheme.bodyMedium,
                        ),
                      ],
                    ),
                  ),
                );
              },
            );
          }
          return const SizedBox.shrink();
        },
      ),
    );
  }

  void _showAddGoalDialog(BuildContext context) {
    final titleCtrl = TextEditingController();
    final targetCtrl = TextEditingController();
    final unitCtrl = TextEditingController();
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('New Goal'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(controller: titleCtrl, decoration: const InputDecoration(labelText: 'Goal title')),
            const SizedBox(height: 12),
            TextField(controller: targetCtrl, decoration: const InputDecoration(labelText: 'Target'), keyboardType: TextInputType.number),
            const SizedBox(height: 12),
            TextField(controller: unitCtrl, decoration: const InputDecoration(labelText: 'Unit (e.g. steps, glasses, km)')),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          ElevatedButton(
            onPressed: () {
              final target = double.tryParse(targetCtrl.text);
              if (titleCtrl.text.isNotEmpty && target != null && unitCtrl.text.isNotEmpty) {
                context.read<GoalsBloc>().add(GoalsEvent.add(
                  title: titleCtrl.text, target: target, unit: unitCtrl.text,
                ));
                Navigator.pop(ctx);
              }
            },
            child: const Text('Add'),
          ),
        ],
      ),
    );
  }
}
```

- [ ] **Step 4: Run code gen + commit**

```bash
cd apps/ozzyl_health && dart run build_runner build --delete-conflicting-outputs
git add apps/ozzyl_health/lib/features/health_goals/
git commit -m "feat(goals): add health goals with progress bars, add/delete, completion state"
```

---

### Task 5: Gamification service (streaks, badges, wellness score)

**Files:**
- Create: `apps/ozzyl_health/lib/core/services/gamification_service.dart`

- [ ] **Step 1: Write GamificationService**

```dart
// apps/ozzyl_health/lib/core/services/gamification_service.dart
import '../database/wellness_database.dart';
import 'package:drift/drift.dart';

class GamificationService {
  final WellnessDatabase _db;

  GamificationService(this._db);

  Future<int> calculateStreak() async {
    final now = DateTime.now();
    int streak = 0;

    for (int i = 0; i < 365; i++) {
      final date = now.subtract(Duration(days: i));
      final start = DateTime(date.year, date.month, date.day);
      final end = start.add(const Duration(days: 1));

      final hasMood = await (_db.select(_db.moodEntries)
            ..where((t) => t.timestamp.isBiggerOrEqualValue(start))
            ..where((t) => t.timestamp.isSmallerThanValue(end))
            ..limit(1))
          .getSingleOrNull();

      final hasWater = await (_db.select(_db.waterLogs)
            ..where((t) => t.timestamp.isBiggerOrEqualValue(start))
            ..where((t) => t.timestamp.isSmallerThanValue(end))
            ..limit(1))
          .getSingleOrNull();

      if (hasMood != null || hasWater != null) {
        streak++;
      } else {
        break;
      }
    }
    return streak;
  }

  Future<double> calculateWellnessScore() async {
    double score = 0;
    final now = DateTime.now();
    final start = DateTime(now.year, now.month, now.day);
    final end = start.add(const Duration(days: 1));

    // Mood logged today (20 points)
    final mood = await (_db.select(_db.moodEntries)
          ..where((t) => t.timestamp.isBiggerOrEqualValue(start))
          ..where((t) => t.timestamp.isSmallerThanValue(end))
          ..limit(1))
        .getSingleOrNull();
    if (mood != null) score += 20;

    // Water >= 2000ml (20 points)
    final waterLogs = await (_db.select(_db.waterLogs)
          ..where((t) => t.timestamp.isBiggerOrEqualValue(start))
          ..where((t) => t.timestamp.isSmallerThanValue(end)))
        .get();
    final totalWater = waterLogs.fold<int>(0, (sum, r) => sum + r.amountMl);
    if (totalWater >= 2000) score += 20;
    else if (totalWater >= 1000) score += 10;

    // Exercise today (20 points)
    final exercise = await (_db.select(_db.exerciseLogs)
          ..where((t) => t.timestamp.isBiggerOrEqualValue(start))
          ..where((t) => t.timestamp.isSmallerThanValue(end))
          ..limit(1))
        .getSingleOrNull();
    if (exercise != null) score += 20;

    // Sleep logged (20 points)
    final sleep = await (_db.select(_db.sleepLogs)
          ..where((t) => t.date.isBiggerOrEqualValue(start.subtract(const Duration(days: 1))))
          ..limit(1))
        .getSingleOrNull();
    if (sleep != null) score += 20;

    // Active goals making progress (20 points)
    final goals = await (_db.select(_db.healthGoals)
          ..where((t) => t.active.equals(true)))
        .get();
    if (goals.isNotEmpty) {
      final progressing = goals.where((g) => g.current > 0).length;
      score += (progressing / goals.length) * 20;
    }

    return score;
  }

  Future<List<String>> getEarnedBadges() async {
    final badges = <String>[];
    final streak = await calculateStreak();

    if (streak >= 1) badges.add('First Day');
    if (streak >= 7) badges.add('7-Day Streak');
    if (streak >= 30) badges.add('Monthly Champion');

    final assessments = await _db.select(_db.assessmentResults).get();
    if (assessments.isNotEmpty) badges.add('Self-Aware');

    final goals = await (_db.select(_db.healthGoals)..where((t) => t.active.equals(true))).get();
    final completed = goals.where((g) => g.current >= g.target).length;
    if (completed >= 1) badges.add('Goal Crusher');
    if (completed >= 5) badges.add('Achiever');

    final steps = await (_db.select(_db.dailySteps)).get();
    final has10k = steps.any((s) => s.count >= 10000);
    if (has10k) badges.add('10K Walker');

    return badges;
  }
}
```

- [ ] **Step 2: Register in DI**

Add to `injection.dart`:
```dart
import '../services/gamification_service.dart';

sl.registerLazySingleton<GamificationService>(
  () => GamificationService(sl<WellnessDatabase>()),
);
```

- [ ] **Step 3: Commit**

```bash
git add apps/ozzyl_health/lib/core/services/ apps/ozzyl_health/lib/core/di/
git commit -m "feat(gamification): add streak, wellness score, badges calculation service"
```

---

### Task 6: Wire all wellness sub-routes

**Files:**
- Modify: `apps/ozzyl_health/lib/core/router/app_router.dart`
- Modify: `apps/ozzyl_health/lib/features/wellness_dashboard/presentation/pages/wellness_page.dart`

- [ ] **Step 1: Update WellnessPage with feature grid**

```dart
// apps/ozzyl_health/lib/features/wellness_dashboard/presentation/pages/wellness_page.dart
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:ozzyl_core/ozzyl_core.dart';

class WellnessPage extends StatelessWidget {
  const WellnessPage({super.key});

  static const _features = [
    ('Mood Tracker', Icons.mood, '/wellness/mood', AppColors.moodRing),
    ('Water Intake', Icons.water_drop, '/wellness/water', AppColors.waterRing),
    ('Sleep Log', Icons.bedtime, '/wellness/sleep', AppColors.primary),
    ('Exercise', Icons.fitness_center, '/wellness/exercise', AppColors.stepsRing),
    ('Health Goals', Icons.flag, '/wellness/goals', AppColors.success),
    ('Assessments', Icons.assignment, '/wellness/assessments', AppColors.info),
    ('Mental Wellness', Icons.self_improvement, '/wellness/mental', AppColors.accent),
    ('Women\'s Health', Icons.female, '/wellness/womens', AppColors.accentLight),
    ('Medication', Icons.medication, '/wellness/medication', AppColors.warning),
    ('Symptom Checker', Icons.search, '/wellness/symptoms', AppColors.error),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Wellness')),
      body: GridView.builder(
        padding: const EdgeInsets.all(16),
        gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
          crossAxisCount: 2,
          mainAxisSpacing: 12,
          crossAxisSpacing: 12,
          childAspectRatio: 1.3,
        ),
        itemCount: _features.length,
        itemBuilder: (context, i) {
          final (title, icon, route, color) = _features[i];
          return InkWell(
            onTap: () => context.push(route),
            borderRadius: BorderRadius.circular(16),
            child: Container(
              decoration: BoxDecoration(
                color: color.withOpacity(0.1),
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: color.withOpacity(0.3)),
              ),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(icon, color: color, size: 36),
                  const SizedBox(height: 8),
                  Text(title, style: TextStyle(color: color, fontWeight: FontWeight.w600)),
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}
```

- [ ] **Step 2: Add sub-routes in router**

Add to the wellness branch routes array in `app_router.dart`:
```dart
import '../../features/sleep_log/presentation/pages/sleep_log_page.dart';
import '../../features/fitness/presentation/pages/exercise_log_page.dart';
import '../../features/health_goals/presentation/pages/health_goals_page.dart';

// Inside wellness GoRoute children:
GoRoute(path: 'sleep', builder: (context, state) => const SleepLogPage()),
GoRoute(path: 'exercise', builder: (context, state) => const ExerciseLogPage()),
GoRoute(path: 'goals', builder: (context, state) => const HealthGoalsPage()),
```

- [ ] **Step 3: Commit**

```bash
git add apps/ozzyl_health/lib/
git commit -m "feat(wellness): add feature grid + wire sleep, exercise, goals routes"
```

---

## Plan 2 Complete

After Plans 2A + 2B, the Wellness tab is fully functional:
- Dashboard with animated rings, streak, quick actions
- Mood tracker with emoji selector + trend chart
- Water intake with glass animation + quick-add
- Sleep log with bar chart, time pickers, quality slider
- Exercise log with activity types + duration slider
- Step counter (pedometer)
- Health goals with progress bars + add/delete
- Gamification (streaks, badges, wellness score)
- Wellness feature grid navigation

**Next:** Plan 3A — Health Assessments + Mental Wellness
