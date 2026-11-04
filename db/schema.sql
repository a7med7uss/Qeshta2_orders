-- نفس الجداول المنفذة على قاعدة qeshta-orders (D1)
CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY AUTOINCREMENT,code TEXT UNIQUE,idem_key TEXT NOT NULL UNIQUE,customer_name TEXT NOT NULL,phone TEXT NOT NULL,address_text TEXT,lat REAL,lng REAL,payment_method TEXT NOT NULL CHECK(payment_method IN('cash','wallet','instapay')),subtotal INTEGER NOT NULL CHECK(subtotal>=0),delivery_fee INTEGER NOT NULL DEFAULT 0,delivery_distance_km REAL,total INTEGER NOT NULL CHECK(total>=0),status TEXT NOT NULL DEFAULT 'new' CHECK(status IN('new','confirmed','out_for_delivery','delivered','cancelled')),cancel_reason TEXT,confirmed_by INTEGER,tg_message_id INTEGER,tg_sent INTEGER NOT NULL DEFAULT 0,tg_attempts INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),updated_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE TABLE IF NOT EXISTS order_items(id INTEGER PRIMARY KEY AUTOINCREMENT,order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,item_ref TEXT NOT NULL,name TEXT NOT NULL,size TEXT,qty INTEGER NOT NULL CHECK(qty BETWEEN 1 AND 50),base_price INTEGER NOT NULL,chosen_price INTEGER NOT NULL,extras TEXT,note TEXT);
CREATE TABLE IF NOT EXISTS staff(telegram_id INTEGER PRIMARY KEY,name TEXT,role TEXT NOT NULL DEFAULT 'staff' CHECK(role IN('owner','staff')),active INTEGER NOT NULL DEFAULT 1,added_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE TABLE IF NOT EXISTS order_events(id INTEGER PRIMARY KEY AUTOINCREMENT,order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,event TEXT NOT NULL,by_telegram_id INTEGER,created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE INDEX IF NOT EXISTS idx_orders_status_created ON orders(status,created_at);
CREATE INDEX IF NOT EXISTS idx_orders_phone ON orders(phone);
CREATE INDEX IF NOT EXISTS idx_orders_tg_unsent ON orders(created_at) WHERE tg_sent=0;
CREATE INDEX IF NOT EXISTS idx_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_events_order ON order_events(order_id);


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
CREATE INDEX IF NOT EXISTS idx_delivery_rates_lookup ON delivery_rates(active,min_km,max_km);
