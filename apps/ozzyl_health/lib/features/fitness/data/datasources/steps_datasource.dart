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
