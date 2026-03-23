import Database from "better-sqlite3";
import path from "path";

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), "data", "cafetier.db");

// Ensure data directory exists
import fs from "fs";
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

export function initDB() {
  db.exec(`
    -- ===================== CONFIGURACIÓN =====================
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      display_name TEXT NOT NULL,
      profit_share REAL NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS roast_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS origins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS varieties (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS expense_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      is_direct_cost INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1
    );

    -- ===================== CLIENTES =====================
    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      address TEXT,
      city TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- ===================== CATÁLOGO DE PRODUCTOS =====================
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      origin_id INTEGER,
      variety_id INTEGER,
      roast_profile_id INTEGER,
      presentation TEXT CHECK(presentation IN ('250g','500g','1kg','granel')),
      price REAL NOT NULL,
      active INTEGER DEFAULT 1,
      FOREIGN KEY (origin_id) REFERENCES origins(id),
      FOREIGN KEY (variety_id) REFERENCES varieties(id),
      FOREIGN KEY (roast_profile_id) REFERENCES roast_profiles(id)
    );

    -- ===================== PEDIDOS =====================
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER,
      client_name TEXT,
      order_date TEXT DEFAULT (datetime('now')),
      delivery_date TEXT,
      total_kg REAL,
      price_per_kg REAL,
      total_amount REAL NOT NULL,
      status TEXT DEFAULT 'pendiente' CHECK(status IN ('pendiente','en_produccion','listo','enviado_parcial','entregado','pagado','cancelado')),
      notes TEXT,
      is_retail INTEGER DEFAULT 0,
      payment_method TEXT CHECK(payment_method IN ('efectivo','transferencia','tarjeta')),
      created_by TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      product_id INTEGER,
      product_name TEXT,
      quantity REAL NOT NULL,
      unit TEXT DEFAULT 'kg',
      unit_price REAL NOT NULL,
      subtotal REAL NOT NULL,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS order_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      payment_method TEXT CHECK(payment_method IN ('efectivo','transferencia','tarjeta')),
      payment_date TEXT DEFAULT (datetime('now')),
      notes TEXT,
      registered_by TEXT,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS order_shipments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      shipment_date TEXT DEFAULT (datetime('now')),
      kg_shipped REAL NOT NULL,
      destination_address TEXT,
      carrier TEXT,
      tracking_number TEXT,
      shipping_cost REAL DEFAULT 0,
      notes TEXT,
      registered_by TEXT,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    );

    -- ===================== PRODUCCIÓN / TOSTADO =====================
    CREATE TABLE IF NOT EXISTS roasting_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_date TEXT DEFAULT (date('now')),
      operator TEXT NOT NULL,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS roasting_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      batch_number TEXT NOT NULL,
      origin_id INTEGER,
      variety_id INTEGER,
      roast_profile_id INTEGER,
      green_kg REAL NOT NULL,
      roasted_kg REAL,
      loss_pct REAL,
      order_id INTEGER,
      quality_rating TEXT CHECK(quality_rating IN ('vender','blendear','descartar',NULL)),
      ai_analysis TEXT,
      artisan_file_path TEXT,
      artisan_file_name TEXT,
      machine_hours REAL DEFAULT 0,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES roasting_sessions(id) ON DELETE CASCADE,
      FOREIGN KEY (origin_id) REFERENCES origins(id),
      FOREIGN KEY (variety_id) REFERENCES varieties(id),
      FOREIGN KEY (roast_profile_id) REFERENCES roast_profiles(id),
      FOREIGN KEY (order_id) REFERENCES orders(id)
    );

    -- ===================== EMPAQUETADO =====================
    CREATE TABLE IF NOT EXISTS packaging (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id INTEGER NOT NULL,
      packaging_date TEXT DEFAULT (date('now')),
      presentation TEXT CHECK(presentation IN ('250g','500g','1kg')),
      units INTEGER NOT NULL,
      total_kg REAL NOT NULL,
      operator TEXT,
      notes TEXT,
      FOREIGN KEY (batch_id) REFERENCES roasting_batches(id) ON DELETE CASCADE
    );

    -- ===================== INVENTARIO =====================
    CREATE TABLE IF NOT EXISTS inventory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_type TEXT NOT NULL CHECK(item_type IN ('cafe_verde','cafe_tostado','cafe_empaquetado','insumo')),
      item_name TEXT NOT NULL,
      quantity REAL NOT NULL DEFAULT 0,
      unit TEXT NOT NULL DEFAULT 'kg',
      min_stock REAL DEFAULT 0,
      origin_id INTEGER,
      variety_id INTEGER,
      batch_id INTEGER,
      lot_label TEXT,
      notes TEXT,
      FOREIGN KEY (origin_id) REFERENCES origins(id),
      FOREIGN KEY (variety_id) REFERENCES varieties(id),
      FOREIGN KEY (batch_id) REFERENCES roasting_batches(id)
    );

    CREATE TABLE IF NOT EXISTS inventory_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      inventory_id INTEGER NOT NULL,
      movement_type TEXT CHECK(movement_type IN ('entrada','salida','ajuste')),
      quantity REAL NOT NULL,
      reason TEXT,
      reference_type TEXT,
      reference_id INTEGER,
      registered_by TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (inventory_id) REFERENCES inventory(id) ON DELETE CASCADE
    );

    -- ===================== COMPRAS / GASTOS =====================
    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      expense_date TEXT DEFAULT (date('now')),
      category_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      description TEXT,
      paid_by TEXT NOT NULL,
      lot_label TEXT,
      supplier TEXT,
      quantity REAL,
      quantity_unit TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (category_id) REFERENCES expense_categories(id)
    );

    -- ===================== APORTES DE CAPITAL =====================
    CREATE TABLE IF NOT EXISTS capital_contributions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_name TEXT NOT NULL,
      amount REAL NOT NULL,
      description TEXT,
      contribution_date TEXT DEFAULT (date('now')),
      recovered REAL DEFAULT 0,
      fully_recovered INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS profit_withdrawals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_name TEXT NOT NULL,
      amount REAL NOT NULL,
      month TEXT NOT NULL,
      withdrawal_date TEXT DEFAULT (date('now')),
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- ===================== BITÁCORA DE MÁQUINA =====================
    CREATE TABLE IF NOT EXISTS machine_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      log_date TEXT DEFAULT (date('now')),
      log_type TEXT CHECK(log_type IN ('mantenimiento','mejora','pieza','incidencia','horas')),
      description TEXT NOT NULL,
      cost REAL DEFAULT 0,
      hours REAL DEFAULT 0,
      registered_by TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- ===================== SEED DATA =====================
    INSERT OR IGNORE INTO users (username, password, display_name, profit_share) VALUES
      ('itzamara', 'cafetier2026', 'Itzamara', 25),
      ('axel', 'cafetier2026', 'Axel', 50),
      ('gaston', 'cafetier2026', 'Gastón', 25);

    INSERT OR IGNORE INTO roast_profiles (name) VALUES
      ('Claro / Light'),('Medio / Medium'),('Medio-Oscuro / Medium-Dark'),
      ('Oscuro / Dark'),('Espresso'),('Filtro / Pour Over'),('Omniroast');

    INSERT OR IGNORE INTO origins (name) VALUES
      ('Chiapas'),('Veracruz (Coatepec)'),('Oaxaca (Pluma)'),('Puebla'),
      ('Guerrero'),('Nayarit'),('Colombia'),('Brasil'),('Guatemala'),
      ('Etiopía'),('Blend (mezcla)');

    INSERT OR IGNORE INTO varieties (name) VALUES
      ('Typica'),('Bourbon'),('Caturra'),('Catuaí'),('Geisha / Gesha'),
      ('SL28'),('SL34'),('Pacamara'),('Maragogipe'),('Mundo Novo'),
      ('Catimor'),('Sarchimor'),('Java'),('Blend');

    INSERT OR IGNORE INTO expense_categories (name, is_direct_cost) VALUES
      ('Café verde', 1),('Gas', 1),('Bolsas y empaques', 1),
      ('Etiquetas', 0),('Envíos / Transporte', 1),('Electricidad', 1),
      ('Publicidad / Marketing', 0),('Mejoras a la máquina', 0),
      ('Mantenimiento máquina', 0),('Renta', 0),('Otros', 0);

    INSERT OR IGNORE INTO settings (key, value) VALUES
      ('machine_kw', '0'),
      ('kwh_price', '0'),
      ('business_name', 'CAFETIER'),
      ('claude_api_key', '');
  `);
}

export default db;
