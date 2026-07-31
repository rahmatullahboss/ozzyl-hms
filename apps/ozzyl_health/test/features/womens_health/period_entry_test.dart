import 'package:flutter_test/flutter_test.dart';
import 'package:ozzyl_health/features/womens_health/domain/entities/period_entry.dart';

void main() {
  group('PeriodEntry', () {
    test('creates entry with required fields', () {
      final entry = PeriodEntry(
        date: DateTime(2024, 4, 15),
        flowLevel: 2,
      );

      expect(entry.date, DateTime(2024, 4, 15));
      expect(entry.flowLevel, 2);
      expect(entry.id, isNull);
      expect(entry.symptoms, isNull);
      expect(entry.notes, isNull);
    });

    test('creates entry with all fields', () {
      final entry = PeriodEntry(
        id: 1,
        date: DateTime(2024, 4, 15),
        flowLevel: 3,
        symptoms: 'Cramps, Headache',
        notes: 'Heavy day',
      );

      expect(entry.id, 1);
      expect(entry.flowLevel, 3);
      expect(entry.symptoms, 'Cramps, Headache');
      expect(entry.notes, 'Heavy day');
    });

    test('flowLevel ranges from 0 to 4', () {
      for (int i = 0; i <= 4; i++) {
        final entry = PeriodEntry(
          date: DateTime.now(),
          flowLevel: i,
        );
        expect(entry.flowLevel, i);
      }
    });
  });
}
