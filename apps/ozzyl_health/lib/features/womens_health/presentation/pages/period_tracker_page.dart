import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:ozzyl_core/ozzyl_core.dart';
import '../../domain/entities/period_entry.dart';
import '../../data/datasources/period_local_datasource.dart';
import '../../../../core/di/injection.dart';
import '../../../../core/database/wellness_database.dart';
import '../bloc/period_bloc.dart';
import '../bloc/period_event.dart';
import '../bloc/period_state.dart';

class PeriodTrackerPage extends StatelessWidget {
  const PeriodTrackerPage({super.key});

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => PeriodBloc(
        PeriodLocalDatasource(sl<WellnessDatabase>()),
      )..add(LoadPeriodData()),
      child: const _PeriodTrackerView(),
    );
  }
}

class _PeriodTrackerView extends StatelessWidget {
  const _PeriodTrackerView();

  static const _flowLabels = ['Spotting', 'Light', 'Medium', 'Heavy', 'Very Heavy'];
  static const _flowColors = [
    AppColors.moodOkay,
    AppColors.accent,
    AppColors.accentDark,
    AppColors.error,
    Color(0xFF8B0000),
  ];
  static const _symptomOptions = [
    'Cramps',
    'Headache',
    'Fatigue',
    'Bloating',
    'Mood Swings',
    'Back Pain',
    'Nausea',
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text("Women's Health")),
      floatingActionButton: FloatingActionButton(
        onPressed: () => _showAddDialog(context),
        child: const Icon(Icons.add),
      ),
      body: BlocBuilder<PeriodBloc, PeriodState>(
        builder: (context, state) {
          if (state is PeriodLoading) {
            return const Center(child: CircularProgressIndicator());
          }
          if (state is PeriodError) {
            return Center(child: Text(state.message));
          }
          if (state is PeriodLoaded) {
            return ListView(
              padding: const EdgeInsets.all(16),
              children: [
                _PredictionCard(
                  daysUntilNext: state.daysUntilNext,
                  avgCycleLength: state.avgCycleLength,
                ),
                const SizedBox(height: 16),
                Text(
                  'Recent Entries',
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                const SizedBox(height: 8),
                if (state.entries.isEmpty)
                  const Card(
                    child: Padding(
                      padding: EdgeInsets.all(24),
                      child: Center(
                        child: Text('No entries yet. Tap + to log.'),
                      ),
                    ),
                  )
                else
                  ...state.entries.map(
                    (e) => Card(
                      margin: const EdgeInsets.only(bottom: 8),
                      child: ListTile(
                        leading: CircleAvatar(
                          backgroundColor:
                              _flowColors[e.flowLevel].withValues(alpha: 0.2),
                          child: Icon(
                            Icons.water_drop,
                            color: _flowColors[e.flowLevel],
                          ),
                        ),
                        title: Text(
                          '${e.date.month}/${e.date.day}/${e.date.year}',
                        ),
                        subtitle: Text(
                          '${_flowLabels[e.flowLevel]}${e.symptoms != null ? ' • ${e.symptoms}' : ''}',
                        ),
                        trailing: IconButton(
                          icon: const Icon(Icons.delete_outline, size: 20),
                          onPressed: () => context
                              .read<PeriodBloc>()
                              .add(DeletePeriodEntry(e.id!)),
                        ),
                      ),
                    ),
                  ),
              ],
            );
          }
          return const SizedBox.shrink();
        },
      ),
    );
  }

  void _showAddDialog(BuildContext context) {
    var selectedFlow = 2;
    final selectedSymptoms = <String>{};
    final notesController = TextEditingController();

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (ctx) {
        return StatefulBuilder(
          builder: (ctx, setSheetState) {
            return Padding(
              padding: EdgeInsets.fromLTRB(
                24,
                24,
                24,
                24 + MediaQuery.of(ctx).viewInsets.bottom,
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    'Log Period Day',
                    style: Theme.of(ctx).textTheme.titleLarge,
                  ),
                  const SizedBox(height: 16),
                  const Text('Flow Level'),
                  const SizedBox(height: 8),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                    children: List.generate(5, (i) {
                      final selected = selectedFlow == i;
                      return GestureDetector(
                        onTap: () => setSheetState(() => selectedFlow = i),
                        child: Column(
                          children: [
                            Container(
                              width: 40,
                              height: 40,
                              decoration: BoxDecoration(
                                shape: BoxShape.circle,
                                color: selected
                                    ? _flowColors[i]
                                    : _flowColors[i].withValues(alpha: 0.2),
                                border: selected
                                    ? Border.all(
                                        color: _flowColors[i], width: 3)
                                    : null,
                              ),
                              child: Icon(
                                Icons.water_drop,
                                color: selected ? Colors.white : _flowColors[i],
                                size: 20,
                              ),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              _flowLabels[i],
                              style: const TextStyle(fontSize: 10),
                            ),
                          ],
                        ),
                      );
                    }),
                  ),
                  const SizedBox(height: 16),
                  const Text('Symptoms'),
                  const SizedBox(height: 8),
                  Wrap(
                    spacing: 8,
                    runSpacing: 4,
                    children: _symptomOptions
                        .map(
                          (s) => FilterChip(
                            label: Text(s),
                            selected: selectedSymptoms.contains(s),
                            selectedColor:
                                AppColors.primary.withValues(alpha: 0.2),
                            onSelected: (v) => setSheetState(() => v
                                ? selectedSymptoms.add(s)
                                : selectedSymptoms.remove(s)),
                          ),
                        )
                        .toList(),
                  ),
                  const SizedBox(height: 16),
                  TextField(
                    controller: notesController,
                    decoration: const InputDecoration(
                      labelText: 'Notes (optional)',
                    ),
                  ),
                  const SizedBox(height: 16),
                  ElevatedButton(
                    onPressed: () {
                      context.read<PeriodBloc>().add(
                            AddPeriodEntry(
                              PeriodEntry(
                                date: DateTime.now(),
                                flowLevel: selectedFlow,
                                symptoms: selectedSymptoms.isEmpty
                                    ? null
                                    : selectedSymptoms.join(', '),
                                notes: notesController.text.trim().isEmpty
                                    ? null
                                    : notesController.text.trim(),
                              ),
                            ),
                          );
                      Navigator.pop(ctx);
                    },
                    child: const Text('Save'),
                  ),
                ],
              ),
            );
          },
        );
      },
    );
  }
}

class _PredictionCard extends StatelessWidget {
  final int? daysUntilNext;
  final int avgCycleLength;

  const _PredictionCard({
    required this.daysUntilNext,
    required this.avgCycleLength,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      color: AppColors.accentLight.withValues(alpha: 0.1),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            Container(
              width: 56,
              height: 56,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: AppColors.accent.withValues(alpha: 0.2),
              ),
              child: const Icon(Icons.female, color: AppColors.accent, size: 28),
            ),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (daysUntilNext != null)
                    Text(
                      daysUntilNext! > 0
                          ? 'Next period in ~$daysUntilNext days'
                          : daysUntilNext == 0
                              ? 'Period expected today'
                              : 'Period may have started',
                      style: const TextStyle(
                        fontWeight: FontWeight.w600,
                        fontSize: 16,
                      ),
                    )
                  else
                    const Text(
                      'Log entries to see predictions',
                      style: TextStyle(
                        fontWeight: FontWeight.w600,
                        fontSize: 16,
                      ),
                    ),
                  const SizedBox(height: 4),
                  Text(
                    'Average cycle: $avgCycleLength days',
                    style: const TextStyle(color: AppColors.textSecondary),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
