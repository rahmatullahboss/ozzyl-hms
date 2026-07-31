import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:ozzyl_core/ozzyl_core.dart';
import '../../../../core/database/wellness_database.dart';
import '../../../../core/di/injection.dart';
import '../../data/datasources/exercise_local_datasource.dart';
import '../../data/repositories/exercise_repository_impl.dart';
import '../bloc/exercise_bloc.dart';
import '../bloc/exercise_event.dart';
import '../bloc/exercise_state.dart';

class ExerciseLogPage extends StatefulWidget {
  const ExerciseLogPage({super.key});

  @override
  State<ExerciseLogPage> createState() => _ExerciseLogPageState();
}

class _ExerciseLogPageState extends State<ExerciseLogPage> {
  String _selectedType = 'Walking';
  int _duration = 30;

  static const _exerciseTypes = [
    ('Walking', Icons.directions_walk),
    ('Running', Icons.directions_run),
    ('Cycling', Icons.directions_bike),
    ('Swimming', Icons.pool),
    ('Yoga', Icons.self_improvement),
    ('Gym', Icons.fitness_center),
  ];

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => ExerciseBloc(
        ExerciseRepositoryImpl(ExerciseLocalDatasource(sl<WellnessDatabase>())),
      )..add(const ExerciseEvent.load()),
      child: Scaffold(
        appBar: AppBar(title: const Text('Exercise Log')),
        body: BlocBuilder<ExerciseBloc, ExerciseState>(
          builder: (context, state) {
            final todayMin = state is ExerciseLoaded ? state.todayMinutes : 0;
            return SingleChildScrollView(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(20),
                      child: Column(
                        children: [
                          Text(
                            '$todayMin min',
                            style: Theme.of(context)
                                .textTheme
                                .displayLarge
                                ?.copyWith(color: AppColors.stepsRing),
                          ),
                          const Text('exercised today'),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 24),
                  Text(
                    'Activity Type',
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                  const SizedBox(height: 12),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: _exerciseTypes.map((e) {
                      final (name, icon) = e;
                      final selected = _selectedType == name;
                      return ChoiceChip(
                        avatar: Icon(icon, size: 18),
                        label: Text(name),
                        selected: selected,
                        selectedColor:
                            AppColors.stepsRing.withValues(alpha: 0.2),
                        onSelected: (_) => setState(() => _selectedType = name),
                      );
                    }).toList(),
                  ),
                  const SizedBox(height: 24),
                  Text(
                    'Duration: $_duration min',
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                  Slider(
                    value: _duration.toDouble(),
                    min: 5,
                    max: 120,
                    divisions: 23,
                    label: '$_duration min',
                    onChanged: (v) => setState(() => _duration = v.round()),
                  ),
                  const SizedBox(height: 16),
                  ElevatedButton(
                    onPressed: () {
                      context.read<ExerciseBloc>().add(ExerciseEvent.add(
                            type: _selectedType,
                            durationMin: _duration,
                          ));
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(
                          content: Text('Exercise logged!'),
                          backgroundColor: AppColors.success,
                        ),
                      );
                    },
                    child: const Text('Log Exercise'),
                  ),
                  const SizedBox(height: 24),
                  if (state is ExerciseLoading)
                    const Center(child: CircularProgressIndicator())
                  else if (state is ExerciseLoaded && state.entries.isNotEmpty) ...[
                    Text(
                      'Today\'s Activities',
                      style: Theme.of(context).textTheme.titleLarge,
                    ),
                    const SizedBox(height: 8),
                    ...state.entries.map((e) => ListTile(
                          leading: const Icon(
                            Icons.fitness_center,
                            color: AppColors.stepsRing,
                          ),
                          title: Text(e.type),
                          subtitle: Text('${e.durationMin} min'),
                          trailing: IconButton(
                            icon: const Icon(
                              Icons.delete_outline,
                              color: AppColors.error,
                            ),
                            onPressed: () {
                              if (e.id != null) {
                                context
                                    .read<ExerciseBloc>()
                                    .add(ExerciseEvent.delete(e.id!));
                              }
                            },
                          ),
                        )),
                  ],
                ],
              ),
            );
          },
        ),
      ),
    );
  }
}
