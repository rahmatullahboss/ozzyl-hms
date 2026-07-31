export type PatientGuidanceStatus = 'attention' | 'watch' | 'stable';

export interface PatientGuidance {
  headline: string;
  status: PatientGuidanceStatus;
  summary: string;
  what_changed: string[];
  next_steps: string[];
  trust_notes: string[];
  care_reminders: string[];
  counts: {
    pending_review_items: number;
    verified_items: number;
    vault_documents: number;
    active_visit_pass: number;
  };
}

export interface ComposePatientGuidanceInput {
  hasPhone: boolean;
  hasNationalId: boolean;
  upcomingAppointments: number;
  recentPrescriptions: number;
  pendingReviewItems: number;
  verifiedItems: number;
  vaultDocuments: number;
  hasActiveVisitPass: boolean;
  recentLifestyleLog: boolean;
  recentAdr: boolean;
}

function uniqueItems(items: string[]): string[] {
  return Array.from(new Set(items.filter((item) => item.trim())));
}

export function composePatientGuidance(input: ComposePatientGuidanceInput): PatientGuidance {
  const whatChanged: string[] = [];
  const nextSteps: string[] = [];
  const trustNotes: string[] = [];
  const careReminders: string[] = [];

  if (!input.hasPhone) {
    nextSteps.push('Add your phone number so hospitals can match your record correctly.');
  }
  if (!input.hasNationalId) {
    nextSteps.push('Add your NID so your global health card stays complete.');
  }
  if (input.upcomingAppointments > 0) {
    whatChanged.push(`You have ${input.upcomingAppointments} upcoming appointment${input.upcomingAppointments > 1 ? 's' : ''}.`);
    nextSteps.push('Keep your latest prescription and reports ready before the visit.');
  }
  if (input.recentPrescriptions > 0) {
    whatChanged.push(`You received ${input.recentPrescriptions} recent prescription${input.recentPrescriptions > 1 ? 's' : ''}.`);
  }
  if (input.pendingReviewItems > 0) {
    trustNotes.push(`${input.pendingReviewItems} patient-entered item${input.pendingReviewItems > 1 ? 's are' : ' is'} still pending review.`);
    nextSteps.push('Mention pending review items to the doctor during your next visit.');
  }
  if (input.verifiedItems > 0) {
    trustNotes.push(`${input.verifiedItems} item${input.verifiedItems > 1 ? 's are' : ' is'} already doctor-reviewed.`);
  }
  if (input.vaultDocuments === 0) {
    careReminders.push('Upload older prescriptions or lab reports so new hospitals can understand your history faster.');
  }
  if (!input.hasActiveVisitPass) {
    careReminders.push('Create a Visit Pass before going to a new hospital so the front desk can open your summary quickly.');
  }
  if (input.recentLifestyleLog) {
    careReminders.push('Your recent lifestyle logs can help the doctor understand your day-to-day health context.');
  }
  if (input.recentAdr) {
    careReminders.push('Carry your medicine reaction history and tell the doctor before taking a new medicine.');
  }

  const needsIdentityAttention = !input.hasPhone || !input.hasNationalId;
  const hasTrustAttention = input.pendingReviewItems > 0;
  const hasOperationalAttention = input.upcomingAppointments > 0 || input.recentPrescriptions > 0;

  let status: PatientGuidanceStatus = 'stable';
  if (needsIdentityAttention || hasTrustAttention) {
    status = 'attention';
  } else if (hasOperationalAttention || input.vaultDocuments === 0 || !input.hasActiveVisitPass) {
    status = 'watch';
  }

  const actionCount = uniqueItems([...nextSteps, ...careReminders]).length;
  let headline = 'Your records look stable today.';
  let summary = 'Your doctor-reviewed information is available, and there are no urgent portal follow-up items right now.';

  if (status === 'attention') {
    headline = `You have ${actionCount || 1} follow-up item${actionCount > 1 ? 's' : ''} to complete.`;
    summary = 'Complete identity details and review pending patient-entered items before your next hospital visit.';
  } else if (status === 'watch') {
    headline = `You have ${actionCount || 1} simple preparation item${actionCount > 1 ? 's' : ''}.`;
    summary = 'Your records are usable, but a few simple steps can make your next visit smoother.';
  }

  if (input.verifiedItems > 0 && status === 'stable') {
    summary = 'Your doctor-reviewed records are available and your portal looks up to date.';
  }

  return {
    headline,
    status,
    summary,
    what_changed: uniqueItems(whatChanged),
    next_steps: uniqueItems(nextSteps),
    trust_notes: uniqueItems(trustNotes),
    care_reminders: uniqueItems(careReminders),
    counts: {
      pending_review_items: input.pendingReviewItems,
      verified_items: input.verifiedItems,
      vault_documents: input.vaultDocuments,
      active_visit_pass: input.hasActiveVisitPass ? 1 : 0,
    },
  };
}
