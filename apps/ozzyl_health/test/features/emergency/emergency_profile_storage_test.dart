import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:ozzyl_health/features/emergency/data/emergency_profile_storage.dart';

class MockSecureStorage extends Mock implements FlutterSecureStorage {}

void main() {
  late MockSecureStorage secureStorage;
  late EmergencyProfileStorage profileStorage;

  setUp(() {
    secureStorage = MockSecureStorage();
    profileStorage = EmergencyProfileStorage(secureStorage);
  });

  group('EmergencyProfileStorage', () {
    test('reads empty emergency profile defaults when secure storage is empty',
        () async {
      when(() => secureStorage.read(key: any(named: 'key')))
          .thenAnswer((_) async => null);

      final profile = await profileStorage.read();

      expect(profile.bloodType, 'Unknown');
      expect(profile.allergies, isEmpty);
      expect(profile.contacts, isEmpty);
    });

    test('saves emergency contacts in secure storage as JSON', () async {
      when(() => secureStorage.write(
            key: EmergencyProfileStorage.contactsKey,
            value: any(named: 'value'),
          )).thenAnswer((_) async {});

      await profileStorage.saveContacts([
        const EmergencyContact(name: 'Rahim', phone: '+8801700000000'),
      ]);

      final captured = verify(() => secureStorage.write(
            key: EmergencyProfileStorage.contactsKey,
            value: captureAny(named: 'value'),
          )).captured.single as String;

      expect(captured, contains('Rahim'));
      expect(captured, contains('+8801700000000'));
    });

    test('ignores corrupt contact JSON instead of crashing emergency screen',
        () async {
      when(() => secureStorage.read(key: EmergencyProfileStorage.bloodTypeKey))
          .thenAnswer((_) async => 'O+');
      when(() => secureStorage.read(key: EmergencyProfileStorage.allergiesKey))
          .thenAnswer((_) async => '["Penicillin"]');
      when(() => secureStorage.read(key: EmergencyProfileStorage.contactsKey))
          .thenAnswer((_) async => '{not-json');

      final profile = await profileStorage.read();

      expect(profile.bloodType, 'O+');
      expect(profile.allergies, ['Penicillin']);
      expect(profile.contacts, isEmpty);
    });
  });
}
