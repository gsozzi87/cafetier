import { Database } from "bun:sqlite";
import fs from "fs";
import path from "path";

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), "data", "cafetier.db");
const DATA_DIR = path.dirname(DB_PATH);
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(DB_PATH, { create: true });
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

export const now = () => new Date().toISOString();
export const today = () => now().slice(0, 10);
export const thisMonth = () => now().slice(0, 7);
export function docNo(prefix: string) {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}`;
}
export function r2(n: number) { return Math.round((n + Number.EPSILON) * 100) / 100; }

export function qAll<T = any>(sql: string, ...p: any[]): T[] { return db.query(sql).all(...p) as T[]; }
export function qGet<T = any>(sql: string, ...p: any[]): T | null { return (db.query(sql).get(...p) as T | undefined) ?? null; }
export function qRun(sql: string, ...p: any[]) { return db.query(sql).run(...p); }
export function qVal<T = any>(sql: string, ...p: any[]): T | null {
  const row = qGet<Record<string, T>>(sql, ...p);
  if (!row) return null;
  return row[Object.keys(row)[0]] ?? null;
}
export function tx<T extends any[], R>(fn: (...args: T) => R) { return db.transaction(fn); }

export function normPartner(name: string | null | undefined) {
  const raw = String(name || "").trim();
  if (!raw) return raw;
  const k = raw.toLowerCase();
  if (["itzamara","itza","gaston","gastón","itza + gaston","itza + gastón","itza y gaston","itza y gastón","itza/gaston","itza/gastón"].includes(k)) return "Itza + Gastón";
  if (k === "axel") return "Axel";
  return raw;
}

export function getSettings() {
  const rows = qAll<{ key: string; value: string }>("SELECT key, value FROM settings");
  const o: Record<string, string> = {};
  for (const r of rows) o[r.key] = r.value;
  return o;
}

export function getNum(key: string, fallback = 0) {
  const row = qGet<{ value: string }>("SELECT value FROM settings WHERE key=?", key);
  const n = Number(row?.value ?? fallback);
  return Number.isFinite(n) ? n : fallback;
}

export function invTotal(type: string): number {
  return Number(qVal("SELECT COALESCE(SUM(quantity),0) AS v FROM inventory_items WHERE item_type=?", type) ?? 0);
}

export function finance() {
  const contributed = Number(qVal("SELECT COALESCE(SUM(amount),0) AS v FROM capital_contributions") ?? 0);
  const revenue = Number(qVal("SELECT COALESCE(SUM(amount),0) AS v FROM sales_payments") ?? 0);
  const expenses = Number(qVal("SELECT COALESCE(SUM(amount),0) AS v FROM expenses") ?? 0);
  const capReturned = Number(qVal("SELECT COALESCE(SUM(amount),0) AS v FROM withdrawals WHERE kind='capital_return'") ?? 0);
  const dividends = Number(qVal("SELECT COALESCE(SUM(amount),0) AS v FROM withdrawals WHERE kind='dividend'") ?? 0);
  const unrecovered = Math.max(0, r2(contributed - capReturned));
  const cash = r2(contributed + revenue - expenses - capReturned - dividends);
  const profit = r2(revenue - expenses - dividends);
  const distributable = unrecovered > 0 ? 0 : Math.max(0, Math.min(profit, cash));
  return { cash, revenue, expenses, contributed, capReturned, unrecovered, dividends, profit, distributable };
}

export function ensureInvItem(data: { item_type: string; item_name: string; unit?: string; origin_id?: number | null; variety_id?: number | null; lot_label?: string | null }) {
  const existing = qGet<{ id: number }>("SELECT id FROM inventory_items WHERE item_type=? AND item_name=? AND COALESCE(lot_label,'')=COALESCE(?,'') LIMIT 1", data.item_type, data.item_name, data.lot_label ?? null);
  if (existing) return existing.id;
  const res = qRun("INSERT INTO inventory_items (item_type,item_name,quantity,unit,min_stock,origin_id,variety_id,lot_label) VALUES (?,?,0,?,0,?,?,?)", data.item_type, data.item_name, data.unit ?? "kg", data.origin_id ?? null, data.variety_id ?? null, data.lot_label ?? null);
  return Number(res.lastInsertRowid);
}

export function invMove(itemId: number, dir: "in" | "out" | "adjust", qty: number, reason: string, by?: string | null) {
  const cur = Number(qVal("SELECT COALESCE(quantity,0) AS v FROM inventory_items WHERE id=?", itemId) ?? 0);
  let next = cur;
  if (dir === "in") next = cur + qty;
  else if (dir === "out") {
    if (cur < qty) throw new Error(`Inventario insuficiente (disponible: ${cur.toFixed(1)}, solicitado: ${qty.toFixed(1)})`);
    next = cur - qty;
  } else next = qty;
  qRun("UPDATE inventory_items SET quantity=? WHERE id=?", r2(next), itemId);
  qRun("INSERT INTO inventory_movements (item_id,direction,quantity,reason,registered_by,created_at) VALUES (?,?,?,?,?,?)", itemId, dir, r2(qty), reason, by ?? "Sistema", now());
}

export function recalcSO(id: number) {
  const o = qGet<any>("SELECT * FROM sales_orders WHERE id=?", id);
  if (!o) return null;
  const paid = Number(qVal("SELECT COALESCE(SUM(amount),0) AS v FROM sales_payments WHERE order_id=?", id) ?? 0);
  const shipped = Number(qVal("SELECT COALESCE(SUM(weight_kg),0) AS v FROM sales_shipments WHERE order_id=?", id) ?? 0);
  const roasted = Number(qVal("SELECT COALESCE(SUM(roasted_kg),0) AS v FROM roasting_batches WHERE sales_order_id=?", id) ?? 0);
  const hasPendPO = Number(qVal("SELECT COUNT(*) AS v FROM purchase_orders WHERE source_type='sales_order' AND source_id=? AND status NOT IN ('recibida','cancelada')", id) ?? 0);
  let status = o.status;
  if (o.order_type === "mostrador") status = paid >= o.total_amount ? "completado" : "abierto";
  else if (shipped >= (o.total_weight_kg || 0) && o.total_weight_kg > 0) status = paid >= o.total_amount ? "completado" : "listo";
  else if (shipped > 0) status = "envio_parcial";
  else if (roasted >= (o.total_weight_kg || 0) && o.total_weight_kg > 0) status = "listo";
  else if (roasted > 0) status = "en_produccion";
  else if (hasPendPO > 0) status = "esperando_compra";
  else status = "abierto";
  qRun("UPDATE sales_orders SET status=?, updated_at=? WHERE id=?", status, now(), id);
  return qGet("SELECT * FROM sales_orders WHERE id=?", id);
}

export function recalcPO(poId: number) {
  const po = qGet<any>("SELECT * FROM purchase_orders WHERE id=?", poId);
  if (!po) return null;
  const received = Number(qVal("SELECT COALESCE(SUM(quantity_kg),0) AS v FROM purchase_entries WHERE purchase_order_id=?", poId) ?? 0);
  const cost = Number(qVal("SELECT COALESCE(SUM(total_cost+shipping_cost),0) AS v FROM purchase_entries WHERE purchase_order_id=?", poId) ?? 0);
  const status = received >= po.requested_kg && po.requested_kg > 0 ? "recibida" : received > 0 ? "parcial" : "pendiente";
  qRun("UPDATE purchase_orders SET received_kg=?, actual_cost=?, status=?, updated_at=? WHERE id=?", r2(received), r2(cost), status, now(), poId);
  if (status === "recibida" && po.source_type === "sales_order" && po.source_id) recalcSO(po.source_id);
  return qGet("SELECT * FROM purchase_orders WHERE id=?", poId);
}

export function createPO(input: { sourceType: string; sourceId?: number | null; description: string; requestedKg: number; estimatedCost?: number; supplier?: string | null }) {
  const f = finance();
  const est = r2(input.estimatedCost ?? 0);
  const status = est > f.cash ? "sin_fondos" : "pendiente";
  const res = qRun("INSERT INTO purchase_orders (po_no,source_type,source_id,status,description,requested_kg,estimated_cost,actual_cost,received_kg,supplier,created_at,updated_at) VALUES (?,?,?,?,?,?,?,0,0,?,?,?)", docNo("OC"), input.sourceType, input.sourceId ?? null, status, input.description, r2(input.requestedKg), est, input.supplier ?? null, now(), now());
  const poId = Number(res.lastInsertRowid);
  if (input.sourceType === "sales_order" && input.sourceId) recalcSO(input.sourceId);
  return qGet<any>("SELECT * FROM purchase_orders WHERE id=?", poId);
}

export function autoExpense(catName: string, amount: number, desc: string, paidBy: string, refType: string, refId: number) {
  const cat = qGet<{ id: number }>("SELECT id FROM expense_categories WHERE name=? LIMIT 1", catName);
  if (!cat) return null;
  const res = qRun("INSERT INTO expenses (expense_date,category_id,amount,description,paid_by,auto_generated,ref_type,ref_id,created_at) VALUES (?,?,?,?,?,1,?,?,?)", today(), cat.id, r2(amount), desc, paidBy, refType, refId, now());
  return Number(res.lastInsertRowid);
}

export function initDB() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS partners (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, share_pct REAL NOT NULL);
    CREATE TABLE IF NOT EXISTS roast_profiles (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, active INTEGER DEFAULT 1);
    CREATE TABLE IF NOT EXISTS origins (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, active INTEGER DEFAULT 1);
    CREATE TABLE IF NOT EXISTS varieties (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, active INTEGER DEFAULT 1);
    CREATE TABLE IF NOT EXISTS expense_categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, is_direct_cost INTEGER DEFAULT 0, active INTEGER DEFAULT 1);
    CREATE TABLE IF NOT EXISTS clients (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, phone TEXT, email TEXT, address TEXT, city TEXT, notes TEXT, active INTEGER DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, origin_id INTEGER, variety_id INTEGER, roast_profile_id INTEGER, presentation TEXT, unit_weight_kg REAL DEFAULT 1, price REAL DEFAULT 0, active INTEGER DEFAULT 1, FOREIGN KEY (origin_id) REFERENCES origins(id), FOREIGN KEY (variety_id) REFERENCES varieties(id), FOREIGN KEY (roast_profile_id) REFERENCES roast_profiles(id));

    CREATE TABLE IF NOT EXISTS inventory_items (id INTEGER PRIMARY KEY AUTOINCREMENT, item_type TEXT NOT NULL CHECK(item_type IN ('cafe_verde','cafe_tostado','cafe_empaquetado','insumo')), item_name TEXT NOT NULL, quantity REAL DEFAULT 0, unit TEXT DEFAULT 'kg', min_stock REAL DEFAULT 0, origin_id INTEGER, variety_id INTEGER, lot_label TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS inventory_movements (id INTEGER PRIMARY KEY AUTOINCREMENT, item_id INTEGER NOT NULL, direction TEXT NOT NULL CHECK(direction IN ('in','out','adjust')), quantity REAL NOT NULL, reason TEXT, registered_by TEXT, created_at TEXT NOT NULL, FOREIGN KEY (item_id) REFERENCES inventory_items(id) ON DELETE CASCADE);

    CREATE TABLE IF NOT EXISTS sales_orders (id INTEGER PRIMARY KEY AUTOINCREMENT, order_no TEXT NOT NULL UNIQUE, order_type TEXT NOT NULL CHECK(order_type IN ('mostrador','mayoreo')), client_id INTEGER, status TEXT DEFAULT 'abierto' CHECK(status IN ('abierto','esperando_compra','en_produccion','listo','envio_parcial','completado','cancelado')), delivery_date TEXT, total_weight_kg REAL DEFAULT 0, price_per_kg REAL DEFAULT 0, total_amount REAL DEFAULT 0, notes TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY (client_id) REFERENCES clients(id));
    CREATE TABLE IF NOT EXISTS sales_order_items (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, product_id INTEGER, description TEXT NOT NULL, presentation TEXT, quantity REAL DEFAULT 0, unit TEXT DEFAULT 'pz', unit_weight_kg REAL DEFAULT 0, unit_price REAL DEFAULT 0, subtotal REAL DEFAULT 0, FOREIGN KEY (order_id) REFERENCES sales_orders(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS sales_payments (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, amount REAL NOT NULL, method TEXT, notes TEXT, registered_by TEXT, created_at TEXT NOT NULL, FOREIGN KEY (order_id) REFERENCES sales_orders(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS sales_shipments (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, weight_kg REAL NOT NULL, destination_address TEXT, carrier TEXT, tracking_number TEXT, shipping_cost REAL DEFAULT 0, registered_by TEXT, notes TEXT, expense_id INTEGER, created_at TEXT NOT NULL, FOREIGN KEY (order_id) REFERENCES sales_orders(id) ON DELETE CASCADE);

    CREATE TABLE IF NOT EXISTS purchase_orders (id INTEGER PRIMARY KEY AUTOINCREMENT, po_no TEXT NOT NULL UNIQUE, source_type TEXT DEFAULT 'manual' CHECK(source_type IN ('sales_order','manual')), source_id INTEGER, status TEXT DEFAULT 'pendiente' CHECK(status IN ('sin_fondos','pendiente','parcial','recibida','cancelada')), description TEXT NOT NULL, requested_kg REAL DEFAULT 0, estimated_cost REAL DEFAULT 0, actual_cost REAL DEFAULT 0, received_kg REAL DEFAULT 0, supplier TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS purchase_entries (id INTEGER PRIMARY KEY AUTOINCREMENT, purchase_order_id INTEGER NOT NULL, inventory_item_id INTEGER NOT NULL, quantity_kg REAL NOT NULL, unit_cost REAL DEFAULT 0, total_cost REAL NOT NULL, shipping_cost REAL DEFAULT 0, supplier TEXT, lot_label TEXT, origin_id INTEGER, variety_id INTEGER, registered_by TEXT, created_at TEXT NOT NULL, FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id) ON DELETE CASCADE);

    CREATE TABLE IF NOT EXISTS capital_contributions (id INTEGER PRIMARY KEY AUTOINCREMENT, partner_name TEXT NOT NULL, amount REAL NOT NULL, description TEXT NOT NULL, contribution_date TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS withdrawals (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL CHECK(kind IN ('capital_return','dividend')), partner_name TEXT NOT NULL, amount REAL NOT NULL, month TEXT, contribution_id INTEGER, notes TEXT, created_at TEXT NOT NULL);

    CREATE TABLE IF NOT EXISTS roasting_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, session_date TEXT NOT NULL, operator TEXT NOT NULL, notes TEXT, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS roasting_batches (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER NOT NULL, batch_no TEXT NOT NULL UNIQUE, green_inventory_item_id INTEGER NOT NULL, roast_profile_id INTEGER, sales_order_id INTEGER, green_kg REAL NOT NULL, roasted_kg REAL, loss_pct REAL, machine_minutes REAL DEFAULT 0, notes TEXT, artisan_file_name TEXT, artisan_data TEXT, ai_review TEXT, created_at TEXT NOT NULL, FOREIGN KEY (session_id) REFERENCES roasting_sessions(id) ON DELETE CASCADE, FOREIGN KEY (green_inventory_item_id) REFERENCES inventory_items(id), FOREIGN KEY (roast_profile_id) REFERENCES roast_profiles(id), FOREIGN KEY (sales_order_id) REFERENCES sales_orders(id));
    CREATE TABLE IF NOT EXISTS batch_photos (id INTEGER PRIMARY KEY AUTOINCREMENT, batch_id INTEGER NOT NULL, file_name TEXT NOT NULL, stored_name TEXT NOT NULL, mime_type TEXT, notes TEXT, created_at TEXT NOT NULL, FOREIGN KEY (batch_id) REFERENCES roasting_batches(id) ON DELETE CASCADE);

    CREATE TABLE IF NOT EXISTS machine_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, log_date TEXT NOT NULL, log_type TEXT NOT NULL CHECK(log_type IN ('mantenimiento','mejora','pieza','incidencia')), description TEXT NOT NULL, cost REAL DEFAULT 0, registered_by TEXT, expense_id INTEGER, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS expenses (id INTEGER PRIMARY KEY AUTOINCREMENT, expense_date TEXT NOT NULL, category_id INTEGER NOT NULL, amount REAL NOT NULL, description TEXT, paid_by TEXT NOT NULL, supplier TEXT, notes TEXT, auto_generated INTEGER DEFAULT 0, ref_type TEXT, ref_id INTEGER, created_at TEXT NOT NULL, FOREIGN KEY (category_id) REFERENCES expense_categories(id));

    INSERT OR IGNORE INTO partners (name, share_pct) VALUES ('Itza + Gastón', 50), ('Axel', 50);
    INSERT OR IGNORE INTO roast_profiles (name) VALUES ('Filtro'),('Espresso'),('Omniroast'),('Claro'),('Medio'),('Oscuro');
    INSERT OR IGNORE INTO origins (name) VALUES ('Chiapas'),('Veracruz'),('Oaxaca'),('Puebla'),('Guerrero'),('Nayarit'),('Colombia'),('Brasil'),('Guatemala'),('Etiopía'),('Blend');
    INSERT OR IGNORE INTO varieties (name) VALUES ('Typica'),('Bourbon'),('Caturra'),('Catuaí'),('Geisha'),('SL28'),('Pacamara'),('Maragogipe'),('Mundo Novo'),('Catimor'),('Blend');
    INSERT OR IGNORE INTO expense_categories (name, is_direct_cost) VALUES ('Café verde',1),('Gas',1),('Electricidad',1),('Empaques',1),('Envíos',1),('Mantenimiento',0),('Marketing',0),('Renta',0),('Otros',0);
    INSERT OR IGNORE INTO settings (key, value) VALUES ('business_name','CAFETIER'),('business_tagline','Culto por el café'),('default_loss_pct','15'),('machine_kw','0'),('kwh_price','0'),('claude_api_key',''),('operators','Axel|Itzamara|Gastón'),('people','Itzamara|Gastón|Axel');
  `);
  ensureInvItem({ item_type: "cafe_tostado", item_name: "Café tostado disponible", unit: "kg" });
}
