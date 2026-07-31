export interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  tenant_id?: number;
  created_at?: string;
}

export interface Hospital {
  id: number;
  name: string;
  subdomain: string;
  status: 'active' | 'inactive' | 'suspended';
  plan: string;
  plan_price?: number;
  billing_cycle?: string;
  trial_ends_at?: string;
  plan_started_at?: string;
  created_at: string;
  updated_at?: string;
  user_count?: number;
  patient_count?: number;
  addons?: string;
  ai_enabled?: boolean;
}

export interface HospitalDetail extends Hospital {
  users: User[];
  stats: {
    patients: number;
    totalBilled: number;
    totalPaid: number;
  };
}

export interface PlatformStats {
  hospitals: {
    total: number;
    active: number;
    inactive: number;
    suspended: number;
  };
  users: number;
  patients: number;
  revenue: {
    totalBilled: number;
    totalPaid: number;
  };
  recentHospitals: Hospital[];
  pendingOnboarding: number;
}

export interface AuditLog {
  id: number;
  tenant_id: number | null;
  user_id: string | null;
  action: string;
  table_name: string;
  record_id?: string;
  created_at: string;
  tenant_name?: string;
  user_email?: string;
}

export interface OnboardingRequest {
  id: string;
  hospital_name: string;
  contact_name: string;
  contact_email: string;
  contact_phone?: string;
  status: 'pending' | 'contacted' | 'approved' | 'rejected' | 'provisioned';
  notes?: string;
  tenant_id?: number;
  reviewed_by?: string;
  reviewed_at?: string;
  created_at: string;
  updated_at?: string;
}

export type PlatformRole = 'platform_admin' | 'platform_setup' | 'platform_support' | 'platform_auditor';

export type TenantRole = 'hospital_admin' | 'doctor' | 'nurse' | 'laboratory' | 'reception' | 'manager' | 'md' | 'director' | 'pharmacist' | 'accountant';

export interface PlatformStaffAccount {
  id: number;
  email: string;
  name: string;
  role: PlatformRole;
  is_active: number;
  last_login_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface PlatformTenantGrant {
  id: number;
  staff_id: number;
  tenant_id: number;
  tenant_name?: string;
  tenant_subdomain?: string;
  grant_type: 'impersonate';
  allowed_role: TenantRole;
  reason: string;
  expires_at?: string | null;
  revoked_at?: string | null;
  created_at?: string;
}

export interface PlatformImpersonationResponse {
  token: string;
  tenant: { id: number; name: string; subdomain: string; status: string; plan: string };
  targetUser: { id: number; email: string; name: string; role: string };
  redirectUrl: string;
}

export interface SystemHealth {
  database: {
    totalTables: number;
    tableStats: Array<{ table: string; count: number }>;
  };
  status: 'healthy' | 'degraded' | 'down';
  uptime: string;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ApiResponse<T> {
  data: T;
  message?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: Pagination;
}
