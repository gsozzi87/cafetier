import { Database } from "bun:sqlite";
import path from "path";
import fs from "fs";

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), "data", "cafetier.db");
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(DB_PATH);
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

export function initDB() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    
    CREATE TABLE IF NOT EXISTS partners (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      profit_share REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS roast_profiles (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, active INTEGER DEFAULT 1);
    CREATE TABLE IF NOT EXISTS origins (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, active INTEGER DEFAULT 1);
    CREATE TABLE IF NOT EXISTS varieties (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, active INTEGER DEFAULT 1);
    CREATE TABLE IF NOT EXISTS expense_categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, is_direct_cost INTEGER DEFAULT 0, active INTEGER DEFAULT 1);

    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, phone TEXT, email TEXT,
      address TEXT, city TEXT, notes TEXT, created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
      origin_id INTEGER, variety_id INTEGER, roast_profile_id INTEGER,
      presentation TEXT CHECK(presentation IN ('250g','500g','1kg','granel')),
      price REAL NOT NULL, active INTEGER DEFAULT 1,
      FOREIGN KEY (origin_id) REFERENCES origins(id),
      FOREIGN KEY (variety_id) REFERENCES varieties(id),
      FOREIGN KEY (roast_profile_id) REFERENCES roast_profiles(id)
    );

    -- INVENTORY: single source of truth
    CREATE TABLE IF NOT EXISTS inventory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_type TEXT NOT NULL CHECK(item_type IN ('cafe_verde','cafe_tostado','cafe_empaquetado','insumo')),
      item_name TEXT NOT NULL, quantity REAL NOT NULL DEFAULT 0,
      unit TEXT NOT NULL DEFAULT 'kg', min_stock REAL DEFAULT 0,
      origin_id INTEGER, variety_id INTEGER, lot_label TEXT, notes TEXT,
      FOREIGN KEY (origin_id) REFERENCES origins(id),
      FOREIGN KEY (variety_id) REFERENCES varieties(id)
    );

    CREATE TABLE IF NOT EXISTS inventory_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT, inventory_id INTEGER NOT NULL,
      movement_type TEXT CHECK(movement_type IN ('entrada','salida','ajuste')),
      quantity REAL NOT NULL, reason TEXT, reference_type TEXT, reference_id INTEGER,
      registered_by TEXT, created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (inventory_id) REFERENCES inventory(id) ON DELETE CASCADE
    );

    -- ORDERS
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT, client_id INTEGER,
      order_date TEXT DEFAULT (datetime('now')), delivery_date TEXT,
      total_kg REAL, price_per_kg REAL, total_amount REAL NOT NULL,
      status TEXT DEFAULT 'pendiente' CHECK(status IN ('pendiente','esperando_compra','en_produccion','listo','enviado_parcial','entregado','pagado','cancelado')),
      notes TEXT, is_retail INTEGER DEFAULT 0,
      payment_method TEXT CHECK(payment_method IN ('efectivo','transferencia','tarjeta')),
      created_by TEXT, created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (client_id) REFERENCES clients(id)
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL,
      product_id INTEGER, product_name TEXT, quantity REAL NOT NULL,
      unit TEXT DEFAULT 'pz', unit_price REAL NOT NULL, subtotal REAL NOT NULL,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS order_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL,
      amount REAL NOT NULL, payment_method TEXT, payment_date TEXT DEFAULT (datetime('now')),
      notes TEXT, registered_by TEXT,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS order_shipments (
      id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL,
      shipment_date TEXT DEFAULT (datetime('now')), kg_shipped REAL NOT NULL,
      destination_address TEXT, carrier TEXT, tracking_number TEXT,
      shipping_cost REAL DEFAULT 0, notes TEXT, registered_by TEXT,
      expense_id INTEGER,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
      FOREIGN KEY (expense_id) REFERENCES expenses(id)
    );

    -- PURCHASE ORDERS (órdenes de compra)
    CREATE TABLE IF NOT EXISTS purchase_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER,
      item_type TEXT DEFAULT 'cafe_verde',
      description TEXT NOT NULL,
      kg_needed REAL NOT NULL,
      kg_purchased REAL DEFAULT 0,
      supplier TEXT,
      estimated_cost REAL DEFAULT 0,
      actual_cost REAL DEFAULT 0,
      status TEXT DEFAULT 'pendiente' CHECK(status IN ('pendiente','parcial','completada','cancelada')),
      created_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS purchase_order_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      purchase_order_id INTEGER NOT NULL,
      quantity REAL NOT NULL,
      cost REAL NOT NULL,
      supplier TEXT,
      lot_label TEXT,
      origin_id INTEGER, variety_id INTEGER,
      inventory_id INTEGER,
      expense_id INTEGER,
      entry_date TEXT DEFAULT (date('now')),
      registered_by TEXT,
      FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id) ON DELETE CASCADE,
      FOREIGN KEY (origin_id) REFERENCES origins(id),
      FOREIGN KEY (variety_id) REFERENCES varieties(id),
      FOREIGN KEY (inventory_id) REFERENCES inventory(id),
      FOREIGN KEY (expense_id) REFERENCES expenses(id)
    );

    -- PRODUCTION
    CREATE TABLE IF NOT EXISTS roasting_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, session_date TEXT DEFAULT (date('now')),
      operator TEXT NOT NULL, notes TEXT, created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS roasting_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER NOT NULL,
      batch_number TEXT NOT NULL,
      green_inventory_id INTEGER NOT NULL,
      origin_id INTEGER, variety_id INTEGER, roast_profile_id INTEGER,
      green_kg REAL NOT NULL, roasted_kg REAL, loss_pct REAL,
      order_id INTEGER,
      quality_rating TEXT CHECK(quality_rating IN ('vender','blendear','descartar',NULL)),
      ai_analysis TEXT, artisan_file_name TEXT, artisan_data TEXT,
      machine_minutes REAL DEFAULT 0, notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES roasting_sessions(id) ON DELETE CASCADE,
      FOREIGN KEY (green_inventory_id) REFERENCES inventory(id),
      FOREIGN KEY (origin_id) REFERENCES origins(id),
      FOREIGN KEY (variety_id) REFERENCES varieties(id),
      FOREIGN KEY (roast_profile_id) REFERENCES roast_profiles(id),
      FOREIGN KEY (order_id) REFERENCES orders(id)
    );

    CREATE TABLE IF NOT EXISTS batch_photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id INTEGER NOT NULL,
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (batch_id) REFERENCES roasting_batches(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS packaging (
      id INTEGER PRIMARY KEY AUTOINCREMENT, batch_id INTEGER NOT NULL,
      packaging_date TEXT DEFAULT (date('now')),
      presentation TEXT CHECK(presentation IN ('250g','500g','1kg')),
      units INTEGER NOT NULL, total_kg REAL NOT NULL, operator TEXT, notes TEXT,
      FOREIGN KEY (batch_id) REFERENCES roasting_batches(id) ON DELETE CASCADE
    );

    -- EXPENSES
    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT, expense_date TEXT DEFAULT (date('now')),
      category_id INTEGER NOT NULL, amount REAL NOT NULL, description TEXT,
      paid_by TEXT NOT NULL, lot_label TEXT, supplier TEXT,
      quantity REAL, quantity_unit TEXT, notes TEXT,
      auto_generated INTEGER DEFAULT 0,
      reference_type TEXT, reference_id INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (category_id) REFERENCES expense_categories(id)
    );

    -- CAPITAL
    CREATE TABLE IF NOT EXISTS capital_contributions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, partner_name TEXT NOT NULL,
      amount REAL NOT NULL, description TEXT NOT NULL,
      contribution_date TEXT DEFAULT (date('now')),
      recovered REAL DEFAULT 0, fully_recovered INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS profit_withdrawals (
      id INTEGER PRIMARY KEY AUTOINCREMENT, partner_name TEXT NOT NULL,
      amount REAL NOT NULL, withdrawal_type TEXT DEFAULT 'utilidad' CHECK(withdrawal_type IN ('aporte_retorno','utilidad')),
      month TEXT NOT NULL, withdrawal_date TEXT DEFAULT (date('now')),
      notes TEXT, created_at TEXT DEFAULT (datetime('now'))
    );

    -- MACHINE
    CREATE TABLE IF NOT EXISTS machine_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, log_date TEXT DEFAULT (date('now')),
      log_type TEXT CHECK(log_type IN ('mantenimiento','mejora','pieza','incidencia')),
      description TEXT NOT NULL, cost REAL DEFAULT 0,
      registered_by TEXT, created_at TEXT DEFAULT (datetime('now'))
    );

    -- SEED (UNIQUE constraints prevent duplicates)
    INSERT OR IGNORE INTO partners (name, profit_share) VALUES ('Itzamara', 25), ('Gastón', 25), ('Axel', 50);
    INSERT OR IGNORE INTO roast_profiles (name) VALUES ('Claro / Light'),('Medio / Medium'),('Medio-Oscuro / Medium-Dark'),('Oscuro / Dark'),('Espresso'),('Filtro / Pour Over'),('Omniroast');
    INSERT OR IGNORE INTO origins (name) VALUES ('Chiapas'),('Veracruz (Coatepec)'),('Oaxaca (Pluma)'),('Puebla'),('Guerrero'),('Nayarit'),('Colombia'),('Brasil'),('Guatemala'),('Etiopía'),('Blend (mezcla)');
    INSERT OR IGNORE INTO varieties (name) VALUES ('Typica'),('Bourbon'),('Caturra'),('Catuaí'),('Geisha / Gesha'),('SL28'),('SL34'),('Pacamara'),('Maragogipe'),('Mundo Novo'),('Catimor'),('Sarchimor'),('Java'),('Blend');
    INSERT OR IGNORE INTO expense_categories (name, is_direct_cost) VALUES ('Café verde', 1),('Gas', 1),('Bolsas y empaques', 1),('Etiquetas', 0),('Envíos / Transporte', 1),('Electricidad', 1),('Publicidad / Marketing', 0),('Mejoras a la máquina', 0),('Mantenimiento máquina', 0),('Renta', 0),('Otros', 0);
    INSERT OR IGNORE INTO settings (key, value) VALUES ('machine_kw', '0'),('kwh_price', '0'),('business_name', 'CAFETIER'),('claude_api_key', '');
  `);
}

export default db;
