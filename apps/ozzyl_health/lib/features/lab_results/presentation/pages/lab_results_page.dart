import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:ozzyl_core/ozzyl_core.dart';
import '../../../../core/di/injection.dart';
import '../../data/datasources/lab_remote_datasource.dart';
import '../../data/repositories/lab_repository_impl.dart';
import '../../domain/entities/lab_result.dart';
import '../bloc/lab_bloc.dart';
import '../bloc/lab_event.dart';
import '../bloc/lab_state.dart';

class LabResultsPage extends StatelessWidget {
  const LabResultsPage({super.key});

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => LabBloc(
        LabRepositoryImpl(
          LabRemoteDatasource(sl<ApiClient>()),
          sl<ConnectivityService>(),
        ),
      )..add(LoadLabResults()),
      child: const _LabResultsView(),
    );
  }
}

class _LabResultsView extends StatelessWidget {
  const _LabResultsView();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Lab Results'),
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
                    onPressed: () =>
                        context.read<LabBloc>().add(LoadLabResults()),
                    child: const Text('Retry'),
                  ),
                ],
              ),
            );
          }
          if (state is LabListLoaded) {
            final results = state.results;
            if (results.isEmpty) {
              return Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.science_outlined,
                        size: 64, color: AppColors.textSecondary),
                    const SizedBox(height: 16),
                    const Text(
                      'No lab results yet',
                      style: TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 8),
                    const Text(
                      'Your lab results will appear here\nonce they are available.',
                      textAlign: TextAlign.center,
                      style: TextStyle(color: AppColors.textSecondary),
                    ),
                    const SizedBox(height: 16),
                    ElevatedButton(
                      onPressed: () =>
                          context.read<LabBloc>().add(LoadLabResults()),
                      child: const Text('Refresh'),
                    ),
                  ],
                ),
              );
            }
            return RefreshIndicator(
              onRefresh: () async {
                context.read<LabBloc>().add(LoadLabResults());
              },
              child: ListView.builder(
                padding: const EdgeInsets.all(16),
                itemCount: results.length,
                itemBuilder: (context, index) {
                  return _LabResultCard(
                    result: results[index],
                    onTap: () => context.push(
                      '/lab-results/${results[index].id}',
                    ),
                  );
                },
              ),
            );
          }
          return const SizedBox.shrink();
        },
      ),
    );
  }
}

class _LabResultCard extends StatelessWidget {
  final LabResult result;
  final VoidCallback onTap;

  const _LabResultCard({
    required this.result,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final dateFormatted = DateFormat('MMM d, yyyy').format(result.date);
    final isPending = result.isPending;
    final isAbnormal = result.isAbnormal == true;

    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              // Leading icon
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: isAbnormal
                      ? AppColors.error.withValues(alpha: 0.1)
                      : AppColors.primary.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(
                  Icons.science_outlined,
                  color: isAbnormal ? AppColors.error : AppColors.primary,
                ),
              ),
              const SizedBox(width: 12),
              // Content
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      result.testName,
                      style: const TextStyle(
                        fontWeight: FontWeight.w600,
                        fontSize: 16,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      dateFormatted,
                      style: const TextStyle(
                        color: AppColors.textSecondary,
                        fontSize: 13,
                      ),
                    ),
                    if (isAbnormal) ...[
                      const SizedBox(height: 4),
                      const Text(
                        'Abnormal',
                        style: TextStyle(
                          color: AppColors.error,
                          fontWeight: FontWeight.w600,
                          fontSize: 13,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              // Status chip
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
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
                    fontSize: 12,
                  ),
                ),
              ),
              const SizedBox(width: 4),
              const Icon(
                Icons.chevron_right,
                color: AppColors.textSecondary,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
