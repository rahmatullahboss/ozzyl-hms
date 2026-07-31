import 'package:flutter/material.dart';
import 'package:ozzyl_core/ozzyl_core.dart';

class MoodSelector extends StatelessWidget {
  final int? selectedMood;
  final ValueChanged<int> onSelected;

  const MoodSelector({super.key, this.selectedMood, required this.onSelected});

  static const _moods = [
    (1, '😢', 'Bad', AppColors.moodBad),
    (2, '😟', 'Low', AppColors.moodLow),
    (3, '😐', 'Okay', AppColors.moodOkay),
    (4, '😊', 'Good', AppColors.moodGood),
    (5, '😄', 'Great', AppColors.moodGreat),
  ];

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceEvenly,
      children: _moods.map((m) {
        final (level, emoji, label, color) = m;
        final isSelected = selectedMood == level;
        return GestureDetector(
          onTap: () => onSelected(level),
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 200),
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: isSelected ? color.withValues(alpha: 0.2) : Colors.transparent,
              borderRadius: BorderRadius.circular(16),
              border: isSelected ? Border.all(color: color, width: 2) : null,
            ),
            child: Column(
              children: [
                Text(emoji, style: TextStyle(fontSize: isSelected ? 36 : 28)),
                const SizedBox(height: 4),
                Text(
                  label,
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: isSelected ? FontWeight.w600 : FontWeight.w400,
                    color: isSelected ? color : AppColors.textSecondary,
                  ),
                ),
              ],
            ),
          ),
        );
      }).toList(),
    );
  }
}
