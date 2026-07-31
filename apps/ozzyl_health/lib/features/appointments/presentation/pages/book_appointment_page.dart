import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:intl/intl.dart';
import 'package:go_router/go_router.dart';
import 'package:ozzyl_core/ozzyl_core.dart';
import '../../../../core/di/injection.dart';
import '../../../../core/database/cache_database.dart';
import '../../data/datasources/appointment_remote_datasource.dart';
import '../../data/datasources/appointment_cache_datasource.dart';
import '../../data/repositories/appointment_repository_impl.dart';
import '../../domain/entities/appointment.dart';
import '../bloc/appointment_bloc.dart';
import '../bloc/appointment_event.dart';
import '../bloc/appointment_state.dart';

class BookAppointmentPage extends StatelessWidget {
  const BookAppointmentPage({super.key});

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => AppointmentBloc(
        AppointmentRepositoryImpl(
          AppointmentRemoteDatasource(sl<ApiClient>()),
          AppointmentCacheDatasource(sl<CacheDatabase>()),
          sl<ConnectivityService>(),
        ),
      ),
      child: const _BookView(),
    );
  }
}

class _BookView extends StatefulWidget {
  const _BookView();

  @override
  State<_BookView> createState() => _BookViewState();
}

class _BookViewState extends State<_BookView> {
  final _doctorIdController = TextEditingController();
  final _notesController = TextEditingController();
  DateTime? _selectedDate;
  TimeSlot? _selectedSlot;

  @override
  void dispose() {
    _doctorIdController.dispose();
    _notesController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return BlocListener<AppointmentBloc, AppointmentState>(
      listener: (context, state) {
        if (state is AppointmentBooked) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Appointment booked successfully!')),
          );
          context.pop();
        }
        if (state is AppointmentError) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(state.message)),
          );
        }
      },
      child: Scaffold(
        appBar: AppBar(title: const Text('Book Appointment')),
        body: SingleChildScrollView(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              TextField(
                controller: _doctorIdController,
                decoration: const InputDecoration(
                  labelText: 'Doctor ID',
                  hintText: 'Enter doctor ID from hospital',
                  prefixIcon: Icon(Icons.person_search),
                ),
              ),
              const SizedBox(height: 16),

              // Date picker
              ListTile(
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
                  side: BorderSide(color: Theme.of(context).dividerColor),
                ),
                leading: const Icon(Icons.calendar_today),
                title: Text(
                  _selectedDate != null
                      ? DateFormat('EEEE, MMM d, y').format(_selectedDate!)
                      : 'Select Date',
                ),
                onTap: () async {
                  final bloc = context.read<AppointmentBloc>();
                  final date = await showDatePicker(
                    context: context,
                    initialDate: DateTime.now().add(const Duration(days: 1)),
                    firstDate: DateTime.now(),
                    lastDate: DateTime.now().add(const Duration(days: 90)),
                  );
                  if (date != null && mounted) {
                    setState(() {
                      _selectedDate = date;
                      _selectedSlot = null;
                    });
                    if (_doctorIdController.text.isNotEmpty) {
                      bloc.add(
                        LoadTimeSlots(_doctorIdController.text.trim(), date),
                      );
                    }
                  }
                },
              ),
              const SizedBox(height: 16),

              // Time slots
              if (_selectedDate != null)
                BlocBuilder<AppointmentBloc, AppointmentState>(
                  builder: (context, state) {
                    if (state is AppointmentLoading) {
                      return const Center(
                        child: Padding(
                          padding: EdgeInsets.all(24),
                          child: CircularProgressIndicator(),
                        ),
                      );
                    }
                    if (state is TimeSlotsLoaded) {
                      if (state.slots.isEmpty) {
                        return const Padding(
                          padding: EdgeInsets.all(24),
                          child: Text('No available slots for this date'),
                        );
                      }
                      return Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: state.slots.map((slot) {
                          final timeStr = DateFormat('h:mm a').format(slot.dateTime);
                          final isSelected = _selectedSlot == slot;
                          return ChoiceChip(
                            label: Text(timeStr),
                            selected: isSelected,
                            onSelected: slot.available
                                ? (v) => setState(() => _selectedSlot = v ? slot : null)
                                : null,
                          );
                        }).toList(),
                      );
                    }
                    return const SizedBox.shrink();
                  },
                ),
              const SizedBox(height: 16),

              TextField(
                controller: _notesController,
                decoration: const InputDecoration(
                  labelText: 'Notes (optional)',
                  hintText: 'Reason for visit, symptoms, etc.',
                  prefixIcon: Icon(Icons.notes),
                ),
                maxLines: 3,
              ),
              const SizedBox(height: 24),

              ElevatedButton(
                onPressed: _selectedSlot != null && _doctorIdController.text.isNotEmpty
                    ? () {
                        context.read<AppointmentBloc>().add(
                              BookAppointment(
                                _doctorIdController.text.trim(),
                                _selectedSlot!.dateTime,
                                notes: _notesController.text.trim().isNotEmpty
                                    ? _notesController.text.trim()
                                    : null,
                              ),
                            );
                      }
                    : null,
                child: const Padding(
                  padding: EdgeInsets.symmetric(vertical: 12),
                  child: Text('Confirm Booking'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
