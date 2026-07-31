import 'package:flutter/material.dart';
import 'package:ozzyl_core/ozzyl_core.dart';

class WaterGlass extends StatelessWidget {
  final int currentMl;
  final int goalMl;

  const WaterGlass({super.key, required this.currentMl, required this.goalMl});

  @override
  Widget build(BuildContext context) {
    final percentage = (currentMl / goalMl).clamp(0.0, 1.0);

    return SizedBox(
      width: 160,
      height: 240,
      child: Stack(
        alignment: Alignment.bottomCenter,
        children: [
          Container(
            width: 120,
            height: 200,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: AppColors.waterRing, width: 3),
            ),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(17),
              child: Align(
                alignment: Alignment.bottomCenter,
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 500),
                  curve: Curves.easeInOut,
                  width: double.infinity,
                  height: 194 * percentage,
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      begin: Alignment.topCenter,
                      end: Alignment.bottomCenter,
                      colors: [
                        AppColors.waterRing.withValues(alpha: 0.4),
                        AppColors.waterRing.withValues(alpha: 0.8),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
          Positioned(
            bottom: 80,
            child: Column(
              children: [
                Text(
                  '${currentMl}ml',
                  style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                        color: percentage > 0.5 ? Colors.white : AppColors.textPrimary,
                        fontWeight: FontWeight.w700,
                      ),
                ),
                Text(
                  '/ ${goalMl}ml',
                  style: TextStyle(
                    color: percentage > 0.5
                        ? Colors.white70
                        : AppColors.textSecondary,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
