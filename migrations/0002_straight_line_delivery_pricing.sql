-- Qeshta Orders: straight-line GPS delivery pricing.
-- Applied once to the existing production D1 database after delivery origin/rates are approved.
ALTER TABLE orders ADD COLUMN delivery_distance_km REAL;

CREATE TABLE IF NOT EXISTS delivery_settings(
  id INTEGER PRIMARY KEY CHECK(id=1),
  restaurant_lat REAL NOT NULL CHECK(restaurant_lat BETWEEN -90 AND 90),
  restaurant_lng REAL NOT NULL CHECK(restaurant_lng BETWEEN -180 AND 180),
  max_distance_km REAL NOT NULL CHECK(max_distance_km>0),
  updated_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS delivery_rates(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  min_km REAL NOT NULL CHECK(min_km>=0),
  max_km REAL NOT NULL CHECK(max_km>=min_km),
  fee INTEGER NOT NULL CHECK(fee>=0),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),
  created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_delivery_rates_lookup
  ON delivery_rates(active,min_km,max_km);
