import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class EmergencyContact {
  final String name;
  final String phone;

  const EmergencyContact({
    required this.name,
    required this.phone,
  });

  factory EmergencyContact.fromJson(Map<String, dynamic> json) {
    return EmergencyContact(
      name: json['name'] as String? ?? '',
      phone: json['phone'] as String? ?? '',
    );
  }

  Map<String, String> toJson() {
    return {
      'name': name,
      'phone': phone,
    };
  }
}

class EmergencyProfile {
  final String bloodType;
  final List<String> allergies;
  final List<EmergencyContact> contacts;

  const EmergencyProfile({
    required this.bloodType,
    required this.allergies,
    required this.contacts,
  });
}

class EmergencyProfileStorage {
  static const bloodTypeKey = 'emergency_profile.blood_type';
  static const allergiesKey = 'emergency_profile.allergies';
  static const contactsKey = 'emergency_profile.contacts';

  final FlutterSecureStorage _storage;

  EmergencyProfileStorage(this._storage);

  Future<EmergencyProfile> read() async {
    final bloodType = await _storage.read(key: bloodTypeKey) ?? 'Unknown';
    final allergies = _decodeStringList(await _storage.read(key: allergiesKey));
    final contacts = _decodeContacts(await _storage.read(key: contactsKey));

    return EmergencyProfile(
      bloodType: bloodType,
      allergies: allergies,
      contacts: contacts,
    );
  }

  Future<void> saveBloodType(String bloodType) async {
    await _storage.write(key: bloodTypeKey, value: bloodType);
  }

  Future<void> saveAllergies(List<String> allergies) async {
    await _storage.write(key: allergiesKey, value: jsonEncode(allergies));
  }

  Future<void> saveContacts(List<EmergencyContact> contacts) async {
    await _storage.write(
      key: contactsKey,
      value: jsonEncode(contacts.map((contact) => contact.toJson()).toList()),
    );
  }

  List<String> _decodeStringList(String? encoded) {
    if (encoded == null || encoded.isEmpty) {
      return [];
    }
    try {
      final decoded = jsonDecode(encoded);
      if (decoded is! List) {
        return [];
      }
      return decoded.whereType<String>().toList();
    } catch (_) {
      return [];
    }
  }

  List<EmergencyContact> _decodeContacts(String? encoded) {
    if (encoded == null || encoded.isEmpty) {
      return [];
    }
    try {
      final decoded = jsonDecode(encoded);
      if (decoded is! List) {
        return [];
      }
      return decoded
          .whereType<Map<String, dynamic>>()
          .map(EmergencyContact.fromJson)
          .where(
              (contact) => contact.name.isNotEmpty && contact.phone.isNotEmpty)
          .toList();
    } catch (_) {
      return [];
    }
  }
}
