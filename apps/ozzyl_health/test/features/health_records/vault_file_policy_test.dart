import 'package:flutter_test/flutter_test.dart';
import 'package:ozzyl_health/features/health_records/domain/services/vault_file_policy.dart';

void main() {
  group('VaultFilePolicy', () {
    test('accepts allowed PDF and image files under 10MB', () {
      expect(
        VaultFilePolicy.validate(fileName: 'report.pdf', sizeBytes: 1024),
        isNull,
      );
      expect(
        VaultFilePolicy.validate(
            fileName: 'prescription.webp', sizeBytes: 1024),
        isNull,
      );
    });

    test('rejects unsupported files and files larger than 10MB', () {
      expect(
        VaultFilePolicy.validate(fileName: 'malware.exe', sizeBytes: 1024),
        contains('Only PDF'),
      );
      expect(
        VaultFilePolicy.validate(
          fileName: 'huge.pdf',
          sizeBytes: VaultFilePolicy.maxBytes + 1,
        ),
        contains('10MB'),
      );
    });

    test('maps file extensions to backend-allowed MIME types', () {
      expect(VaultFilePolicy.mimeTypeFor('a.pdf'), 'application/pdf');
      expect(VaultFilePolicy.mimeTypeFor('a.jpg'), 'image/jpeg');
      expect(VaultFilePolicy.mimeTypeFor('a.png'), 'image/png');
      expect(VaultFilePolicy.mimeTypeFor('a.webp'), 'image/webp');
    });
  });
}
