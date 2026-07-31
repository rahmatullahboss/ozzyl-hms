#!/usr/bin/env python3
"""Batch replace hardcoded strings in PatientChartWorkspace.tsx with t() calls."""

import re

FILE_PATH = '/Users/rahmatullahzisan/Desktop/Dev/hms/web/src/pages/PatientChartWorkspace.tsx'

# Read the file
with open(FILE_PATH, 'r') as f:
    content = f.read()

# Define replacements: (old_pattern, new_pattern)
# Using regex patterns for toast, labels, placeholders, etc.
replacements = [
    # sourceLabel function strings
    ("return 'Consultation';", "return t('sourceLabels.consultation');"),
    ("return 'SOAP Note';", "return t('sourceLabels.soapNote');"),
    ("return 'Problem';", "return t('sourceLabels.problem');"),
    ("return 'Medication';", "return t('sourceLabels.medication');"),
    ("return 'Allergy';", "return t('sourceLabels.allergy');"),
    ("return 'Radiology Order';", "return t('sourceLabels.radiologyOrder');"),
    ("return 'Radiology Report';", "return t('sourceLabels.radiologyReport');"),
    ("return 'Discharge';", "return t('sourceLabels.discharge');"),
    ("return 'Document';", "return t('sourceLabels.document');"),
    ("return 'Referral';", "return t('sourceLabels.referral');"),
    ("return 'Lab';", "return t('sourceLabels.lab');"),
    ("return 'Prescription';", "return t('sourceLabels.prescription');"),
    ("return 'Admission';", "return t('sourceLabels.admission');"),
    ("return 'Appointment';", "return t('sourceLabels.appointment');"),
    ("return 'Patient ADR';", "return t('sourceLabels.patientAdr');"),
    ("return 'Lifestyle Log';", "return t('sourceLabels.lifestyleLog');"),
    ("return 'Visit';", "return t('sourceLabels.visit');"),

    # fmtDate/age notSpecified
    ("return '—';", "return t('common.dash');"),

    # AI section
    ("AI Chart Brief", "{t('sections.aiChartBrief')}"),
    ("Generating...", "{t('buttons.generating')}"),
    ("Generate", "{t('buttons.generate')}"),
    ("Deterministic summary generated", "{t('ai.deterministicSummary')}"),
    ("Generated", "{t('ai.generated')}"),
    ("Verify with full chart.", "{t('ai.verifyWithChart')}"),
    ("AI service is not configured for this environment.", "{t('ai.serviceNotConfigured')}"),
    ("Generate a concise doctor-facing summary from the patient chart.", "{t('ai.generateSummaryDesc')}"),

    # Section titles
    ("Active Problems", "{t('sections.activeProblems')}"),
    ("No active problems recorded.", "{t('emptyStates.noActiveProblems')}"),
    ("Problem", "{t('labels.problem')}"),
    ("active", "{t('status.active')}"),
    ("updated", "{t('labels.updated')}"),
    ("Source", "{t('buttons.source')}"),
    ("Resolving...", "{t('buttons.resolving')}"),
    ("Resolve", "{t('buttons.resolve')}"),
    ("Resolved", "{t('sections.resolved')}"),

    # Problem form
    ("Add problem / diagnosis", "{t('placeholders.addProblem')}"),
    ("Comments", "{t('labels.comments')}"),
    ("Mild", "{t('severity.mild')}"),
    ("Moderate", "{t('severity.moderate')}"),
    ("Severe", "{t('severity.severe')}"),
    ("Adding...", "{t('buttons.adding')}"),
    ("Add Problem", "{t('buttons.addProblem')}"),

    # Medications
    ("Current Medications", "{t('sections.currentMedications')}"),
    ("No active medication list recorded.", "{t('emptyStates.noMedications')}"),
    ("No dosing details", "{t('emptyStates.noDosing')}"),
    ("Hold", "{t('buttons.hold')}"),
    ("Stop", "{t('buttons.stop')}"),
    ("Stopped / Completed", "{t('sections.stoppedMedications')}"),
    ("Medication name", "{t('placeholders.medicationName')}"),
    ("Dose", "{t('labels.dose')}"),
    ("Frequency", "{t('labels.frequency')}"),
    ("Duration", "{t('labels.duration')}"),
    ("Instructions", "{t('labels.instructions')}"),
    ("Add Medication", "{t('buttons.addMedication')}"),
    ("Adding...", "{t('buttons.adding')}"),

    # Allergies
    ("Allergies & ADRs", "{t('sections.allergies')}"),
    ("No known allergies recorded.", "{t('emptyStates.noAllergies')}"),
    ("Allergen", "{t('labels.allergen')}"),
    ("Reaction", "{t('labels.reaction')}"),
    ("Drug", "{t('allergyType.drug')}"),
    ("Food", "{t('allergyType.food')}"),
    ("Environmental", "{t('allergyType.environmental')}"),
    ("Add Allergy", "{t('buttons.addAllergy')}"),
    ("Verify", "{t('buttons.verify')}"),

    # Lab results
    ("Recent Labs", "{t('sections.recentLabs')}"),
    ("Abnormal", "{t('labStatus.abnormal')}"),
    ("Pending", "{t('labStatus.pending')}"),
    ("Normal", "{t('labStatus.normal')}"),
    ("No recent lab results.", "{t('emptyStates.noLabs')}"),

    # Tasks section
    ("Tasks", "{t('sections.tasks')}"),
    ("Active Consultation", "{t('sections.activeConsultation')}"),
    ("Close Encounter", "{t('buttons.closeEncounter')}"),
    ("Closing...", "{t('buttons.closing')}"),
    ("Consultation ID", "{t('labels.consultationId')}"),
    ("Working diagnosis", "{t('placeholders.workingDiagnosis')}"),
    ("Encounter summary", "{t('placeholders.encounterSummary')}"),
    ("Prescription / treatment summary", "{t('placeholders.prescriptionSummary')}"),
    ("Medication reconciliation completed", "{t('labels.medReconCompleted')}"),
    ("Medication reconciliation summary", "{t('placeholders.medReconSummary')}"),
    ("Book follow-up appointment", "{t('labels.bookFollowup')}"),
    ("Follow-up note for appointment", "{t('placeholders.followupNote')}"),

    # SOAP Notes
    ("Edit SOAP Note", "{t('sections.editSoapNote')}"),
    ("New SOAP Note", "{t('sections.newSoapNote')}"),
    ("Cancel Edit", "{t('buttons.cancelEdit')}"),
    ("Load from template...", "{t('placeholders.loadTemplate')}"),
    ("Chief complaint", "{t('placeholders.chiefComplaint')}"),
    ("Subjective", "{t('soap.subjective')}"),
    ("Objective", "{t('soap.objective')}"),
    ("Assessment", "{t('soap.assessment')}"),
    ("Plan", "{t('soap.plan')}"),
    ("Saving...", "{t('buttons.saving')}"),
    ("Update SOAP", "{t('buttons.updateSoap')}"),
    ("Save SOAP", "{t('buttons.saveSoap')}"),
    ("SOAP Notes", "{t('sections.soapNotes')}"),
    ("No summary recorded.", "{t('emptyStates.noSummary')}"),
    ("Edit", "{t('buttons.edit')}"),

    # Radiology
    ("Radiology Reports", "{t('sections.radiologyReports')}"),
    ("Radiology findings recorded.", "{t('emptyStates.radiologyFindings')}"),
    ("Reviewed", "{t('status.reviewed')}"),
    ("Doctor review pending", "{t('status.reviewPending')}"),
    ("Mark Reviewed", "{t('buttons.markReviewed')}"),
    ("Reviewing...", "{t('buttons.reviewing')}"),

    # Quick Orders
    ("Quick Orders", "{t('sections.quickOrders')}"),
    ("Lab", "{t('orderType.lab')}"),
    ("Search lab test", "{t('placeholders.searchLabTest')}"),
    ("Searching tests…", "{t('loading.searchingTests')}"),
    ("Lab test ID", "{t('placeholders.labTestId')}"),
    ("Order notes", "{t('placeholders.orderNotes')}"),
    ("Ordering...", "{t('buttons.ordering')}"),
    ("Order Lab", "{t('buttons.orderLab')}"),
    ("Radiology", "{t('orderType.radiology')}"),
    ("X-Ray", "{t('imaging.xray')}"),
    ("Ultrasound", "{t('imaging.ultrasound')}"),
    ("CT", "{t('imaging.ct')}"),
    ("MRI", "{t('imaging.mri')}"),
    ("Urgent", "{t('urgency.urgent')}"),
    ("STAT", "{t('urgency.stat')}"),
    ("Imaging item", "{t('placeholders.imagingItem')}"),
    ("Requisition remarks", "{t('placeholders.requisitionRemarks')}"),
    ("Order Imaging", "{t('buttons.orderImaging')}"),
    ("Follow-up", "{t('orderType.followup')}"),
    ("Follow-up notes", "{t('placeholders.followupNotes')}"),
    ("Scheduling...", "{t('buttons.scheduling')}"),
    ("Schedule Follow-up", "{t('buttons.scheduleFollowup')}"),

    # Right column
    ("Vitals Trend", "{t('sections.vitalsTrend')}"),
    ("Pending Follow-ups", "{t('sections.pendingFollowups')}"),
    ("No scheduled follow-up found.", "{t('emptyStates.noFollowups')}"),
    ("Active Clinical Alerts", "{t('sections.clinicalAlerts')}"),
    ("Acknowledging...", "{t('buttons.acknowledging')}"),
    ("Acknowledge", "{t('buttons.acknowledge')}"),
    ("Pending Lab Orders", "{t('sections.pendingLabOrders')}"),
    ("No pending orders.", "{t('emptyStates.noPendingOrders')}"),
    ("pending", "{t('status.pending')}"),
    ("pending of", "{t('labels.pendingOf')}"),
    ("tests", "{t('labels.tests')}"),

    # Referrals & Documents
    ("Referrals", "{t('sections.referrals')}"),
    ("Referral", "{t('labels.referral')}"),
    ("Clinical Documents", "{t('sections.clinicalDocuments')}"),
    ("Document", "{t('labels.document')}"),
    ("Radiology Orders", "{t('sections.radiologyOrders')}"),
    ("Radiology order", "{t('labels.radiologyOrder')}"),
    ("Chronic Care Reminders", "{t('sections.chronicCareReminders')}"),
    ("Reminder", "{t('labels.reminder')}"),

    # Source Panel
    ("Source Panel", "{t('sections.sourcePanel')}"),
    ("Generate AI brief or pick a chart item to inspect its source context.", "{t('emptyStates.sourcePanel')}"),
    ("Loading source details…", "{t('loading.sourceDetails')}"),
]

for old, new in replacements:
    content = content.replace(old, new)

# Write the file back
with open(FILE_PATH, 'w') as f:
    f.write(content)

print(f"Applied {len(replacements)} replacements to PatientChartWorkspace.tsx")
