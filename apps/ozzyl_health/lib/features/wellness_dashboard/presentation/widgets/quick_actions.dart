import 'package:flutter/material.dart';
import 'package:ozzyl_core/ozzyl_core.dart';

class QuickActions extends StatelessWidget {
  final VoidCallback onLogMood;
  final VoidCallback onLogWater;
  final VoidCallback onLogExercise;

  const QuickActions({
    super.key,
    required this.onLogMood,
    required this.onLogWater,
    required this.onLogExercise,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceEvenly,
      children: [
        _ActionButton(
          icon: Icons.mood,
          label: 'Mood',
          color: AppColors.moodRing,
          onTap: onLogMood,
        ),
        _ActionButton(
          icon: Icons.water_drop,
          label: 'Water',
          color: AppColors.waterRing,
          onTap: onLogWater,
        ),
        _ActionButton(
          icon: Icons.fitness_center,
          label: 'Exercise',
          color: AppColors.stepsRing,
          onTap: onLogExercise,
        ),
      ],
    );
  }
}

class _ActionButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final Color color;
  final VoidCallback onTap;

  const _ActionButton({
    required this.icon,
    required this.label,
    required this.color,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(16),
      child: Container(
        width: 96,
        padding: const EdgeInsets.symmetric(vertical: 16),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.1),
          borderRadius: BorderRadius.circular(16),
        ),
        child: Column(
          children: [
            Icon(icon, color: color, size: 32),
            const SizedBox(height: 8),
            Text(label, style: TextStyle(color: color, fontWeight: FontWeight.w600)),
          ],
        ),
      ),
    );
  }
}
