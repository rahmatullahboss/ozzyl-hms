abstract final class ApiConstants {
  static const String prodBaseUrl =
      'https://hms-saas-production.rahmatullahzisan.workers.dev';
  static const String stagingBaseUrl =
      'https://hms-saas-staging.rahmatullahzisan.workers.dev';

  static const String authLogin = '/api/patient-auth/login';
  static const String authRegister = '/api/patient-auth/register';
  static const String authLogout = '/api/patient-auth/logout';
  static const String authMfaVerify = '/api/auth/mfa/verify';

  static const String appointments = '/api/v1/appointments';
  static const String prescriptions = '/api/v1/prescriptions';
  static const String labResults = '/api/v1/lab/results';
  static const String patientPhr = '/api/v1/patient-phr';
  static const String wellnessSync = '/api/v1/wellness/sync';
  static const String doctors = '/api/v1/doctors';
  static const String publicHospitals = '/api/v1/public/hospitals';
  static const String patientFamily = '/api/v1/patients/family';
  static const String pushNotifications = '/api/v1/push-notifications';
  static const String patientPortalNotifications =
      '/api/patient-portal/notifications';
  static const String patientProfile = '/api/v1/patients/me';
  static const String healthArticles = '/api/v1/public/health-articles';
  static const String linkHospital = '/api/v1/patients/link-hospital';
  static const String ai = '/api/v1/ai';
}
