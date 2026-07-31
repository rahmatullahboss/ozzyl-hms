/**
 * Shared test fixtures for integration tests.
 *
 * Contains realistic test data for patients, doctors, admissions, bills,
 * and tenants — all aligned with the HMS D1 schema.
 */

// ─── Tenants ───────────────────────────────────────────────────────────────

export const TENANT_1 = {
  id: 'tenant-1',
  name: 'City General Hospital',
  subdomain: 'citygeneral',
  status: 'active',
  plan: 'professional',
  created_at: '2024-01-01T00:00:00Z',
};

export const TENANT_2 = {
  id: 'tenant-2',
  name: 'Green Life Hospital',
  subdomain: 'greenlife',
  status: 'active',
  plan: 'starter',
  created_at: '2024-01-01T00:00:00Z',
};

export const TENANT_INACTIVE = {
  id: 'tenant-inactive',
  name: 'Old Hospital',
  subdomain: 'oldhospital',
  status: 'inactive',
  plan: 'starter',
  created_at: '2024-01-01T00:00:00Z',
};

export const TENANT_SUSPENDED = {
  id: 'tenant-suspended',
  name: 'Suspended Hospital',
  subdomain: 'suspendedhospital',
  status: 'suspended',
  plan: 'starter',
  created_at: '2024-01-01T00:00:00Z',
};

// ─── Users ─────────────────────────────────────────────────────────────────

export const ADMIN_USER = {
  id: 1,
  tenant_id: TENANT_1.id,
  name: 'Admin User',
  email: 'admin@citygeneral.com',
  role: 'hospital_admin',
  is_active: 1,
};

export const DOCTOR_USER = {
  id: 2,
  tenant_id: TENANT_1.id,
  name: 'Dr. Ahmed Rahman',
  email: 'doctor@citygeneral.com',
  role: 'doctor',
  is_active: 1,
};

export const RECEPTIONIST_USER = {
  id: 3,
  tenant_id: TENANT_1.id,
  name: 'Ayesha Receptionist',
  email: 'reception@citygeneral.com',
  role: 'receptionist',
  is_active: 1,
};

// ─── Billing Counter ────────────────────────────────────────────────────────

export const ACTIVE_BILLING_COUNTER = {
  id: 7001,
  tenant_id: TENANT_1.id,
  counter_name: 'Main Billing Counter',
  counter_code: 'BILL-1',
  counter_type: 'billing',
  is_active: 1,
};

export const ACTIVE_BILLING_COUNTER_SESSION = {
  id: 7101,
  tenant_id: TENANT_1.id,
  employee_id: ADMIN_USER.id,
  counter_id: ACTIVE_BILLING_COUNTER.id,
  counter_name: ACTIVE_BILLING_COUNTER.counter_name,
  counter_code: ACTIVE_BILLING_COUNTER.counter_code,
  counter_type: ACTIVE_BILLING_COUNTER.counter_type,
  opening_cash: 0,
  opened_at: '2024-01-19T08:00:00Z',
  status: 'active',
};

export const ACTIVE_BILLING_COUNTER_TABLES = {
  billing_counters: [ACTIVE_BILLING_COUNTER],
  billing_counter_sessions: [ACTIVE_BILLING_COUNTER_SESSION],
};

// ─── Patients ──────────────────────────────────────────────────────────────

export const PATIENT_1 = {
  id: 101,
  tenant_id: TENANT_1.id,
  patient_code: 'PT-000101',
  name: 'রহিম মিয়া',
  mobile: '01712345678',
  gender: 'Male',
  date_of_birth: '1985-06-15',
  blood_group: 'A+',
  address: 'Mirpur, Dhaka',
  created_at: '2024-01-15T10:00:00Z',
};

export const PATIENT_2 = {
  id: 102,
  tenant_id: TENANT_1.id,
  patient_code: 'PT-000102',
  name: 'Fatima Begum',
  mobile: '01812345678',
  gender: 'Female',
  date_of_birth: '1990-03-20',
  blood_group: 'B+',
  address: 'Dhanmondi, Dhaka',
  created_at: '2024-01-16T09:00:00Z',
};

// Patient from a DIFFERENT tenant (for isolation tests)
export const PATIENT_TENANT_2 = {
  id: 201,
  tenant_id: TENANT_2.id,
  patient_code: 'PT-000001',
  name: 'Karim Ali',
  mobile: '01912345678',
  gender: 'Male',
  created_at: '2024-01-17T09:00:00Z',
};

