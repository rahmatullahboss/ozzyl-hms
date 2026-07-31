import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:ozzyl_core/ozzyl_core.dart';
import '../../../../core/database/wellness_database.dart';
import '../../../../core/di/injection.dart';
import '../../data/datasources/goals_local_datasource.dart';
import '../../data/repositories/goals_repository_impl.dart';
import '../bloc/goals_bloc.dart';
import '../bloc/goals_event.dart';
import '../bloc/goals_state.dart';

class HealthGoalsPage extends StatelessWidget {
  const HealthGoalsPage({super.key});

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => GoalsBloc(
        GoalsRepositoryImpl(GoalsLocalDatasource(sl<WellnessDatabase>())),
      )..add(const GoalsEvent.load()),
      child: Scaffold(
        appBar: AppBar(title: const Text('Health Goals')),
        floatingActionButton: Builder(
          builder: (context) => FloatingActionButton(
            onPressed: () => _showAddGoalDialog(context),
            child: const Icon(Icons.add),
          ),
        ),
        body: BlocBuilder<GoalsBloc, GoalsState>(
          builder: (context, state) {
            if (state is GoalsLoading) {
              return const Center(child: CircularProgressIndicator());
            }
            if (state is GoalsLoaded && state.goals.isEmpty) {
              return Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(
                      Icons.flag_outlined,
                      size: 64,
                      color: AppColors.textSecondary,
                    ),
                    const SizedBox(height: 16),
                    const Text('No goals yet'),
                    const SizedBox(height: 8),
                    ElevatedButton(
                      onPressed: () => _showAddGoalDialog(context),
                      child: const Text('Set a Goal'),
                    ),
                  ],
                ),
              );
            }
            if (state is GoalsError) {
              return Center(child: Text(state.message));
            }
            if (state is GoalsLoaded) {
              return ListView.builder(
                padding: const EdgeInsets.all(16),
                itemCount: state.goals.length,
                itemBuilder: (context, i) {
                  final goal = state.goals[i];
                  return Card(
                    margin: const EdgeInsets.only(bottom: 12),
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Expanded(
                                child: Text(
                                  goal.title,
                                  style: Theme.of(context).textTheme.titleMedium,
                                ),
                              ),
                              if (goal.isCompleted)
                                const Icon(Icons.check_circle,
                                    color: AppColors.success),
                              IconButton(
                                icon: const Icon(Icons.delete_outline, size: 20),
                                onPressed: () {
                                  if (goal.id != null) {
                                    context
                                        .read<GoalsBloc>()
                                        .add(GoalsEvent.delete(goal.id!));
                                  }
                                },
                              ),
                            ],
                          ),
                          const SizedBox(height: 8),
                          LinearProgressIndicator(
                            value: goal.progress,
                            backgroundColor:
                                AppColors.primary.withValues(alpha: 0.15),
                            color: goal.isCompleted
                                ? AppColors.success
                                : AppColors.primary,
                            minHeight: 8,
                            borderRadius: BorderRadius.circular(4),
                          ),
                          const SizedBox(height: 8),
                          Text(
                            '${goal.current.toStringAsFixed(0)} / ${goal.target.toStringAsFixed(0)} ${goal.unit}',
                            style: Theme.of(context).textTheme.bodyMedium,
                          ),
                          if (goal.id != null && !goal.isCompleted) ...[
                            const SizedBox(height: 8),
                            Align(
                              alignment: Alignment.centerRight,
                              child: TextButton.icon(
                                onPressed: () => _showUpdateProgressDialog(
                                  context,
                                  goal.id!,
                                  goal.current,
                                ),
                                icon: const Icon(Icons.edit, size: 18),
                                label: const Text('Update progress'),
                              ),
                            ),
                          ],
                        ],
                      ),
                    ),
                  );
                },
              );
            }
            return const SizedBox.shrink();
          },
        ),
      ),
    );
  }

  void _showAddGoalDialog(BuildContext context) {
    final titleCtrl = TextEditingController();
    final targetCtrl = TextEditingController();
    final unitCtrl = TextEditingController();
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('New Goal'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: titleCtrl,
              decoration: const InputDecoration(labelText: 'Goal title'),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: targetCtrl,
              decoration: const InputDecoration(labelText: 'Target'),
              keyboardType: TextInputType.number,
            ),
            const SizedBox(height: 12),
            TextField(
              controller: unitCtrl,
              decoration: const InputDecoration(
                labelText: 'Unit (e.g. steps, glasses, km)',
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () {
              final target = double.tryParse(targetCtrl.text);
              if (titleCtrl.text.isNotEmpty &&
                  target != null &&
                  unitCtrl.text.isNotEmpty) {
                context.read<GoalsBloc>().add(GoalsEvent.add(
                      title: titleCtrl.text.trim(),
                      target: target,
                      unit: unitCtrl.text.trim(),
                    ));
                Navigator.pop(ctx);
              }
            },
            child: const Text('Add'),
          ),
        ],
      ),
    );
  }

  void _showUpdateProgressDialog(
    BuildContext context,
    int goalId,
    double current,
  ) {
    final currentCtrl = TextEditingController(text: current.toStringAsFixed(0));
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Update Progress'),
        content: TextField(
          controller: currentCtrl,
          decoration: const InputDecoration(labelText: 'Current progress'),
          keyboardType: TextInputType.number,
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () {
              final value = double.tryParse(currentCtrl.text);
              if (value != null) {
                context.read<GoalsBloc>().add(
                      GoalsEvent.updateProgress(id: goalId, current: value),
                    );
                Navigator.pop(ctx);
              }
            },
            child: const Text('Save'),
          ),
        ],
      ),
    );
  }
}
