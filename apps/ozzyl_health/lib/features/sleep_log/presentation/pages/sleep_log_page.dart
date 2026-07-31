import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:ozzyl_core/ozzyl_core.dart';
import '../bloc/sleep_bloc.dart';
import '../bloc/sleep_event.dart';
import '../bloc/sleep_state.dart';
import '../widgets/sleep_chart.dart';

class SleepLogPage extends StatefulWidget {
  const SleepLogPage({super.key});

  @override
  State<SleepLogPage> createState() => _SleepLogPageState();
}

class _SleepLogPageState extends State<SleepLogPage> {
  TimeOfDay _bedtime = const TimeOfDay(hour: 23, minute: 0);
  TimeOfDay _wakeTime = const TimeOfDay(hour: 7, minute: 0);
  int _quality = 3;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Sleep Log')),
      body: BlocBuilder<SleepBloc, SleepState>(
        builder: (context, state) {
          return SingleChildScrollView(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (state is SleepLoaded) ...[
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        children: [
                          Text('Avg ${state.avgHours.toStringAsFixed(1)} hrs/night',
                            style: Theme.of(context).textTheme.headlineMedium),
                          const SizedBox(height: 4),
                          Text('Last 7 nights', style: Theme.of(context).textTheme.bodyMedium),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 16),
                  SleepChart(entries: state.entries),
                  const SizedBox(height: 24),
                ],
                Text('Log Last Night', style: Theme.of(context).textTheme.titleLarge),
                const SizedBox(height: 16),
                Row(
                  children: [
                    Expanded(
                      child: _TimePickerTile(
                        label: 'Bedtime',
                        time: _bedtime,
                        icon: Icons.bedtime_outlined,
                        onTap: () async {
                          final t = await showTimePicker(context: context, initialTime: _bedtime);
                          if (t != null) setState(() => _bedtime = t);
                        },
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: _TimePickerTile(
                        label: 'Wake up',
                        time: _wakeTime,
                        icon: Icons.alarm,
                        onTap: () async {
                          final t = await showTimePicker(context: context, initialTime: _wakeTime);
                          if (t != null) setState(() => _wakeTime = t);
                        },
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                Text('Sleep Quality', style: Theme.of(context).textTheme.titleMedium),
                Slider(
                  value: _quality.toDouble(),
                  min: 1, max: 5, divisions: 4,
                  label: ['', 'Poor', 'Fair', 'Good', 'Great', 'Excellent'][_quality],
                  onChanged: (v) => setState(() => _quality = v.round()),
                ),
                const SizedBox(height: 16),
                ElevatedButton(
                  onPressed: () {
                    final now = DateTime.now();
                    final yesterday = now.subtract(const Duration(days: 1));
                    final bedtime = DateTime(yesterday.year, yesterday.month, yesterday.day, _bedtime.hour, _bedtime.minute);
                    final wakeTime = DateTime(now.year, now.month, now.day, _wakeTime.hour, _wakeTime.minute);
                    context.read<SleepBloc>().add(SleepEvent.add(
                      bedtime: bedtime, wakeTime: wakeTime, quality: _quality,
                    ));
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(content: Text('Sleep logged!'), backgroundColor: AppColors.success),
                    );
                  },
                  child: const Text('Save Sleep'),
                ),
              ],
            ),
          );
        },
      ),
    );
  }
}

class _TimePickerTile extends StatelessWidget {
  final String label;
  final TimeOfDay time;
  final IconData icon;
  final VoidCallback onTap;
  const _TimePickerTile({required this.label, required this.time, required this.icon, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          border: Border.all(color: AppColors.divider),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Column(
          children: [
            Icon(icon, color: AppColors.primary),
            const SizedBox(height: 8),
            Text(label, style: Theme.of(context).textTheme.bodyMedium),
            Text(time.format(context), style: Theme.of(context).textTheme.titleLarge),
          ],
        ),
      ),
    );
  }
}
