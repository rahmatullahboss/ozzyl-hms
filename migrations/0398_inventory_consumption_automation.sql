-- Inventory consumption automation foundation
-- Purpose: Adds rule/event/exception/policy tables for service/procedure/OT/ward stock deduction automation.
-- Important: These tables do not replace InventoryStock or InventoryConsumption. Final posting must use the canonical inventory issue engine.

CREATE TABLE IF NOT EXISTS InventoryConsumptionRule (
  RuleId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  RuleName TEXT NOT NULL,
  RuleCode TEXT,
  TriggerType TEXT NOT NULL CHECK(TriggerType IN ('billing_item','lab_test','ot_procedure','procedure','nursing_task','emergency_service','pharmacy_sale','package','manual_reference')),
  TriggerId INTEGER,
  TriggerCode TEXT,
  Department TEXT,
  DefaultStoreId INTEGER REFERENCES InventoryStore(StoreId),
  DeductionMode TEXT NOT NULL DEFAULT 'suggest_confirm' CHECK(DeductionMode IN ('auto','suggest_confirm','scan_required','approval_required','manual_only')),
  ChargePolicy TEXT NOT NULL DEFAULT 'none' CHECK(ChargePolicy IN ('none','patient','department','included_in_package')),
  IsActive INTEGER NOT NULL DEFAULT 1,
  EffectiveFrom TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  EffectiveTo TEXT,
  CreatedBy INTEGER,
  CreatedOn TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ModifiedBy INTEGER,
  ModifiedOn TEXT
);

CREATE INDEX IF NOT EXISTS idx_inv_cons_rule_trigger
  ON InventoryConsumptionRule(tenant_id, TriggerType, TriggerId, IsActive);
CREATE INDEX IF NOT EXISTS idx_inv_cons_rule_code
  ON InventoryConsumptionRule(tenant_id, RuleCode, IsActive);
CREATE INDEX IF NOT EXISTS idx_inv_cons_rule_department
  ON InventoryConsumptionRule(tenant_id, Department, IsActive);
CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_cons_rule_active_code
  ON InventoryConsumptionRule(tenant_id, TriggerType, COALESCE(TriggerId, 0), COALESCE(RuleCode, ''), IsActive);

CREATE TABLE IF NOT EXISTS InventoryConsumptionRuleItem (
  RuleItemId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  RuleId INTEGER NOT NULL REFERENCES InventoryConsumptionRule(RuleId),
  ItemId INTEGER NOT NULL REFERENCES InventoryItem(ItemId),
  DefaultStockId INTEGER REFERENCES InventoryStock(StockId),
  Quantity REAL NOT NULL CHECK(Quantity > 0),
  Unit TEXT,
  IsMandatory INTEGER NOT NULL DEFAULT 1,
  RequiresScan INTEGER NOT NULL DEFAULT 0,
  RequiresApproval INTEGER NOT NULL DEFAULT 0,
  HighValueFlag INTEGER NOT NULL DEFAULT 0,
  AllowSubstitution INTEGER NOT NULL DEFAULT 0,
  VarianceToleranceQty REAL DEFAULT 0,
  VarianceTolerancePercent REAL DEFAULT 0,
  SortOrder INTEGER NOT NULL DEFAULT 0,
  Notes TEXT,
  CreatedBy INTEGER,
  CreatedOn TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ModifiedBy INTEGER,
  ModifiedOn TEXT
);

CREATE INDEX IF NOT EXISTS idx_inv_cons_rule_item_rule
  ON InventoryConsumptionRuleItem(tenant_id, RuleId, SortOrder);
CREATE INDEX IF NOT EXISTS idx_inv_cons_rule_item_item
  ON InventoryConsumptionRuleItem(tenant_id, ItemId);

