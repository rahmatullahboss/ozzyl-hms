import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:ozzyl_core/ozzyl_core.dart';
import '../../../../core/database/wellness_database.dart';
import '../../../../core/di/injection.dart';
import '../../data/datasources/mood_local_datasource.dart';
import '../../data/repositories/mood_repository_impl.dart';
import '../bloc/mood_bloc.dart';
import '../bloc/mood_event.dart';
import '../bloc/mood_state.dart';
import '../widgets/mood_selector.dart';
import '../widgets/mood_chart.dart';

class MoodTrackerPage extends StatefulWidget {
  const MoodTrackerPage({super.key});

  @override
  State<MoodTrackerPage> createState() => _MoodTrackerPageState();
}

class _MoodTrackerPageState extends State<MoodTrackerPage> {
  int? _selectedMood;
  final _notesController = TextEditingController();

  @override
  void dispose() {
    _notesController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => MoodBloc(
        MoodRepositoryImpl(MoodLocalDatasource(sl<WellnessDatabase>())),
      )..add(const MoodEvent.loadEntries()),
      child: Scaffold(
        appBar: AppBar(title: const Text('Mood Tracker')),
        body: BlocBuilder<MoodBloc, MoodState>(
          builder: (context, state) {
            return SingleChildScrollView(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    'How are you feeling?',
                    style: Theme.of(context).textTheme.headlineMedium,
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 24),
                  MoodSelector(
                    selectedMood: _selectedMood,
                    onSelected: (m) => setState(() => _selectedMood = m),
                  ),
                  const SizedBox(height: 24),
                  if (_selectedMood != null) ...[
                    TextField(
                      controller: _notesController,
                      decoration: const InputDecoration(
                        labelText: 'Notes (optional)',
                        hintText: 'What made you feel this way?',
                      ),
                      maxLines: 3,
                    ),
                    const SizedBox(height: 16),
                    ElevatedButton(
                      onPressed: _onSave,
                      child: const Text('Save Mood'),
                    ),
                  ],
                  const SizedBox(height: 32),
                  Text(
                    'Recent Trend',
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                  const SizedBox(height: 16),
                  if (state is MoodLoaded)
                    MoodChart(entries: state.entries)
                  else if (state is MoodLoading)
                    const Center(child: CircularProgressIndicator())
                  else
                    const Center(child: Text('Log your first mood!')),
                ],
              ),
            );
          },
        ),
      ),
    );
  }

  void _onSave() {
    if (_selectedMood == null) return;
    context.read<MoodBloc>().add(
          MoodEvent.addEntry(
            moodLevel: _selectedMood!,
            notes: _notesController.text.trim().isEmpty
                ? null
                : _notesController.text.trim(),
          ),
        );
    setState(() => _selectedMood = null);
    _notesController.clear();
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Mood saved!'), backgroundColor: AppColors.success),
    );
  }
}
