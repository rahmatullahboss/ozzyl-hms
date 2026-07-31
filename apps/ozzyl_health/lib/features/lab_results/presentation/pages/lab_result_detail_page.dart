import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:ozzyl_core/ozzyl_core.dart';
import '../../../../core/di/injection.dart';
import '../../data/datasources/lab_remote_datasource.dart';
import '../../data/repositories/lab_repository_impl.dart';
import '../../domain/entities/lab_result.dart';
import '../bloc/lab_bloc.dart';
import '../bloc/lab_event.dart';
import '../bloc/lab_state.dart';

class LabResultDetailPage extends StatelessWidget {
  final String resultId;
  const LabResultDetailPage({super.key, required this.resultId});

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => LabBloc(
        LabRepositoryImpl(
          LabRemoteDatasource(sl<ApiClient>()),
          sl<ConnectivityService>(),
        ),
      )..add(LoadLabResultDetail(resultId)),
      child: const _DetailView(),
    );
  }
}

class _DetailView extends StatelessWidget {
  const _DetailView();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Lab Result'),
      ),
      body: BlocBuilder<LabBloc, LabState>(
        builder: (context, state) {
          if (state is LabLoading) {
            return const Center(child: CircularProgressIndicator());
          }
          if (state is LabError) {
            return Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.error_outline,
                      size: 48, color: AppColors.error),
                  const SizedBox(height: 12),
                  Text(
                    state.message,
                    textAlign: TextAlign.center,
                    style: const TextStyle(color: AppColors.textSecondary),
                  ),
                  const SizedBox(height: 12),
                  ElevatedButton(
                    onPressed: () => Navigator.of(context).pop(),
                    child: const Text('Go Back'),
                  ),
                ],
              ),
            );
          }
          if (state is LabDetailLoaded) {
            return _buildDetail(context, state.result);
          }
          return const SizedBox.shrink();
        },
      ),
    );
  }

  Widget _buildDetail(BuildContext context, LabResult result) {
    final dateFormatted =
        DateFormat('MMMM d, yyyy – h:mm a').format(result.date);
    final isPending = result.isPending;
    final isAbnormal = result.isAbnormal == true;

    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header card
          Card(
            child: Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Container(
                        width: 48,
                        height: 48,
                        decoration: BoxDecoration(
                          color: isAbnormal
                              ? AppColors.error.withValues(alpha: 0.1)
                              : AppColors.primary.withValues(alpha: 0.1),
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: Icon(
                          Icons.science_outlined,
                          color:
                              isAbnormal ? AppColors.error : AppColors.primary,
                          size: 28,
                        ),
                      ),
                      const SizedBox(width: 16),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              result.testName,
                              style: const TextStyle(
                                fontWeight: FontWeight.bold,
                                fontSize: 20,
                              ),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              dateFormatted,
                              style: const TextStyle(
                                color: AppColors.textSecondary,
                                fontSize: 14,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),
                  // Status chip
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                    decoration: BoxDecoration(
                      color: isPending
                          ? AppColors.warning.withValues(alpha: 0.1)
                          : AppColors.success.withValues(alpha: 0.1),
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: Text(
                      isPending ? 'Pending' : 'Completed',
                      style: TextStyle(
                        color: isPending ? AppColors.warning : AppColors.success,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),

          const SizedBox(height: 16),

          // Result section
          if (result.result != null) ...[
            Card(
              child: Padding(
                padding: const EdgeInsets.all(20),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Result',
                      style: Theme.of(context).textTheme.titleMedium?.copyWith(
                            fontWeight: FontWeight.w600,
                          ),
                    ),
                    const SizedBox(height: 12),
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.baseline,
                      textBaseline: TextBaseline.alphabetic,
                      children: [
                        Text(
                          result.result!,
                          style: TextStyle(
                            fontSize: 32,
                            fontWeight: FontWeight.bold,
                            color: isAbnormal
                                ? AppColors.error
                                : Theme.of(context)
                                    .textTheme
                                    .bodyLarge
                                    ?.color,
                          ),
                        ),
                        if (result.unit != null) ...[
                          const SizedBox(width: 8),
                          Text(
                            result.unit!,
                            style: const TextStyle(
                              fontSize: 16,
                              color: AppColors.textSecondary,
                            ),
                          ),
                        ],
                      ],
                    ),
                    if (isAbnormal) ...[
                      const SizedBox(height: 8),
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 10, vertical: 4),
                        decoration: BoxDecoration(
                          color: AppColors.error.withValues(alpha: 0.1),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: const Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(Icons.warning_amber_rounded,
                                size: 16, color: AppColors.error),
                            SizedBox(width: 4),
                            Text(
                              'Abnormal Result',
                              style: TextStyle(
                                color: AppColors.error,
                                fontWeight: FontWeight.w600,
                                fontSize: 13,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),
          ],

          // Details section
          Card(
            child: Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Details',
                    style: Theme.of(context).textTheme.titleMedium?.copyWith(
                          fontWeight: FontWeight.w600,
                        ),
                  ),
                  const SizedBox(height: 12),
                  if (result.referenceRange != null)
                    _DetailRow(
                      label: 'Reference Range',
                      value: result.referenceRange!,
                    ),
                  if (result.orderedBy != null)
                    _DetailRow(
                      label: 'Ordered By',
                      value: result.orderedBy!,
                    ),
                  _DetailRow(
                    label: 'Status',
                    value: isPending ? 'Pending' : 'Completed',
                  ),
                  _DetailRow(
                    label: 'Date',
                    value: DateFormat('MMM d, yyyy').format(result.date),
                  ),
                ],
              ),
            ),
          ),

          // PDF button
          if (result.pdfUrl != null) ...[
            const SizedBox(height: 24),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton.icon(
                onPressed: () async {
                  final uri = Uri.parse(result.pdfUrl!);
                  if (await canLaunchUrl(uri)) {
                    await launchUrl(uri, mode: LaunchMode.externalApplication);
                  } else {
                    if (context.mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(
                          content: Text('Could not open PDF'),
                        ),
                      );
                    }
                  }
                },
                icon: const Icon(Icons.picture_as_pdf),
                label: const Text('View PDF Report'),
              ),
            ),
          ],

          const SizedBox(height: 24),
        ],
      ),
    );
  }
}

class _DetailRow extends StatelessWidget {
  final String label;
  final String value;

  const _DetailRow({
    required this.label,
    required this.value,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 140,
            child: Text(
              label,
              style: const TextStyle(
                color: AppColors.textSecondary,
                fontSize: 14,
              ),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: const TextStyle(
                fontWeight: FontWeight.w500,
                fontSize: 14,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
