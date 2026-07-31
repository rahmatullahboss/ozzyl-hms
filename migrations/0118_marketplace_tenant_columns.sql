-- Add marketplace visibility and public profile fields to tenants table
ALTER TABLE tenants ADD COLUMN tenant_type TEXT NOT NULL DEFAULT 'hospital';
ALTER TABLE tenants ADD COLUMN is_published INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tenants ADD COLUMN public_description TEXT;
ALTER TABLE tenants ADD COLUMN public_photos TEXT;
ALTER TABLE tenants ADD COLUMN specialties TEXT;
ALTER TABLE tenants ADD COLUMN latitude REAL;
ALTER TABLE tenants ADD COLUMN longitude REAL;
ALTER TABLE tenants ADD COLUMN operating_hours TEXT;
