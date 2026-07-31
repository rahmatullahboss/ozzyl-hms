import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:ozzyl_core/ozzyl_core.dart';

class WellnessPage extends StatelessWidget {
  const WellnessPage({super.key});

  static const _features = [
    ('Mood Tracker', Icons.mood, '/wellness/mood', AppColors.moodRing),
    ('Water Intake', Icons.water_drop, '/wellness/water', AppColors.waterRing),
    ('Sleep Log', Icons.bedtime, '/wellness/sleep', AppColors.primary),
    (
      'Exercise',
      Icons.fitness_center,
      '/wellness/exercise',
      AppColors.stepsRing
    ),
    ('Health Goals', Icons.flag, '/wellness/goals', AppColors.success),
    ('Assessments', Icons.assignment, '/wellness/assessments', AppColors.info),
    (
      'Mental Wellness',
      Icons.self_improvement,
      '/wellness/mental',
      AppColors.accent
    ),
    ("Women's Health", Icons.female, '/wellness/womens', AppColors.accentLight),
    ('Medication', Icons.medication, '/wellness/medication', AppColors.warning),
    ('Vitals', Icons.monitor_heart, '/wellness/vitals', AppColors.error),
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
                color: color.withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: color.withValues(alpha: 0.3)),
              ),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(icon, color: color, size: 36),
                  const SizedBox(height: 8),
                  Text(title,
                      style:
                          TextStyle(color: color, fontWeight: FontWeight.w600)),
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}
