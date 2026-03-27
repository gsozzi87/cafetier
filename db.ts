
import { Database } from "bun:sqlite";
import fs from "fs";
import path from "path";

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), "data", "cafetier.db");
const DATA_DIR = path.dirname(DB_PATH);

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(DB_PATH, { create: true });
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

export const nowIso = () => new Date().toISOString();
export const todayIso = () => nowIso().slice(0, 10);
export const monthIso = () => nowIso().slice(0, 7);

export function qAll<T = any>(sql: string, ...params: any[]): T[] {
  return db.query(sql).all(...params) as T[];
}
export function qGet<T = any>(sql: string, ...params: any[]): T | null {
  return (db.query(sql).get(...params) as T | undefined) ?? null;
}
export function qRun(sql: string, ...params: any[]) {
  return db.query(sql).run(...params);
}
export function qVal<T = any>(sql: string, ...params: any[]): T | null {
  const row = qGet<Record<string, T>>(sql, ...params);
  if (!row) return null;
  const first = Object.keys(row)[0];
  return row[first] ?? null;
}
export function tx<T extends any[], R>(fn: (...args: T) => R) {
  return db.transaction(fn);
}

export type SummaryNumbers = {
  availableCash: number;
  totalRevenue: number;
  totalExpenses: number;
  totalContributed: number;
  capitalRecovered: number;
  unrecoveredCapital: number;
  dividendsPaid: number;
  retainedProfit: number;
  distributableDividends: number;
};

export function newDocNo(prefix: string) {
  const stamp = nowIso().replace(/[-:TZ.]/g, "").slice(0, 14);
  const rand = Math.floor(Math.random() * 900 + 100);
  return `${prefix}-${stamp}-${rand}`;
}

export function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function normalizePartnerName(name: string | null | undefined) {
  const raw = String(name || '').trim();
  if (!raw) return raw;
  const key = raw.toLowerCase();
  if (["itzamara", "itza", "gaston", "gastón", "itza + gaston", "itza + gastón", "itza y gaston", "itza y gastón", "itza/gaston", "itza/gastón"].includes(key)) {
    return "Itza + Gastón";
  }
  if (key === "axel") return "Axel";
  return raw;
}

export function getSettingsObject() {
  const rows = qAll<{ key: string; value: string }>("SELECT key, value FROM settings");
  const out: Record<string, string> = {};
  for (const row of rows) out[row.key] = row.value;
  return out;
}

export function getSettingNumber(key: string, fallback = 0) {
  const row = qGet<{ value: string }>("SELECT value FROM settings WHERE key = ?", key);
  const n = Number(row?.value ?? fallback);
  return Number.isFinite(n) ? n : fallback;
}

export function computeFinanceSummary(): SummaryNumbers {
  const totalContributed = Number(qVal("SELECT COALESCE(SUM(amount), 0) AS v FROM capital_contributions") ?? 0);
  const totalRevenue = Number(qVal("SELECT COALESCE(SUM(amount), 0) AS v FROM sales_payments") ?? 0);
  const totalExpenses = Number(qVal("SELECT COALESCE(SUM(amount), 0) AS v FROM expenses") ?? 0);
  const capitalRecovered = Number(qVal("SELECT COALESCE(SUM(amount), 0) AS v FROM withdrawals WHERE kind = 'capital_return'") ?? 0);
  const dividendsPaid = Number(qVal("SELECT COALESCE(SUM(amount), 0) AS v FROM withdrawals WHERE kind = 'dividend'") ?? 0);
  const unrecoveredCapital = Math.max(0, round2(totalContributed - capitalRecovered));
  const availableCash = round2(totalContributed + totalRevenue - totalExpenses - capitalRecovered - dividendsPaid);
  const retainedProfit = round2(totalRevenue - totalExpenses - dividendsPaid);
  const distributableDividends = unrecoveredCapital > 0 ? 0 : Math.max(0, Math.min(retainedProfit, availableCash));
  return {
    availableCash,
    totalRevenue,
    totalExpenses,
    totalContributed,
    capitalRecovered,
    unrecoveredCapital,
    dividendsPaid,
    retainedProfit,
    distributableDividends,
  };
}

export function inventoryTotals() {
  return {
    green: Number(qVal("SELECT COALESCE(SUM(quantity), 0) AS v FROM inventory_items WHERE item_type = 'green_coffee'") ?? 0),
    roasted: Number(qVal("SELECT COALESCE(SUM(quantity), 0) AS v FROM inventory_items WHERE item_type = 'roasted_coffee'") ?? 0),
    packaged: Number(qVal("SELECT COALESCE(SUM(quantity), 0) AS v FROM inventory_items WHERE item_type = 'packaged_coffee'") ?? 0),
    supplies: Number(qVal("SELECT COALESCE(SUM(quantity), 0) AS v FROM inventory_items WHERE item_type = 'supply'") ?? 0),
  };
}

export function ensureInventoryItem(data: {
  item_type: string;
  item_name: string;
  unit?: string;
  min_stock?: number;
  origin_id?: number | null;
  variety_id?: number | null;
  lot_label?: string | null;
  presentation?: string | null;
  notes?: string | null;
}) {
  const existing = qGet<{ id: number }>(
    `SELECT id FROM inventory_items
     WHERE item_type = ? AND item_name = ? AND COALESCE(lot_label,'') = COALESCE(?, '')`,
    data.item_type,
    data.item_name,
    data.lot_label ?? null,
  );
  if (existing) return existing.id;

  const res = qRun(
    `INSERT INTO inventory_items
      (item_type, item_name, quantity, unit, min_stock, origin_id, variety_id, lot_label, presentation, notes)
     VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`,
    data.item_type,
    data.item_name,
    data.unit ?? "kg",
    data.min_stock ?? 0,
    data.origin_id ?? null,
    data.variety_id ?? null,
    data.lot_label ?? null,
    data.presentation ?? null,
    data.notes ?? null,
  );
  return Number(res.lastInsertRowid);
}

