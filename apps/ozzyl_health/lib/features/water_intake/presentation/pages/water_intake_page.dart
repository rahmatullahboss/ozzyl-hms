import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:ozzyl_core/ozzyl_core.dart';
import '../../../../core/database/wellness_database.dart';
import '../../../../core/di/injection.dart';
import '../../data/datasources/water_local_datasource.dart';
import '../../data/repositories/water_repository_impl.dart';
import '../bloc/water_bloc.dart';
import '../bloc/water_event.dart';
import '../bloc/water_state.dart';
import '../widgets/water_glass.dart';

class WaterIntakePage extends StatelessWidget {
  const WaterIntakePage({super.key});

  static const _quickAmounts = [100, 200, 250, 500];

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => WaterBloc(
        WaterRepositoryImpl(WaterLocalDatasource(sl<WellnessDatabase>())),
      )..add(const WaterEvent.loadToday()),
      child: Scaffold(
        appBar: AppBar(title: const Text('Water Intake')),
        body: BlocBuilder<WaterBloc, WaterState>(
          builder: (context, state) {
            final totalMl = state is WaterLoaded ? state.totalMl : 0;
            final goalMl = state is WaterLoaded ? state.goalMl : 2500;

            return SingleChildScrollView(
              padding: const EdgeInsets.all(16),
              child: Column(
                children: [
                  const SizedBox(height: 16),
                  Center(child: WaterGlass(currentMl: totalMl, goalMl: goalMl)),
                  const SizedBox(height: 32),
                  Text(
                    'Quick Add',
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                  const SizedBox(height: 16),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                    children: _quickAmounts.map((ml) {
                      return _QuickAddButton(
                        amountMl: ml,
                        onTap: () {
                          context
                              .read<WaterBloc>()
                              .add(WaterEvent.addWater(ml));
                        },
                      );
                    }).toList(),
                  ),
                  const SizedBox(height: 32),
                  if (state is WaterLoading)
                    const Center(child: CircularProgressIndicator())
                  else if (state is WaterLoaded && state.logs.isNotEmpty) ...[
                    Text(
                      'Today\'s Logs',
                      style: Theme.of(context).textTheme.titleLarge,
                    ),
                    const SizedBox(height: 8),
                    ...state.logs.map(
                      (log) => ListTile(
                        leading: const Icon(
                          Icons.water_drop,
                          color: AppColors.waterRing,
                        ),
                        title: Text('${log.amountMl}ml'),
                        subtitle: Text(
                          '${log.timestamp.hour.toString().padLeft(2, '0')}:${log.timestamp.minute.toString().padLeft(2, '0')}',
                        ),
                        trailing: IconButton(
                          icon: const Icon(
                            Icons.delete_outline,
                            color: AppColors.error,
                          ),
                          onPressed: () {
                            if (log.id != null) {
                              context
                                  .read<WaterBloc>()
                                  .add(WaterEvent.deleteLog(log.id!));
                            }
                          },
                        ),
                      ),
                    ),
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

class _QuickAddButton extends StatelessWidget {
  final int amountMl;
  final VoidCallback onTap;

  const _QuickAddButton({required this.amountMl, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(16),
      child: Container(
        width: 72,
        padding: const EdgeInsets.symmetric(vertical: 16),
        decoration: BoxDecoration(
          color: AppColors.waterRing.withValues(alpha: 0.1),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: AppColors.waterRing.withValues(alpha: 0.3)),
        ),
        child: Column(
          children: [
            const Icon(Icons.water_drop, color: AppColors.waterRing),
            const SizedBox(height: 4),
            Text(
              '${amountMl}ml',
              style: const TextStyle(
                fontWeight: FontWeight.w600,
                color: AppColors.waterRing,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