// ─── Doctors ───────────────────────────────────────────────────────────────

export const DOCTOR_1 = {
  id: 5,
  tenant_id: TENANT_1.id,
  name: 'Dr. Fatima Akhter',
  specialty: 'Internal Medicine',
  mobile_number: '+8801890000000',
  bmdc_reg_no: 'A-12345',
  consultation_fee: 1000,
  is_active: 1,
  created_at: '2024-01-01T00:00:00Z',
};

// ─── Beds ──────────────────────────────────────────────────────────────────

export const BED_AVAILABLE = {
  id: 10,
  tenant_id: TENANT_1.id,
  ward_name: 'General Ward',
  bed_number: 'G-01',
  bed_type: 'general',
  floor: '1',
  status: 'available',
};

export const BED_OCCUPIED = {
  id: 11,
  tenant_id: TENANT_1.id,
  ward_name: 'Cabin',
  bed_number: 'C-01',
  bed_type: 'cabin',
  floor: '2',
  status: 'occupied',
};

// ─── Admissions ────────────────────────────────────────────────────────────

export const ADMISSION_1 = {
  id: 20,
  tenant_id: TENANT_1.id,
  admission_no: 'ADM-00001',
  patient_id: PATIENT_1.id,
  patient_name: PATIENT_1.name,
  patient_code: PATIENT_1.patient_code,
  bed_id: BED_OCCUPIED.id,
  ward_name: BED_OCCUPIED.ward_name,
  bed_number: BED_OCCUPIED.bed_number,
  doctor_id: DOCTOR_1.id,
  doctor_name: DOCTOR_1.name,
  admission_type: 'emergency',
  provisional_diagnosis: 'Acute febrile illness',
  status: 'admitted',
  admission_date: '2024-01-20T08:00:00Z',
  discharge_date: null,
};

export const ADMISSION_DISCHARGED = {
  id: 21,
  tenant_id: TENANT_1.id,
  admission_no: 'ADM-00002',
  patient_id: PATIENT_2.id,
  bed_id: null,
  doctor_id: DOCTOR_1.id,
  status: 'discharged',
  admission_date: '2024-01-10T08:00:00Z',
  discharge_date: '2024-01-14T10:00:00Z',
};

// ─── Bills ─────────────────────────────────────────────────────────────────

export const BILL_1 = {
  id: 30,
  tenant_id: TENANT_1.id,
  invoice_no: 'INV-000030',
  patient_id: PATIENT_1.id,
  total: 2500,
  discount: 0,
  paid: 0,
  due: 2500,
  status: 'open',
  created_at: '2024-01-20T12:00:00Z',
};

export const BILL_PAID = {
  id: 31,
  tenant_id: TENANT_1.id,
  invoice_no: 'INV-000031',
  patient_id: PATIENT_2.id,
  total: 1000,
  discount: 0,
  paid: 1000,
  due: 0,
  status: 'paid',
  created_at: '2024-01-18T12:00:00Z',
};

// ─── RBAC Role Lists ────────────────────────────────────────────────────────

export const ALL_ROLES = [
  'super_admin',
  'platform_support',
  'hospital_admin',
  'director',
  'md',
  'doctor',
  'nurse',
  'receptionist',
  'lab_tech',
  'pharmacist',
  'accountant',
] as const;

export type HmsRole = typeof ALL_ROLES[number];

/** Roles allowed to create/manage admissions */
export const ADMISSION_ALLOWED_ROLES: HmsRole[] = ['receptionist', 'doctor', 'nurse', 'hospital_admin', 'md'];

/** Roles NOT allowed to create admissions */
export const ADMISSION_DENIED_ROLES: HmsRole[] = ALL_ROLES.filter(
  (r) => !ADMISSION_ALLOWED_ROLES.includes(r as HmsRole),
) as HmsRole[];

/** Roles allowed to manage beds */
export const BED_ADMIN_ROLES: HmsRole[] = ['hospital_admin', 'director', 'md'];

/** Roles NOT allowed to manage beds */
export const BED_ADMIN_DENIED_ROLES: HmsRole[] = ALL_ROLES.filter(
  (r) => !BED_ADMIN_ROLES.includes(r as HmsRole),
) as HmsRole[];

// ─── Deposits ──────────────────────────────────────────────────────────────

