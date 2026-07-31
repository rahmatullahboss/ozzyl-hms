import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:ozzyl_core/ozzyl_core.dart';
import '../../../../core/di/injection.dart';
import '../../data/datasources/health_records_remote_datasource.dart';
import '../../data/repositories/health_records_repository_impl.dart';
import '../../domain/entities/health_record.dart';
import '../bloc/records_bloc.dart';
import '../bloc/records_event.dart';
import '../bloc/records_state.dart';

class HealthRecordsPage extends StatelessWidget {
  const HealthRecordsPage({super.key});

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => RecordsBloc(
        HealthRecordsRepositoryImpl(
          HealthRecordsRemoteDatasource(sl<ApiClient>()),
          sl<ConnectivityService>(),
        ),
      )..add(LoadHealthRecords()),
      child: const _HealthRecordsView(),
    );
  }
}

class _HealthRecordsView extends StatelessWidget {
  const _HealthRecordsView();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Health Records'),
        actions: [
          IconButton(
            tooltip: 'Timeline',
            onPressed: () => context.push('/health-records/timeline'),
            icon: const Icon(Icons.timeline),
          ),
          IconButton(
            tooltip: 'Document vault',
            onPressed: () => context.push('/health-records/vault'),
            icon: const Icon(Icons.folder_copy_outlined),
          ),
        ],
      ),
      body: BlocBuilder<RecordsBloc, RecordsState>(
        builder: (context, state) {
          if (state is RecordsLoading) {
            return const Center(child: CircularProgressIndicator());
          }
          if (state is RecordsError) {
            return Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(
                      Icons.error_outline,
                      size: 48,
                      color: AppColors.error,
                    ),
                    const SizedBox(height: 12),
                    Text(
                      state.message,
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 12),
                    ElevatedButton.icon(
                      onPressed: () =>
                          context.read<RecordsBloc>().add(LoadHealthRecords()),
                      icon: const Icon(Icons.refresh),
                      label: const Text('Retry'),
                    ),
                  ],
                ),
              ),
            );
          }
          if (state is RecordsLoaded) {
            final records = state.records;
            return RefreshIndicator(
              onRefresh: () async {
                context.read<RecordsBloc>().add(LoadHealthRecords());
              },
              child: ListView(
                padding: const EdgeInsets.symmetric(vertical: 8),
                children: [
                  _AllergiesSection(allergies: records.allergies),
                  _MedicationsSection(medications: records.medications),
                  _DiagnosesSection(diagnoses: records.diagnoses),
                  _ImmunizationsSection(immunizations: records.immunizations),
                ],
              ),
            );
          }
          return const SizedBox.shrink();
        },
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Allergies
// ---------------------------------------------------------------------------

class _AllergiesSection extends StatelessWidget {
  final List<Allergy> allergies;
  const _AllergiesSection({required this.allergies});

  @override
  Widget build(BuildContext context) {
    return ExpansionTile(
      leading: const Icon(Icons.warning_amber, color: AppColors.warning),
      title: const Text('Allergies'),
      trailing: _CountBadge(count: allergies.length),
      initiallyExpanded: true,
      children: allergies.isEmpty
          ? [const _EmptyTile(label: 'No allergies recorded')]
          : allergies.map((a) => _AllergyTile(allergy: a)).toList(),
    );
  }
}

class _AllergyTile extends StatelessWidget {
  final Allergy allergy;
  const _AllergyTile({required this.allergy});

  @override
  Widget build(BuildContext context) {
    return ListTile(
      title: Text(allergy.name),
      subtitle: allergy.reaction != null
          ? Text(allergy.reaction!,
              style: const TextStyle(color: AppColors.textSecondary))
          : null,
      trailing: allergy.severity != null
          ? _SeverityChip(severity: allergy.severity!)
          : null,
    );
  }
}

class _SeverityChip extends StatelessWidget {
  final String severity;
  const _SeverityChip({required this.severity});

  @override
  Widget build(BuildContext context) {
    final lower = severity.toLowerCase();
    Color color;
    if (lower == 'severe' || lower == 'high') {
      color = AppColors.error;
    } else if (lower == 'moderate' || lower == 'medium') {
      color = AppColors.warning;
    } else {
      color = AppColors.success;
    }
    return Chip(
      label: Text(
        severity,
        style: TextStyle(color: color, fontSize: 12),
      ),
      backgroundColor: color.withValues(alpha: 0.12),
      side: BorderSide.none,
      padding: EdgeInsets.zero,
      visualDensity: VisualDensity.compact,
    );
  }
}

// ---------------------------------------------------------------------------
// Medications
// ---------------------------------------------------------------------------

class _MedicationsSection extends StatelessWidget {
  final List<ActiveMedication> medications;
  const _MedicationsSection({required this.medications});

  @override
  Widget build(BuildContext context) {
    return ExpansionTile(
      leading: const Icon(Icons.medication, color: AppColors.primary),
      title: const Text('Medications'),
      trailing: _CountBadge(count: medications.length),
      children: medications.isEmpty
          ? [const _EmptyTile(label: 'No active medications')]
          : medications.map((m) => _MedicationTile(medication: m)).toList(),
    );
  }
}

