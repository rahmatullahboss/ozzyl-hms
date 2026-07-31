import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:ozzyl_health/features/privacy/data/consent_preferences_storage.dart';

class MockSecureStorage extends Mock implements FlutterSecureStorage {}

void main() {
  late MockSecureStorage secureStorage;
  late ConsentPreferencesStorage storage;

  setUp(() {
    secureStorage = MockSecureStorage();
    storage = ConsentPreferencesStorage(secureStorage);
  });

  group('ConsentPreferencesStorage', () {
    test('defaults to no sensitive sharing when empty', () async {
      when(() => secureStorage.read(key: ConsentPreferencesStorage.storageKey))
          .thenAnswer((_) async => null);

      final preferences = await storage.read();

      expect(preferences.hospitalAccess, isFalse);
      expect(preferences.aiContextAccess, isFalse);
      expect(preferences.familyProxyAccess, isFalse);
    });

    test('saves consent preferences to secure storage', () async {
      when(() => secureStorage.write(
            key: ConsentPreferencesStorage.storageKey,
            value: any(named: 'value'),
          )).thenAnswer((_) async {});

      await storage.save(
        ConsentPreferences.defaults().copyWith(hospitalAccess: true),
      );

      final written = verify(() => secureStorage.write(
            key: ConsentPreferencesStorage.storageKey,
            value: captureAny(named: 'value'),
          )).captured.single as String;

      expect(written, contains('"hospitalAccess":true'));
    });
  });
}
