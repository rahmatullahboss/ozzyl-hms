export type UserRole = 
  | 'super_admin' 
  | 'hospital_admin' 
  | 'laboratory' 
  | 'reception' 
  | 'md' 
  | 'director';

export type TenantStatus = 'active' | 'inactive' | 'suspended';

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  tenantId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Tenant {
  id: string;
  name: string;
  subdomain: string;
  status: TenantStatus;
  plan: string;
  createdAt: string;
}

export interface Patient {
  id: string;
  name: string;
  fatherHusband: string;
  address: string;
  mobile: string;
  guardianMobile?: string;
  age?: number;
  gender?: 'male' | 'female' | 'other';
  bloodGroup?: string;
}

export interface Test {
  id: string;
  patientId: string;
  testName: string;
  result?: string;
  date: string;
  status: 'pending' | 'completed';
}

export interface Bill {
  id: string;
  patientId: string;
  testBill: number;
  admissionBill: number;
  doctorVisitBill: number;
  operationBill: number;
  medicineBill: number;
  discount: number;
  total: number;
  paid: number;
  due: number;
}

export interface Payment {
  id: string;
  billId: string;
  amount: number;
  date: string;
  type: 'current' | 'due';
}

export interface Income {
  id: string;
  date: string;
  source: 'test' | 'operation' | 'pharmacy' | 'other';
  amount: number;
  description?: string;
}

export interface Expense {
  id: string;
  date: string;
  category: string;
  amount: number;
  description?: string;
}

export interface Investment {
  id: string;
  date: string;
  type: string;
  amount: number;
  description?: string;
}

export interface Medicine {
  id: string;
  name: string;
  company: string;
  unitPrice: number;
  quantity: number;
}

export interface Staff {
  id: string;
  name: string;
  address: string;
  position: string;
  salary: number;
  bankAccount: string;
  mobile: string;
  joiningDate?: string;
  status: 'active' | 'inactive';
}

export interface SalaryPayment {
  id: string;
  staffId: string;
  amount: number;
  paymentDate: string;
  month: string;
}

export interface Shareholder {
  id: string;
  name: string;
  address: string;
  phone: string;
  shareCount: number;
  type: 'profit' | 'owner';
  investment: number;
}

export interface SystemSettings {
  sharePrice: number;
  totalShares: number;
  profitPercentage: number;
  profitPartnerCount: number;
  ownerPartnerCount: number;
  sharesPerProfitPartner: number;
  fireServiceCharge: number;
  ambulanceCharge: number;
}

export interface JWTPayload {
  userId: string;
  role: UserRole;
  tenantId?: string;
  permissions: string[];
  exp: number;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export * from './authz';
export * from './workspaceAccess';
export * from './dashboard';
