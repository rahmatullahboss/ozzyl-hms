import 'package:drift/drift.dart';
import '../database/wellness_database.dart';

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

    final mood = await (_db.select(_db.moodEntries)
          ..where((t) => t.timestamp.isBiggerOrEqualValue(start))
          ..where((t) => t.timestamp.isSmallerThanValue(end))
          ..limit(1))
        .getSingleOrNull();
    if (mood != null) {
      score += 20;
    }

    final waterLogs = await (_db.select(_db.waterLogs)
          ..where((t) => t.timestamp.isBiggerOrEqualValue(start))
          ..where((t) => t.timestamp.isSmallerThanValue(end)))
        .get();
    final totalWater = waterLogs.fold<int>(0, (sum, r) => sum + r.amountMl);
    if (totalWater >= 2000) {
      score += 20;
    } else if (totalWater >= 1000) {
      score += 10;
    }

    final exercise = await (_db.select(_db.exerciseLogs)
          ..where((t) => t.timestamp.isBiggerOrEqualValue(start))
          ..where((t) => t.timestamp.isSmallerThanValue(end))
          ..limit(1))
        .getSingleOrNull();
    if (exercise != null) {
      score += 20;
    }

    final sleep = await (_db.select(_db.sleepLogs)
          ..where((t) => t.date
              .isBiggerOrEqualValue(start.subtract(const Duration(days: 1))))
          ..limit(1))
        .getSingleOrNull();
    if (sleep != null) {
      score += 20;
    }

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

    if (streak >= 1) {
      badges.add('First Day');
    }
    if (streak >= 7) {
      badges.add('7-Day Streak');
    }
    if (streak >= 30) {
      badges.add('Monthly Champion');
    }

    final assessments = await _db.select(_db.assessmentResults).get();
    if (assessments.isNotEmpty) {
      badges.add('Self-Aware');
    }

    final goals = await (_db.select(_db.healthGoals)
          ..where((t) => t.active.equals(true)))
        .get();
    final completed = goals.where((g) => g.current >= g.target).length;
    if (completed >= 1) {
      badges.add('Goal Crusher');
    }
    if (completed >= 5) {
      badges.add('Achiever');
    }

    final steps = await (_db.select(_db.dailySteps)).get();
    final has10k = steps.any((s) => s.count >= 10000);
    if (has10k) {
      badges.add('10K Walker');
    }

    return badges;
  }
}
