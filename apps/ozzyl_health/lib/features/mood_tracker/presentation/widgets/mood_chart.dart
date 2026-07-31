import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:ozzyl_core/ozzyl_core.dart';
import '../../domain/entities/mood_entry.dart';

class MoodChart extends StatelessWidget {
  final List<MoodEntryEntity> entries;

  const MoodChart({super.key, required this.entries});

  @override
  Widget build(BuildContext context) {
    if (entries.isEmpty) {
      return const SizedBox(
        height: 200,
        child: Center(child: Text('No mood data yet')),
      );
    }

    final spots = entries.reversed.toList().asMap().entries.map((e) {
      return FlSpot(e.key.toDouble(), e.value.moodLevel.toDouble());
    }).toList();

    return SizedBox(
      height: 200,
      child: LineChart(
        LineChartData(
          gridData: const FlGridData(show: false),
          titlesData: const FlTitlesData(show: false),
          borderData: FlBorderData(show: false),
          minY: 0,
          maxY: 6,
          lineBarsData: [
            LineChartBarData(
              spots: spots,
              isCurved: true,
              color: AppColors.primary,
              barWidth: 3,
              dotData: FlDotData(
                show: true,
                getDotPainter: (spot, _, __, ___) {
                  final color = _colorForMood(spot.y.toInt());
                  return FlDotCirclePainter(
                    radius: 5,
                    color: color,
                    strokeWidth: 2,
                    strokeColor: Colors.white,
                  );
                },
              ),
              belowBarData: BarAreaData(
                show: true,
                color: AppColors.primary.withValues(alpha: 0.1),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Color _colorForMood(int level) {
    return switch (level) {
      1 => AppColors.moodBad,
      2 => AppColors.moodLow,
      3 => AppColors.moodOkay,
      4 => AppColors.moodGood,
      5 => AppColors.moodGreat,
      _ => AppColors.textSecondary,
    };
  }
}
