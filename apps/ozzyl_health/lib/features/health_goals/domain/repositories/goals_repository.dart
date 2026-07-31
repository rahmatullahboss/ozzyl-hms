import '../entities/health_goal.dart';

abstract class GoalsRepository {
  Future<List<HealthGoalEntity>> getActiveGoals();
  Future<void> addGoal(HealthGoalEntity goal);
  Future<void> updateProgress(int id, double current);
  Future<void> deleteGoal(int id);
}