export const DEPOSIT_1 = {
  id: 40,
  tenant_id: TENANT_1.id,
  patient_id: PATIENT_1.id,
  amount: 5000,
  collected_by: ADMIN_USER.id,
  receipt_no: 'DEP-000001',
  payment_method: 'cash',
  status: 'active',
  created_at: '2024-01-19T09:00:00Z',
};

// ─── Emergency Records ─────────────────────────────────────────────────────

export const EMERGENCY_1 = {
  id: 50,
  tenant_id: TENANT_1.id,
  patient_id: PATIENT_1.id,
  triage_level: 'urgent',
  chief_complaint: 'Chest pain and shortness of breath',
  status: 'under_treatment',
  arrived_at: '2024-01-20T07:00:00Z',
};

// ─── Inventory ─────────────────────────────────────────────────────────────

export const INV_VENDOR_1 = {
  VendorId: 1,
  tenant_id: TENANT_1.id,
  VendorName: 'MedSupply Ltd',
  VendorCode: 'VS-001',
  ContactPhone: '01711000001',
  ContactEmail: 'info@medsupply.com',
  ContactAddress: 'Dhaka',
  City: 'Dhaka',
  Country: 'Bangladesh',
  CreditPeriod: 30,
  IsActive: 1,
  IsTDSApplicable: 0,
  TDSPercent: 0,
};

export const INV_VENDOR_2 = {
  VendorId: 2,
  tenant_id: TENANT_1.id,
  VendorName: 'SurgEquip Co',
  VendorCode: 'VS-002',
  IsActive: 1,
};

export const INV_STORE_MAIN = {
  StoreId: 1,
  tenant_id: TENANT_1.id,
  StoreName: 'Main Pharmacy',
  StoreCode: 'ST-001',
  StoreType: 'main',
  IsActive: 1,
};

export const INV_STORE_OT = {
  StoreId: 2,
  tenant_id: TENANT_1.id,
  StoreName: 'OT Store',
  StoreCode: 'ST-002',
  StoreType: 'substore',
  IsActive: 1,
};

export const INV_CATEGORY_1 = {
  ItemCategoryId: 1,
  tenant_id: TENANT_1.id,
  CategoryName: 'Surgical Supplies',
  CategoryCode: 'CAT-001',
  IsActive: 1,
};

export const INV_SUBCATEGORY_1 = {
  SubCategoryId: 1,
  tenant_id: TENANT_1.id,
  ItemCategoryId: INV_CATEGORY_1.ItemCategoryId,
  SubCategoryName: 'Gloves',
  IsActive: 1,
};

export const INV_UOM_1 = {
  UOMId: 1,
  tenant_id: TENANT_1.id,
  UOMName: 'Box',
  IsActive: 1,
};

export const INV_ITEM_1 = {
  ItemId: 1,
  tenant_id: TENANT_1.id,
  ItemName: 'Surgical Gloves (M)',
  ItemCode: 'IT-001',
  ItemCategoryId: INV_CATEGORY_1.ItemCategoryId,
  UOMId: INV_UOM_1.UOMId,
  StandardRate: 45,
  ReOrderLevel: 50,
  IsActive: 1,
};

export const INV_ITEM_2 = {
  ItemId: 2,
  tenant_id: TENANT_1.id,
  ItemName: 'Syringe 5ml',
  ItemCode: 'IT-002',
  StandardRate: 12,
  ReOrderLevel: 100,
  IsActive: 1,
};

export const INV_STOCK_1 = {
  StockId: 1,
  tenant_id: TENANT_1.id,
  ItemId: INV_ITEM_1.ItemId,
  StoreId: INV_STORE_MAIN.StoreId,
  BatchNo: 'BN-2024-001',
  ExpiryDate: '2026-12-31',
  CostPrice: 40,
  MRP: 55,
  AvailableQuantity: 200,
};

export const INV_STOCK_2 = {
  StockId: 2,
  tenant_id: TENANT_1.id,
  ItemId: INV_ITEM_2.ItemId,
  StoreId: INV_STORE_MAIN.StoreId,
  BatchNo: 'BN-2024-002',
  ExpiryDate: '2025-06-30',
  CostPrice: 10,
  MRP: 15,
  AvailableQuantity: 500,
};

export const INV_PO_1 = {
  PurchaseOrderId: 1,
  tenant_id: TENANT_1.id,
  PONo: 'PO-2024-001',
  VendorId: INV_VENDOR_1.VendorId,
  StoreId: INV_STORE_MAIN.StoreId,
  PODate: '2024-01-15',
  POStatus: 'pending',
  TotalAmount: 4500,
  CreatedOn: '2024-01-15T09:00:00Z',
};

