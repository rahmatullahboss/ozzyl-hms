-- Migration: 0088_ambulance.sql
-- Ambulance Management — fleet, trips, dispatch

CREATE TABLE IF NOT EXISTS ambulance_vehicles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    vehicle_number TEXT NOT NULL,         -- license plate
    vehicle_type TEXT DEFAULT 'basic' CHECK(vehicle_type IN ('basic','advanced','icu','neonatal','patient_transport')),
    make_model TEXT,                      -- "Toyota HiAce"
    year INTEGER,
    driver_name TEXT,
    driver_phone TEXT,
    paramedic_name TEXT,
    insurance_expiry TEXT,
    fitness_expiry TEXT,
    gps_device_id TEXT,
    current_status TEXT DEFAULT 'available' CHECK(current_status IN ('available','on_trip','maintenance','out_of_service')),
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_amb_vehicle_tenant ON ambulance_vehicles(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_amb_vehicle_num ON ambulance_vehicles(tenant_id, vehicle_number);

CREATE TABLE IF NOT EXISTS ambulance_trips (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL,
    trip_number TEXT NOT NULL,
    vehicle_id INTEGER NOT NULL,
    patient_id INTEGER,
    patient_name TEXT,
    trip_type TEXT NOT NULL CHECK(trip_type IN ('emergency_pickup','hospital_transfer','discharge_drop','dead_body','referral','other')),
    urgency TEXT DEFAULT 'routine' CHECK(urgency IN ('routine','urgent','emergency')),
    -- Pickup
    pickup_location TEXT NOT NULL,
    pickup_time TEXT,
    pickup_lat REAL,
    pickup_lng REAL,
    -- Drop
    drop_location TEXT,
    drop_time TEXT,
    -- Distance & billing
    distance_km REAL,
    fare_amount REAL,
    payment_status TEXT DEFAULT 'pending' CHECK(payment_status IN ('pending','paid','waived','billed')),
    -- Staff
    driver_name TEXT,
    paramedic_name TEXT,
    -- Status
    status TEXT DEFAULT 'dispatched' CHECK(status IN ('dispatched','en_route','arrived','patient_loaded','in_transit','completed','cancelled')),
    dispatched_at TEXT,
    completed_at TEXT,
    cancelled_reason TEXT,
    -- Clinical (for emergency pickups)
    condition_at_pickup TEXT,
    vitals_at_pickup TEXT,               -- JSON: {bp, pulse, spo2}
    treatment_given TEXT,
    remarks TEXT,
    created_by INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_amb_trip_num ON ambulance_trips(tenant_id, trip_number);
CREATE INDEX IF NOT EXISTS idx_amb_trip_tenant ON ambulance_trips(tenant_id, dispatched_at);
CREATE INDEX IF NOT EXISTS idx_amb_trip_vehicle ON ambulance_trips(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_amb_trip_status ON ambulance_trips(tenant_id, status);
