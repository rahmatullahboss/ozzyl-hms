import 'package:ozzyl_core/ozzyl_core.dart';

enum HospitalIntegrationStatus {
  available,
  limited,
  unavailable,
  requiresSetup,
}

class HospitalIntegrationCapability {
  final String label;
  final String description;
  final HospitalIntegrationStatus status;

  const HospitalIntegrationCapability({
    required this.label,
    required this.description,
    required this.status,
  });
}

class HospitalIntegrationCapabilityService {
  static List<HospitalIntegrationCapability> forDetail(HospitalDetail detail) {
    final hasDoctors = detail.doctors.isNotEmpty;
    final hasDepartments = detail.departments.isNotEmpty;
    final hasContact = detail.hospital.phone != null || detail.website != null;

    return [
      HospitalIntegrationCapability(
        label: 'Appointments',
        description: hasDoctors
            ? 'Doctor availability can be shown when the hospital exposes slots.'
            : 'Doctor roster is not available from this hospital yet.',
        status: hasDoctors
            ? HospitalIntegrationStatus.available
            : HospitalIntegrationStatus.requiresSetup,
      ),
      HospitalIntegrationCapability(
        label: 'Lab reports',
        description: hasDepartments
            ? 'Reports can be synced after the hospital maps patient IDs.'
            : 'Lab report sync needs hospital-side integration.',
        status: hasDepartments
            ? HospitalIntegrationStatus.limited
            : HospitalIntegrationStatus.requiresSetup,
      ),
      const HospitalIntegrationCapability(
        label: 'Prescriptions',
        description:
            'Prescription sync requires consent, audit logs, and HMS mapping.',
        status: HospitalIntegrationStatus.requiresSetup,
      ),
      const HospitalIntegrationCapability(
        label: 'Documents',
        description:
            'Document exchange requires protected storage and signed file links.',
        status: HospitalIntegrationStatus.requiresSetup,
      ),
      HospitalIntegrationCapability(
        label: 'Payments',
        description: hasContact
            ? 'Payment status is not connected; contact the hospital directly.'
            : 'Payment integration is not exposed by this hospital.',
        status: HospitalIntegrationStatus.unavailable,
      ),
    ];
  }
}
