-- Canonical inventory item, location, lot, movement, transfer, and balance authority.
-- Triggerless for remote D1/Wrangler compatibility.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS canonical_inventory_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  item_public_id TEXT NOT NULL,
  item_kind TEXT NOT NULL,
  legacy_inventory_item_id INTEGER,
  legacy_pharmacy_item_id INTEGER,
  legacy_medicine_id INTEGER,
  service_public_id TEXT,
  display_name TEXT NOT NULL,
  base_unit_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (item_kind IN ('general','medicine','reagent','supply','fixed_asset','other')),
  CHECK (length(trim(display_name))>0),
  CHECK (length(trim(base_unit_code))>0),
  CHECK (status IN ('active','inactive','retired')),
  CHECK (length(source_evidence_sha256)=64),
  FOREIGN KEY (tenant_id,service_public_id)
    REFERENCES canonical_service_catalog_items(tenant_id,service_public_id) ON DELETE RESTRICT,
  UNIQUE (tenant_id,item_public_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_inventory_items_legacy_inventory
  ON canonical_inventory_items(tenant_id,legacy_inventory_item_id)
  WHERE legacy_inventory_item_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_inventory_items_legacy_pharmacy
  ON canonical_inventory_items(tenant_id,legacy_pharmacy_item_id)
  WHERE legacy_pharmacy_item_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_inventory_items_legacy_medicine
  ON canonical_inventory_items(tenant_id,legacy_medicine_id)
  WHERE legacy_medicine_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_canonical_inventory_items_service
  ON canonical_inventory_items(tenant_id,service_public_id,status);

CREATE TABLE IF NOT EXISTS canonical_inventory_locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  location_public_id TEXT NOT NULL,
  location_type TEXT NOT NULL,
  legacy_inventory_store_id INTEGER,
  location_code TEXT,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (location_type IN ('store','pharmacy','ward','department','dispensary','virtual','other')),
  CHECK (length(trim(display_name))>0),
  CHECK (status IN ('active','inactive','retired')),
  CHECK (length(source_evidence_sha256)=64),
  UNIQUE (tenant_id,location_public_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_inventory_locations_legacy_store
  ON canonical_inventory_locations(tenant_id,legacy_inventory_store_id)
  WHERE legacy_inventory_store_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_inventory_locations_code
  ON canonical_inventory_locations(tenant_id,location_code)
  WHERE location_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS canonical_inventory_lots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  lot_public_id TEXT NOT NULL,
  item_public_id TEXT NOT NULL,
  legacy_inventory_stock_id INTEGER,
  legacy_pharmacy_stock_id INTEGER,
  legacy_medicine_batch_id INTEGER,
  lot_code TEXT NOT NULL,
  manufacture_date TEXT,
  expiry_date TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (length(trim(lot_code))>0),
  CHECK (manufacture_date IS NULL OR manufacture_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  CHECK (expiry_date IS NULL OR expiry_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  CHECK (expiry_date IS NULL OR manufacture_date IS NULL OR expiry_date>=manufacture_date),
  CHECK (status IN ('active','blocked','expired','retired')),
  CHECK (length(source_evidence_sha256)=64),
  FOREIGN KEY (tenant_id,item_public_id)
    REFERENCES canonical_inventory_items(tenant_id,item_public_id) ON DELETE RESTRICT,
  UNIQUE (tenant_id,lot_public_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_inventory_lots_legacy_inventory
  ON canonical_inventory_lots(tenant_id,legacy_inventory_stock_id)
  WHERE legacy_inventory_stock_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_inventory_lots_legacy_pharmacy
  ON canonical_inventory_lots(tenant_id,legacy_pharmacy_stock_id)
  WHERE legacy_pharmacy_stock_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_inventory_lots_legacy_medicine
  ON canonical_inventory_lots(tenant_id,legacy_medicine_batch_id)
  WHERE legacy_medicine_batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_canonical_inventory_lots_item_expiry
  ON canonical_inventory_lots(tenant_id,item_public_id,status,expiry_date,lot_public_id);

CREATE TABLE IF NOT EXISTS canonical_inventory_unit_conversions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  conversion_public_id TEXT NOT NULL,
  item_public_id TEXT NOT NULL,
  source_unit_code TEXT NOT NULL,
  base_unit_code TEXT NOT NULL,
  numerator INTEGER NOT NULL,
  denominator INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (length(trim(source_unit_code))>0),
  CHECK (length(trim(base_unit_code))>0),
  CHECK (numerator BETWEEN 1 AND 9007199254740991),
  CHECK (denominator BETWEEN 1 AND 9007199254740991),
  CHECK (status IN ('active','inactive','retired')),
  CHECK (length(source_evidence_sha256)=64),
  FOREIGN KEY (tenant_id,item_public_id)
    REFERENCES canonical_inventory_items(tenant_id,item_public_id) ON DELETE RESTRICT,
  UNIQUE (tenant_id,conversion_public_id),
  UNIQUE (tenant_id,item_public_id,source_unit_code,status)
);
CREATE INDEX IF NOT EXISTS idx_canonical_inventory_unit_conversions_lookup
  ON canonical_inventory_unit_conversions(tenant_id,item_public_id,source_unit_code,status);

CREATE TABLE IF NOT EXISTS canonical_inventory_stock_policies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  item_public_id TEXT NOT NULL,
  location_public_id TEXT NOT NULL,
  allow_negative_stock INTEGER NOT NULL DEFAULT 0,
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (allow_negative_stock IN (0,1)),
  CHECK (length(source_evidence_sha256)=64),
  FOREIGN KEY (tenant_id,item_public_id)
    REFERENCES canonical_inventory_items(tenant_id,item_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,location_public_id)
    REFERENCES canonical_inventory_locations(tenant_id,location_public_id) ON DELETE RESTRICT,
  UNIQUE (tenant_id,item_public_id,location_public_id)
);

CREATE TABLE IF NOT EXISTS canonical_inventory_balances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  item_public_id TEXT NOT NULL,
  location_public_id TEXT NOT NULL,
  lot_public_id TEXT NOT NULL,
  quantity_base INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 0,
  projection_guard INTEGER NOT NULL DEFAULT 1,
  source_evidence_sha256 TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (quantity_base BETWEEN -9007199254740991 AND 9007199254740991),
  CHECK (version>=0),
  CONSTRAINT canonical_inventory_balances_projection_guard CHECK (projection_guard=1),
  CHECK (length(source_evidence_sha256)=64),
  FOREIGN KEY (tenant_id,item_public_id)
    REFERENCES canonical_inventory_items(tenant_id,item_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,location_public_id)
    REFERENCES canonical_inventory_locations(tenant_id,location_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,lot_public_id)
    REFERENCES canonical_inventory_lots(tenant_id,lot_public_id) ON DELETE RESTRICT,
  UNIQUE (tenant_id,item_public_id,location_public_id,lot_public_id)
);
CREATE INDEX IF NOT EXISTS idx_canonical_inventory_balances_location
  ON canonical_inventory_balances(tenant_id,location_public_id,item_public_id,lot_public_id);

CREATE TABLE IF NOT EXISTS canonical_inventory_transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  transfer_public_id TEXT NOT NULL,
  item_public_id TEXT NOT NULL,
  lot_public_id TEXT NOT NULL,
  from_location_public_id TEXT NOT NULL,
  to_location_public_id TEXT NOT NULL,
  quantity_base INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'posted',
  occurred_at_utc TEXT NOT NULL,
  business_date TEXT NOT NULL,
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (from_location_public_id<>to_location_public_id),
  CHECK (quantity_base BETWEEN 1 AND 9007199254740991),
  CHECK (status IN ('posted','reversed')),
  CHECK (substr(occurred_at_utc,-1)='Z'),
  CHECK (business_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  CHECK (length(source_evidence_sha256)=64),
  FOREIGN KEY (tenant_id,item_public_id)
    REFERENCES canonical_inventory_items(tenant_id,item_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,lot_public_id)
    REFERENCES canonical_inventory_lots(tenant_id,lot_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,from_location_public_id)
    REFERENCES canonical_inventory_locations(tenant_id,location_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,to_location_public_id)
    REFERENCES canonical_inventory_locations(tenant_id,location_public_id) ON DELETE RESTRICT,
  UNIQUE (tenant_id,transfer_public_id)
);

CREATE TABLE IF NOT EXISTS canonical_inventory_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  movement_public_id TEXT NOT NULL,
  item_public_id TEXT NOT NULL,
  location_public_id TEXT NOT NULL,
  lot_public_id TEXT NOT NULL,
  movement_type TEXT NOT NULL,
  direction TEXT NOT NULL,
  source_quantity INTEGER NOT NULL,
  source_unit_code TEXT NOT NULL,
  conversion_numerator INTEGER NOT NULL,
  conversion_denominator INTEGER NOT NULL,
  quantity_base INTEGER NOT NULL,
  signed_quantity_base INTEGER NOT NULL,
  balance_before_base INTEGER NOT NULL,
  balance_after_base INTEGER NOT NULL,
  transfer_public_id TEXT,
  service_event_public_id TEXT,
  invoice_public_id TEXT,
  invoice_line_public_id TEXT,
  reversal_of_movement_public_id TEXT,
  source_type TEXT NOT NULL,
  source_public_id TEXT NOT NULL,
  source_line_public_id TEXT NOT NULL,
  source_table TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'posted',
  occurred_at_utc TEXT NOT NULL,
  business_date TEXT NOT NULL,
  actor_user_id INTEGER,
  balance_guard INTEGER NOT NULL DEFAULT 1,
  source_evidence_sha256 TEXT NOT NULL,
  created_at_utc TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (movement_type IN (
    'migration_opening','purchase_receipt','transfer_out','transfer_in','issue',
    'dispense','sale','patient_return','supplier_return','waste','expiry',
    'adjustment_in','adjustment_out','reversal_in','reversal_out'
  )),
  CHECK (direction IN ('in','out')),
  CHECK (source_quantity BETWEEN 1 AND 9007199254740991),
  CHECK (length(trim(source_unit_code))>0),
  CHECK (conversion_numerator BETWEEN 1 AND 9007199254740991),
  CHECK (conversion_denominator BETWEEN 1 AND 9007199254740991),
  CHECK (source_quantity<=9007199254740991/conversion_numerator),
  CHECK ((source_quantity*conversion_numerator)%conversion_denominator=0),
  CHECK (quantity_base=(source_quantity*conversion_numerator)/conversion_denominator),
  CHECK (quantity_base BETWEEN 1 AND 9007199254740991),
  CHECK (signed_quantity_base=CASE WHEN direction='in' THEN quantity_base ELSE -quantity_base END),
  CHECK (balance_before_base BETWEEN -9007199254740991 AND 9007199254740991),
  CHECK (balance_after_base BETWEEN -9007199254740991 AND 9007199254740991),
  CHECK (balance_after_base=balance_before_base+signed_quantity_base),
  CHECK (
    (movement_type IN ('migration_opening','purchase_receipt','transfer_in','patient_return','adjustment_in','reversal_in') AND direction='in')
    OR (movement_type IN ('transfer_out','issue','dispense','sale','supplier_return','waste','expiry','adjustment_out','reversal_out') AND direction='out')
  ),
  CHECK (
    (movement_type IN ('transfer_out','transfer_in') AND transfer_public_id IS NOT NULL)
    OR (movement_type NOT IN ('transfer_out','transfer_in') AND transfer_public_id IS NULL)
  ),
  CHECK (
    (movement_type='dispense' AND invoice_public_id IS NULL AND invoice_line_public_id IS NULL)
    OR (movement_type='sale' AND (
      (service_event_public_id IS NULL AND invoice_public_id IS NULL AND invoice_line_public_id IS NULL)
      OR (service_event_public_id IS NOT NULL AND invoice_public_id IS NOT NULL AND invoice_line_public_id IS NOT NULL)
    ))
    OR (movement_type NOT IN ('dispense','sale') AND service_event_public_id IS NULL AND invoice_public_id IS NULL AND invoice_line_public_id IS NULL)
  ),
  CHECK ((invoice_public_id IS NULL)=(invoice_line_public_id IS NULL)),
  CHECK (length(trim(source_type))>0),
  CHECK (length(trim(source_public_id))>0),
  CHECK (length(trim(source_line_public_id))>0),
  CHECK (length(trim(source_table))>0),
  CHECK (status IN ('posted','reversed')),
  CHECK (substr(occurred_at_utc,-1)='Z'),
  CHECK (business_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  CONSTRAINT canonical_inventory_movements_balance_guard CHECK (balance_guard=1),
  CHECK (length(source_evidence_sha256)=64),
  FOREIGN KEY (tenant_id,item_public_id)
    REFERENCES canonical_inventory_items(tenant_id,item_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,location_public_id)
    REFERENCES canonical_inventory_locations(tenant_id,location_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,lot_public_id)
    REFERENCES canonical_inventory_lots(tenant_id,lot_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,transfer_public_id)
    REFERENCES canonical_inventory_transfers(tenant_id,transfer_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,service_event_public_id)
    REFERENCES canonical_service_events(tenant_id,event_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,invoice_public_id,invoice_line_public_id)
    REFERENCES canonical_invoice_lines(tenant_id,invoice_public_id,line_public_id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id,reversal_of_movement_public_id)
    REFERENCES canonical_inventory_movements(tenant_id,movement_public_id) ON DELETE RESTRICT,
  UNIQUE (tenant_id,movement_public_id),
  UNIQUE (tenant_id,source_type,source_public_id,source_line_public_id,movement_type)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_inventory_movements_transfer_leg
  ON canonical_inventory_movements(tenant_id,transfer_public_id,movement_type)
  WHERE transfer_public_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_inventory_movements_service_stockout
  ON canonical_inventory_movements(tenant_id,service_event_public_id)
  WHERE service_event_public_id IS NOT NULL AND movement_type IN ('dispense','sale');
CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_inventory_movements_invoice_stockout
  ON canonical_inventory_movements(tenant_id,invoice_public_id,invoice_line_public_id)
  WHERE invoice_line_public_id IS NOT NULL AND movement_type='sale';
CREATE INDEX IF NOT EXISTS idx_canonical_inventory_movements_balance
  ON canonical_inventory_movements(tenant_id,item_public_id,location_public_id,lot_public_id,occurred_at_utc,id);
CREATE INDEX IF NOT EXISTS idx_canonical_inventory_movements_source
  ON canonical_inventory_movements(tenant_id,source_type,source_public_id,source_line_public_id);
