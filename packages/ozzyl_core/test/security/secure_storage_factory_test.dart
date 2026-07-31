import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ozzyl_core/ozzyl_core.dart';

void main() {
  group('createOzzylSecureStorage', () {
    test('uses stronger Android storage algorithms for health credentials', () {
      final storage = createOzzylSecureStorage();
      final options = storage.aOptions.toMap();

      expect(
        options['keyCipherAlgorithm'],
        'RSA_ECB_OAEPwithSHA_256andMGF1Padding',
      );
      expect(options['storageCipherAlgorithm'], 'AES_GCM_NoPadding');
      expect(options['resetOnError'], 'true');
    });

    test(
      'keeps iOS keychain items device-local and available only when unlocked',
      () {
        final storage = createOzzylSecureStorage();
        final options = storage.iOptions.toMap();

        expect(options['accessibility'], 'unlocked_this_device');
        expect(options['synchronizable'], 'false');
      },
    );

    test('returns a FlutterSecureStorage instance', () {
      expect(createOzzylSecureStorage(), isA<FlutterSecureStorage>());
    });
  });
}
