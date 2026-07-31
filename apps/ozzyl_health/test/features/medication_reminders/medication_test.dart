import 'package:flutter_test/flutter_test.dart';
import 'package:ozzyl_health/features/medication_reminders/domain/entities/medication.dart';

void main() {
  group('Medication', () {
    test('creates medication with required fields', () {
      final med = Medication(
        name: 'Paracetamol',
        dosage: '500mg',
        frequency: 'daily',
        times: '["08:00"]',
      );

      expect(med.name, 'Paracetamol');
      expect(med.dosage, '500mg');
      expect(med.frequency, 'daily');
      expect(med.times, '["08:00"]');
      expect(med.active, isTrue);
      expect(med.id, isNull);
    });

    test('creates inactive medication', () {
      final med = Medication(
        id: 1,
        name: 'Amoxicillin',
        dosage: '250mg',
        frequency: 'twice_daily',
        times: '["08:00", "20:00"]',
        active: false,
      );

      expect(med.id, 1);
      expect(med.active, isFalse);
    });

    test('supports all frequency types', () {
      final frequencies = ['daily', 'twice_daily', 'weekly'];
      for (final freq in frequencies) {
        final med = Medication(
          name: 'Test Med',
          dosage: '100mg',
          frequency: freq,
          times: '["08:00"]',
        );
        expect(med.frequency, freq);
      }
    });
  });
}
