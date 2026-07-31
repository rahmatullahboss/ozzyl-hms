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
                backgroundColor: AppColors.stepsRing.withValues(alpha: 0.2),
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
            const Icon(Icons.directions_walk, color: AppColors.stepsRing, size: 32),
          ],
        ),
      ),
    );
  }
}
