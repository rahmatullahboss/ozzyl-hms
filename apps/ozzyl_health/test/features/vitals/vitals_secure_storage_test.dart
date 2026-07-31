import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:ozzyl_health/features/vitals/data/vitals_secure_storage.dart';
import 'package:ozzyl_health/features/vitals/domain/vital_entry.dart';

class MockSecureStorage extends Mock implements FlutterSecureStorage {}

void main() {
  late MockSecureStorage secureStorage;
  late VitalsSecureStorage storage;

  setUp(() {
    secureStorage = MockSecureStorage();
    storage = VitalsSecureStorage(secureStorage);
  });

  group('VitalsSecureStorage', () {
    test('returns empty list for missing or corrupt data', () async {
      when(() => secureStorage.read(key: VitalsSecureStorage.storageKey))
          .thenAnswer((_) async => '{bad-json');

      expect(await storage.readAll(), isEmpty);
    });

    test('persists newest entry in secure storage', () async {
      when(() => secureStorage.read(key: VitalsSecureStorage.storageKey))
          .thenAnswer((_) async => null);
      when(() => secureStorage.write(
            key: VitalsSecureStorage.storageKey,
            value: any(named: 'value'),
          )).thenAnswer((_) async {});

      await storage.add(
        VitalEntry(
          id: '1',
          timestamp: DateTime.utc(2026, 5, 1),
          systolic: 120,
          diastolic: 80,
        ),
      );

      final written = verify(() => secureStorage.write(
            key: VitalsSecureStorage.storageKey,
            value: captureAny(named: 'value'),
          )).captured.single as String;

      expect(written, contains('"systolic":120'));
      expect(written, contains('"diastolic":80'));
    });
  });
}
