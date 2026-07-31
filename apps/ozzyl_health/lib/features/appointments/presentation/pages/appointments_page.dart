import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
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

class AppointmentsPage extends StatelessWidget {
  const AppointmentsPage({super.key});

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => AppointmentBloc(
        AppointmentRepositoryImpl(
          AppointmentRemoteDatasource(sl<ApiClient>()),
          AppointmentCacheDatasource(sl<CacheDatabase>()),
          sl<ConnectivityService>(),
        ),
      )..add(LoadUpcomingAppointments()),
      child: const _AppointmentsView(),
    );
  }
}

class _AppointmentsView extends StatelessWidget {
  const _AppointmentsView();

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Appointments'),
          bottom: const TabBar(
            tabs: [Tab(text: 'Upcoming'), Tab(text: 'History')],
          ),
        ),
        floatingActionButton: FloatingActionButton(
          onPressed: () => context.push('/appointments/book'),
          child: const Icon(Icons.add),
        ),
        body: BlocBuilder<AppointmentBloc, AppointmentState>(
          builder: (context, state) {
            if (state is AppointmentLoading) {
              return const Center(child: CircularProgressIndicator());
            }
            if (state is AppointmentError) {
              return Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.error_outline,
                        size: 48, color: AppColors.error),
                    const SizedBox(height: 12),
                    Text(state.message),
                    const SizedBox(height: 12),
                    ElevatedButton(
                      onPressed: () => context
                          .read<AppointmentBloc>()
                          .add(LoadUpcomingAppointments()),
                      child: const Text('Retry'),
                    ),
                  ],
                ),
              );
            }
            if (state is AppointmentListLoaded) {
              return TabBarView(
                children: [
                  _buildList(context, state.upcoming, isUpcoming: true),
                  _buildList(context, state.history, isUpcoming: false),
                ],
              );
            }
            return const SizedBox.shrink();
          },
        ),
      ),
    );
  }

  Widget _buildList(BuildContext context, List<Appointment> list,
      {required bool isUpcoming}) {
    if (list.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.calendar_today,
                size: 64, color: AppColors.textSecondary),
            const SizedBox(height: 16),
            Text(isUpcoming
                ? 'No upcoming appointments'
                : 'No past appointments'),
            if (isUpcoming) ...[
              const SizedBox(height: 8),
              const Text('Tap + to book one',
                  style: TextStyle(color: AppColors.textSecondary)),
            ],
          ],
        ),
      );
    }
    return RefreshIndicator(
      onRefresh: () async {
        context.read<AppointmentBloc>().add(
              isUpcoming
                  ? LoadUpcomingAppointments()
                  : LoadAppointmentHistory(),
            );
      },
      child: ListView.builder(
        padding: const EdgeInsets.all(16),
        itemCount: list.length,
        itemBuilder: (context, i) => _AppointmentCard(
          appointment: list[i],
          isUpcoming: isUpcoming,
        ),
      ),
    );
  }
}

class _AppointmentCard extends StatelessWidget {
  final Appointment appointment;
  final bool isUpcoming;
  const _AppointmentCard({required this.appointment, required this.isUpcoming});

  @override
  Widget build(BuildContext context) {
    final dateStr =
        DateFormat('MMM d, y – h:mm a').format(appointment.dateTime);
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                CircleAvatar(
                  backgroundColor: AppColors.primary.withValues(alpha: 0.1),
                  child: const Icon(Icons.person, color: AppColors.primary),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        appointment.doctorName,
                        style: const TextStyle(
                            fontWeight: FontWeight.w600, fontSize: 16),
                      ),
                      if (appointment.doctorSpecialty != null)
                        Text(appointment.doctorSpecialty!,
                            style: const TextStyle(
                                color: AppColors.textSecondary)),
                    ],
                  ),
                ),
                _statusChip(appointment.status),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                const Icon(Icons.access_time,
                    size: 16, color: AppColors.textSecondary),
                const SizedBox(width: 6),
                Text(dateStr, style: const TextStyle(fontSize: 13)),
              ],
            ),
            if (appointment.hospitalName != null) ...[
              const SizedBox(height: 4),
              Row(
                children: [
                  const Icon(Icons.local_hospital,
                      size: 16, color: AppColors.textSecondary),
                  const SizedBox(width: 6),
                  Text(appointment.hospitalName!,
                      style: const TextStyle(fontSize: 13)),
                ],
              ),
            ],
            const SizedBox(height: 8),
            Text(
              _statusExplanation(appointment.status),
              style: const TextStyle(
                fontSize: 12,
                color: AppColors.textSecondary,
              ),
            ),
            if (isUpcoming && appointment.status == 'scheduled') ...[
              const SizedBox(height: 12),
              Align(
                alignment: Alignment.centerRight,
                child: TextButton(
                  onPressed: () => context
                      .read<AppointmentBloc>()
                      .add(CancelAppointment(appointment.id)),
                  child: const Text('Cancel',
                      style: TextStyle(color: AppColors.error)),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _statusChip(String status) {
    final normalized = status.toLowerCase();
    final color = switch (normalized) {
      'scheduled' => AppColors.primary,
      'pending' => AppColors.warning,
      'confirmed' => AppColors.success,
      'locked' => AppColors.warning,
      'completed' => AppColors.success,
      'cancelled' => AppColors.error,
      _ => AppColors.textSecondary,
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Text(
        normalized[0].toUpperCase() + normalized.substring(1),
        style:
            TextStyle(fontSize: 12, color: color, fontWeight: FontWeight.w600),
      ),
    );
  }

  String _statusExplanation(String status) {
    return switch (status.toLowerCase()) {
      'pending' => 'Waiting for hospital confirmation. Slot may still change.',
      'confirmed' => 'Confirmed by hospital. Bring any required records.',
      'locked' => 'Slot is temporarily locked while the hospital confirms it.',
      'scheduled' =>
        'Scheduled in the app. Check for hospital updates before visiting.',
      'cancelled' => 'Cancelled. Book again if care is still needed.',
      'completed' =>
        'Completed. Related records may appear after hospital sync.',
      _ => 'Status comes from the connected hospital system when available.',
    };
  }
}
