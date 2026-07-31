class SymptomSafety {
  static const String disclaimer =
      'This is educational wellness information, not a diagnosis. A licensed clinician must evaluate medical concerns.';

  static const List<String> redFlagTerms = [
    'chest pain',
    'shortness of breath',
    'difficulty breathing',
    'stroke',
    'fainting',
    'fainted',
    'unconscious',
    'severe bleeding',
    'suicidal',
    'seizure',
  ];

  static bool hasEmergencyRedFlag(List<String> symptoms, String? context) {
    final haystack = [
      ...symptoms,
      if (context != null) context,
    ].join(' ').toLowerCase();
    return redFlagTerms.any(haystack.contains);
  }

  static String emergencyMessage() {
    return 'Emergency red flags may be present. Call local emergency services or go to the nearest emergency department now. $disclaimer';
  }

  static String safeFallback(String raw) {
    final blocked = RegExp(
      r'\b(diagnosis is|you have|take \d|increase your dose|stop taking|prescribe)\b',
      caseSensitive: false,
    );
    if (blocked.hasMatch(raw)) {
      return 'The AI response was withheld because it sounded too clinical. Please consult a licensed professional. $disclaimer';
    }
    return '$raw\n\n$disclaimer';
  }
}
