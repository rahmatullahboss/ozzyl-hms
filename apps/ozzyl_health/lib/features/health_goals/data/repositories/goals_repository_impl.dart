import '../../domain/entities/health_goal.dart';
import '../../domain/repositories/goals_repository.dart';
import '../datasources/goals_local_datasource.dart';

class GoalsRepositoryImpl implements GoalsRepository {
  final GoalsLocalDatasource _local;
  GoalsRepositoryImpl(this._local);

  @override
  Future<List<HealthGoalEntity>> getActiveGoals() => _local.getActiveGoals();
  @override
  Future<void> addGoal(HealthGoalEntity goal) => _local.addGoal(goal);
  @override
  Future<void> updateProgress(int id, double current) => _local.updateProgress(id, current);
  @override
  Future<void> deleteGoal(int id) => _local.deleteGoal(id);
}