export function pushInventoryMovement(input: {
  itemId: number;
  direction: "in" | "out" | "adjust";
  quantity: number;
  reason: string;
  refType?: string | null;
  refId?: number | null;
  registeredBy?: string | null;
}) {
  const current = Number(qVal("SELECT COALESCE(quantity, 0) AS v FROM inventory_items WHERE id = ?", input.itemId) ?? 0);
  let next = current;

  if (input.direction === "in") next = current + input.quantity;
  else if (input.direction === "out") {
    if (current < input.quantity) {
      throw new Error("Inventario insuficiente para realizar la salida.");
    }
    next = current - input.quantity;
  } else {
    next = input.quantity;
  }

  qRun("UPDATE inventory_items SET quantity = ? WHERE id = ?", round2(next), input.itemId);
  qRun(
    `INSERT INTO inventory_movements
      (item_id, direction, quantity, reason, ref_type, ref_id, registered_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    input.itemId,
    input.direction,
    round2(input.quantity),
    input.reason,
    input.refType ?? null,
    input.refId ?? null,
    input.registeredBy ?? "Sistema",
    nowIso(),
  );
}

export function recalcPurchaseOrder(poId: number) {
  const po = qGet<any>("SELECT * FROM purchase_orders WHERE id = ?", poId);
  if (!po) return null;

  const hasEntryShipping = columnExists("purchase_entries", "shipping_cost");
  const received = Number(qVal("SELECT COALESCE(SUM(quantity_kg), 0) AS v FROM purchase_entries WHERE purchase_order_id = ?", poId) ?? 0);
  const actualCost = Number(
    qVal(
      hasEntryShipping
        ? "SELECT COALESCE(SUM(total_cost + shipping_cost), 0) AS v FROM purchase_entries WHERE purchase_order_id = ?"
        : "SELECT COALESCE(SUM(total_cost), 0) AS v FROM purchase_entries WHERE purchase_order_id = ?",
      poId,
    ) ?? 0,
  );
  const actualShipping = Number(
    hasEntryShipping
      ? qVal("SELECT COALESCE(SUM(shipping_cost), 0) AS v FROM purchase_entries WHERE purchase_order_id = ?", poId) ?? 0
      : 0,
  );
  const openCapital = qGet<{ amount_missing: number }>(
    `SELECT amount_requested - amount_funded AS amount_missing
       FROM capital_requests
      WHERE source_type = 'purchase_order'
        AND source_id = ?
        AND status IN ('open','partially_funded')
      ORDER BY id DESC
      LIMIT 1`,
    poId,
  );
  const status =
    received >= po.requested_green_kg && po.requested_green_kg > 0
      ? "received"
      : openCapital && Number(openCapital.amount_missing) > 0
      ? "pending_capital"
      : received > 0
      ? "partial"
      : "pending_purchase";

  qRun(
    `UPDATE purchase_orders
        SET received_green_kg = ?, actual_cost = ?, actual_shipping_cost = ?, status = ?, updated_at = ?
      WHERE id = ?`,
    round2(received),
    round2(actualCost),
    round2(actualShipping),
    status,
    nowIso(),
    poId,
  );
  return qGet("SELECT * FROM purchase_orders WHERE id = ?", poId);
}

export function recalcCapitalRequest(requestId: number) {
  const req = qGet<any>("SELECT * FROM capital_requests WHERE id = ?", requestId);
  if (!req) return null;

  const funded = Number(
    qVal("SELECT COALESCE(SUM(amount), 0) AS v FROM capital_contributions WHERE capital_request_id = ?", requestId) ?? 0,
  );
  let status = "open";
  if (funded <= 0) status = "open";
  else if (funded >= req.amount_requested) status = "funded";
  else status = "partially_funded";

  qRun(
    `UPDATE capital_requests
        SET amount_funded = ?, status = ?, updated_at = ?
      WHERE id = ?`,
    round2(funded),
    status,
    nowIso(),
    requestId,
  );

  if (req.source_type === "purchase_order" && req.source_id) recalcPurchaseOrder(req.source_id);
  return qGet("SELECT * FROM capital_requests WHERE id = ?", requestId);
}

export function recalcSalesOrder(orderId: number) {
  const order = qGet<any>("SELECT * FROM sales_orders WHERE id = ?", orderId);
  if (!order) return null;

  const paid = Number(qVal("SELECT COALESCE(SUM(amount), 0) AS v FROM sales_payments WHERE order_id = ?", orderId) ?? 0);
  const shipped = Number(qVal("SELECT COALESCE(SUM(weight_kg), 0) AS v FROM sales_shipments WHERE order_id = ?", orderId) ?? 0);
  const roasted = Number(qVal("SELECT COALESCE(SUM(roasted_kg), 0) AS v FROM roasting_batches WHERE sales_order_id = ?", orderId) ?? 0);
  const hasPendingPO = Number(
    qVal(
      `SELECT COUNT(*) AS v
         FROM purchase_orders
        WHERE source_type = 'sales_order'
          AND source_id = ?
          AND status NOT IN ('received','cancelled')`,
      orderId,
    ) ?? 0,
  );

  let status = order.status;
  if (order.order_type === "retail") {
    status = paid >= order.total_amount ? "completed" : "open";
  } else if (shipped >= (order.total_weight_kg || 0) && order.total_weight_kg > 0) {
    status = paid >= order.total_amount ? "completed" : "ready";
  } else if (shipped > 0) {
    status = "partial_shipped";
  } else if (roasted >= (order.total_weight_kg || 0) && order.total_weight_kg > 0) {
    status = "ready";
  } else if (roasted > 0) {
    status = "in_production";
  } else if (hasPendingPO > 0) {
    status = "pending_purchase";
  } else {
    status = "open";
  }

  qRun(
    `UPDATE sales_orders
        SET status = ?, updated_at = ?
      WHERE id = ?`,
    status,
    nowIso(),
    orderId,
  );
  return qGet("SELECT * FROM sales_orders WHERE id = ?", orderId);
}

export function createCapitalRequest(input: {
  amountRequested: number;
  notes: string;
  sourceType?: string | null;
  sourceId?: number | null;
}) {
  const requested = round2(input.amountRequested);
  if (input.sourceType === "purchase_order" && input.sourceId) {
    const existing = qGet<any>(
      `SELECT * FROM capital_requests
        WHERE source_type = 'purchase_order' AND source_id = ? AND status IN ('open','partially_funded')
        ORDER BY id DESC LIMIT 1`,
      input.sourceId,
    );
    if (existing) {
      const newRequested = Math.max(requested, round2(Number(existing.amount_requested) - Number(existing.amount_funded)));
      qRun(
        `UPDATE capital_requests
            SET amount_requested = ?, notes = ?, updated_at = ?
          WHERE id = ?`,
        round2(Number(existing.amount_funded) + newRequested),
        input.notes,
        nowIso(),
        existing.id,
      );
      recalcCapitalRequest(existing.id);
      return qGet("SELECT * FROM capital_requests WHERE id = ?", existing.id);
    }
  }

  const res = qRun(
    `INSERT INTO capital_requests
      (request_no, source_type, source_id, status, amount_requested, amount_funded, notes, created_at, updated_at)
     VALUES (?, ?, ?, 'open', ?, 0, ?, ?, ?)`,
    newDocNo("CAP"),
    input.sourceType ?? null,
    input.sourceId ?? null,
    requested,
    input.notes,
    nowIso(),
    nowIso(),
  );
  const id = Number(res.lastInsertRowid);
  if (input.sourceType === "purchase_order" && input.sourceId) recalcPurchaseOrder(input.sourceId);
  return qGet("SELECT * FROM capital_requests WHERE id = ?", id);
}

export function createPurchaseOrder(input: {
  sourceType: "sales_order" | "manual";
  sourceId?: number | null;
  description: string;
  requestedGreenKg: number;
  estimatedCost?: number;
  estimatedShippingCost?: number;
  supplier?: string | null;
  notes?: string | null;
}) {
  const finance = computeFinanceSummary();
  const estimatedCost = round2(input.estimatedCost ?? 0);
  const estimatedShippingCost = round2(input.estimatedShippingCost ?? 0);
  const estimatedLandedCost = round2(estimatedCost + estimatedShippingCost);
  let status = "pending_purchase";

  if (estimatedLandedCost > finance.availableCash) {
    status = "pending_capital";
  }

  const res = qRun(
    `INSERT INTO purchase_orders
      (po_no, source_type, source_id, status, description, requested_green_kg, ordered_green_kg, received_green_kg, estimated_cost, estimated_shipping_cost, actual_cost, actual_shipping_cost, supplier, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 0, 0, ?, ?, ?, ?)`,
    newDocNo("PO"),
    input.sourceType,
    input.sourceId ?? null,
    status,
    input.description,
    round2(input.requestedGreenKg),
    round2(input.requestedGreenKg),
    estimatedCost,
    estimatedShippingCost,
    input.supplier ?? null,
    input.notes ?? null,
    nowIso(),
    nowIso(),
  );
  const poId = Number(res.lastInsertRowid);

  if (estimatedLandedCost > finance.availableCash) {
    createCapitalRequest({
      amountRequested: round2(estimatedLandedCost - finance.availableCash),
      notes: `Capital requerido para ${input.description}`,
      sourceType: "purchase_order",
      sourceId: poId,
    });
  }

  if (input.sourceType === "sales_order" && input.sourceId) recalcSalesOrder(input.sourceId);
  return qGet<any>("SELECT * FROM purchase_orders WHERE id = ?", poId);
}


function tableExists(name: string) {
  return !!db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
}

function tableColumns(name: string) {
  if (!tableExists(name)) return [] as string[];
  const rows = db.query(`PRAGMA table_info("${name}")`).all() as Array<{ name: string }>;
  return rows.map(r => r.name);
}

function columnExists(table: string, column: string) {
  return tableColumns(table).includes(column);
}

function renameTableIfNeeded(from: string, to: string) {
  if (tableExists(from) && !tableExists(to)) {
    db.exec(`ALTER TABLE "${from}" RENAME TO "${to}"`);
  }
}

function addColumnIfMissing(table: string, column: string, definition: string) {
  if (tableExists(table) && !columnExists(table, column)) {
    db.exec(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${definition}`);
  }
}

