import 'package:drift/drift.dart';
import 'package:drift_flutter/drift_flutter.dart';

import 'tables/mood_entries.dart';
import 'tables/water_logs.dart';
import 'tables/sleep_logs.dart';
import 'tables/exercise_logs.dart';
import 'tables/health_goals.dart';
import 'tables/medication_reminders.dart';
import 'tables/period_tracking.dart';
import 'tables/journal_entries.dart';
import 'tables/assessment_results.dart';
import 'tables/daily_steps.dart';
import 'tables/sync_queue.dart';

part 'wellness_database.g.dart';

@DriftDatabase(tables: [
  MoodEntries,
  WaterLogs,
  SleepLogs,
  ExerciseLogs,
  HealthGoals,
  MedicationReminders,
  PeriodTracking,
  JournalEntries,
  AssessmentResults,
  DailySteps,
  SyncQueue,
])
class WellnessDatabase extends _$WellnessDatabase {
  WellnessDatabase([QueryExecutor? executor])
      : super(executor ?? _openConnection());

  @override
  int get schemaVersion => 1;

  static QueryExecutor _openConnection() {
    return driftDatabase(name: 'wellness');
  }
}
