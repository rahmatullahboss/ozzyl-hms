import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import '../domain/vital_entry.dart';

class VitalsSecureStorage {
  static const storageKey = 'wellness.vitals.v1';
  final FlutterSecureStorage _storage;

  VitalsSecureStorage(this._storage);

  Future<List<VitalEntry>> readAll() async {
    final encoded = await _storage.read(key: storageKey);
    if (encoded == null || encoded.isEmpty) return [];
    try {
      final decoded = jsonDecode(encoded);
      if (decoded is! List) return [];
      return decoded
          .whereType<Map<String, dynamic>>()
          .map(VitalEntry.fromJson)
          .toList()
        ..sort((a, b) => b.timestamp.compareTo(a.timestamp));
    } catch (_) {
      return [];
    }
  }

  Future<void> add(VitalEntry entry) async {
    final entries = await readAll();
    final next = [entry, ...entries].take(200).toList();
    await _storage.write(
      key: storageKey,
      value: jsonEncode(next.map((entry) => entry.toJson()).toList()),
    );
  }
}
