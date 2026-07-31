import { describe, expect, it } from 'vitest';
import {
  getPatientAuthTabMeta,
  getPatientNidError,
  getPatientPhoneError,
  getPatientRegisterProgress,
} from '../../apps/ozzyl-lifestyle/src/lib/patientAuthUi';

const translations: Record<string, string> = {
  'patientLogin.phoneFormatError': 'Invalid phone format',
  'patientLogin.nidFormatError': 'Invalid nid format',
  'patientLogin.title': 'Sign in',
  'patientLogin.description': 'Patient login',
  'patientLogin.loginButton': 'Continue',
  'patientLogin.googleLoginTitle': 'Google sign in',
  'patientLogin.googleLoginSubtitle': 'Use Google',
  'patientLogin.registerTitle': 'Create account',
  'patientLogin.registerDescription': 'Register now',
  'patientLogin.registerButton': 'Create',
  'patientLogin.googleSignupTitle': 'Google sign up',
  'patientLogin.googleSignupSubtitle': 'Use Google to sign up',
  'patientLogin.forgotTitle': 'Forgot password',
  'patientLogin.forgotDescription': 'Reset access',
  'patientLogin.forgotButton': 'Send reset',
  'patientLogin.googleSigninTitle': 'Sign in instead',
  'patientLogin.googleSigninSubtitle': 'Go back to sign in',
};

const t = (key: string) => translations[key] ?? key;

describe('patient auth ui helpers', () => {
  it('validates phone and nid only when values are present', () => {
    expect(getPatientPhoneError('', t)).toBe('');
    expect(getPatientPhoneError('01912345678', t)).toBe('');
    expect(getPatientPhoneError('123', t)).toBe('Invalid phone format');

    expect(getPatientNidError('', t)).toBe('');
    expect(getPatientNidError('1234567890', t)).toBe('');
    expect(getPatientNidError('123', t)).toBe('Invalid nid format');
  });

  it('tracks register progress using the same required milestones as the UI', () => {
    expect(getPatientRegisterProgress({
      name: 'Rahim',
      email: '',
      phone: '01912345678',
      registerPassword: 'secret123',
      confirmPassword: 'secret123',
    })).toBe(4);

    expect(getPatientRegisterProgress({
      name: 'Rahim',
      email: '',
      phone: '',
      registerPassword: 'secret123',
      confirmPassword: 'different',
    })).toBe(2);
  });

  it('returns tab-specific copy for login, register, and forgot states', () => {
    expect(getPatientAuthTabMeta('login', t).title).toBe('Sign in');
    expect(getPatientAuthTabMeta('register', t).button).toBe('Create');
    expect(getPatientAuthTabMeta('forgot', t).googleTitle).toBe('Sign in instead');
  });
});
