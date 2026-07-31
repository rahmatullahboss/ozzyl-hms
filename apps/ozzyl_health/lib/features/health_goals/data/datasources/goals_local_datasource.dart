import 'package:drift/drift.dart';
import '../../../../core/database/wellness_database.dart';
import '../../domain/entities/health_goal.dart';

class GoalsLocalDatasource {
  final WellnessDatabase _db;
  GoalsLocalDatasource(this._db);

  Future<List<HealthGoalEntity>> getActiveGoals() async {
    final query = _db.select(_db.healthGoals)
      ..where((t) => t.active.equals(true));
    final rows = await query.get();
    return rows.map((r) => HealthGoalEntity(
      id: r.id, title: r.title, target: r.target, current: r.current,
      unit: r.unit, deadline: r.deadline, active: r.active,
    )).toList();
  }

  Future<void> addGoal(HealthGoalEntity goal) async {
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
