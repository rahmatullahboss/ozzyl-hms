export interface DischargePrescriptionItem {
  medicine_name: string;
  dosage: string;
  frequency: string;
  duration: string;
  instructions: string;
}

export interface DischargePrescriptionHandoff {
  reconciliationId: number;
  patientId: number;
  items: DischargePrescriptionItem[];
  stoppedMedications: Array<{ name: string; reason: string }>;
  advice: string;
}

type RawRecord = Record<string, unknown>;

function value(record: RawRecord, camel: string, snake: string): unknown {
  return record[camel] ?? record[snake];
}

function text(input: unknown): string {
  return input == null ? '' : String(input).trim();
}

export function buildDischargePrescriptionHandoff(
  raw: RawRecord & { items?: RawRecord[] },
  expectedPatientId: number,
): DischargePrescriptionHandoff {
  const reconciliationId = Number(raw.id ?? 0);
  const patientId = Number(value(raw, 'patientId', 'patient_id') ?? 0);
  const type = text(value(raw, 'reconciliationType', 'reconciliation_type'));
  const status = text(raw.status);

  if (!reconciliationId || !patientId || patientId !== expectedPatientId) {
    throw new Error('Medication reconciliation does not belong to this patient');
  }
  if (type !== 'discharge' || status !== 'completed') {
    throw new Error('A completed discharge medication reconciliation is required');
  }

  const prescriptionItems: DischargePrescriptionItem[] = [];
  const stoppedMedications: Array<{ name: string; reason: string }> = [];

  for (const item of raw.items ?? []) {
    const name = text(value(item, 'medicationName', 'medication_name'));
    if (!name) continue;

    const action = text(item.action) || 'continue';
    const reason = text(value(item, 'actionReason', 'action_reason'));
    if (action === 'discontinue') {
      stoppedMedications.push({ name, reason });
      continue;
    }
    if (!['continue', 'modify', 'add'].includes(action)) continue;

    const dosage = action === 'modify'
      ? text(value(item, 'newDose', 'new_dose')) || text(item.dose)
      : text(item.dose);
    const frequency = action === 'modify'
      ? text(value(item, 'newFrequency', 'new_frequency')) || text(item.frequency)
      : text(item.frequency);
    const route = action === 'modify'
      ? text(value(item, 'newRoute', 'new_route')) || text(item.route)
      : text(item.route);
    const instructionParts = [route ? `Route: ${route}` : '', reason ? `Reconciliation: ${reason}` : ''].filter(Boolean);

    prescriptionItems.push({
      medicine_name: name,
      dosage,
      frequency,
      duration: '',
      instructions: instructionParts.join(' · '),
    });
  }

  const adviceLines = [
    'Discharge medicines were prefilled from completed medication reconciliation. Verify every dose, frequency, duration and instruction before finalizing.',
  ];
  if (stoppedMedications.length > 0) {
    adviceLines.push('', 'Stopped medicines:');
    for (const medication of stoppedMedications) {
      adviceLines.push(`- ${medication.name}${medication.reason ? ` — ${medication.reason}` : ''}`);
    }
  }

  return {
    reconciliationId,
    patientId,
    items: prescriptionItems,
    stoppedMedications,
    advice: adviceLines.join('\n'),
  };
}
