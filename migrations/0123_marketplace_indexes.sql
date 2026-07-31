-- Indexes for fast marketplace search queries on existing tables
CREATE INDEX idx_tenants_marketplace ON tenants(is_published, tenant_type);
CREATE INDEX idx_tenants_location ON tenants(latitude, longitude) WHERE is_published = 1;
CREATE INDEX idx_doctors_marketplace ON doctors(is_marketplace_visible, tenant_id);
CREATE INDEX idx_doctors_specialty_marketplace ON doctors(specialty, is_marketplace_visible);