export const INV_PO_ITEM_1 = {
  POItemId: 1,
  tenant_id: TENANT_1.id,
  PurchaseOrderId: INV_PO_1.PurchaseOrderId,
  ItemId: INV_ITEM_1.ItemId,
  Quantity: 100,
  StandardRate: 45,
  TotalAmount: 4500,
};

export const INV_GR_1 = {
  GoodsReceiptId: 1,
  tenant_id: TENANT_1.id,
  GRNo: 'GR-2024-001',
  VendorId: INV_VENDOR_1.VendorId,
  PurchaseOrderId: INV_PO_1.PurchaseOrderId,
  StoreId: INV_STORE_MAIN.StoreId,
  GRDate: '2024-01-20',
  PaymentMode: 'credit',
  PaymentStatus: 'unpaid',
  TotalAmount: 4500,
};

export const INV_GR_ITEM_1 = {
  GRItemId: 1,
  tenant_id: TENANT_1.id,
  GoodsReceiptId: INV_GR_1.GoodsReceiptId,
  ItemId: INV_ITEM_1.ItemId,
  BatchNo: 'BN-2024-001',
  ReceivedQuantity: 100,
  ItemRate: 45,
  StockId: INV_STOCK_1.StockId,
};

export const INV_REQUISITION_1 = {
  RequisitionId: 1,
  tenant_id: TENANT_1.id,
  RequisitionNo: 'REQ-2024-001',
  RequestingStoreId: INV_STORE_OT.StoreId,
  SourceStoreId: INV_STORE_MAIN.StoreId,
  Priority: 'normal',
  RequisitionStatus: 'pending',
  RequisitionDate: '2024-01-18',
};

export const INV_REQ_ITEM_1 = {
  RequisitionItemId: 1,
  tenant_id: TENANT_1.id,
  RequisitionId: INV_REQUISITION_1.RequisitionId,
  ItemId: INV_ITEM_1.ItemId,
  RequestedQuantity: 20,
  ApprovedQuantity: 0,
  RequisitionItemStatus: 'pending',
};

export const INV_DISPATCH_1 = {
  DispatchId: 1,
  tenant_id: TENANT_1.id,
  DispatchNo: 'DSP-2024-001',
  RequisitionId: INV_REQUISITION_1.RequisitionId,
  SourceStoreId: INV_STORE_MAIN.StoreId,
  DestinationStoreId: INV_STORE_OT.StoreId,
  DispatchDate: '2024-01-19',
  ReceivedOn: null,
};

export const INV_DISPATCH_RECEIVED = {
  DispatchId: 2,
  tenant_id: TENANT_1.id,
  DispatchNo: 'DSP-2024-002',
  RequisitionId: INV_REQUISITION_1.RequisitionId,
  SourceStoreId: INV_STORE_MAIN.StoreId,
  DestinationStoreId: INV_STORE_OT.StoreId,
  DispatchDate: '2024-01-18',
  ReceivedOn: '2024-01-18T15:00:00Z',
};

export const INV_WRITEOFF_1 = {
  WriteOffId: 1,
  tenant_id: TENANT_1.id,
  WriteOffNo: 'WO-2024-001',
  StoreId: INV_STORE_MAIN.StoreId,
  WriteOffDate: '2024-01-10',
  WriteOffReason: 'expired',
  IsApproved: 0,
};

export const INV_WRITEOFF_APPROVED = {
  WriteOffId: 2,
  tenant_id: TENANT_1.id,
  WriteOffNo: 'WO-2024-002',
  StoreId: INV_STORE_MAIN.StoreId,
  WriteOffDate: '2024-01-08',
  WriteOffReason: 'damaged',
  IsApproved: 1,
};

export const INV_WRITEOFF_ITEM_1 = {
  WriteOffItemId: 1,
  tenant_id: TENANT_1.id,
  WriteOffId: INV_WRITEOFF_1.WriteOffId,
  ItemId: INV_ITEM_2.ItemId,
  StockId: INV_STOCK_2.StockId,
  WriteOffQuantity: 10,
};

export const INV_RETURN_1 = {
  ReturnToVendorId: 1,
  tenant_id: TENANT_1.id,
  ReturnNo: 'RET-2024-001',
  VendorId: INV_VENDOR_1.VendorId,
  StoreId: INV_STORE_MAIN.StoreId,
  GoodsReceiptId: INV_GR_1.GoodsReceiptId,
  ReturnDate: '2024-01-22',
  Background: 'Defective batch',
};

