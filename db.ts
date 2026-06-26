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
function ensureColumn(table: string, column: string, definition: string) {
  const cols = qAll<{ name: string }>(`PRAGMA table_info(${table})`);
  if (!cols.some(c => c.name === column)) qRun(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
export function tx<T extends any[], R>(fn: (...args: T) => R) { return db.transaction(fn); }

export function normPartner(name: string | null | undefined) {
  const raw = String(name || "").trim();
  if (!raw) return raw;
  const k = raw.toLowerCase();
  if (["itzamara","itza","gaston","gastón","itza + gaston","itza + gastón","itza y gaston","itza y gastón","itza/gaston","itza/gastón"].includes(k)) return "Itza";
  if (k === "axel") return "Axel";
  return raw;
}

export function normAccount(name: string | null | undefined) {
  const raw = String(name || "").trim();
  if (!raw) return "Caja chica";
  const partner = normPartner(raw);
  if (partner === "Itza" || partner === "Axel") return partner;
  const k = raw.toLowerCase();
  if (["caja", "caja chica", "cash", "efectivo", "dinero disponible en caja"].includes(k)) return "Caja chica";
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

const invTypeMap: Record<string, string> = {
  cafe_verde: "green_coffee",
  cafe_tostado: "roasted_coffee",
  cafe_empaquetado: "packaged_coffee",
  insumo: "supply",
};
export function normInvType(type: string) {
  return invTypeMap[type] || type;
}

export function invTotal(type: string): number {
  return Number(qVal("SELECT COALESCE(SUM(quantity),0) AS v FROM inventory_items WHERE item_type=?", normInvType(type)) ?? 0);
}

export function finance() {
  const contributed = Number(qVal("SELECT COALESCE(SUM(amount),0) AS v FROM capital_contributions") ?? 0);
  const revenue = Number(qVal("SELECT COALESCE(SUM(amount),0) AS v FROM sales_payments") ?? 0);
  const expenses = Number(qVal("SELECT COALESCE(SUM(amount),0) AS v FROM expenses") ?? 0);
  const capReturned = Number(qVal("SELECT COALESCE(SUM(amount),0) AS v FROM withdrawals WHERE kind='capital_return'") ?? 0);
  const dividends = Number(qVal("SELECT COALESCE(SUM(amount),0) AS v FROM withdrawals WHERE kind='dividend'") ?? 0);
  const unrecovered = Math.max(0, r2(contributed - capReturned));
  const cash = r2(contributed + revenue - expenses - capReturned - dividends);
  const profit = r2(revenue - expenses);
  const retainedProfit = r2(profit - dividends);
  const distributable = unrecovered > 0 ? 0 : Math.max(0, Math.min(retainedProfit, cash));
  return {
    cash,
    revenue,
    expenses,
    contributed,
    capReturned,
    unrecovered,
    dividends,
    profit,
    retainedProfit,
    distributable,
    availableCash: cash,
    totalContributed: contributed,
    capitalRecovered: capReturned,
    unrecoveredCapital: unrecovered,
    dividendsPaid: dividends,
    distributableDividends: distributable,
  };
}

export function accountBalances() {
  const balances: Record<string, number> = { Axel: 0, Itza: 0, "Caja chica": 0 };
  const add = (account: string | null | undefined, amount: number) => {
    const key = normAccount(account);
    balances[key] = r2((balances[key] || 0) + Number(amount || 0));
  };

  for (const r of qAll<any>("SELECT COALESCE(received_account, partner_name) AS account, amount FROM capital_contributions")) add(r.account, r.amount);
  for (const r of qAll<any>("SELECT COALESCE(received_account, registered_by, 'Axel') AS account, amount FROM sales_payments")) add(r.account, r.amount);
  for (const r of qAll<any>("SELECT COALESCE(paid_from_account, CASE WHEN from_cashbox=1 THEN 'Caja chica' ELSE paid_by END) AS account, amount FROM expenses")) add(r.account, -Number(r.amount || 0));
  for (const r of qAll<any>("SELECT COALESCE(paid_from_account, 'Caja chica') AS account, amount FROM withdrawals")) add(r.account, -Number(r.amount || 0));

  for (const key of Object.keys(balances)) balances[key] = r2(balances[key]);
  return balances;
}

export function partnerCapital() {
  return qAll<any>("SELECT * FROM partners ORDER BY id").map(p => {
    const contributed = Number(qVal("SELECT COALESCE(SUM(amount),0) AS v FROM capital_contributions WHERE partner_name=?", p.name) ?? 0);
    const recovered = Number(qVal("SELECT COALESCE(SUM(amount),0) AS v FROM withdrawals WHERE kind='capital_return' AND partner_name=?", p.name) ?? 0);
    const dividends = Number(qVal("SELECT COALESCE(SUM(amount),0) AS v FROM withdrawals WHERE kind='dividend' AND partner_name=?", p.name) ?? 0);
    const unrecovered = Math.max(0, r2(contributed - recovered));
    return {
      ...p,
      contributed: r2(contributed),
      recovered: r2(recovered),
      capital_returned: r2(recovered),
      unrecovered,
      unrecovered_capital: unrecovered,
      dividends: r2(dividends),
      dividends_paid: r2(dividends),
    };
  });
}

export function financialPosition(month = thisMonth()) {
  const f = finance();
  const accounts = accountBalances();
  const partners = partnerCapital().map(p => ({
    ...p,
    dividend_capacity: r2((f.distributable * p.share_pct) / 100),
    dividends_available: r2((f.distributable * p.share_pct) / 100),
  }));
  const receivables = Number(qVal(`
    SELECT COALESCE(SUM(CASE WHEN so.total_amount - COALESCE((SELECT SUM(amount) FROM sales_payments WHERE order_id=so.id),0) > 0
      THEN so.total_amount - COALESCE((SELECT SUM(amount) FROM sales_payments WHERE order_id=so.id),0) ELSE 0 END),0) AS v
    FROM sales_orders so
    WHERE so.status != 'cancelado'
  `) ?? 0);
  const receivablesMonth = Number(qVal(`
    SELECT COALESCE(SUM(CASE WHEN so.total_amount - COALESCE((SELECT SUM(amount) FROM sales_payments WHERE order_id=so.id),0) > 0
      THEN so.total_amount - COALESCE((SELECT SUM(amount) FROM sales_payments WHERE order_id=so.id),0) ELSE 0 END),0) AS v
    FROM sales_orders so
    WHERE so.status != 'cancelado' AND substr(so.created_at,1,7)=?
  `, month) ?? 0);
  const revenueMonth = Number(qVal("SELECT COALESCE(SUM(amount),0) AS v FROM sales_payments WHERE substr(created_at,1,7)=?", month) ?? 0);
  const expenseMonth = Number(qVal("SELECT COALESCE(SUM(amount),0) AS v FROM expenses WHERE substr(expense_date,1,7)=?", month) ?? 0);
  const roastedMonth = Number(qVal("SELECT COALESCE(SUM(rb.roasted_kg),0) AS v FROM roasting_batches rb JOIN roasting_sessions rs ON rs.id=rb.session_id WHERE substr(rs.session_date,1,7)=?", month) ?? 0);
  const shippedMonth = Number(qVal("SELECT COALESCE(SUM(weight_kg),0) AS v FROM sales_shipments WHERE substr(created_at,1,7)=?", month) ?? 0);
  const itza = partners.find(p => p.name === "Itza");
  const axel = partners.find(p => p.name === "Axel");
  const axelCash = Math.max(0, Number(accounts.Axel || 0));
  const itzaUnrecovered = Number(itza?.unrecovered || 0);
  const axelToItza = r2(Math.min(axelCash, itzaUnrecovered));
  const monthlyProfit = r2(revenueMonth - expenseMonth);
  return {
    finance: f,
    accounts,
    partners,
    receivables: r2(receivables),
    receivablesMonth: r2(receivablesMonth),
    inventory: {
      green: invTotal("green_coffee"),
      roasted: invTotal("roasted_coffee"),
      packaged: invTotal("packaged_coffee"),
      supplies: invTotal("supply"),
    },
    monthly: {
      month,
      revenue: r2(revenueMonth),
      expenses: r2(expenseMonth),
      profit: monthlyProfit,
      roastedKg: r2(roastedMonth),
      shippedKg: r2(shippedMonth),
      profitPerRoastedKg: roastedMonth > 0 ? r2(monthlyProfit / roastedMonth) : 0,
      profitPerShippedKg: shippedMonth > 0 ? r2(monthlyProfit / shippedMonth) : 0,
    },
    settlement: {
      axel_to_itza: axelToItza,
      axelToItza,
      reason: axelToItza > 0
        ? "Axel tiene dinero de la empresa y hay capital de Itza pendiente por recuperar."
        : itzaUnrecovered > 0
          ? "Itza tiene capital pendiente, pero no hay saldo positivo registrado en la cuenta de Axel."
          : "No hay capital pendiente de Itza por recuperar.",
      itza_unrecovered: r2(itzaUnrecovered),
      axel_unrecovered: r2(Number(axel?.unrecovered || 0)),
      axel_account_cash: r2(axelCash),
    },
    dividendAdvice: {
      canDistribute: f.unrecovered <= 0 && f.distributable > 0,
      available: f.distributable,
      blockedReason: f.unrecovered > 0 ? "Primero hay que devolver aportes reembolsables de socios." : f.distributable <= 0 ? "Todavia no hay utilidad distribuible con caja disponible." : "",
      alreadyPaid: f.dividends,
    },
  };
}

export function ensureInvItem(data: { item_type: string; item_name: string; unit?: string; origin_id?: number | null; variety_id?: number | null; lot_label?: string | null }) {
  const itemType = normInvType(data.item_type);
  const existing = qGet<{ id: number }>("SELECT id FROM inventory_items WHERE item_type=? AND item_name=? AND COALESCE(lot_label,'')=COALESCE(?,'') LIMIT 1", itemType, data.item_name, data.lot_label ?? null);
  if (existing) return existing.id;
  const res = qRun("INSERT INTO inventory_items (item_type,item_name,quantity,unit,min_stock,origin_id,variety_id,lot_label) VALUES (?,?,0,?,0,?,?,?)", itemType, data.item_name, data.unit ?? "kg", data.origin_id ?? null, data.variety_id ?? null, data.lot_label ?? null);
  return Number(res.lastInsertRowid);
}

function migrateInventoryTypes() {
  const def = qGet<{ sql: string }>("SELECT sql FROM sqlite_master WHERE type='table' AND name='inventory_items'");
  if (!def?.sql.includes("'cafe_verde'")) return;
  db.exec(`
    PRAGMA foreign_keys = OFF;
    CREATE TABLE inventory_items_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_type TEXT NOT NULL CHECK(item_type IN ('green_coffee','roasted_coffee','packaged_coffee','supply')),
      item_name TEXT NOT NULL,
      quantity REAL DEFAULT 0,
      unit TEXT DEFAULT 'kg',
      min_stock REAL DEFAULT 0,
      origin_id INTEGER,
      variety_id INTEGER,
      lot_label TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO inventory_items_new (id,item_type,item_name,quantity,unit,min_stock,origin_id,variety_id,lot_label,created_at)
    SELECT id,
      CASE item_type
        WHEN 'cafe_verde' THEN 'green_coffee'
        WHEN 'cafe_tostado' THEN 'roasted_coffee'
        WHEN 'cafe_empaquetado' THEN 'packaged_coffee'
        WHEN 'insumo' THEN 'supply'
        ELSE item_type
      END,
      item_name, quantity, unit, min_stock, origin_id, variety_id, lot_label, created_at
    FROM inventory_items;
    DROP TABLE inventory_items;
    ALTER TABLE inventory_items_new RENAME TO inventory_items;
    PRAGMA foreign_keys = ON;
  `);
}

// Older databases were created with English status / type CHECK constraints
// ('pending_purchase', 'wholesale', 'received'...). The current schema uses
// Spanish values, and CREATE TABLE IF NOT EXISTS never alters an existing table,
// so writing a Spanish status fails the old CHECK. Rebuild any drifted table,
// translating existing values, so the schema matches the code exactly.
const PO_CREATE = "CREATE TABLE purchase_orders_new (id INTEGER PRIMARY KEY AUTOINCREMENT, po_no TEXT NOT NULL UNIQUE, source_type TEXT DEFAULT 'manual' CHECK(source_type IN ('sales_order','manual')), source_id INTEGER, status TEXT DEFAULT 'pendiente' CHECK(status IN ('sin_fondos','pendiente','parcial','recibida','cancelada')), description TEXT NOT NULL, requested_kg REAL DEFAULT 0, estimated_cost REAL DEFAULT 0, estimated_shipping_cost REAL DEFAULT 0, actual_cost REAL DEFAULT 0, actual_shipping_cost REAL DEFAULT 0, received_kg REAL DEFAULT 0, supplier TEXT, notes TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)";
const SO_CREATE = "CREATE TABLE sales_orders_new (id INTEGER PRIMARY KEY AUTOINCREMENT, order_no TEXT NOT NULL UNIQUE, order_type TEXT NOT NULL CHECK(order_type IN ('mostrador','mayoreo')), client_id INTEGER, status TEXT DEFAULT 'abierto' CHECK(status IN ('abierto','esperando_compra','en_produccion','listo','envio_parcial','completado','cancelado')), delivery_date TEXT, total_weight_kg REAL DEFAULT 0, price_per_kg REAL DEFAULT 0, total_amount REAL DEFAULT 0, notes TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY (client_id) REFERENCES clients(id))";
const ML_CREATE = "CREATE TABLE machine_logs_new (id INTEGER PRIMARY KEY AUTOINCREMENT, log_date TEXT NOT NULL, log_type TEXT NOT NULL CHECK(log_type IN ('mantenimiento','mejora','pieza','incidencia')), description TEXT NOT NULL, cost REAL DEFAULT 0, registered_by TEXT, expense_id INTEGER, created_at TEXT NOT NULL)";

// Rebuild a drifted table. Tries to preserve+translate rows; if the copy fails
// (e.g. an unexpected old column layout), it falls back to recreating the table
// empty so the schema is always fixed and the app keeps booting.
function rebuildDriftedTable(table: string, isDrifted: (sql: string) => boolean, createNewSql: string, buildInsert: (cols: Set<string>) => string) {
  const def = qGet<{ sql: string }>("SELECT sql FROM sqlite_master WHERE type='table' AND name=?", table);
  if (!def?.sql || !isDrifted(def.sql)) return;
  const cols = new Set(qAll<{ name: string }>(`PRAGMA table_info(${table})`).map(c => c.name));
  try {
    db.exec(`PRAGMA foreign_keys = OFF; DROP TABLE IF EXISTS ${table}_new; ${createNewSql}; ${buildInsert(cols)}; DROP TABLE ${table}; ALTER TABLE ${table}_new RENAME TO ${table}; PRAGMA foreign_keys = ON;`);
  } catch (e) {
    console.error(`[migrateStatusSchema] copia de ${table} falló (${(e as Error).message}); recreando vacía.`);
    try {
      db.exec(`PRAGMA foreign_keys = OFF; DROP TABLE IF EXISTS ${table}_new; ${createNewSql}; DROP TABLE ${table}; ALTER TABLE ${table}_new RENAME TO ${table}; PRAGMA foreign_keys = ON;`);
    } catch (e2) {
      console.error(`[migrateStatusSchema] recreación de ${table} falló: ${(e2 as Error).message}`);
    }
  }
}

function migrateStatusSchema() {
  const has = (cols: Set<string>, name: string, fallback: string) => (cols.has(name) ? name : fallback);

  rebuildDriftedTable(
    "purchase_orders",
    sql => sql.includes("'pending_purchase'") || sql.includes("'pending_capital'") || sql.includes("'received'"),
    PO_CREATE,
    cols => {
      const reqKg = cols.has("requested_kg") ? "requested_kg" : cols.has("requested_green_kg") ? "requested_green_kg" : "0";
      const rcvKg = cols.has("received_kg") ? "received_kg" : cols.has("received_green_kg") ? "received_green_kg" : "0";
      const status = cols.has("status")
        ? "CASE status WHEN 'pending_capital' THEN 'sin_fondos' WHEN 'pending_purchase' THEN 'pendiente' WHEN 'partial' THEN 'parcial' WHEN 'received' THEN 'recibida' WHEN 'cancelled' THEN 'cancelada' WHEN 'sin_fondos' THEN 'sin_fondos' WHEN 'pendiente' THEN 'pendiente' WHEN 'parcial' THEN 'parcial' WHEN 'recibida' THEN 'recibida' WHEN 'cancelada' THEN 'cancelada' ELSE 'pendiente' END"
        : "'pendiente'";
      const srcType = cols.has("source_type") ? "CASE source_type WHEN 'sales_order' THEN 'sales_order' ELSE 'manual' END" : "'manual'";
      return `INSERT INTO purchase_orders_new (id,po_no,source_type,source_id,status,description,requested_kg,estimated_cost,estimated_shipping_cost,actual_cost,actual_shipping_cost,received_kg,supplier,notes,created_at,updated_at)
        SELECT id, ${has(cols, "po_no", "'OC-'||id")}, ${srcType}, ${has(cols, "source_id", "NULL")}, ${status}, COALESCE(${has(cols, "description", "NULL")},'Compra'), COALESCE(${reqKg},0), COALESCE(${has(cols, "estimated_cost", "0")},0), COALESCE(${has(cols, "estimated_shipping_cost", "0")},0), COALESCE(${has(cols, "actual_cost", "0")},0), COALESCE(${has(cols, "actual_shipping_cost", "0")},0), COALESCE(${rcvKg},0), ${has(cols, "supplier", "NULL")}, ${has(cols, "notes", "NULL")}, COALESCE(${has(cols, "created_at", "NULL")},CURRENT_TIMESTAMP), COALESCE(${has(cols, "updated_at", "NULL")},CURRENT_TIMESTAMP)
        FROM purchase_orders`;
    }
  );

  rebuildDriftedTable(
    "sales_orders",
    sql => sql.includes("'wholesale'") || sql.includes("'retail'") || sql.includes("'in_production'") || sql.includes("'completed'"),
    SO_CREATE,
    cols => {
      const orderType = cols.has("order_type") ? "CASE order_type WHEN 'retail' THEN 'mostrador' WHEN 'wholesale' THEN 'mayoreo' WHEN 'mostrador' THEN 'mostrador' WHEN 'mayoreo' THEN 'mayoreo' ELSE 'mayoreo' END" : "'mayoreo'";
      const status = cols.has("status")
        ? "CASE status WHEN 'open' THEN 'abierto' WHEN 'pending_purchase' THEN 'esperando_compra' WHEN 'in_production' THEN 'en_produccion' WHEN 'ready' THEN 'listo' WHEN 'partial_shipped' THEN 'envio_parcial' WHEN 'completed' THEN 'completado' WHEN 'cancelled' THEN 'cancelado' WHEN 'abierto' THEN 'abierto' WHEN 'esperando_compra' THEN 'esperando_compra' WHEN 'en_produccion' THEN 'en_produccion' WHEN 'listo' THEN 'listo' WHEN 'envio_parcial' THEN 'envio_parcial' WHEN 'completado' THEN 'completado' WHEN 'cancelado' THEN 'cancelado' ELSE 'abierto' END"
        : "'abierto'";
      return `INSERT INTO sales_orders_new (id,order_no,order_type,client_id,status,delivery_date,total_weight_kg,price_per_kg,total_amount,notes,created_at,updated_at)
        SELECT id, ${has(cols, "order_no", "'VTA-'||id")}, ${orderType}, ${has(cols, "client_id", "NULL")}, ${status}, ${has(cols, "delivery_date", "NULL")}, COALESCE(${has(cols, "total_weight_kg", "0")},0), COALESCE(${has(cols, "price_per_kg", "0")},0), COALESCE(${has(cols, "total_amount", "0")},0), ${has(cols, "notes", "NULL")}, COALESCE(${has(cols, "created_at", "NULL")},CURRENT_TIMESTAMP), COALESCE(${has(cols, "updated_at", "NULL")},CURRENT_TIMESTAMP)
        FROM sales_orders`;
    }
  );

  rebuildDriftedTable(
    "machine_logs",
    sql => sql.includes("'maintenance'") || sql.includes("'improvement'") || sql.includes("'incident'"),
    ML_CREATE,
    cols => {
      const logType = cols.has("log_type") ? "CASE log_type WHEN 'maintenance' THEN 'mantenimiento' WHEN 'improvement' THEN 'mejora' WHEN 'part' THEN 'pieza' WHEN 'incident' THEN 'incidencia' WHEN 'mantenimiento' THEN 'mantenimiento' WHEN 'mejora' THEN 'mejora' WHEN 'pieza' THEN 'pieza' WHEN 'incidencia' THEN 'incidencia' ELSE 'mantenimiento' END" : "'mantenimiento'";
      return `INSERT INTO machine_logs_new (id,log_date,log_type,description,cost,registered_by,expense_id,created_at)
        SELECT id, COALESCE(${has(cols, "log_date", "NULL")},CURRENT_TIMESTAMP), ${logType}, COALESCE(${has(cols, "description", "NULL")},'Registro'), COALESCE(${has(cols, "cost", "0")},0), ${has(cols, "registered_by", "NULL")}, ${has(cols, "expense_id", "NULL")}, COALESCE(${has(cols, "created_at", "NULL")},CURRENT_TIMESTAMP)
        FROM machine_logs`;
    }
  );

  // Ensure FK enforcement is restored even if a rebuild was interrupted.
  db.exec("PRAGMA foreign_keys = ON");
}

export function invMove(itemId: number, dir: "in" | "out" | "adjust", qty: number, reason: string, by?: string | null, allowNegative = false, movedAt?: string | null) {
  const cur = Number(qVal("SELECT COALESCE(quantity,0) AS v FROM inventory_items WHERE id=?", itemId) ?? 0);
  let next = cur;
  if (dir === "in") next = cur + qty;
  else if (dir === "out") {
    if (!allowNegative && cur < qty) throw new Error(`Inventario insuficiente (disponible: ${cur.toFixed(1)}, solicitado: ${qty.toFixed(1)})`);
    next = cur - qty;
  } else next = qty;
  qRun("UPDATE inventory_items SET quantity=? WHERE id=?", r2(next), itemId);
  qRun("INSERT INTO inventory_movements (item_id,direction,quantity,reason,registered_by,created_at) VALUES (?,?,?,?,?,?)", itemId, dir, r2(qty), reason, by ?? "Sistema", movedAt || now());
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

export function createPO(input: { sourceType: string; sourceId?: number | null; description: string; requestedKg: number; estimatedCost?: number; estimatedShippingCost?: number; supplier?: string | null; notes?: string | null; createdAt?: string }) {
  const f = finance();
  const est = r2(input.estimatedCost ?? 0);
  const ship = r2(input.estimatedShippingCost ?? 0);
  const status = est + ship > f.cash ? "sin_fondos" : "pendiente";
  const res = qRun("INSERT INTO purchase_orders (po_no,source_type,source_id,status,description,requested_kg,estimated_cost,estimated_shipping_cost,actual_cost,actual_shipping_cost,received_kg,supplier,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,0,0,0,?,?,?,?)", docNo("OC"), input.sourceType, input.sourceId ?? null, status, input.description, r2(input.requestedKg), est, ship, input.supplier ?? null, input.notes ?? null, input.createdAt || now(), now());
  const poId = Number(res.lastInsertRowid);
  if (input.sourceType === "sales_order" && input.sourceId) recalcSO(input.sourceId);
  return qGet<any>("SELECT * FROM purchase_orders WHERE id=?", poId);
}

export function autoExpense(catName: string, amount: number, desc: string, paidBy: string, refType: string, refId: number, fromCashbox = 1, fromUtilities = 0, paidFromAccount?: string | null, expenseDate?: string | null) {
  let cat = qGet<{ id: number }>("SELECT id FROM expense_categories WHERE name=? LIMIT 1", catName);
  const normalizedCat = String(catName || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (!cat && normalizedCat.startsWith("env")) cat = qGet<{ id: number }>("SELECT id FROM expense_categories WHERE lower(name) LIKE 'env%' LIMIT 1");
  if (!cat) return null;
  const inferredDate = refType.startsWith("purchase")
    ? qVal<string>("SELECT substr(created_at,1,10) AS v FROM purchase_entries WHERE purchase_order_id=? ORDER BY id DESC LIMIT 1", refId)
    : null;
  const res = qRun("INSERT INTO expenses (expense_date,category_id,amount,description,paid_by,auto_generated,ref_type,ref_id,from_cashbox,from_utilities,paid_from_account,created_at) VALUES (?,?,?,?,?,1,?,?,?,?,?,?)", expenseDate || inferredDate || today(), cat.id, r2(amount), desc, paidBy, refType, refId, fromCashbox ? 1 : 0, fromUtilities ? 1 : 0, normAccount(paidFromAccount || paidBy), now());
  return Number(res.lastInsertRowid);
}

export function initDB() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS site_content (page TEXT PRIMARY KEY, content_json TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS site_media (id INTEGER PRIMARY KEY AUTOINCREMENT, file_name TEXT NOT NULL, mime_type TEXT NOT NULL, data BLOB NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS partners (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, share_pct REAL NOT NULL);
    CREATE TABLE IF NOT EXISTS roast_profiles (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, active INTEGER DEFAULT 1);
    CREATE TABLE IF NOT EXISTS origins (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, active INTEGER DEFAULT 1);
    CREATE TABLE IF NOT EXISTS varieties (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, active INTEGER DEFAULT 1);
    CREATE TABLE IF NOT EXISTS expense_categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, is_direct_cost INTEGER DEFAULT 0, active INTEGER DEFAULT 1);
    CREATE TABLE IF NOT EXISTS clients (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, cafe_name TEXT, contact_name TEXT, phone TEXT, contact_phone TEXT, email TEXT, address TEXT, neighborhood TEXT, municipality TEXT, city TEXT, state TEXT, country TEXT, postal_code TEXT, address_reference TEXT, notes TEXT, active INTEGER DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, origin_id INTEGER, variety_id INTEGER, roast_profile_id INTEGER, presentation TEXT, unit_weight_kg REAL DEFAULT 1, price REAL DEFAULT 0, active INTEGER DEFAULT 1, FOREIGN KEY (origin_id) REFERENCES origins(id), FOREIGN KEY (variety_id) REFERENCES varieties(id), FOREIGN KEY (roast_profile_id) REFERENCES roast_profiles(id));

    CREATE TABLE IF NOT EXISTS inventory_items (id INTEGER PRIMARY KEY AUTOINCREMENT, item_type TEXT NOT NULL CHECK(item_type IN ('green_coffee','roasted_coffee','packaged_coffee','supply')), item_name TEXT NOT NULL, quantity REAL DEFAULT 0, unit TEXT DEFAULT 'kg', min_stock REAL DEFAULT 0, origin_id INTEGER, variety_id INTEGER, lot_label TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS inventory_movements (id INTEGER PRIMARY KEY AUTOINCREMENT, item_id INTEGER NOT NULL, direction TEXT NOT NULL CHECK(direction IN ('in','out','adjust')), quantity REAL NOT NULL, reason TEXT, registered_by TEXT, created_at TEXT NOT NULL, FOREIGN KEY (item_id) REFERENCES inventory_items(id) ON DELETE CASCADE);

    CREATE TABLE IF NOT EXISTS sales_orders (id INTEGER PRIMARY KEY AUTOINCREMENT, order_no TEXT NOT NULL UNIQUE, order_type TEXT NOT NULL CHECK(order_type IN ('mostrador','mayoreo')), client_id INTEGER, status TEXT DEFAULT 'abierto' CHECK(status IN ('abierto','esperando_compra','en_produccion','listo','envio_parcial','completado','cancelado')), delivery_date TEXT, total_weight_kg REAL DEFAULT 0, price_per_kg REAL DEFAULT 0, total_amount REAL DEFAULT 0, notes TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY (client_id) REFERENCES clients(id));
    CREATE TABLE IF NOT EXISTS sales_order_items (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, product_id INTEGER, description TEXT NOT NULL, presentation TEXT, quantity REAL DEFAULT 0, unit TEXT DEFAULT 'pz', unit_weight_kg REAL DEFAULT 0, unit_price REAL DEFAULT 0, subtotal REAL DEFAULT 0, FOREIGN KEY (order_id) REFERENCES sales_orders(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS sales_payments (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, amount REAL NOT NULL, method TEXT, notes TEXT, registered_by TEXT, received_account TEXT DEFAULT 'Axel', created_at TEXT NOT NULL, FOREIGN KEY (order_id) REFERENCES sales_orders(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS sales_shipments (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, weight_kg REAL NOT NULL, destination_address TEXT, carrier TEXT, tracking_number TEXT, shipping_cost REAL DEFAULT 0, registered_by TEXT, notes TEXT, expense_id INTEGER, funding_source TEXT, paid_from_account TEXT, created_at TEXT NOT NULL, FOREIGN KEY (order_id) REFERENCES sales_orders(id) ON DELETE CASCADE);

    CREATE TABLE IF NOT EXISTS purchase_orders (id INTEGER PRIMARY KEY AUTOINCREMENT, po_no TEXT NOT NULL UNIQUE, source_type TEXT DEFAULT 'manual' CHECK(source_type IN ('sales_order','manual')), source_id INTEGER, status TEXT DEFAULT 'pendiente' CHECK(status IN ('sin_fondos','pendiente','parcial','recibida','cancelada')), description TEXT NOT NULL, requested_kg REAL DEFAULT 0, estimated_cost REAL DEFAULT 0, estimated_shipping_cost REAL DEFAULT 0, actual_cost REAL DEFAULT 0, actual_shipping_cost REAL DEFAULT 0, received_kg REAL DEFAULT 0, supplier TEXT, notes TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS purchase_entries (id INTEGER PRIMARY KEY AUTOINCREMENT, purchase_order_id INTEGER NOT NULL, inventory_item_id INTEGER NOT NULL, quantity_kg REAL NOT NULL, unit_cost REAL DEFAULT 0, total_cost REAL NOT NULL, shipping_cost REAL DEFAULT 0, supplier TEXT, lot_label TEXT, origin_id INTEGER, variety_id INTEGER, registered_by TEXT, funding_source TEXT, paid_from_account TEXT, created_at TEXT NOT NULL, FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id) ON DELETE CASCADE);

    CREATE TABLE IF NOT EXISTS capital_contributions (id INTEGER PRIMARY KEY AUTOINCREMENT, partner_name TEXT NOT NULL, amount REAL NOT NULL, description TEXT NOT NULL, contribution_date TEXT NOT NULL, capital_request_id INTEGER, received_account TEXT, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS withdrawals (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL CHECK(kind IN ('capital_return','dividend')), partner_name TEXT NOT NULL, amount REAL NOT NULL, month TEXT, contribution_id INTEGER, dividend_order_id INTEGER, paid_from_account TEXT, notes TEXT, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS capital_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, request_no TEXT NOT NULL UNIQUE, amount_requested REAL NOT NULL, amount_funded REAL DEFAULT 0, status TEXT DEFAULT 'open', notes TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS dividend_orders (id INTEGER PRIMARY KEY AUTOINCREMENT, dividend_no TEXT NOT NULL UNIQUE, month TEXT NOT NULL, total_amount REAL NOT NULL, status TEXT DEFAULT 'open', notes TEXT, created_at TEXT NOT NULL, paid_at TEXT);
    CREATE TABLE IF NOT EXISTS partner_assets (id INTEGER PRIMARY KEY AUTOINCREMENT, asset_name TEXT NOT NULL, owner_partner TEXT NOT NULL, purchased_by TEXT, purchase_date TEXT NOT NULL, amount REAL DEFAULT 0, notes TEXT, status TEXT DEFAULT 'active', created_at TEXT NOT NULL);

    CREATE TABLE IF NOT EXISTS roasting_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, session_date TEXT NOT NULL, operator TEXT NOT NULL, notes TEXT, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS roasting_batches (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER NOT NULL, batch_no TEXT NOT NULL UNIQUE, green_inventory_item_id INTEGER NOT NULL, roast_profile_id INTEGER, sales_order_id INTEGER, green_kg REAL NOT NULL, roasted_kg REAL, loss_pct REAL, machine_minutes REAL DEFAULT 0, notes TEXT, artisan_file_name TEXT, artisan_data TEXT, ai_review TEXT, created_at TEXT NOT NULL, FOREIGN KEY (session_id) REFERENCES roasting_sessions(id) ON DELETE CASCADE, FOREIGN KEY (green_inventory_item_id) REFERENCES inventory_items(id), FOREIGN KEY (roast_profile_id) REFERENCES roast_profiles(id), FOREIGN KEY (sales_order_id) REFERENCES sales_orders(id));
    CREATE TABLE IF NOT EXISTS batch_photos (id INTEGER PRIMARY KEY AUTOINCREMENT, batch_id INTEGER NOT NULL, file_name TEXT NOT NULL, stored_name TEXT NOT NULL, mime_type TEXT, notes TEXT, created_at TEXT NOT NULL, FOREIGN KEY (batch_id) REFERENCES roasting_batches(id) ON DELETE CASCADE);

    CREATE TABLE IF NOT EXISTS machine_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, log_date TEXT NOT NULL, log_type TEXT NOT NULL CHECK(log_type IN ('mantenimiento','mejora','pieza','incidencia')), description TEXT NOT NULL, cost REAL DEFAULT 0, registered_by TEXT, expense_id INTEGER, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS expenses (id INTEGER PRIMARY KEY AUTOINCREMENT, expense_date TEXT NOT NULL, category_id INTEGER NOT NULL, amount REAL NOT NULL, description TEXT, paid_by TEXT NOT NULL, supplier TEXT, notes TEXT, auto_generated INTEGER DEFAULT 0, ref_type TEXT, ref_id INTEGER, from_cashbox INTEGER DEFAULT 1, from_utilities INTEGER DEFAULT 0, paid_from_account TEXT, created_at TEXT NOT NULL, FOREIGN KEY (category_id) REFERENCES expense_categories(id));

    INSERT OR IGNORE INTO partners (name, share_pct) VALUES ('Itza', 50), ('Axel', 50);
    INSERT OR IGNORE INTO roast_profiles (name) VALUES ('Filtro'),('Espresso'),('Omniroast'),('Claro'),('Medio'),('Oscuro');
    INSERT OR IGNORE INTO origins (name) VALUES ('Chiapas'),('Veracruz'),('Oaxaca'),('Puebla'),('Guerrero'),('Nayarit'),('Colombia'),('Brasil'),('Guatemala'),('Etiopía'),('Blend');
    INSERT OR IGNORE INTO varieties (name) VALUES ('Typica'),('Bourbon'),('Caturra'),('Catuaí'),('Geisha'),('SL28'),('Pacamara'),('Maragogipe'),('Mundo Novo'),('Catimor'),('Blend');
    INSERT OR IGNORE INTO expense_categories (name, is_direct_cost) VALUES ('Café verde',1),('Gas',1),('Electricidad',1),('Empaques',1),('Envíos',1),('Mantenimiento',0),('Marketing',0),('Renta',0),('Otros',0);
    INSERT OR IGNORE INTO settings (key, value) VALUES ('business_name','CAFETIER'),('business_tagline','Culto por el café'),('default_loss_pct','20'),('machine_kw','0'),('kwh_price','0'),('claude_api_key',''),('operators','Axel|Itza'),('people','Itza|Axel'),('individual_people','Itza|Axel'),('roast_operators','Axel|Itza');
  `);
  ensureColumn("clients", "cafe_name", "TEXT");
  ensureColumn("clients", "contact_name", "TEXT");
  ensureColumn("clients", "contact_phone", "TEXT");
  ensureColumn("clients", "postal_code", "TEXT");
  ensureColumn("clients", "neighborhood", "TEXT");
  ensureColumn("clients", "municipality", "TEXT");
  ensureColumn("clients", "state", "TEXT");
  ensureColumn("clients", "country", "TEXT");
  ensureColumn("clients", "address_reference", "TEXT");
  ensureColumn("expenses", "from_cashbox", "INTEGER DEFAULT 1");
  ensureColumn("expenses", "from_utilities", "INTEGER DEFAULT 0");
  ensureColumn("expenses", "paid_from_account", "TEXT");
  ensureColumn("sales_shipments", "funding_source", "TEXT");
  ensureColumn("sales_shipments", "paid_from_account", "TEXT");
  ensureColumn("sales_payments", "received_account", "TEXT DEFAULT 'Axel'");
  ensureColumn("purchase_orders", "estimated_shipping_cost", "REAL DEFAULT 0");
  ensureColumn("purchase_orders", "actual_shipping_cost", "REAL DEFAULT 0");
  ensureColumn("purchase_orders", "notes", "TEXT");
  ensureColumn("purchase_entries", "funding_source", "TEXT");
  ensureColumn("purchase_entries", "paid_from_account", "TEXT");
  ensureColumn("capital_contributions", "capital_request_id", "INTEGER");
  ensureColumn("capital_contributions", "received_account", "TEXT");
  ensureColumn("capital_contributions", "ref_type", "TEXT");
  ensureColumn("capital_contributions", "ref_id", "INTEGER");
  ensureColumn("withdrawals", "dividend_order_id", "INTEGER");
  ensureColumn("withdrawals", "paid_from_account", "TEXT");
  qRun("UPDATE sales_payments SET received_account=COALESCE(received_account, registered_by, 'Axel')");
  qRun("UPDATE sales_shipments SET funding_source=COALESCE(funding_source, 'business_account')");
  qRun("UPDATE sales_shipments SET paid_from_account=COALESCE(paid_from_account, 'Caja chica')");
  qRun("UPDATE expenses SET paid_from_account=COALESCE(paid_from_account, CASE WHEN from_cashbox=1 THEN 'Caja chica' ELSE paid_by END)");
  qRun("UPDATE capital_contributions SET received_account=COALESCE(received_account, partner_name)");
  qRun("UPDATE withdrawals SET paid_from_account=COALESCE(paid_from_account, 'Caja chica')");
  qRun("UPDATE capital_contributions SET partner_name='Itza' WHERE lower(partner_name) IN ('itzamara','itza','gaston','gastón','itza + gaston','itza + gastón','itza y gaston','itza y gastón','itza/gaston','itza/gastón')");
  qRun("UPDATE withdrawals SET partner_name='Itza' WHERE lower(partner_name) IN ('itzamara','itza','gaston','gastón','itza + gaston','itza + gastón','itza y gaston','itza y gastón','itza/gaston','itza/gastón')");
  qRun("UPDATE partners SET share_pct=50 WHERE name IN ('Itza','Axel')");
  qRun("DELETE FROM partners WHERE name NOT IN ('Itza','Axel')");
  qRun("INSERT OR REPLACE INTO settings (key,value) VALUES ('people','Itza|Axel'),('individual_people','Itza|Axel'),('operators','Axel|Itza'),('roast_operators','Axel|Itza')");
  qRun("UPDATE settings SET value='20' WHERE key='default_loss_pct' AND value='15'");
  migrateInventoryTypes();
  migrateStatusSchema();
  ensureInvItem({ item_type: "roasted_coffee", item_name: "Café tostado disponible", unit: "kg" });

  // One-shot data reset via env var (set RESET_DB_ON_BOOT=operativo|todo in the host,
  // redeploy once). A marker prevents it from wiping again on later restarts.
  const resetFlag = process.env.RESET_DB_ON_BOOT;
  if (resetFlag) {
    const marker = qVal<string>("SELECT value FROM settings WHERE key='last_boot_reset'");
    if (marker !== resetFlag) {
      resetData(resetFlag === "todo" ? "todo" : "operativo");
      qRun("INSERT OR REPLACE INTO settings(key,value) VALUES ('last_boot_reset',?)", resetFlag);
      console.log(`[RESET_DB_ON_BOOT] Datos reiniciados (alcance=${resetFlag}).`);
    }
  }
}

// Merma (loss) estimated dynamically from the most recent roasting batches,
// falling back to the configured default. Clamped to a sane range.
export function estimatedLoss(): number {
  const avg = qVal<number>("SELECT AVG(loss_pct) AS v FROM (SELECT loss_pct FROM roasting_batches WHERE loss_pct IS NOT NULL ORDER BY id DESC LIMIT 12)");
  const fallback = getNum("default_loss_pct", 20);
  let loss = avg != null && Number.isFinite(Number(avg)) && Number(avg) > 0 ? Number(avg) : fallback;
  loss = Math.min(40, Math.max(5, loss));
  return r2(loss);
}

// Green coffee needed to obtain a target roasted weight, given the estimated loss.
export function greenNeededForRoasted(roastedKg: number, loss = estimatedLoss()): number {
  const factor = 1 - loss / 100;
  return factor > 0 ? r2(roastedKg / factor) : r2(roastedKg);
}

// One-time data reset. scope "operativo" keeps catalogs, clients, products and
// settings; scope "todo" also clears clients and products. Children are removed
// before parents so foreign keys stay satisfied without disabling them.
export function resetData(scope: "operativo" | "todo" = "operativo") {
  const tables = [
    "sales_payments", "sales_shipments", "sales_order_items",
    "batch_photos", "roasting_batches", "roasting_sessions",
    "purchase_entries", "purchase_orders",
    "inventory_movements", "inventory_items",
    "sales_orders",
    "machine_logs", "expenses",
    "withdrawals", "capital_contributions", "capital_requests", "dividend_orders", "partner_assets",
  ];
  const run = tx(() => {
    for (const t of tables) qRun(`DELETE FROM ${t}`);
    if (scope === "todo") { qRun("DELETE FROM products"); qRun("DELETE FROM clients"); }
    const seqNames = scope === "todo" ? [...tables, "products", "clients"] : tables;
    qRun(`DELETE FROM sqlite_sequence WHERE name IN (${seqNames.map(() => "?").join(",")})`, ...seqNames);
    ensureInvItem({ item_type: "roasted_coffee", item_name: "Café tostado disponible", unit: "kg" });
  });
  run();
  return { scope, tablesCleared: tables.length };
}
