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

              QuickActions(
                onLogMood: () => context.push('/wellness/mood'),
                onLogWater: () => context.push('/wellness/water'),
                onLogExercise: () {},
              ),
              const SizedBox(height: 24),

              const StreakCard(streakDays: 0),
              const SizedBox(height: 24),

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