export const INV_RFQ_1 = {
  RFQId: 1,
  tenant_id: TENANT_1.id,
  RFQNo: 'RFQ-2024-001',
  Subject: 'Q1 Medical Supplies',
  Status: 'active',
  CreatedOn: '2024-01-05T08:00:00Z',
};

export const INV_QUOTATION_1 = {
  QuotationId: 1,
  tenant_id: TENANT_1.id,
  RFQId: INV_RFQ_1.RFQId,
  VendorId: INV_VENDOR_1.VendorId,
  QuotationNo: 'QT-2024-001',
  QuotationDate: '2024-01-08',
  Status: 'active',
};

// ─── Inventory Donations ────────────────────────────────────────────────

export const INV_DONATION_1 = {
  DonationId: 1,
  tenant_id: TENANT_1.id,
  DonationName: 'Medical Equipment Donation',
  DonorName: 'Red Crescent Society',
  DonationDate: '2024-02-15',
  TotalValue: 50000,
  Remarks: 'Annual medical equipment donation',
  CreatedBy: ADMIN_USER.id,
  CreatedOn: '2024-02-15T10:00:00Z',
};

export const INV_DONATION_2 = {
  DonationId: 2,
  tenant_id: TENANT_1.id,
  DonationName: 'Surgical Supplies Donation',
  DonorName: 'WHO Bangladesh',
  DonationDate: '2024-03-01',
  TotalValue: 25000,
  Remarks: 'Surgical supplies for OT',
  CreatedBy: ADMIN_USER.id,
  CreatedOn: '2024-03-01T09:00:00Z',
};

/** Roles allowed to manage inventory */
export const INV_ALLOWED_ROLES = ['hospital_admin', 'pharmacist', 'store_manager'] as const;

// ─── Inventory Medicine Item (for pharmacy bridge tests) ────────────────

export const INV_ITEM_MEDICINE = {
  ItemId: 10,
  tenant_id: TENANT_1.id,
  ItemName: 'Paracetamol 500mg',
  ItemCode: 'MED-001',
  ItemType: 'medicine',
  GenericName: 'Paracetamol',
  BrandName: 'Napa',
  Strength: '500mg',
  DosageForm: 'Tablet',
  StandardRate: 5,
  ReOrderLevel: 100,
  MinStockQuantity: 50,
  IsActive: 1,
};

export const INV_STOCK_MEDICINE = {
  StockId: 10,
  tenant_id: TENANT_1.id,
  ItemId: INV_ITEM_MEDICINE.ItemId,
  StoreId: INV_STORE_MAIN.StoreId,
  BatchNo: 'MED-BN-001',
  ExpiryDate: '2027-06-30',
  CostPrice: 3,
  MRP: 5,
  AvailableQuantity: 30,
};

// ─── Pharmacy Items ────────────────────────────────────────────────────

export const PHARMACY_ITEM_1 = {
  id: 1,
  tenant_id: TENANT_1.id,
  name: 'Paracetamol 500mg',
  item_code: 'PH-001',
  reorder_level: 100,
  min_stock_qty: 50,
  is_active: 1,
  inventory_item_id: null,
};

export const PHARMACY_ITEM_LINKED = {
  id: 2,
  tenant_id: TENANT_1.id,
  name: 'Amoxicillin 250mg',
  item_code: 'PH-002',
  reorder_level: 80,
  min_stock_qty: 40,
  is_active: 1,
  inventory_item_id: INV_ITEM_MEDICINE.ItemId,
};

export const PHARMACY_SUPPLIER_1 = {
  id: 1,
  tenant_id: TENANT_1.id,
  name: 'PharmaDist Co',
  contact_no: '01711000099',
  is_active: 1,
  vendor_id: null,
};

export const PHARMACY_STOCK_LOW = {
  id: 1,
  tenant_id: TENANT_1.id,
  item_id: PHARMACY_ITEM_1.id,
  batch_no: 'BATCH-001',
  available_qty: 10,
  is_active: 1,
};

export const PHARMACY_STOCK_OK = {
  id: 2,
  tenant_id: TENANT_1.id,
  item_id: PHARMACY_ITEM_LINKED.id,
  batch_no: 'BATCH-002',
  available_qty: 200,
  is_active: 1,
};