function upgradeSchemaIfNeeded() {
  addColumnIfMissing("partners", "share_pct", "REAL NOT NULL DEFAULT 0");

  addColumnIfMissing("sales_orders", "order_type", "TEXT NOT NULL DEFAULT 'wholesale'");
  addColumnIfMissing("sales_orders", "order_no", "TEXT");
  addColumnIfMissing("sales_orders", "updated_at", "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP");
  addColumnIfMissing("sales_orders", "total_weight_kg", "REAL NOT NULL DEFAULT 0");

  addColumnIfMissing("sales_order_items", "unit_weight_kg", "REAL NOT NULL DEFAULT 0");
  addColumnIfMissing("sales_shipments", "shipping_cost", "REAL NOT NULL DEFAULT 0");
  addColumnIfMissing("sales_shipments", "expense_id", "INTEGER");

  addColumnIfMissing("purchase_orders", "ordered_green_kg", "REAL NOT NULL DEFAULT 0");
  addColumnIfMissing("purchase_orders", "received_green_kg", "REAL NOT NULL DEFAULT 0");
  addColumnIfMissing("purchase_orders", "estimated_shipping_cost", "REAL NOT NULL DEFAULT 0");
  addColumnIfMissing("purchase_orders", "actual_shipping_cost", "REAL NOT NULL DEFAULT 0");
  addColumnIfMissing("purchase_orders", "updated_at", "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP");
  addColumnIfMissing("purchase_orders", "po_no", "TEXT");
  addColumnIfMissing("purchase_orders", "source_type", "TEXT NOT NULL DEFAULT 'manual'");

  addColumnIfMissing("purchase_entries", "shipping_cost", "REAL NOT NULL DEFAULT 0");
  addColumnIfMissing("purchase_entries", "supplier", "TEXT");
  addColumnIfMissing("purchase_entries", "lot_label", "TEXT");
  addColumnIfMissing("purchase_entries", "origin_id", "INTEGER");
  addColumnIfMissing("purchase_entries", "variety_id", "INTEGER");
  addColumnIfMissing("purchase_entries", "registered_by", "TEXT");

  addColumnIfMissing("capital_contributions", "capital_request_id", "INTEGER");
  addColumnIfMissing("withdrawals", "kind", "TEXT NOT NULL DEFAULT 'dividend'");
  addColumnIfMissing("withdrawals", "contribution_id", "INTEGER");
  addColumnIfMissing("withdrawals", "dividend_order_id", "INTEGER");

  if (tableExists("sales_orders") && columnExists("sales_orders", "order_no")) {
    qRun(`UPDATE sales_orders SET order_no = COALESCE(order_no, 'SO-' || id) WHERE order_no IS NULL OR order_no = ''`);
  }
  if (tableExists("purchase_orders") && columnExists("purchase_orders", "po_no")) {
    qRun(`UPDATE purchase_orders SET po_no = COALESCE(po_no, 'PO-' || id) WHERE po_no IS NULL OR po_no = ''`);
    qRun(`UPDATE purchase_orders SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP)`);
  }
}

