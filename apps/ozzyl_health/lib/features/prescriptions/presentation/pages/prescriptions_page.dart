import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:intl/intl.dart';
import 'package:ozzyl_core/ozzyl_core.dart';
import '../../../../core/di/injection.dart';
import '../../data/datasources/prescription_remote_datasource.dart';
import '../../data/repositories/prescription_repository_impl.dart';
import '../../domain/entities/prescription.dart';
import '../bloc/prescription_bloc.dart';
import '../bloc/prescription_event.dart';
import '../bloc/prescription_state.dart';

class PrescriptionsPage extends StatelessWidget {
  const PrescriptionsPage({super.key});

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => PrescriptionBloc(
        PrescriptionRepositoryImpl(
          PrescriptionRemoteDatasource(sl<ApiClient>()),
          sl<ConnectivityService>(),
        ),
      )..add(LoadPrescriptions()),
      child: const _PrescriptionsView(),
    );
  }
}

class _PrescriptionsView extends StatelessWidget {
  const _PrescriptionsView();

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Prescriptions'),
          bottom: const TabBar(
            tabs: [
              Tab(text: 'Active'),
              Tab(text: 'Completed'),
            ],
          ),
        ),
        body: BlocBuilder<PrescriptionBloc, PrescriptionState>(
          builder: (context, state) {
            if (state is PrescriptionLoading) {
              return const Center(child: CircularProgressIndicator());
            }
            if (state is PrescriptionError) {
              return _ErrorView(message: state.message);
            }
            if (state is PrescriptionLoaded) {
              return TabBarView(
                children: [
                  _PrescriptionList(
                    prescriptions: state.active,
                    emptyMessage: 'No active prescriptions',
                    emptyIcon: Icons.medication_outlined,
                    showRefill: true,
                  ),
                  _PrescriptionList(
                    prescriptions: state.completed,
                    emptyMessage: 'No completed prescriptions',
                    emptyIcon: Icons.check_circle_outline,
                    showRefill: false,
                  ),
                ],
              );
            }
            return const SizedBox.shrink();
          },
        ),
      ),
    );
  }
}

class _ErrorView extends StatelessWidget {
  final String message;
  const _ErrorView({required this.message});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.error_outline, size: 48, color: AppColors.error),
          const SizedBox(height: 12),
          Text(
            message,
            textAlign: TextAlign.center,
            style: const TextStyle(color: AppColors.textSecondary),
          ),
          const SizedBox(height: 12),
          ElevatedButton(
            onPressed: () =>
                context.read<PrescriptionBloc>().add(LoadPrescriptions()),
            child: const Text('Retry'),
          ),
        ],
      ),
    );
  }
}

class _PrescriptionList extends StatelessWidget {
  final List<Prescription> prescriptions;
  final String emptyMessage;
  final IconData emptyIcon;
  final bool showRefill;

  const _PrescriptionList({
    required this.prescriptions,
    required this.emptyMessage,
    required this.emptyIcon,
    required this.showRefill,
  });

  @override
  Widget build(BuildContext context) {
    if (prescriptions.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(emptyIcon, size: 64, color: AppColors.textSecondary),
            const SizedBox(height: 16),
            Text(
              emptyMessage,
              style: const TextStyle(
                fontSize: 16,
                color: AppColors.textSecondary,
              ),
            ),
          ],
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: () async {
        context.read<PrescriptionBloc>().add(LoadPrescriptions());
      },
      child: ListView.builder(
        padding: const EdgeInsets.all(16),
        itemCount: prescriptions.length,
        itemBuilder: (context, index) {
          return _PrescriptionCard(
            prescription: prescriptions[index],
            showRefill: showRefill,
          );
        },
      ),
    );
  }
}

class _PrescriptionCard extends StatelessWidget {
  final Prescription prescription;
  final bool showRefill;

  const _PrescriptionCard({
    required this.prescription,
    required this.showRefill,
  });

  @override
  Widget build(BuildContext context) {
    final dateFormatted = DateFormat.yMMMd().format(prescription.date);

    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    prescription.doctorName,
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
                _StatusChip(status: prescription.status),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              dateFormatted,
              style: const TextStyle(
                fontSize: 13,
                color: AppColors.textSecondary,
              ),
            ),
            if (prescription.hospitalName != null) ...[
              const SizedBox(height: 2),
              Text(
                prescription.hospitalName!,
                style: const TextStyle(
                  fontSize: 13,
                  color: AppColors.textSecondary,
                ),
              ),
            ],
            const Divider(height: 20),
            ...prescription.items.map(
              (item) => Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Icon(Icons.medication, size: 18, color: AppColors.primary),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            item.medicineName,
                            style: const TextStyle(fontWeight: FontWeight.w500),
                          ),
                          Text(
                            '${item.dosage} - ${item.frequency} - ${item.duration}',
                            style: const TextStyle(
                              fontSize: 12,
                              color: AppColors.textSecondary,
                            ),
                          ),
                          if (item.instructions != null)
                            Text(
                              item.instructions!,
                              style: const TextStyle(
                                fontSize: 12,
                                color: AppColors.textSecondary,
                                fontStyle: FontStyle.italic,
                              ),
                            ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
            if (showRefill) ...[
              const SizedBox(height: 8),
              SizedBox(
                width: double.infinity,
                child: OutlinedButton.icon(
                  onPressed: () {
                    context
                        .read<PrescriptionBloc>()
                        .add(RequestRefill(prescription.id));
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(
                        content: Text('Refill request sent'),
                        behavior: SnackBarBehavior.floating,
                      ),
                    );
                  },
                  icon: const Icon(Icons.refresh),
                  label: const Text('Request Refill'),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _StatusChip extends StatelessWidget {
  final String status;
  const _StatusChip({required this.status});

  @override
  Widget build(BuildContext context) {
    Color color;
    switch (status) {
      case 'active':
        color = AppColors.success;
        break;
      case 'completed':
        color = AppColors.primary;
        break;
      case 'cancelled':
        color = AppColors.error;
        break;
      default:
        color = AppColors.warning;
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Text(
        status[0].toUpperCase() + status.substring(1),
        style: TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w600,
          color: color,
        ),
      ),
    );
  }
}
