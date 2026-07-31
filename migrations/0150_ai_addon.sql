-- Migration: 0150_ai_addon.sql
-- Add AI feature support to tenants table

ALTER TABLE tenants ADD COLUMN ai_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE tenants ADD COLUMN ai_usage_count INTEGER DEFAULT 0;
ALTER TABLE tenants ADD COLUMN ai_monthly_limit INTEGER DEFAULT 0;
