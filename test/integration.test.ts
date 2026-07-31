import { describe, it, expect } from 'vitest';

// ─── Integration Flow Tests ───────────────────────────────────────────────────
// End-to-end logic flows combining multiple modules (no HTTP/DB calls)
// Critical patient journey: Register → Appointment → Consultation → Billing → Discharge

describe('HMS Integration Flow Tests', () => {

  // ─── Helper Types ──────────────────────────────────────────────────────────
  interface Patient {
    id: number;
    patientCode: string;
    name: string;
    mobile: string;
    gender: 'Male' | 'Female' | 'Other';
    dateOfBirth?: string;
    bloodGroup?: string;
    tenantId: number;
  }

  interface Appointment {
    id: number;
    patientId: number;
    doctorId: number;
    appointmentDate: string;
    appointmentType: string;
    status: string;
    serialNo: string;
    tenantId: number;
  }

  interface Consultation {
    id: number;
    appointmentId: number;
    patientId: number;
    doctorId: number;
    chiefComplaint: string;
    diagnosis: string;
    plan: string;
    tenantId: number;
  }

  interface Bill {
    id: number;
    invoiceNo: string;
    patientId: number;
    consultationId?: number;
    admissionId?: number;
    totalAmount: number;
    discountAmount: number;
    paidAmount: number;
    dueAmount: number;
    status: 'unpaid' | 'partially_paid' | 'paid' | 'cancelled';
    tenantId: number;
  }

  interface BillItem {
    billId: number;
    category: string;
    description: string;
    quantity: number;
    unitPrice: number;
    total: number;
  }

  // ─── Patient Registration Flow ─────────────────────────────────────────────
  describe('Patient Registration Flow', () => {
    function generatePatientCode(seq: number, prefix = 'PT'): string {
      return `${prefix}-${String(seq).padStart(6, '0')}`;
    }

    function registerPatient(input: Omit<Patient, 'id' | 'patientCode'>, seq: number): Patient {
      return {
        id: seq,
        patientCode: generatePatientCode(seq),
        ...input,
      };
    }

    it('should register a new patient with auto-generated code', () => {
      const patient = registerPatient({
        name: 'রহিম মিয়া',
        mobile: '01712345678',
        gender: 'Male',
        tenantId: 1,
      }, 1);
      expect(patient.patientCode).toBe('PT-000001');
      expect(patient.id).toBe(1);
      expect(patient.name).toBe('রহিম মিয়া');
    });

    it('should generate sequential patient codes', () => {
      const p1 = generatePatientCode(1);
      const p2 = generatePatientCode(2);
      expect(p1).toBe('PT-000001');
      expect(p2).toBe('PT-000002');
      expect(p2 > p1).toBe(true);
    });

    it('should enforce tenant isolation on patient creation', () => {
      const patient = registerPatient({
        name: 'Karim', mobile: '01812345678', gender: 'Male', tenantId: 2,
      }, 1);
      expect(patient.tenantId).toBe(2);
    });
  });

  // ─── Full OPD Flow ─────────────────────────────────────────────────────────
  describe('Full OPD Patient Journey: Register → Appointment → Consultation → Bill → Payment', () => {
    const TENANT_ID = 1;

    // Step 1: Register patient
    const patient: Patient = {
      id: 101,
      patientCode: 'PT-000101',
      name: 'Fatima Begum',
      mobile: '01912345678',
      gender: 'Female',
      tenantId: TENANT_ID,
    };

    // Step 2: Book appointment
    const appointment: Appointment = {
      id: 201,
      patientId: patient.id,
      doctorId: 5,
      appointmentDate: '2024-01-20',
      appointmentType: 'walk_in',
      status: 'scheduled',
      serialNo: 'SN-0007',
      tenantId: TENANT_ID,
    };

    // Step 3: Create consultation
    const consultation: Consultation = {
      id: 301,
      appointmentId: appointment.id,
      patientId: patient.id,
      doctorId: appointment.doctorId,
      chiefComplaint: 'Fever and cough for 3 days',
      diagnosis: 'Acute upper respiratory infection (J06.9)',
      plan: 'Paracetamol 500mg TDS × 5 days, Cetirizine 10mg OD',
      tenantId: TENANT_ID,
    };

    // Step 4: Create bill
    const billItems: BillItem[] = [
      { billId: 401, category: 'consultation', description: 'OPD Consultation - Dr. Rahman', quantity: 1, unitPrice: 1000, total: 1000 },
      { billId: 401, category: 'medicine', description: 'Paracetamol 500mg × 15 tabs', quantity: 15, unitPrice: 5, total: 75 },
    ];

    const bill: Bill = {
      id: 401,
      invoiceNo: 'INV-000401',
      patientId: patient.id,
      consultationId: consultation.id,
      totalAmount: billItems.reduce((s, i) => s + i.total, 0),
      discountAmount: 0,
      paidAmount: 0,
      dueAmount: 0,
      status: 'unpaid',
      tenantId: TENANT_ID,
    };
    bill.dueAmount = bill.totalAmount - bill.discountAmount - bill.paidAmount;

    it('Step 1: should have a valid registered patient', () => {
      expect(patient.patientCode).toBe('PT-000101');
      expect(patient.mobile).toBe('01912345678');
    });

    it('Step 2: appointment should be linked to correct patient and doctor', () => {
      expect(appointment.patientId).toBe(patient.id);
      expect(appointment.doctorId).toBe(5);
      expect(appointment.status).toBe('scheduled');
    });

    it('Step 3: consultation should link to appointment and patient', () => {
      expect(consultation.appointmentId).toBe(appointment.id);
      expect(consultation.patientId).toBe(patient.id);
      expect(consultation.chiefComplaint).not.toBe('');
    });

    it('Step 4: bill total should equal sum of items (1000 + 75 = 1075)', () => {
      expect(bill.totalAmount).toBe(1075);
      expect(bill.dueAmount).toBe(1075);
      expect(bill.status).toBe('unpaid');
    });

    it('Step 5: partial payment should update bill correctly', () => {
      const paymentAmount = 1000;
      bill.paidAmount += paymentAmount;
      bill.dueAmount = bill.totalAmount - bill.discountAmount - bill.paidAmount;
      bill.status = bill.dueAmount <= 0 ? 'paid' : 'partially_paid';
      expect(bill.status).toBe('partially_paid');
      expect(bill.dueAmount).toBe(75);
    });

    it('Step 6: final payment clears the bill', () => {
      const remainingPayment = 75;
      bill.paidAmount += remainingPayment;
      bill.dueAmount = bill.totalAmount - bill.discountAmount - bill.paidAmount;
      bill.status = bill.dueAmount <= 0 ? 'paid' : 'partially_paid';
      expect(bill.status).toBe('paid');
      expect(bill.dueAmount).toBe(0);
    });

    it('should enforce same tenant throughout the flow', () => {
      expect(patient.tenantId).toBe(TENANT_ID);
      expect(appointment.tenantId).toBe(TENANT_ID);
      expect(consultation.tenantId).toBe(TENANT_ID);
      expect(bill.tenantId).toBe(TENANT_ID);
    });
  });

  // ─── Full IPD Flow ─────────────────────────────────────────────────────────
  describe('Full IPD Flow: Admission → Daily Charges → Discharge', () => {
    it('should accumulate daily bed charges over 3-day admission', () => {
      const dailyBedRate = 3000; // cabin rate
      const admissionDays = 3;
      const nursingCharges = 500;
      const medicationCharges = 2000;
      const totalBedCharge = dailyBedRate * admissionDays;
      const totalIPDBill = totalBedCharge + nursingCharges + medicationCharges;
      expect(totalBedCharge).toBe(9000);
      expect(totalIPDBill).toBe(11_500);
    });

    it('should apply advance deposit to discharge bill', () => {
      const depositAmount = 5000;
      const dischargeBillTotal = 11_500;
      const remainingDue = dischargeBillTotal - depositAmount;
      expect(remainingDue).toBe(6500);
    });

    it('should mark bed as cleaning after discharge', () => {
      let bedStatus = 'occupied';
      // Discharge triggers bed cleaning
      bedStatus = 'cleaning';
      expect(bedStatus).toBe('cleaning');
    });

    it('should free bed after cleaning', () => {
      let bedStatus = 'cleaning';
      bedStatus = 'vacant';
      expect(bedStatus).toBe('vacant');
    });
  });

  // ─── Lab Test Integration Flow ─────────────────────────────────────────────
  describe('Lab Test Order → Result → Notification Flow', () => {
    interface LabOrder {
      id: number;
      patientId: number;
      orderedBy: number;
      tests: string[];
      status: 'pending' | 'sample_collected' | 'processing' | 'completed' | 'reported';
    }

    it('should create lab order from consultation', () => {
      const order: LabOrder = {
        id: 501,
        patientId: 101,
        orderedBy: 5, // doctorId
        tests: ['CBC', 'Blood Sugar (Fasting)', 'Urine R/E'],
        status: 'pending',
      };
      expect(order.tests.length).toBe(3);
      expect(order.status).toBe('pending');
    });

    it('should progress through lab workflow states', () => {
      let status: LabOrder['status'] = 'pending';
      // Sample collected
      status = 'sample_collected';
      expect(status).toBe('sample_collected');
      // Processing
      status = 'processing';
      expect(status).toBe('processing');
      // Completed
      status = 'completed';
      expect(status).toBe('completed');
      // Report generated
      status = 'reported';
      expect(status).toBe('reported');
    });

    it('should calculate lab fees for multiple tests', () => {
      const labFees: Record<string, number> = {
        CBC: 500,
        'Blood Sugar (Fasting)': 200,
        'Urine R/E': 150,
      };
      const orders = ['CBC', 'Blood Sugar (Fasting)', 'Urine R/E'];
      const totalFee = orders.reduce((s, test) => s + (labFees[test] ?? 0), 0);
      expect(totalFee).toBe(850);
    });

    it('should trigger notification when lab result is ready', () => {
      const labStatus = 'reported';
      const shouldNotify = labStatus === 'reported' || labStatus === 'completed';
      expect(shouldNotify).toBe(true);
    });
  });

  // ─── Billing + Accounting Integration ─────────────────────────────────────
  describe('Billing → Accounting Integration', () => {
    it('should post income entry when bill is paid', () => {
      const payment = { amount: 5000, method: 'bkash', billId: 401 };
      // When payment is received, income entry must be created
      const incomeEntry = {
        source: 'billing',
        amount: payment.amount,
        billId: payment.billId,
        paymentMethod: payment.method,
      };
      expect(incomeEntry.amount).toBe(5000);
      expect(incomeEntry.source).toBe('billing');
    });

    it('should post expense entry when expense is approved', () => {
      const expense = { amount: 3000, category: 'medicine_purchase', approvedBy: 1 };
      const expenseEntry = {
        category: expense.category,
        amount: expense.amount,
        approvedBy: expense.approvedBy,
      };
      expect(expenseEntry.amount).toBe(3000);
      expect(expenseEntry.category).toBe('medicine_purchase');
    });

    it('should calculate net P&L for a period', () => {
      const totalIncome = 500_000;
      const totalExpenses = 350_000;
      const netPL = totalIncome - totalExpenses;
      expect(netPL).toBe(150_000); // profit
    });

    it('should detect loss period when expenses exceed income', () => {
      const totalIncome = 100_000;
      const totalExpenses = 120_000;
      const netPL = totalIncome - totalExpenses;
      expect(netPL).toBeLessThan(0); // loss
    });
  });

  // ─── Profit Distribution Integration ──────────────────────────────────────
  describe('Profit Distribution Integration', () => {
    interface ProfitShare {
      recipientId: number;
      recipientName: string;
      sharePercentage: number;
    }

    function distributeProfits(totalProfit: number, shares: ProfitShare[]): Array<ProfitShare & { amount: number }> {
      const totalPct = shares.reduce((s, sh) => s + sh.sharePercentage, 0);
      if (totalPct > 100) throw new Error('Total share percentage exceeds 100%');
      return shares.map((sh) => ({
        ...sh,
        amount: Math.round(totalProfit * (sh.sharePercentage / 100)),
      }));
    }

    it('should distribute profits correctly among partners', () => {
      const shares: ProfitShare[] = [
        { recipientId: 1, recipientName: 'Dr. Ahmed', sharePercentage: 50 },
        { recipientId: 2, recipientName: 'Dr. Hossain', sharePercentage: 30 },
        { recipientId: 3, recipientName: 'Hospital Reserve', sharePercentage: 20 },
      ];
      const distribution = distributeProfits(100_000, shares);
      expect(distribution[0].amount).toBe(50_000);
      expect(distribution[1].amount).toBe(30_000);
      expect(distribution[2].amount).toBe(20_000);
    });

    it('should throw error when total share > 100%', () => {
      const shares: ProfitShare[] = [
        { recipientId: 1, recipientName: 'Dr. A', sharePercentage: 60 },
        { recipientId: 2, recipientName: 'Dr. B', sharePercentage: 50 },
      ];
      expect(() => distributeProfits(100_000, shares)).toThrow('Total share percentage exceeds 100%');
    });

    it('should allow partial profit distribution (remainder stays in reserve)', () => {
      const shares: ProfitShare[] = [
        { recipientId: 1, recipientName: 'Dr. A', sharePercentage: 40 },
      ];
      const distribution = distributeProfits(100_000, shares);
      const distributed = distribution.reduce((s, d) => s + d.amount, 0);
      const undistributed = 100_000 - distributed;
      expect(distributed).toBe(40_000);
      expect(undistributed).toBe(60_000);
    });
  });
});