function legacyPresentationWeight(presentation: string | null | undefined) {
  if (!presentation) return 1;
  const p = String(presentation).toLowerCase();
  if (p === "250g") return 0.25;
  if (p === "500g") return 0.5;
  if (p === "1kg") return 1;
  return 1;
}

function mapLegacyInventoryType(type: string | null | undefined) {
  switch (type) {
    case "cafe_verde":
      return "green_coffee";
    case "cafe_tostado":
      return "roasted_coffee";
    case "cafe_empaquetado":
      return "packaged_coffee";
    case "insumo":
    default:
      return "supply";
  }
}

function mapLegacyMovementType(type: string | null | undefined) {
  switch (type) {
    case "entrada":
      return "in";
    case "salida":
      return "out";
    default:
      return "adjust";
  }
}

function mapLegacySalesStatus(status: string | null | undefined) {
  switch (status) {
    case "esperando_compra":
      return "pending_purchase";
    case "en_produccion":
      return "in_production";
    case "listo":
      return "ready";
    case "enviado_parcial":
      return "partial_shipped";
    case "entregado":
    case "pagado":
      return "completed";
    case "cancelado":
      return "cancelled";
    case "pendiente":
    default:
      return "open";
  }
}

function mapLegacyPurchaseStatus(status: string | null | undefined) {
  switch (status) {
    case "completada":
      return "received";
    case "parcial":
      return "partial";
    case "cancelada":
      return "cancelled";
    case "pendiente":
    default:
      return "pending_purchase";
  }
}

function migrateLegacyTablesIfNeeded() {
  const legacyDetected =
    tableExists("orders") ||
    tableExists("order_items") ||
    tableExists("order_payments") ||
    tableExists("order_shipments") ||
    (tableExists("partners") && !columnExists("partners", "share_pct") && columnExists("partners", "profit_share")) ||
    tableExists("legacy_partners") ||
    tableExists("legacy_products") ||
    tableExists("legacy_purchase_orders") ||
    tableExists("legacy_roasting_batches");

  if (!legacyDetected) return;

  renameTableIfNeeded("partners", "legacy_partners");
  renameTableIfNeeded("clients", "legacy_clients");
  renameTableIfNeeded("products", "legacy_products");
  renameTableIfNeeded("purchase_orders", "legacy_purchase_orders");
  renameTableIfNeeded("capital_contributions", "legacy_capital_contributions");
  renameTableIfNeeded("roasting_batches", "legacy_roasting_batches");
  renameTableIfNeeded("expenses", "legacy_expenses");
  renameTableIfNeeded("inventory_movements", "legacy_inventory_movements");
  if (tableExists("machine_log") && !tableExists("legacy_machine_log")) {
    renameTableIfNeeded("machine_log", "legacy_machine_log");
  }
}

function createSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS partners (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      share_pct REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS roast_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS origins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS varieties (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS expense_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      is_direct_cost INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      address TEXT,
      city TEXT,
      notes TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      origin_id INTEGER,
      variety_id INTEGER,
      roast_profile_id INTEGER,
      presentation TEXT,
      unit_weight_kg REAL NOT NULL DEFAULT 1,
      price REAL NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (origin_id) REFERENCES origins(id),
      FOREIGN KEY (variety_id) REFERENCES varieties(id),
      FOREIGN KEY (roast_profile_id) REFERENCES roast_profiles(id)
    );

    CREATE TABLE IF NOT EXISTS inventory_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_type TEXT NOT NULL CHECK(item_type IN ('green_coffee','roasted_coffee','packaged_coffee','supply')),
      item_name TEXT NOT NULL,
      quantity REAL NOT NULL DEFAULT 0,
      unit TEXT NOT NULL DEFAULT 'kg',
      min_stock REAL NOT NULL DEFAULT 0,
      origin_id INTEGER,
      variety_id INTEGER,
      lot_label TEXT,
      presentation TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (origin_id) REFERENCES origins(id),
      FOREIGN KEY (variety_id) REFERENCES varieties(id)
    );

    CREATE TABLE IF NOT EXISTS inventory_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL,
      direction TEXT NOT NULL CHECK(direction IN ('in','out','adjust')),
      quantity REAL NOT NULL,
      reason TEXT,
      ref_type TEXT,
      ref_id INTEGER,
      registered_by TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (item_id) REFERENCES inventory_items(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS sales_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_no TEXT NOT NULL UNIQUE,
      order_type TEXT NOT NULL CHECK(order_type IN ('retail','wholesale')),
      client_id INTEGER,
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','pending_purchase','in_production','ready','partial_shipped','completed','cancelled')),
      delivery_date TEXT,
      total_weight_kg REAL NOT NULL DEFAULT 0,
      price_per_kg REAL DEFAULT 0,
      total_amount REAL NOT NULL DEFAULT 0,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (client_id) REFERENCES clients(id)
    );

    CREATE TABLE IF NOT EXISTS sales_order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      product_id INTEGER,
      description TEXT NOT NULL,
      presentation TEXT,
      quantity REAL NOT NULL DEFAULT 0,
      unit TEXT NOT NULL DEFAULT 'unit',
      unit_weight_kg REAL NOT NULL DEFAULT 0,
      unit_price REAL NOT NULL DEFAULT 0,
      subtotal REAL NOT NULL DEFAULT 0,
      FOREIGN KEY (order_id) REFERENCES sales_orders(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS sales_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      method TEXT,
      notes TEXT,
      registered_by TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (order_id) REFERENCES sales_orders(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS sales_shipments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      weight_kg REAL NOT NULL,
      destination_address TEXT,
      carrier TEXT,
      tracking_number TEXT,
      shipping_cost REAL NOT NULL DEFAULT 0,
      registered_by TEXT,
      notes TEXT,
      expense_id INTEGER,
      created_at TEXT NOT NULL,
      FOREIGN KEY (order_id) REFERENCES sales_orders(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS purchase_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      po_no TEXT NOT NULL UNIQUE,
      source_type TEXT NOT NULL CHECK(source_type IN ('sales_order','manual')),
      source_id INTEGER,
      status TEXT NOT NULL DEFAULT 'pending_purchase' CHECK(status IN ('pending_capital','pending_purchase','partial','received','cancelled')),
      description TEXT NOT NULL,
      requested_green_kg REAL NOT NULL DEFAULT 0,
      ordered_green_kg REAL NOT NULL DEFAULT 0,
      received_green_kg REAL NOT NULL DEFAULT 0,
      estimated_cost REAL NOT NULL DEFAULT 0,
      estimated_shipping_cost REAL NOT NULL DEFAULT 0,
      actual_cost REAL NOT NULL DEFAULT 0,
      actual_shipping_cost REAL NOT NULL DEFAULT 0,
      supplier TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS purchase_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      purchase_order_id INTEGER NOT NULL,
      inventory_item_id INTEGER NOT NULL,
      quantity_kg REAL NOT NULL,
      unit_cost REAL NOT NULL DEFAULT 0,
      total_cost REAL NOT NULL,
      shipping_cost REAL NOT NULL DEFAULT 0,
      supplier TEXT,
      lot_label TEXT,
      origin_id INTEGER,
      variety_id INTEGER,
      registered_by TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id) ON DELETE CASCADE,
      FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id),
      FOREIGN KEY (origin_id) REFERENCES origins(id),
      FOREIGN KEY (variety_id) REFERENCES varieties(id)
    );

    CREATE TABLE IF NOT EXISTS capital_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_no TEXT NOT NULL UNIQUE,
      source_type TEXT CHECK(source_type IN ('purchase_order','manual')),
      source_id INTEGER,
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','partially_funded','funded','cancelled')),
      amount_requested REAL NOT NULL DEFAULT 0,
      amount_funded REAL NOT NULL DEFAULT 0,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS capital_contributions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      capital_request_id INTEGER,
      partner_name TEXT NOT NULL,
      amount REAL NOT NULL,
      description TEXT NOT NULL,
      contribution_date TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (capital_request_id) REFERENCES capital_requests(id)
    );

    CREATE TABLE IF NOT EXISTS dividend_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dividend_no TEXT NOT NULL UNIQUE,
      month TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','paid','cancelled')),
      total_amount REAL NOT NULL DEFAULT 0,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS dividend_order_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dividend_order_id INTEGER NOT NULL,
      partner_name TEXT NOT NULL,
      share_pct REAL NOT NULL,
      amount REAL NOT NULL,
      FOREIGN KEY (dividend_order_id) REFERENCES dividend_orders(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS withdrawals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL CHECK(kind IN ('capital_return','dividend')),
      partner_name TEXT NOT NULL,
      amount REAL NOT NULL,
      month TEXT,
      contribution_id INTEGER,
      dividend_order_id INTEGER,
      notes TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS roasting_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_date TEXT NOT NULL,
      operator TEXT NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS roasting_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      batch_no TEXT NOT NULL UNIQUE,
      green_inventory_item_id INTEGER NOT NULL,
      roast_profile_id INTEGER,
      sales_order_id INTEGER,
      green_kg REAL NOT NULL,
      roasted_kg REAL,
      loss_pct REAL,
      machine_minutes REAL NOT NULL DEFAULT 0,
      notes TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES roasting_sessions(id) ON DELETE CASCADE,
      FOREIGN KEY (green_inventory_item_id) REFERENCES inventory_items(id),
      FOREIGN KEY (roast_profile_id) REFERENCES roast_profiles(id),
      FOREIGN KEY (sales_order_id) REFERENCES sales_orders(id)
    );

    CREATE TABLE IF NOT EXISTS machine_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      log_date TEXT NOT NULL,
      log_type TEXT NOT NULL CHECK(log_type IN ('maintenance','improvement','part','incident')),
      description TEXT NOT NULL,
      cost REAL NOT NULL DEFAULT 0,
      registered_by TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      expense_date TEXT NOT NULL,
      category_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      description TEXT,
      paid_by TEXT NOT NULL,
      supplier TEXT,
      notes TEXT,
      auto_generated INTEGER NOT NULL DEFAULT 0,
      ref_type TEXT,
      ref_id INTEGER,
      created_at TEXT NOT NULL,
      FOREIGN KEY (category_id) REFERENCES expense_categories(id)
    );

    INSERT OR IGNORE INTO partners (name, share_pct) VALUES
      ('Itza + Gastón', 50),
      ('Axel', 50);

    INSERT OR IGNORE INTO roast_profiles (name) VALUES
      ('Filtro'),
      ('Espresso'),
      ('Omniroast'),
      ('Claro'),
      ('Medio'),
      ('Oscuro');

    INSERT OR IGNORE INTO origins (name) VALUES
      ('Chiapas'),
      ('Veracruz'),
      ('Oaxaca'),
      ('Puebla'),
      ('Blend');

    INSERT OR IGNORE INTO varieties (name) VALUES
      ('Typica'),
      ('Bourbon'),
      ('Caturra'),
      ('Catuaí'),
      ('Blend');

    INSERT OR IGNORE INTO expense_categories (name, is_direct_cost) VALUES
      ('Café verde', 1),
      ('Gas', 1),
      ('Electricidad', 1),
      ('Empaques', 1),
      ('Envíos', 1),
      ('Mantenimiento', 0),
      ('Marketing', 0),
      ('Renta', 0),
      ('Otros', 0);

    INSERT OR IGNORE INTO settings (key, value) VALUES
      ('business_name', 'CAFETIER'),
      ('default_loss_pct', '15'),
      ('machine_kw', '0'),
      ('kwh_price', '0'),
      ('default_green_cost_per_kg', '0');