class _MedicationTile extends StatelessWidget {
  final ActiveMedication medication;
  const _MedicationTile({required this.medication});

  @override
  Widget build(BuildContext context) {
    final parts = <String>[
      if (medication.dosage != null) medication.dosage!,
      if (medication.frequency != null) medication.frequency!,
    ];
    return ListTile(
      title: Text(medication.name),
      subtitle: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (parts.isNotEmpty)
            Text(
              parts.join(' - '),
              style: const TextStyle(color: AppColors.textSecondary),
            ),
          if (medication.prescribedBy != null)
            Text(
              'Prescribed by ${medication.prescribedBy}',
              style: const TextStyle(
                color: AppColors.textSecondary,
                fontSize: 12,
              ),
            ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Diagnoses
// ---------------------------------------------------------------------------

class _DiagnosesSection extends StatelessWidget {
  final List<Diagnosis> diagnoses;
  const _DiagnosesSection({required this.diagnoses});

  @override
  Widget build(BuildContext context) {
    return ExpansionTile(
      leading: const Icon(Icons.medical_information, color: AppColors.primary),
      title: const Text('Diagnoses'),
      trailing: _CountBadge(count: diagnoses.length),
      children: diagnoses.isEmpty
          ? [const _EmptyTile(label: 'No diagnoses on file')]
          : diagnoses.map((d) => _DiagnosisTile(diagnosis: d)).toList(),
    );
  }
}

class _DiagnosisTile extends StatelessWidget {
  final Diagnosis diagnosis;
  const _DiagnosisTile({required this.diagnosis});

  @override
  Widget build(BuildContext context) {
    return ListTile(
      title: Text(diagnosis.name),
      subtitle: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (diagnosis.icdCode != null)
            Text(
              'ICD: ${diagnosis.icdCode}',
              style: const TextStyle(
                color: AppColors.textSecondary,
                fontSize: 12,
              ),
            ),
          if (diagnosis.date != null)
            Text(
              DateFormat.yMMMd().format(diagnosis.date!),
              style: const TextStyle(
                color: AppColors.textSecondary,
                fontSize: 12,
              ),
            ),
        ],
      ),
      trailing: diagnosis.status != null
          ? _StatusChip(status: diagnosis.status!)
          : null,
    );
  }
}

class _StatusChip extends StatelessWidget {
  final String status;
  const _StatusChip({required this.status});

  @override
  Widget build(BuildContext context) {
    final lower = status.toLowerCase();
    Color color;
    if (lower == 'active') {
      color = AppColors.error;
    } else if (lower == 'resolved' || lower == 'inactive') {
      color = AppColors.success;
    } else {
      color = AppColors.textSecondary;
    }
    return Chip(
      label: Text(
        status,
        style: TextStyle(color: color, fontSize: 12),
      ),
      backgroundColor: color.withValues(alpha: 0.12),
      side: BorderSide.none,
      padding: EdgeInsets.zero,
      visualDensity: VisualDensity.compact,
    );
  }
}

// ---------------------------------------------------------------------------
// Immunizations
// ---------------------------------------------------------------------------

class _ImmunizationsSection extends StatelessWidget {
  final List<Immunization> immunizations;
  const _ImmunizationsSection({required this.immunizations});

  @override
  Widget build(BuildContext context) {
    return ExpansionTile(
      leading: const Icon(Icons.vaccines, color: AppColors.success),
      title: const Text('Immunizations'),
      trailing: _CountBadge(count: immunizations.length),
      children: immunizations.isEmpty
          ? [const _EmptyTile(label: 'No immunizations recorded')]
          : immunizations
              .map((i) => _ImmunizationTile(immunization: i))
              .toList(),
    );
  }
}

class _ImmunizationTile extends StatelessWidget {
  final Immunization immunization;
  const _ImmunizationTile({required this.immunization});

  @override
  Widget build(BuildContext context) {
    return ListTile(
      title: Text(immunization.name),
      subtitle: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (immunization.date != null)
            Text(
              DateFormat.yMMMd().format(immunization.date!),
              style: const TextStyle(
                color: AppColors.textSecondary,
                fontSize: 12,
              ),
            ),
          if (immunization.provider != null)
            Text(
              immunization.provider!,
              style: const TextStyle(
                color: AppColors.textSecondary,
                fontSize: 12,
              ),
            ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Shared widgets
// ---------------------------------------------------------------------------

class _CountBadge extends StatelessWidget {
  final int count;
  const _CountBadge({required this.count});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: AppColors.primary.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Text(
        '$count',
        style: const TextStyle(
          color: AppColors.primary,
          fontWeight: FontWeight.w600,
          fontSize: 13,
        ),
      ),
    );
  }
}

class _EmptyTile extends StatelessWidget {
  final String label;
  const _EmptyTile({required this.label});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 16),
      child: Center(
        child: Text(
          label,
          style: const TextStyle(color: AppColors.textSecondary),
        ),
      ),
    );
  }
}
