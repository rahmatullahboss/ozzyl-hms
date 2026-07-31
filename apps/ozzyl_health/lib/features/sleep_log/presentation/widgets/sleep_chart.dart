import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:ozzyl_core/ozzyl_core.dart';
import '../../domain/entities/sleep_entry.dart';

class SleepChart extends StatelessWidget {
  final List<SleepEntry> entries;
  const SleepChart({super.key, required this.entries});

  @override
  Widget build(BuildContext context) {
    if (entries.isEmpty) {
      return const SizedBox(height: 200, child: Center(child: Text('No sleep data yet')));
    }

    final bars = entries.reversed.toList().asMap().entries.map((e) {
      final hours = e.value.hours;
      return BarChartGroupData(
        x: e.key,
        barRods: [
          BarChartRodData(
            toY: hours,
            color: hours >= 7 ? AppColors.success : hours >= 5 ? AppColors.warning : AppColors.error,
            width: 20,
            borderRadius: const BorderRadius.vertical(top: Radius.circular(6)),
          ),
        ],
      );
    }).toList();

    return SizedBox(
      height: 200,
      child: BarChart(
        BarChartData(
          barGroups: bars,
          gridData: const FlGridData(show: false),
          titlesData: const FlTitlesData(show: false),
          borderData: FlBorderData(show: false),
          maxY: 12,
        ),
      ),
    );
  }
}