`);
}

function backfillFromLegacy() {
  if (tableExists("legacy_partners")) {
    const rows = qAll<any>("SELECT * FROM legacy_partners");
    const merged = new Map<string, number>();
    for (const row of rows) {
      const name = normalizePartnerName(row.name);
      const share = Number(row.profit_share ?? row.share_pct ?? 0);
      merged.set(name, round2((merged.get(name) || 0) + share));
    }
    if (!merged.size) {
      merged.set("Itza + Gastón", 50);
      merged.set("Axel", 50);
    }
    qRun("DELETE FROM partners");
    for (const [name, share] of merged.entries()) {
      qRun("INSERT INTO partners(name, share_pct) VALUES (?, ?)", name, share);
    }
  }

  if (tableExists("legacy_clients")) {
    qRun(
      `INSERT OR IGNORE INTO clients(id, name, phone, email, address, city, notes, active, created_at)
       SELECT id, name, phone, email, address, city, notes, 1, COALESCE(created_at, CURRENT_TIMESTAMP)
       FROM legacy_clients`,
    );
  }

  if (tableExists("legacy_products")) {
    const rows = qAll<any>("SELECT * FROM legacy_products");
    for (const row of rows) {
      qRun(
        `INSERT OR REPLACE INTO products
          (id, name, origin_id, variety_id, roast_profile_id, presentation, unit_weight_kg, price, active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        row.id,
        row.name,
        row.origin_id ?? null,
        row.variety_id ?? null,
        row.roast_profile_id ?? null,
        row.presentation ?? null,
        legacyPresentationWeight(row.presentation),
        Number(row.price ?? 0),
        Number(row.active ?? 1),
      );
    }
  }

  if (tableExists("inventory")) {
    const rows = qAll<any>("SELECT * FROM inventory");
    for (const row of rows) {
      qRun(
        `INSERT OR REPLACE INTO inventory_items
          (id, item_type, item_name, quantity, unit, min_stock, origin_id, variety_id, lot_label, presentation, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))`,
        row.id,
        mapLegacyInventoryType(row.item_type),
        row.item_name,
        Number(row.quantity ?? 0),
        row.unit ?? "kg",
        Number(row.min_stock ?? 0),
        row.origin_id ?? null,
        row.variety_id ?? null,
        row.lot_label ?? null,
        null,
        row.notes ?? null,
        nowIso(),
      );
    }
  }

  if (tableExists("legacy_inventory_movements")) {
    const rows = qAll<any>("SELECT * FROM legacy_inventory_movements");
    for (const row of rows) {
      qRun(
        `INSERT OR IGNORE INTO inventory_movements
          (id, item_id, direction, quantity, reason, ref_type, ref_id, registered_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        row.id,
        row.inventory_id,
        mapLegacyMovementType(row.movement_type),
        Number(row.quantity ?? 0),
        row.reason ?? null,
        row.reference_type ?? null,
        row.reference_id ?? null,
        row.registered_by ?? "Sistema",
        row.created_at ?? nowIso(),
      );
    }
  }

  if (tableExists("orders")) {
    const orders = qAll<any>("SELECT * FROM orders");
    for (const row of orders) {
      let totalKg = Number(row.total_kg ?? 0);
      if (!totalKg && Number(row.is_retail ?? 0) === 1) {
        totalKg = Number(
          qVal(
            `SELECT COALESCE(SUM(
              CASE
                WHEN oi.unit = 'kg' THEN oi.quantity
                WHEN p.presentation = '250g' THEN oi.quantity * 0.25
                WHEN p.presentation = '500g' THEN oi.quantity * 0.5
                WHEN p.presentation = '1kg' THEN oi.quantity * 1
                ELSE 0
              END
            ), 0) AS v
            FROM order_items oi
            LEFT JOIN products p ON p.id = oi.product_id
            WHERE oi.order_id = ?`,
            row.id,
          ) ?? 0,
        );
      }
      qRun(
        `INSERT OR REPLACE INTO sales_orders
          (id, order_no, order_type, client_id, status, delivery_date, total_weight_kg, price_per_kg, total_amount, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        row.id,
        `SO-LEG-${row.id}`,
        Number(row.is_retail ?? 0) === 1 ? "retail" : "wholesale",
        row.client_id ?? null,
        mapLegacySalesStatus(row.status),
        row.delivery_date ?? null,
        round2(totalKg),
        Number(row.price_per_kg ?? 0),
        Number(row.total_amount ?? 0),
        row.notes ?? null,
        row.created_at ?? row.order_date ?? nowIso(),
        row.created_at ?? row.order_date ?? nowIso(),
      );
    }
  }

  if (tableExists("order_items")) {
    const rows = qAll<any>("SELECT * FROM order_items");
    for (const row of rows) {
      const product = row.product_id ? qGet<any>("SELECT * FROM products WHERE id = ?", row.product_id) : null;
      const presentation = product?.presentation ?? null;
      qRun(
        `INSERT OR REPLACE INTO sales_order_items
          (id, order_id, product_id, description, presentation, quantity, unit, unit_weight_kg, unit_price, subtotal)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        row.id,
        row.order_id,
        row.product_id ?? null,
        row.product_name ?? product?.name ?? "Item",
        presentation,
        Number(row.quantity ?? 0),
        row.unit ?? "unit",
        legacyPresentationWeight(presentation),
        Number(row.unit_price ?? 0),
        Number(row.subtotal ?? 0),
      );
    }
  }

  if (tableExists("order_payments")) {
    const rows = qAll<any>("SELECT * FROM order_payments");
    for (const row of rows) {
      qRun(
        `INSERT OR IGNORE INTO sales_payments(id, order_id, amount, method, notes, registered_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        row.id,
        row.order_id,
        Number(row.amount ?? 0),
        row.payment_method ?? null,
        row.notes ?? null,
        row.registered_by ?? null,
        row.payment_date ?? row.created_at ?? nowIso(),
      );
    }
  }

  if (tableExists("order_shipments")) {
    const rows = qAll<any>("SELECT * FROM order_shipments");
    for (const row of rows) {
      qRun(
        `INSERT OR IGNORE INTO sales_shipments
          (id, order_id, weight_kg, destination_address, carrier, tracking_number, shipping_cost, registered_by, notes, expense_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        row.id,
        row.order_id,
        Number(row.kg_shipped ?? 0),
        row.destination_address ?? null,
        row.carrier ?? null,
        row.tracking_number ?? null,
        Number(row.shipping_cost ?? 0),
        row.registered_by ?? null,
        row.notes ?? null,
        row.expense_id ?? null,
        row.shipment_date ?? row.created_at ?? nowIso(),
      );
    }
  }

  if (tableExists("legacy_purchase_orders")) {
    const rows = qAll<any>("SELECT * FROM legacy_purchase_orders");
    for (const row of rows) {
      qRun(
        `INSERT OR REPLACE INTO purchase_orders
          (id, po_no, source_type, source_id, status, description, requested_green_kg, ordered_green_kg, received_green_kg, estimated_cost, estimated_shipping_cost, actual_cost, actual_shipping_cost, supplier, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        row.id,
        `PO-LEG-${row.id}`,
        row.order_id ? "sales_order" : "manual",
        row.order_id ?? null,
        mapLegacyPurchaseStatus(row.status),
        row.description,
        Number(row.kg_needed ?? 0),
        Number(row.kg_needed ?? 0),
        Number(row.kg_purchased ?? 0),
        Number(row.estimated_cost ?? 0),
        Number(row.estimated_shipping_cost ?? 0),
        Number(row.actual_cost ?? 0),
        Number(row.actual_shipping_cost ?? 0),
        row.supplier ?? null,
        null,
        row.created_at ?? nowIso(),
        row.completed_at ?? row.created_at ?? nowIso(),
      );
    }
  }

  if (tableExists("purchase_order_entries")) {
    const rows = qAll<any>("SELECT * FROM purchase_order_entries");
    for (const row of rows) {
      const qty = Number(row.quantity ?? 0);
      const total = Number(row.cost ?? 0);
      qRun(
        `INSERT OR IGNORE INTO purchase_entries
          (id, purchase_order_id, inventory_item_id, quantity_kg, unit_cost, total_cost, shipping_cost, supplier, lot_label, origin_id, variety_id, registered_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
        row.id,
        row.purchase_order_id,
        row.inventory_id,
        qty,
        qty > 0 ? round2(total / qty) : 0,
        total,
        row.supplier ?? null,
        row.lot_label ?? null,
        row.origin_id ?? null,
        row.variety_id ?? null,
        row.registered_by ?? null,
        row.entry_date ?? row.created_at ?? nowIso(),
      );
    }
  }

  if (tableExists("legacy_capital_contributions")) {
    const rows = qAll<any>("SELECT * FROM legacy_capital_contributions");
    for (const row of rows) {
      qRun(
        `INSERT OR REPLACE INTO capital_contributions
          (id, capital_request_id, partner_name, amount, description, contribution_date, created_at)
         VALUES (?, NULL, ?, ?, ?, ?, ?)`,
        row.id,
        normalizePartnerName(row.partner_name),
        Number(row.amount ?? 0),
        row.description,
        row.contribution_date ?? todayIso(),
        row.created_at ?? nowIso(),
      );
    }
  }

  if (tableExists("profit_withdrawals")) {
    const rows = qAll<any>("SELECT * FROM profit_withdrawals");
    for (const row of rows) {
      qRun(
        `INSERT OR IGNORE INTO withdrawals
          (id, kind, partner_name, amount, month, contribution_id, dividend_order_id, notes, created_at)
         VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
        row.id,
        row.withdrawal_type === "aporte_retorno" ? "capital_return" : "dividend",
        normalizePartnerName(row.partner_name),
        Number(row.amount ?? 0),
        row.month ?? null,
        row.notes ?? null,
        row.withdrawal_date ?? row.created_at ?? nowIso(),
      );
    }
  }

  if (tableExists("legacy_roasting_batches")) {
    const rows = qAll<any>("SELECT * FROM legacy_roasting_batches");
    for (const row of rows) {
      qRun(
        `INSERT OR REPLACE INTO roasting_batches
          (id, session_id, batch_no, green_inventory_item_id, roast_profile_id, sales_order_id, green_kg, roasted_kg, loss_pct, machine_minutes, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        row.id,
        row.session_id,
        row.batch_number ?? `BATCH-${row.id}`,
        row.green_inventory_id,
        row.roast_profile_id ?? null,
        row.order_id ?? null,
        Number(row.green_kg ?? 0),
        row.roasted_kg ?? null,
        row.loss_pct ?? null,
        Number(row.machine_minutes ?? 0),
        row.notes ?? null,
        row.created_at ?? nowIso(),
      );
    }
  }

  if (tableExists("legacy_machine_log")) {
    const rows = qAll<any>("SELECT * FROM legacy_machine_log");
    for (const row of rows) {
      qRun(
        `INSERT OR IGNORE INTO machine_logs(id, log_date, log_type, description, cost, registered_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        row.id,
        row.log_date ?? todayIso(),
        row.log_type ?? "incident",
        row.description,
        Number(row.cost ?? 0),
        row.registered_by ?? null,
        row.created_at ?? nowIso(),
      );
    }
  }

  if (tableExists("legacy_expenses")) {
    const rows = qAll<any>("SELECT * FROM legacy_expenses");
    for (const row of rows) {
      qRun(
        `INSERT OR IGNORE INTO expenses
          (id, expense_date, category_id, amount, description, paid_by, supplier, notes, auto_generated, ref_type, ref_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        row.id,
        row.expense_date ?? todayIso(),
        row.category_id,
        Number(row.amount ?? 0),
        row.description ?? null,
        row.paid_by,
        row.supplier ?? null,
        row.notes ?? null,
        Number(row.auto_generated ?? 0),
        row.reference_type ?? null,
        row.reference_id ?? null,
        row.created_at ?? nowIso(),
      );
    }
  }

  const legacyOrderIds = qAll<{ id: number }>("SELECT id FROM sales_orders");
  for (const row of legacyOrderIds) recalcSalesOrder(row.id);
  const legacyPoIds = qAll<{ id: number }>("SELECT id FROM purchase_orders");
  for (const row of legacyPoIds) recalcPurchaseOrder(row.id);
}

export function initDB() {
  migrateLegacyTablesIfNeeded();
  createSchema();
  upgradeSchemaIfNeeded();
  backfillFromLegacy();
  qRun(`INSERT OR REPLACE INTO settings(key, value) VALUES ('migration_v3_done', '1')`);
  ensureInventoryItem({
    item_type: "roasted_coffee",
    item_name: "Café tostado disponible",
    unit: "kg",
  });
}
