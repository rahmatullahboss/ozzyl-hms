import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:ozzyl_core/ozzyl_core.dart';
import 'package:ozzyl_health/features/auth/data/datasources/auth_remote_datasource.dart';

void main() {
  test('patient auth API constants target global patient endpoints', () {
    expect(ApiConstants.authLogin, '/api/patient-auth/login');
    expect(ApiConstants.authRegister, '/api/patient-auth/register');
    expect(ApiConstants.authLogout, '/api/patient-auth/logout');
  });

  test('normalizes global patient response into mobile AuthResponse contract', () {
    final response = normalizePatientAuthResponse({
      'token': 'patient-jwt',
      'user': {
        'id': 41,
        'name': 'Patient One',
        'email': 'patient@example.com',
        'phone': '01700000000',
        'uhid': 'UHID-41',
      },
    });

    expect(response.token, 'patient-jwt');
    expect(response.user.id, '41');
    expect(response.user.name, 'Patient One');
    expect(response.user.email, 'patient@example.com');
    expect(response.user.phone, '01700000000');
    expect(response.user.role, 'patient');
    expect(response.user.tenantId, isNull);
    expect(response.mfaRequired, isFalse);
  });

  test('normalizes nullable patient email without claiming a tenant role', () {
    final response = normalizePatientAuthResponse({
      'token': 'pending-jwt',
      'user': {
        'id': 42,
        'name': 'Pending Patient',
        'email': null,
        'phone': '01800000000',
      },
    });

    expect(response.user.email, '');
    expect(response.user.role, 'patient');
    expect(response.user.tenantId, isNull);
  });

  test('builds patient login and Google credential payloads', () {
    const login = LoginRequest(email: 'patient@example.com', password: 'Pass1234');
    expect(patientLoginPayload(login), {
      'identifier': 'patient@example.com',
      'password': 'Pass1234',
    });
    expect(patientGooglePayload('google-id-token'), {
      'credential': 'google-id-token',
    });
  });

  test('accepts only verified patient identity profiles', () {
    expect(() => assertVerifiedPatientProfile({'authStatus': 'verified'}), returnsNormally);
    expect(
      () => assertVerifiedPatientProfile({'authStatus': 'pending_verification'}),
      throwsA(isA<StateError>()),
    );
    expect(
      () => assertVerifiedPatientProfile({'authStatus': 'suspended'}),
      throwsA(isA<StateError>()),
    );
    expect(
      () => assertVerifiedPatientProfile({}),
      throwsA(isA<StateError>()),
    );
  });

  test('wires post-login verification and fails registration closed', () async {
    final source = await File(
      'lib/features/auth/data/datasources/auth_remote_datasource.dart',
    ).readAsString();
    expect(source, contains("'/api/patient-auth/me'"));
    expect(source, contains("'Authorization': 'Bearer \$token'"));
    expect(source, contains('Patient self-registration requires the identity verification flow'));
  });

  test('rejects malformed patient auth evidence', () {
    expect(
      () => normalizePatientAuthResponse({'user': {'id': 1}}),
      throwsA(isA<FormatException>()),
    );
    expect(
      () => normalizePatientAuthResponse({'token': 'x', 'user': null}),
      throwsA(isA<FormatException>()),
    );
  });
}
