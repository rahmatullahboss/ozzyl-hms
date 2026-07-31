import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class ConsentPreferences {
  final bool hospitalAccess;
  final bool aiContextAccess;
  final bool familyProxyAccess;
  final String acceptedLegalVersion;
  final DateTime updatedAt;

  const ConsentPreferences({
    required this.hospitalAccess,
    required this.aiContextAccess,
    required this.familyProxyAccess,
    required this.acceptedLegalVersion,
    required this.updatedAt,
  });

  factory ConsentPreferences.defaults() {
    return ConsentPreferences(
      hospitalAccess: false,
      aiContextAccess: false,
      familyProxyAccess: false,
      acceptedLegalVersion: '',
      updatedAt: DateTime.fromMillisecondsSinceEpoch(0),
    );
  }

  factory ConsentPreferences.fromJson(Map<String, dynamic> json) {
    return ConsentPreferences(
      hospitalAccess: json['hospitalAccess'] == true,
      aiContextAccess: json['aiContextAccess'] == true,
      familyProxyAccess: json['familyProxyAccess'] == true,
      acceptedLegalVersion: json['acceptedLegalVersion'] as String? ?? '',
      updatedAt: DateTime.tryParse(json['updatedAt'] as String? ?? '') ??
          DateTime.fromMillisecondsSinceEpoch(0),
    );
  }

  ConsentPreferences copyWith({
    bool? hospitalAccess,
    bool? aiContextAccess,
    bool? familyProxyAccess,
    String? acceptedLegalVersion,
    DateTime? updatedAt,
  }) {
    return ConsentPreferences(
      hospitalAccess: hospitalAccess ?? this.hospitalAccess,
      aiContextAccess: aiContextAccess ?? this.aiContextAccess,
      familyProxyAccess: familyProxyAccess ?? this.familyProxyAccess,
      acceptedLegalVersion: acceptedLegalVersion ?? this.acceptedLegalVersion,
      updatedAt: updatedAt ?? this.updatedAt,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'hospitalAccess': hospitalAccess,
      'aiContextAccess': aiContextAccess,
      'familyProxyAccess': familyProxyAccess,
      'acceptedLegalVersion': acceptedLegalVersion,
      'updatedAt': updatedAt.toIso8601String(),
    };
  }
}

class ConsentPreferencesStorage {
  static const storageKey = 'privacy.consent_preferences.v1';

  final FlutterSecureStorage _storage;

  ConsentPreferencesStorage(this._storage);

  Future<ConsentPreferences> read() async {
    final encoded = await _storage.read(key: storageKey);
    if (encoded == null || encoded.isEmpty) {
      return ConsentPreferences.defaults();
    }
    try {
      final decoded = jsonDecode(encoded);
      if (decoded is Map<String, dynamic>) {
        return ConsentPreferences.fromJson(decoded);
      }
    } catch (_) {
      return ConsentPreferences.defaults();
    }
    return ConsentPreferences.defaults();
  }

  Future<void> save(ConsentPreferences preferences) async {
    await _storage.write(
        key: storageKey, value: jsonEncode(preferences.toJson()));
  }
}
