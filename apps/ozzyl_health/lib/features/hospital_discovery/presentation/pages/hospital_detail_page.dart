import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:ozzyl_core/ozzyl_core.dart';
import '../../../../core/di/injection.dart';
import '../../../../core/database/cache_database.dart';
import '../../data/datasources/hospital_remote_datasource.dart';
import '../../data/datasources/hospital_cache_datasource.dart';
import '../../data/repositories/hospital_repository_impl.dart';
import '../../domain/services/hospital_integration_capability.dart';
import '../bloc/hospital_bloc.dart';
import '../bloc/hospital_event.dart';
import '../bloc/hospital_state.dart';

class HospitalDetailPage extends StatelessWidget {
  final String hospitalId;
  const HospitalDetailPage({super.key, required this.hospitalId});

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => HospitalBloc(
        HospitalRepositoryImpl(
          HospitalRemoteDatasource(sl<ApiClient>()),
          HospitalCacheDatasource(sl<CacheDatabase>()),
          sl<ConnectivityService>(),
        ),
      )..add(LoadHospitalDetail(hospitalId)),
      child: const _DetailView(),
    );
  }
}

class _DetailView extends StatelessWidget {
  const _DetailView();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: BlocBuilder<HospitalBloc, HospitalState>(
        builder: (context, state) {
          if (state is HospitalLoading) {
            return const Center(child: CircularProgressIndicator());
          }
          if (state is HospitalError) {
            return Scaffold(
              appBar: AppBar(),
              body: Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.error_outline,
                        size: 48, color: AppColors.error),
                    const SizedBox(height: 12),
                    Text(state.message),
                  ],
                ),
              ),
            );
          }
          if (state is HospitalDetailLoaded) {
            return _buildDetail(context, state.detail);
          }
          return const SizedBox.shrink();
        },
      ),
    );
  }

  Widget _buildDetail(BuildContext context, HospitalDetail detail) {
    final hospital = detail.hospital;
    return CustomScrollView(
      slivers: [
        SliverAppBar(
          expandedHeight: 200,
          pinned: true,
          flexibleSpace: FlexibleSpaceBar(
            title: Text(
              hospital.name,
              style: const TextStyle(fontSize: 16),
            ),
            background: hospital.imageUrl != null
                ? CachedNetworkImage(
                    imageUrl: hospital.imageUrl!,
                    fit: BoxFit.cover,
                    color: Colors.black38,
                    colorBlendMode: BlendMode.darken,
                  )
                : Container(
                    color: AppColors.primary,
                    child: const Center(
                      child: Icon(Icons.local_hospital,
                          size: 64, color: Colors.white70),
                    ),
                  ),
          ),
        ),
        SliverToBoxAdapter(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Info row
                Row(
                  children: [
                    if (hospital.rating != null) ...[
                      const Icon(Icons.star,
                          size: 20, color: AppColors.warning),
                      const SizedBox(width: 4),
                      Text(
                        '${hospital.rating}',
                        style: const TextStyle(
                            fontWeight: FontWeight.w600, fontSize: 16),
                      ),
                      const SizedBox(width: 16),
                    ],
                    if (hospital.bedCount != null) ...[
                      const Icon(Icons.bed,
                          size: 20, color: AppColors.textSecondary),
                      const SizedBox(width: 4),
                      Text('${hospital.bedCount} beds'),
                      const SizedBox(width: 16),
                    ],
                    if (hospital.city != null) ...[
                      const Icon(Icons.location_city,
                          size: 20, color: AppColors.textSecondary),
                      const SizedBox(width: 4),
                      Text(hospital.city!),
                    ],
                  ],
                ),

                if (hospital.address != null) ...[
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      const Icon(Icons.location_on,
                          size: 18, color: AppColors.textSecondary),
                      const SizedBox(width: 8),
                      Expanded(child: Text(hospital.address!)),
                    ],
                  ),
                ],

                // Contact row
                const SizedBox(height: 16),
                Row(
                  children: [
                    if (hospital.phone != null)
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: () =>
                              launchUrl(Uri.parse('tel:${hospital.phone}')),
                          icon: const Icon(Icons.phone, size: 18),
                          label: const Text('Call'),
                        ),
                      ),
                    if (hospital.phone != null && detail.website != null)
                      const SizedBox(width: 12),
                    if (detail.website != null)
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: () =>
                              launchUrl(Uri.parse(detail.website!)),
                          icon: const Icon(Icons.language, size: 18),
                          label: const Text('Website'),
                        ),
                      ),
                  ],
                ),

                // About
                if (detail.about != null) ...[
                  const SizedBox(height: 24),
                  Text('About', style: Theme.of(context).textTheme.titleMedium),
                  const SizedBox(height: 8),
                  Text(detail.about!),
                ],

                // Specialties
                if (hospital.specialties.isNotEmpty) ...[
                  const SizedBox(height: 24),
                  Text('Specialties',
                      style: Theme.of(context).textTheme.titleMedium),
                  const SizedBox(height: 8),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: hospital.specialties
                        .map((s) => Chip(label: Text(s)))
                        .toList(),
                  ),
                ],

                const SizedBox(height: 24),
                Text('Integration capability',
                    style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 8),
                Text(
                  'Shows what this hospital can support in the patient app. Final access still depends on consent, patient ID mapping, and hospital-side HMS integration.',
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: AppColors.textSecondary,
                      ),
                ),
                const SizedBox(height: 12),
                ...HospitalIntegrationCapabilityService.forDetail(detail)
                    .map((capability) => _CapabilityTile(capability)),

                // Departments
                if (detail.departments.isNotEmpty) ...[
                  const SizedBox(height: 24),
                  Text('Departments',
                      style: Theme.of(context).textTheme.titleMedium),
                  const SizedBox(height: 8),
                  ...detail.departments.map((d) => ListTile(
                        dense: true,
                        leading: const Icon(Icons.medical_services_outlined),
                        title: Text(d.name),
                        subtitle: d.description != null
                            ? Text(d.description!,
                                maxLines: 1, overflow: TextOverflow.ellipsis)
                            : null,
                        trailing: d.doctorCount != null
                            ? Text('${d.doctorCount} doctors')
                            : null,
                      )),
                ],

                // Doctors
                if (detail.doctors.isNotEmpty) ...[
                  const SizedBox(height: 24),
                  Text('Doctors',
                      style: Theme.of(context).textTheme.titleMedium),
                  const SizedBox(height: 8),
                  ...detail.doctors.map((d) => Card(
                        margin: const EdgeInsets.only(bottom: 8),
                        child: ListTile(
                          leading: CircleAvatar(
                            backgroundImage: d.imageUrl != null
                                ? CachedNetworkImageProvider(d.imageUrl!)
                                : null,
                            child: d.imageUrl == null
                                ? const Icon(Icons.person)
                                : null,
                          ),
                          title: Text(d.name),
                          subtitle:
                              d.specialty != null ? Text(d.specialty!) : null,
                          trailing: d.available == true
                              ? const Chip(
                                  label: Text('Available',
                                      style: TextStyle(fontSize: 12)),
                                  backgroundColor: Color(0xFFE8F5E9),
                                )
                              : null,
                        ),
                      )),
                ],

                // Photos
                if (detail.photos.isNotEmpty) ...[
                  const SizedBox(height: 24),
                  Text('Photos',
                      style: Theme.of(context).textTheme.titleMedium),
                  const SizedBox(height: 8),
                  SizedBox(
                    height: 120,
                    child: ListView.separated(
                      scrollDirection: Axis.horizontal,
                      itemCount: detail.photos.length,
                      separatorBuilder: (_, __) => const SizedBox(width: 8),
                      itemBuilder: (_, i) => ClipRRect(
                        borderRadius: BorderRadius.circular(12),
                        child: CachedNetworkImage(
                          imageUrl: detail.photos[i],
                          width: 160,
                          height: 120,
                          fit: BoxFit.cover,
                        ),
                      ),
                    ),
                  ),
                ],

                // Link button
                const SizedBox(height: 32),
                SizedBox(
                  width: double.infinity,
                  child: ElevatedButton.icon(
                    onPressed: () {
                      context
                          .read<HospitalBloc>()
                          .add(LinkHospital(hospital.id));
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(
                            content: Text('Hospital linked to your account')),
                      );
                    },
                    icon: const Icon(Icons.link),
                    label: const Text('Link as My Hospital'),
                  ),
                ),
                const SizedBox(height: 24),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _CapabilityTile extends StatelessWidget {
  final HospitalIntegrationCapability capability;

  const _CapabilityTile(this.capability);

  @override
  Widget build(BuildContext context) {
    final color = switch (capability.status) {
      HospitalIntegrationStatus.available => AppColors.success,
      HospitalIntegrationStatus.limited => AppColors.warning,
      HospitalIntegrationStatus.requiresSetup => AppColors.primary,
      HospitalIntegrationStatus.unavailable => AppColors.textSecondary,
    };
    final icon = switch (capability.status) {
      HospitalIntegrationStatus.available => Icons.check_circle_outline,
      HospitalIntegrationStatus.limited => Icons.info_outline,
      HospitalIntegrationStatus.requiresSetup => Icons.sync_alt,
      HospitalIntegrationStatus.unavailable => Icons.block,
    };
    final statusLabel = switch (capability.status) {
      HospitalIntegrationStatus.available => 'Available',
      HospitalIntegrationStatus.limited => 'Limited',
      HospitalIntegrationStatus.requiresSetup => 'Setup needed',
      HospitalIntegrationStatus.unavailable => 'Unavailable',
    };

    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: ListTile(
        leading: Icon(icon, color: color),
        title: Text(capability.label),
        subtitle: Text(capability.description),
        trailing: Chip(
          label: Text(statusLabel, style: const TextStyle(fontSize: 12)),
          backgroundColor: color.withValues(alpha: 0.12),
          side: BorderSide(color: color.withValues(alpha: 0.2)),
        ),
      ),
    );
  }
}