CREATE TABLE IF NOT EXISTS InventoryConsumptionEvent (
  EventId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  RuleId INTEGER REFERENCES InventoryConsumptionRule(RuleId),
  EventNo TEXT NOT NULL,
  TriggerType TEXT NOT NULL CHECK(TriggerType IN ('billing_item','lab_test','ot_procedure','procedure','nursing_task','emergency_service','pharmacy_sale','package','manual_reference')),
  TriggerId INTEGER,
  TriggerCode TEXT,
  PatientId INTEGER,
  VisitId INTEGER,
  AdmissionId INTEGER,
  BillId INTEGER,
  InvoiceItemId INTEGER,
  LabOrderId INTEGER,
  LabOrderItemId INTEGER,
  OTCaseId INTEGER,
  ProcedureId INTEGER,
  Department TEXT,
  StoreId INTEGER REFERENCES InventoryStore(StoreId),
  DeductionMode TEXT NOT NULL DEFAULT 'suggest_confirm' CHECK(DeductionMode IN ('auto','suggest_confirm','scan_required','approval_required','manual_only')),
  Status TEXT NOT NULL DEFAULT 'expected' CHECK(Status IN ('expected','pending_confirmation','confirmed','posted','reversed','cancelled','blocked_missing_rule','blocked_stock_shortage','blocked_scan_required','blocked_approval_required','variance_review')),
  PostedConsumptionId INTEGER REFERENCES InventoryConsumption(ConsumptionId),
  ReversalConsumptionId INTEGER REFERENCES InventoryConsumption(ConsumptionId),
  ExpectedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ConfirmedBy INTEGER,
  ConfirmedAt TEXT,
  PostedBy INTEGER,
  PostedAt TEXT,
  CancelledBy INTEGER,
  CancelledAt TEXT,
  Remarks TEXT,
  CreatedBy INTEGER,
  CreatedOn TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ModifiedBy INTEGER,
  ModifiedOn TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_cons_event_no
  ON InventoryConsumptionEvent(tenant_id, EventNo);
CREATE INDEX IF NOT EXISTS idx_inv_cons_event_status
  ON InventoryConsumptionEvent(tenant_id, Status, ExpectedAt);
CREATE INDEX IF NOT EXISTS idx_inv_cons_event_reference
  ON InventoryConsumptionEvent(tenant_id, TriggerType, TriggerId);
CREATE INDEX IF NOT EXISTS idx_inv_cons_event_patient
  ON InventoryConsumptionEvent(tenant_id, PatientId, ExpectedAt);
CREATE INDEX IF NOT EXISTS idx_inv_cons_event_ot
  ON InventoryConsumptionEvent(tenant_id, OTCaseId, Status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_cons_event_idempotency
  ON InventoryConsumptionEvent(tenant_id, TriggerType, COALESCE(TriggerId, 0), COALESCE(RuleId, 0), COALESCE(InvoiceItemId, 0), COALESCE(LabOrderItemId, 0), COALESCE(OTCaseId, 0));

CREATE TABLE IF NOT EXISTS InventoryConsumptionEventItem (
  EventItemId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  EventId INTEGER NOT NULL REFERENCES InventoryConsumptionEvent(EventId),
  RuleItemId INTEGER REFERENCES InventoryConsumptionRuleItem(RuleItemId),
  ItemId INTEGER NOT NULL REFERENCES InventoryItem(ItemId),
  StockId INTEGER REFERENCES InventoryStock(StockId),
  BatchNo TEXT,
  ExpectedQuantity REAL NOT NULL DEFAULT 0,
  ActualQuantity REAL,
  Unit TEXT,
  Chargeable INTEGER NOT NULL DEFAULT 0,
  ChargeAmount REAL NOT NULL DEFAULT 0,
  Status TEXT NOT NULL DEFAULT 'expected' CHECK(Status IN ('expected','confirmed','posted','reversed','cancelled','blocked','variance_review')),
  VarianceQty REAL DEFAULT 0,
  VarianceReason TEXT,
  ScanCode TEXT,
  RequiresScan INTEGER NOT NULL DEFAULT 0,
  RequiresApproval INTEGER NOT NULL DEFAULT 0,
  HighValueFlag INTEGER NOT NULL DEFAULT 0,
  ConfirmedBy INTEGER,
  ConfirmedAt TEXT,
  Remarks TEXT,
  CreatedBy INTEGER,
  CreatedOn TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ModifiedBy INTEGER,
  ModifiedOn TEXT
);

CREATE INDEX IF NOT EXISTS idx_inv_cons_event_item_event
  ON InventoryConsumptionEventItem(tenant_id, EventId);
CREATE INDEX IF NOT EXISTS idx_inv_cons_event_item_item
  ON InventoryConsumptionEventItem(tenant_id, ItemId);
CREATE INDEX IF NOT EXISTS idx_inv_cons_event_item_stock
  ON InventoryConsumptionEventItem(tenant_id, StockId);
CREATE INDEX IF NOT EXISTS idx_inv_cons_event_item_status
  ON InventoryConsumptionEventItem(tenant_id, Status);

CREATE TABLE IF NOT EXISTS InventoryConsumptionException (
  ExceptionId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  EventId INTEGER REFERENCES InventoryConsumptionEvent(EventId),
  EventItemId INTEGER REFERENCES InventoryConsumptionEventItem(EventItemId),
  Reason TEXT NOT NULL CHECK(Reason IN ('missing_rule','stock_shortage','scan_missing','approval_required','variance_high','duplicate_event','reference_missing','reversal_failed')),
  Severity TEXT NOT NULL DEFAULT 'warning' CHECK(Severity IN ('info','warning','critical')),
  Status TEXT NOT NULL DEFAULT 'open' CHECK(Status IN ('open','reviewed','resolved','ignored')),
  Message TEXT NOT NULL,
  ReviewedBy INTEGER,
  ReviewedAt TEXT,
  ResolutionNote TEXT,
  CreatedBy INTEGER,
  CreatedOn TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_inv_cons_exception_status
  ON InventoryConsumptionException(tenant_id, Status, Severity);
CREATE INDEX IF NOT EXISTS idx_inv_cons_exception_event
  ON InventoryConsumptionException(tenant_id, EventId);
CREATE INDEX IF NOT EXISTS idx_inv_cons_exception_reason
  ON InventoryConsumptionException(tenant_id, Reason, Status);

CREATE TABLE IF NOT EXISTS InventoryConsumptionPolicy (
  tenant_id TEXT PRIMARY KEY,
  DefaultDeductionMode TEXT NOT NULL DEFAULT 'suggest_confirm' CHECK(DefaultDeductionMode IN ('auto','suggest_confirm','scan_required','approval_required','manual_only')),
  AutoDeductLowRiskItems INTEGER NOT NULL DEFAULT 1,
  RequireReferenceForManualIssue INTEGER NOT NULL DEFAULT 0,
  RequireScanForHighValue INTEGER NOT NULL DEFAULT 0,
  RequireApprovalForHighVariance INTEGER NOT NULL DEFAULT 0,
  BlockDischargeOnUnconfirmedConsumption INTEGER NOT NULL DEFAULT 0,
  SoftModeAllowStockShortage INTEGER NOT NULL DEFAULT 1,
  HighVariancePercent REAL NOT NULL DEFAULT 25,
  HighValueAmountThreshold REAL NOT NULL DEFAULT 5000,
  UpdatedBy INTEGER,
  UpdatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
