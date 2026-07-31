import 'package:flutter_test/flutter_test.dart';
import 'package:ozzyl_health/features/symptom_checker/domain/symptom_safety.dart';

void main() {
  group('SymptomSafety', () {
    test('detects emergency red flags from selected symptoms and context', () {
      expect(
        SymptomSafety.hasEmergencyRedFlag(['Chest Pain'], null),
        isTrue,
      );
      expect(
        SymptomSafety.hasEmergencyRedFlag(['Headache'], 'I fainted today'),
        isTrue,
      );
    });

    test('does not flag routine wellness symptoms as emergency by default', () {
      expect(
        SymptomSafety.hasEmergencyRedFlag(['Runny Nose'], 'mild for one day'),
        isFalse,
      );
    });

    test('withholds unsafe diagnostic or dosage-like AI wording', () {
      final safe = SymptomSafety.safeFallback('Your diagnosis is flu.');
      expect(safe, contains('withheld'));

      final normal = SymptomSafety.safeFallback('Rest and monitor symptoms.');
      expect(normal, contains(SymptomSafety.disclaimer));
    });
  });
}
