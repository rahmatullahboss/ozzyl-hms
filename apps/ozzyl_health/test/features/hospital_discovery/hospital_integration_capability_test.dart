import 'package:flutter_test/flutter_test.dart';
import 'package:ozzyl_core/ozzyl_core.dart';
import 'package:ozzyl_health/features/hospital_discovery/domain/services/hospital_integration_capability.dart';

void main() {
  group('HospitalIntegrationCapabilityService', () {
    test('marks appointments available when doctors are exposed', () {
      final capabilities = HospitalIntegrationCapabilityService.forDetail(
        HospitalDetail(
          hospital: const Hospital(id: 'h1', name: 'City Hospital'),
          doctors: const [
            HospitalDoctor(id: 'd1', name: 'Dr. Rahman'),
          ],
        ),
      );

      final appointments = capabilities.singleWhere(
        (capability) => capability.label == 'Appointments',
      );

      expect(appointments.status, HospitalIntegrationStatus.available);
    });

    test('keeps record sync setup-gated for patient ID mapping', () {
      final capabilities = HospitalIntegrationCapabilityService.forDetail(
        HospitalDetail(
          hospital: const Hospital(id: 'h1', name: 'City Hospital'),
          departments: const [
            HospitalDepartment(name: 'Pathology'),
          ],
        ),
      );

      final labs = capabilities.singleWhere(
        (capability) => capability.label == 'Lab reports',
      );
      final prescriptions = capabilities.singleWhere(
        (capability) => capability.label == 'Prescriptions',
      );

      expect(labs.status, HospitalIntegrationStatus.limited);
      expect(prescriptions.status, HospitalIntegrationStatus.requiresSetup);
    });
  });
}
