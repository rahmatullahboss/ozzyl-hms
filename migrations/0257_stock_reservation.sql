CREATE TABLE IF NOT EXISTS InventoryStockReservation (
  ReservationId INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  StockId INTEGER NOT NULL,
  ItemId INTEGER NOT NULL,
  StoreId INTEGER NOT NULL,
  Quantity INTEGER NOT NULL,
  ReservedForType TEXT NOT NULL, -- 'patient', 'department', 'surgery', 'order'
  ReservedForId TEXT,
  ReservedBy TEXT NOT NULL,
  Status TEXT DEFAULT 'active', -- 'active', 'fulfilled', 'cancelled', 'expired'
  ExpiresAt TEXT NOT NULL,
  FulfilledAt TEXT,
  CancelledAt TEXT,
  Remarks TEXT,
  CreatedOn TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (StockId) REFERENCES InventoryStock(StockId)
);

CREATE INDEX IF NOT EXISTS idx_reservation_tenant_stock
  ON InventoryStockReservation(tenant_id, StockId);

CREATE INDEX IF NOT EXISTS idx_reservation_tenant_status
  ON InventoryStockReservation(tenant_id, Status);

CREATE INDEX IF NOT EXISTS idx_reservation_expires
  ON InventoryStockReservation(Status, ExpiresAt);
