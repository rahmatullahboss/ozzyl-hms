import { ArrowRight, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router';
import {
  PATIENT_LOGIN_ASSURANCE_BODY,
  PATIENT_LOGIN_ASSURANCE_TITLE,
} from '../../lib/patientPortalUx';
import { getPatientPortalTopLevelPath } from '../../lib/patientPortalRouting';

interface PatientAuthRailProps {
  dashboardCtaLabel: string;
}

const RAIL_HIGHLIGHTS = [
  {
    title: 'Global identity first',
    body: 'Each patient gets one universal account and one global health identity.',
  },
  {
    title: 'Profile can mature later',
    body: 'Missing phone or NID can be added after Google signup from the dashboard.',
  },
  {
    title: 'What you unlock immediately',
    list: [
      'Health card and portable UHID',
      'Prescriptions, reports, and visit history in one place',
      'Vault uploads and self-reported health data',
    ],
  },
];

export function PatientAuthRail({ dashboardCtaLabel }: PatientAuthRailProps) {
  return (
    <div className="patient-auth-rail">
      <div className="patient-auth-rail-orb patient-auth-rail-orb-top" />
      <div className="patient-auth-rail-orb patient-auth-rail-orb-bottom" />

      <div className="patient-auth-rail-card">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-cyan-500 to-teal-600 flex items-center justify-center shadow-lg shadow-cyan-500/20 mb-6">
          <ShieldCheck className="w-7 h-7 text-white" />
        </div>
        <h2 className="text-2xl font-bold text-slate-900 dark:text-white leading-tight">
          {PATIENT_LOGIN_ASSURANCE_TITLE}
        </h2>
        <p className="mt-4 text-sm leading-7 text-slate-600 dark:text-slate-300">
          {PATIENT_LOGIN_ASSURANCE_BODY}
        </p>
        <div className="mt-6 grid gap-3">
          {RAIL_HIGHLIGHTS.map((item) => (
            <div
              key={item.title}
              className="rounded-2xl border border-slate-200/70 dark:border-slate-800 px-4 py-3 bg-white/70 dark:bg-slate-950/40"
            >
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{item.title}</p>
              {item.list ? (
                <ul className="mt-2 space-y-2 text-xs text-slate-500 dark:text-slate-400">
                  {item.list.map((entry) => (
                    <li key={entry}>{entry}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{item.body}</p>
              )}
            </div>
          ))}
        </div>
        <div className="mt-6">
          <Link
            to={getPatientPortalTopLevelPath('home')}
            className="inline-flex items-center gap-2 text-sm font-semibold text-cyan-700 hover:text-cyan-800 dark:text-cyan-300"
          >
            {dashboardCtaLabel}
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </div>
  );
}
