import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:ozzyl_core/ozzyl_core.dart';
import '../../../../core/di/injection.dart';
import '../../../../core/database/cache_database.dart';
import '../../data/datasources/hospital_remote_datasource.dart';
import '../../data/datasources/hospital_cache_datasource.dart';
import '../../data/repositories/hospital_repository_impl.dart';
import '../bloc/hospital_bloc.dart';
import '../bloc/hospital_event.dart';
import '../bloc/hospital_state.dart';
import '../widgets/hospital_card.dart';

class HospitalPage extends StatelessWidget {
  const HospitalPage({super.key});

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => HospitalBloc(
        HospitalRepositoryImpl(
          HospitalRemoteDatasource(sl<ApiClient>()),
          HospitalCacheDatasource(sl<CacheDatabase>()),
          sl<ConnectivityService>(),
        ),
      )..add(LoadNearbyHospitals()),
      child: const _HospitalView(),
    );
  }
}

class _HospitalView extends StatelessWidget {
  const _HospitalView();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Hospitals'),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(56),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
            child: TextField(
              decoration: InputDecoration(
                hintText: 'Search hospitals...',
                prefixIcon: const Icon(Icons.search),
                filled: true,
                fillColor: Theme.of(context).colorScheme.surfaceContainerHighest,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                  borderSide: BorderSide.none,
                ),
                contentPadding: const EdgeInsets.symmetric(vertical: 0),
              ),
              onChanged: (q) =>
                  context.read<HospitalBloc>().add(SearchHospitals(q)),
            ),
          ),
        ),
      ),
      body: BlocBuilder<HospitalBloc, HospitalState>(
        builder: (context, state) {
          if (state is HospitalLoading) {
            return const Center(child: CircularProgressIndicator());
          }
          if (state is HospitalError) {
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
                        .read<HospitalBloc>()
                        .add(LoadNearbyHospitals()),
                    child: const Text('Retry'),
                  ),
                ],
              ),
            );
          }
          if (state is HospitalListLoaded) {
            final list = state.filtered;
            if (list.isEmpty) {
              return Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.local_hospital,
                        size: 64, color: AppColors.textSecondary),
                    const SizedBox(height: 16),
                    Text(
                      state.searchQuery.isNotEmpty
                          ? 'No hospitals match "${state.searchQuery}"'
                          : 'No hospitals found',
                    ),
                    if (state.searchQuery.isEmpty) ...[
                      const SizedBox(height: 8),
                      const Text(
                        'Pull down to refresh',
                        style: TextStyle(color: AppColors.textSecondary),
                      ),
                    ],
                  ],
                ),
              );
            }
            return RefreshIndicator(
              onRefresh: () async {
                context.read<HospitalBloc>().add(LoadNearbyHospitals());
              },
              child: ListView.builder(
                padding: const EdgeInsets.all(16),
                itemCount: list.length,
                itemBuilder: (context, i) {
                  final hospital = list[i];
                  return HospitalCard(
                    hospital: hospital,
                    onTap: () => context.push(
                      '/hospital/detail/${hospital.id}',
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
