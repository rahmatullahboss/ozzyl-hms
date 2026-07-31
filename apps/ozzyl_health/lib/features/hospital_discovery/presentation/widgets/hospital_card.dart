import 'package:flutter/material.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:ozzyl_core/ozzyl_core.dart';

class HospitalCard extends StatelessWidget {
  final Hospital hospital;
  final double? distanceKm;
  final VoidCallback onTap;

  const HospitalCard({
    super.key,
    required this.hospital,
    this.distanceKm,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(12),
                child: hospital.imageUrl != null
                    ? CachedNetworkImage(
                        imageUrl: hospital.imageUrl!,
                        width: 72,
                        height: 72,
                        fit: BoxFit.cover,
                        placeholder: (_, __) => Container(
                          width: 72,
                          height: 72,
                          color: AppColors.primary.withValues(alpha: 0.1),
                          child: const Icon(Icons.local_hospital,
                              color: AppColors.primary),
                        ),
                        errorWidget: (_, __, ___) => _placeholder(),
                      )
                    : _placeholder(),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      hospital.name,
                      style: const TextStyle(
                        fontWeight: FontWeight.w600,
                        fontSize: 16,
                      ),
                    ),
                    if (hospital.address != null)
                      Text(
                        hospital.address!,
                        style: Theme.of(context).textTheme.bodyMedium,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    const SizedBox(height: 4),
                    Row(
                      children: [
                        if (hospital.rating != null) ...[
                          const Icon(Icons.star,
                              size: 16, color: AppColors.warning),
                          Text(
                            ' ${hospital.rating}',
                            style:
                                const TextStyle(fontWeight: FontWeight.w600),
                          ),
                          const SizedBox(width: 12),
                        ],
                        if (distanceKm != null) ...[
                          const Icon(Icons.location_on,
                              size: 16, color: AppColors.textSecondary),
                          Text(' ${distanceKm!.toStringAsFixed(1)} km'),
                        ],
                      ],
                    ),
                    if (hospital.specialties.isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(top: 4),
                        child: Text(
                          hospital.specialties.take(3).join(', '),
                          style: const TextStyle(
                            fontSize: 12,
                            color: AppColors.primary,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right),
            ],
          ),
        ),
      ),
    );
  }

  Widget _placeholder() {
    return Container(
      width: 72,
      height: 72,
      color: AppColors.primary.withValues(alpha: 0.1),
      child: const Icon(
        Icons.local_hospital,
        color: AppColors.primary,
        size: 32,
      ),
    );
  }
}
