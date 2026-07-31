import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:ozzyl_core/ozzyl_core.dart';
import '../../domain/entities/medication.dart';
import '../../data/datasources/medication_local_datasource.dart';
import '../../../../core/di/injection.dart';
import '../../../../core/database/wellness_database.dart';
import '../../../../core/services/notification_service.dart';
import '../bloc/medication_bloc.dart';
import '../bloc/medication_event.dart';
import '../bloc/medication_state.dart';

class MedicationPage extends StatelessWidget {
  const MedicationPage({super.key});

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => MedicationBloc(
        MedicationLocalDatasource(sl<WellnessDatabase>()),
        sl<NotificationService>(),
      )..add(LoadMedications()),
      child: const _MedicationView(),
    );
  }
}

class _MedicationView extends StatelessWidget {
  const _MedicationView();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Medication Reminders')),
      floatingActionButton: FloatingActionButton(
        onPressed: () => _showAddDialog(context),
        child: const Icon(Icons.add),
      ),
      body: BlocBuilder<MedicationBloc, MedicationState>(
        builder: (context, state) {
          if (state is MedicationLoading) {
            return const Center(child: CircularProgressIndicator());
          }
          if (state is MedicationError) {
            return Center(child: Text(state.message));
          }
          if (state is MedicationLoaded) {
            if (state.medications.isEmpty) {
              return const Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.medication, size: 64, color: AppColors.textSecondary),
                    SizedBox(height: 16),
                    Text('No medications yet'),
                    SizedBox(height: 8),
                    Text(
                      'Tap + to add a medication reminder',
                      style: TextStyle(color: AppColors.textSecondary),
                    ),
                  ],
                ),
              );
            }
            return ListView.builder(
              padding: const EdgeInsets.all(16),
              itemCount: state.medications.length,
              itemBuilder: (context, i) {
                final med = state.medications[i];
                final times = _parseTimes(med.times);
                return Dismissible(
                  key: ValueKey(med.id),
                  direction: DismissDirection.endToStart,
                  background: Container(
                    alignment: Alignment.centerRight,
                    padding: const EdgeInsets.only(right: 20),
                    color: AppColors.error,
                    child: const Icon(Icons.delete, color: Colors.white),
                  ),
                  onDismissed: (_) => context
                      .read<MedicationBloc>()
                      .add(DeleteMedication(med.id!)),
                  child: Card(
                    margin: const EdgeInsets.only(bottom: 8),
                    child: ListTile(
                      leading: CircleAvatar(
                        backgroundColor: med.active
                            ? AppColors.success.withValues(alpha: 0.2)
                            : AppColors.divider,
                        child: Icon(
                          Icons.medication,
                          color: med.active
                              ? AppColors.success
                              : AppColors.textSecondary,
                        ),
                      ),
                      title: Text(
                        med.name,
                        style: const TextStyle(fontWeight: FontWeight.w600),
                      ),
                      subtitle: Text(
                        '${med.dosage} • ${med.frequency} • $times',
                      ),
                      trailing: Switch(
                        value: med.active,
                        onChanged: (v) => context
                            .read<MedicationBloc>()
                            .add(ToggleMedication(med.id!, v)),
                      ),
                    ),
                  ),
                );
              },
            );
          }
          return const SizedBox.shrink();
        },
      ),
    );
  }

  String _parseTimes(String timesJson) {
    try {
      final list = (jsonDecode(timesJson) as List).cast<String>();
      return list.join(', ');
    } catch (_) {
      return timesJson;
    }
  }

  void _showAddDialog(BuildContext context) {
    final nameController = TextEditingController();
    final dosageController = TextEditingController();
    var frequency = 'daily';
    final times = <TimeOfDay>[const TimeOfDay(hour: 8, minute: 0)];

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
                    'Add Medication',
                    style: Theme.of(ctx).textTheme.titleLarge,
                  ),
                  const SizedBox(height: 16),
                  TextField(
                    controller: nameController,
                    decoration: const InputDecoration(labelText: 'Name'),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: dosageController,
                    decoration: const InputDecoration(
                      labelText: 'Dosage',
                      hintText: 'e.g. 500mg',
                    ),
                  ),
                  const SizedBox(height: 12),
                  DropdownButtonFormField<String>(
                    initialValue: frequency,
                    decoration: const InputDecoration(labelText: 'Frequency'),
                    items: const [
                      DropdownMenuItem(value: 'daily', child: Text('Daily')),
                      DropdownMenuItem(
                          value: 'twice_daily', child: Text('Twice Daily')),
                      DropdownMenuItem(value: 'weekly', child: Text('Weekly')),
                    ],
                    onChanged: (v) => setSheetState(() => frequency = v!),
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      const Text('Reminder Times:'),
                      const Spacer(),
                      IconButton(
                        icon: const Icon(Icons.add_alarm),
                        onPressed: () => setSheetState(() =>
                            times.add(const TimeOfDay(hour: 20, minute: 0))),
                      ),
                    ],
                  ),
                  ...times.asMap().entries.map((e) {
                    final i = e.key;
                    final t = e.value;
                    return ListTile(
                      dense: true,
                      title: Text(t.format(ctx)),
                      trailing: i > 0
                          ? IconButton(
                              icon: const Icon(Icons.remove_circle_outline,
                                  size: 20),
                              onPressed: () =>
                                  setSheetState(() => times.removeAt(i)),
                            )
                          : null,
                      onTap: () async {
                        final picked = await showTimePicker(
                          context: ctx,
                          initialTime: t,
                        );
                        if (picked != null) {
                          setSheetState(() => times[i] = picked);
                        }
                      },
                    );
                  }),
                  const SizedBox(height: 16),
                  ElevatedButton(
                    onPressed: () {
                      if (nameController.text.isEmpty ||
                          dosageController.text.isEmpty) {
                        return;
                      }
                      final timesJson = jsonEncode(
                        times
                            .map((t) =>
                                '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}')
                            .toList(),
                      );
                      context.read<MedicationBloc>().add(
                            AddMedication(
                              Medication(
                                name: nameController.text.trim(),
                                dosage: dosageController.text.trim(),
                                frequency: frequency,
                                times: timesJson,
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
