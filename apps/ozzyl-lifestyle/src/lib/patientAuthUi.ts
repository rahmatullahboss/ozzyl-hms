export type PatientAuthTab = 'login' | 'register' | 'forgot';

type Translate = (key: string) => string;

export const patientPhonePattern = /^01\d{9}$/;
export const patientNidPattern = /^\d{10}$|^\d{17}$/;

export interface PatientRegisterProgressInput {
  name: string;
  email: string;
  phone: string;
  registerPassword: string;
  confirmPassword: string;
}

export interface PatientAuthTabMeta {
  title: string;
  description: string;
  button: string;
  googleTitle: string;
  googleSubtitle: string;
}

export function getPatientPhoneError(phone: string, t: Translate) {
  if (!phone) return '';
  if (!patientPhonePattern.test(phone)) return t('patientLogin.phoneFormatError');
  return '';
}

export function getPatientNidError(nid: string, t: Translate) {
  if (!nid) return '';
  if (!patientNidPattern.test(nid)) return t('patientLogin.nidFormatError');
  return '';
}

export function getPatientRegisterProgress(input: PatientRegisterProgressInput) {
  return [
    Boolean(input.name.trim()),
    Boolean(input.email.trim()) || Boolean(input.phone.trim()),
    Boolean(input.registerPassword),
    Boolean(input.confirmPassword) && input.registerPassword === input.confirmPassword,
  ].filter(Boolean).length;
}

export function getPatientAuthTabMeta(tab: PatientAuthTab, t: Translate): PatientAuthTabMeta {
  if (tab === 'register') {
    return {
      title: t('patientLogin.registerTitle'),
      description: t('patientLogin.registerDescription'),
      button: t('patientLogin.registerButton'),
      googleTitle: t('patientLogin.googleSignupTitle'),
      googleSubtitle: t('patientLogin.googleSignupSubtitle'),
    };
  }

  if (tab === 'forgot') {
    return {
      title: t('patientLogin.forgotTitle'),
      description: t('patientLogin.forgotDescription'),
      button: t('patientLogin.forgotButton'),
      googleTitle: t('patientLogin.googleSigninTitle'),
      googleSubtitle: t('patientLogin.googleSigninSubtitle'),
    };
  }

  return {
    title: t('patientLogin.title'),
    description: t('patientLogin.description'),
    button: t('patientLogin.loginButton'),
    googleTitle: t('patientLogin.googleLoginTitle'),
    googleSubtitle: t('patientLogin.googleLoginSubtitle'),
  };
}
