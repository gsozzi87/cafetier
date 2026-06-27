import { Hono } from "hono";
import fs from "fs";
import path from "path";
import { autoExpense, createPO, docNo, ensureInvItem, estimatedLoss, finance, financialPosition, getNum, getSettings, greenNeededForRoasted, invMove, invTotal, normAccount, normInvType, normPartner, now, partnerCapital, qAll, qGet, qRun, qVal, r2, recalcPO, recalcSO, resetData, thisMonth, today, tx } from "./db";

const api = new Hono();
const ok = (d: any = null) => ({ success: true, data: d });
const fail = (m: string) => ({ success: false, error: m });
async function body<T = any>(c: any): Promise<T> { try { return await c.req.json() as T; } catch { return {} as T; } }
function num(v: any, f = 0) { const n = Number(v); return Number.isFinite(n) ? n : f; }
function req(cond: any, msg: string) { if (!cond) throw new Error(msg); }
function boolFlag(v: any, fallback = 0) {
  if (v === undefined || v === null || v === "") return fallback ? 1 : 0;
  return ["1", "true", "yes", "si", "sí", "on"].includes(String(v).toLowerCase()) ? 1 : 0;
}
function expenseFunding(b: any) {
  const source = String(b.funding_source || "").trim();
  const isPartnerContribution = source === "partner_contribution";
  const legacyPartner = source && !["cash", "business_account", "partner_contribution"].includes(source) ? normPartner(source) : "";
  const explicitPartner = normPartner(b.partner_name || b.reimbursable_partner || legacyPartner || "");
  const fromCashbox = isPartnerContribution ? 0 : b.from_cashbox === undefined ? (explicitPartner ? 0 : 1) : boolFlag(b.from_cashbox, 1);
  const fromUtilities = boolFlag(b.from_utilities, 0);
  const paidBy = explicitPartner || b.paid_by || (fromCashbox ? "Dinero Cafetier" : "Itza");
  const partner = ["Itza", "Axel"].includes(normPartner(paidBy)) ? normPartner(paidBy) : "";
  const paidFromAccount = normAccount(b.paid_from_account || b.account || (fromCashbox ? paidBy : partner || paidBy));
  return { fromCashbox, fromUtilities, paidBy: partner || paidBy, partner: fromCashbox ? "" : partner, paidFromAccount };
}
function registerDirectFunding(partner: string, amount: number, date: string, description: string, receivedAccount?: string | null, capitalRequestId?: number | null, refType?: string | null, refId?: number | null) {
  if (!partner) return;
  const res = qRun("INSERT INTO capital_contributions(partner_name,amount,description,contribution_date,capital_request_id,received_account,ref_type,ref_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)", partner, r2(amount), description, date, capitalRequestId || null, normAccount(receivedAccount || partner), refType || null, refId || null, now());
  if (capitalRequestId) refreshCapitalRequest(capitalRequestId);
  return Number(res.lastInsertRowid);
}
function refreshCapitalRequest(id: number) {
  const funded = Number(qVal("SELECT COALESCE(SUM(amount),0) AS v FROM capital_contributions WHERE capital_request_id=?", id) ?? 0);
  const reqRow = qGet<any>("SELECT * FROM capital_requests WHERE id=?", id);
  if (!reqRow) return;
  const status = funded >= Number(reqRow.amount_requested || 0) ? "funded" : funded > 0 ? "partially_funded" : "open";
  qRun("UPDATE capital_requests SET amount_funded=?, status=?, updated_at=? WHERE id=?", r2(funded), status, now(), id);
}

// Delete an expense and the mirror capital contribution it generated when a
// partner paid it (so the books stay balanced). New rows are linked by ref;
// older rows are matched conservatively (only when exactly one matches).
function deleteExpenseAndMirrorRows(id: number) {
  const exp = qGet<any>("SELECT * FROM expenses WHERE id=?", id);
  qRun("DELETE FROM capital_contributions WHERE ref_type='expense' AND ref_id=?", id);
  if (exp && Number(exp.from_cashbox) === 0 && exp.paid_from_account) {
    const desc = `Gasto pagado por ${exp.paid_from_account}: ${exp.description || "sin descripción"}`;
    const matches = qAll<any>("SELECT id FROM capital_contributions WHERE ref_id IS NULL AND partner_name=? AND amount=? AND description=?", normPartner(exp.paid_from_account), r2(Number(exp.amount)), desc);
    if (matches.length === 1) qRun("DELETE FROM capital_contributions WHERE id=?", matches[0].id);
  }
  qRun("DELETE FROM expenses WHERE id=?", id);
}
function deleteExpenseWithMirror(id: number) {
  const del = tx(() => deleteExpenseAndMirrorRows(id));
  del();
}
function purchaseOrderView(row: any) {
  if (!row) return row;
  const totalEstimated = Number(row.estimated_cost || 0) + Number(row.estimated_shipping_cost || 0);
  const missing = Math.max(0, totalEstimated - finance().cash);
  return {
    ...row,
    requested_green_kg: row.requested_kg,
    received_green_kg: row.received_kg,
    actual_shipping_cost: row.actual_shipping_cost || 0,
    estimated_shipping_cost: row.estimated_shipping_cost || 0,
    capital_missing: row.status === "sin_fondos" ? r2(missing) : 0,
    paid_from: qVal<string>("SELECT GROUP_CONCAT(DISTINCT paid_from_account) AS v FROM purchase_entries WHERE purchase_order_id=? AND paid_from_account IS NOT NULL AND paid_from_account<>''", row.id) || "",
  };
}
// Maps a catalog item to a sensible expense category when receiving a non-coffee purchase.
function purchaseExpenseCategory(cat: any) {
  if (!cat) return "Otros";
  if (cat.item_type === "green_coffee") return "Café verde";
  const c = String(cat.category || "").toLowerCase();
  if (c.includes("empaque") || c.includes("caja") || c.includes("bolsa") || c.includes("etiqueta")) return "Empaques";
  if (c.includes("marketing")) return "Marketing";
  return "Otros";
}
// Expense category for a received entry, derived from the inventory item it landed in.
function entryExpenseCategory(itemId: number) {
  const it = qGet<any>("SELECT * FROM inventory_items WHERE id=?", itemId);
  if (!it) return "Otros";
  if (it.item_type === "green_coffee") return "Café verde";
  const cat = qGet<any>("SELECT * FROM inventory_catalog WHERE name=?", it.item_name);
  return purchaseExpenseCategory(cat || { item_type: it.item_type, category: "" });
}
// Undo everything a received entry produced: inventory, its expenses (+mirrors) and partner funding.
function reversePurchaseEntry(entry: any, po: any) {
  if (entry.inventory_item_id && Number(entry.quantity_kg) !== 0) {
    invMove(entry.inventory_item_id, "out", r2(Number(entry.quantity_kg)), `Reverso recepción ${po.po_no}`, "Sistema", true);
  }
  for (const e of qAll<any>("SELECT id FROM expenses WHERE ref_type IN ('purchase_entry','purchase_entry_ship') AND ref_id=?", entry.id)) {
    deleteExpenseAndMirrorRows(Number(e.id));
  }
  qRun("DELETE FROM capital_contributions WHERE ref_type='purchase_entry' AND ref_id=?", entry.id);
}
// (Re)create the inventory + accounting effects of a received entry, keyed to the entry id.
function applyPurchaseEntryEffects(entryId: number, itemId: number, po: any, v: { qty: number; cost: number; ship: number; fundingSource: string; partner: string; paidFromAccount: string; registeredBy: string; entryDate: string }) {
  const landed = r2(v.cost + v.ship);
  if (v.qty !== 0) invMove(itemId, "in", v.qty, `Recepción ${po.po_no}`, v.registeredBy || "Sistema", true, setIsoDate(now(), v.entryDate));
  if (v.fundingSource === "partner_contribution") {
    registerDirectFunding(v.partner, landed, v.entryDate, `Compra ${po.po_no} pagada por ${v.partner}`, v.partner, null, "purchase_entry", entryId);
  }
  const fromCashbox = v.fundingSource === "partner_contribution" ? 0 : 1;
  autoExpense(entryExpenseCategory(itemId), v.cost, `Compra ${po.description || "verde"} ${po.po_no}`, v.registeredBy || v.paidFromAccount, "purchase_entry", entryId, fromCashbox, 0, v.paidFromAccount, v.entryDate);
  if (v.ship > 0) autoExpense("Envíos", v.ship, `Envío compra ${po.po_no}`, v.registeredBy || v.paidFromAccount, "purchase_entry_ship", entryId, fromCashbox, 0, v.paidFromAccount, v.entryDate);
}
function cashbookRows(start?: string | null, end?: string | null) {
  const rows = qAll<any>(`
    SELECT 'capital_contribution' AS source, cc.id AS source_id, cc.contribution_date AS date, 'Aporte de capital' AS type, 'Aporte' AS clase,
      cc.partner_name AS person, COALESCE(cc.received_account, cc.partner_name) AS account, cc.description AS detail,
      cc.amount AS amount, cc.amount AS signed_amount, cc.created_at AS created_at
    FROM capital_contributions cc
    WHERE cc.description NOT LIKE '%pagado por%' AND cc.description NOT LIKE '%pagada por%'
    UNION ALL
    SELECT 'sales_payment' AS source, sp.id AS source_id, substr(sp.created_at,1,10) AS date, 'Cobro de venta' AS type, 'Venta' AS clase,
      COALESCE(sp.registered_by,'Sistema') AS person, COALESCE(sp.received_account,'Axel') AS account,
      'Pago ' || COALESCE(so.order_no, '#' || sp.order_id) || COALESCE(' · ' || sp.notes, '') AS detail,
      sp.amount AS amount, sp.amount AS signed_amount, sp.created_at AS created_at
    FROM sales_payments sp
    LEFT JOIN sales_orders so ON so.id=sp.order_id
    UNION ALL
    SELECT 'expense' AS source, e.id AS source_id, e.expense_date AS date, ec.name AS type,
      CASE WHEN e.ref_type IN ('purchase_entry','purchase_order') THEN 'Compra'
           WHEN e.ref_type IN ('purchase_entry_ship','purchase_shipping','shipment') THEN 'Envío'
           ELSE 'Gasto' END AS clase,
      e.paid_by AS person, COALESCE(e.paid_from_account, e.paid_by) AS account,
      COALESCE(e.description, ec.name) || COALESCE(' · ' || e.supplier, '') AS detail,
      e.amount AS amount, -e.amount AS signed_amount, e.created_at AS created_at
    FROM expenses e
    JOIN expense_categories ec ON ec.id=e.category_id
    UNION ALL
    SELECT 'withdrawal' AS source, w.id AS source_id, substr(w.created_at,1,10) AS date,
      CASE w.kind WHEN 'capital_return' THEN 'Devolución de capital' ELSE 'Dividendo' END AS type,
      CASE w.kind WHEN 'capital_return' THEN 'Retiro' ELSE 'Dividendo' END AS clase,
      w.partner_name AS person, COALESCE(w.paid_from_account,'Dinero Cafetier') AS account,
      COALESCE(w.notes,'') AS detail,
      w.amount AS amount, -w.amount AS signed_amount, w.created_at AS created_at
    FROM withdrawals w
  `).map(r => ({
    ...r,
    id: `${r.source}:${r.source_id}`,
    amount: r2(Number(r.amount || 0)),
    signed_amount: r2(Number(r.signed_amount || 0)),
    editable: true,
    deletable: true,
  }));
  return rows
    .filter(r => (!start || r.date >= start) && (!end || r.date <= end))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.created_at).localeCompare(String(b.created_at)));
}
function setIsoDate(current: string | null | undefined, date: string) {
  const suffix = current && String(current).includes("T") ? String(current).slice(10) : "T12:00:00.000Z";
  return `${date}${suffix}`;
}

const UPLOAD_DIR = process.env.UPLOAD_PATH || "/data/uploads";
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

api.onError((err, c) => { console.error(err); return c.json(fail(err.message || "Error interno"), 500); });

// ===== PUBLIC SITE CONTENT =====
api.get("/site-content/:page", c => {
  const page = String(c.req.param("page") || "").toLowerCase();
  req(/^[a-z0-9_-]+$/.test(page), "Pagina invalida");
  const row = qGet<{ content_json: string; updated_at: string }>("SELECT content_json,updated_at FROM site_content WHERE page=?", page);
  if (!row) return c.json(ok(null));
  return c.json(ok({ content: JSON.parse(row.content_json), updated_at: row.updated_at }));
});

api.put("/site-content/:page", async c => {
  const page = String(c.req.param("page") || "").toLowerCase();
  req(/^[a-z0-9_-]+$/.test(page), "Pagina invalida");
  const b = await body<any>(c);
  const content = b.content ?? b;
  req(content && typeof content === "object" && !Array.isArray(content), "Contenido invalido");
  const json = JSON.stringify(content);
  req(json.length <= 300_000, "El contenido es demasiado grande");
  const updatedAt = now();
  qRun(`
    INSERT INTO site_content(page,content_json,updated_at) VALUES (?,?,?)
    ON CONFLICT(page) DO UPDATE SET content_json=excluded.content_json,updated_at=excluded.updated_at
  `, page, json, updatedAt);
  return c.json(ok({ content, updated_at: updatedAt }));
});

api.post("/site-media", async c => {
  const form = await c.req.parseBody();
  const file = form.file;
  req(file instanceof File, "Selecciona una imagen");
  const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);
  req(allowedTypes.has(file.type), "Usa una imagen PNG, JPEG, WebP, GIF o AVIF");
  req(file.size > 0 && file.size <= 8 * 1024 * 1024, "La imagen debe pesar menos de 8 MB");
  const data = new Uint8Array(await file.arrayBuffer());
  const inserted = qRun("INSERT INTO site_media(file_name,mime_type,data,created_at) VALUES (?,?,?,?)", file.name || "imagen", file.type, data, now());
  const id = Number(inserted.lastInsertRowid);
  return c.json(ok({ id, url: `/api/site-media/${id}`, file_name: file.name, mime_type: file.type }));
});

api.get("/site-media/:id", c => {
  const row = qGet<{ file_name: string; mime_type: string; data: Uint8Array }>("SELECT file_name,mime_type,data FROM site_media WHERE id=?", Number(c.req.param("id")));
  if (!row) return c.json(fail("Imagen no encontrada"), 404);
  return new Response(row.data, {
    headers: {
      "Content-Type": row.mime_type,
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Disposition": `inline; filename="${row.file_name.replace(/[\r\n\"]/g, "")}"`,
    },
  });
});

// ===== MASTER DATA =====
api.get("/master-data", c => {
  const partners = qAll("SELECT * FROM partners ORDER BY id");
  const clients = qAll("SELECT * FROM clients WHERE active=1 ORDER BY name");
  const products = qAll("SELECT p.*, o.name AS origin_name, v.name AS variety_name, rp.name AS roast_name FROM products p LEFT JOIN origins o ON o.id=p.origin_id LEFT JOIN varieties v ON v.id=p.variety_id LEFT JOIN roast_profiles rp ON rp.id=p.roast_profile_id WHERE p.active=1 ORDER BY p.name");
  const origins = qAll("SELECT * FROM origins WHERE active=1 ORDER BY name");
  const varieties = qAll("SELECT * FROM varieties WHERE active=1 ORDER BY name");
  const roastProfiles = qAll("SELECT * FROM roast_profiles WHERE active=1 ORDER BY name");
  const expenseCategories = qAll("SELECT * FROM expense_categories WHERE active=1 ORDER BY name");
  const suppliers = qAll("SELECT * FROM suppliers WHERE active=1 ORDER BY name");
  const carriers = qAll("SELECT * FROM carriers WHERE active=1 ORDER BY name");
  const inventoryCatalog = qAll("SELECT * FROM inventory_catalog WHERE active=1 ORDER BY category, name");
  return c.json(ok({ partners, clients, products, origins, varieties, roastProfiles, expenseCategories, suppliers, carriers, inventoryCatalog, settings: getSettings() }));
});

// ===== DASHBOARD (Resumen General) =====
api.get("/dashboard", c => {
  // Default view is all-time (no month). A month filters the period figures.
  const monthParam = c.req.query("month") || null;
  const month = monthParam || thisMonth();
  const f = finance();
  const position = financialPosition(month);
  const inv = { verde: invTotal("green_coffee"), tostado: invTotal("roasted_coffee"), empaquetado: invTotal("packaged_coffee") };
  // Period figures: filtered by month when given, otherwise totalled from the beginning.
  const mc = monthParam ? " WHERE substr(created_at,1,7)=?" : "";
  const me = monthParam ? " WHERE substr(expense_date,1,7)=?" : "";
  const mr = monthParam ? " WHERE substr(rs.session_date,1,7)=?" : "";
  const arg = monthParam ? [monthParam] : [];
  const rev = Number(qVal(`SELECT COALESCE(SUM(amount),0) AS v FROM sales_payments${mc}`, ...arg) ?? 0);
  const exp = Number(qVal(`SELECT COALESCE(SUM(amount),0) AS v FROM expenses${me}`, ...arg) ?? 0);
  const roasted = Number(qVal(`SELECT COALESCE(SUM(rb.roasted_kg),0) AS v FROM roasting_batches rb JOIN roasting_sessions rs ON rs.id=rb.session_id${mr}`, ...arg) ?? 0);
  const shipped = Number(qVal(`SELECT COALESCE(SUM(weight_kg),0) AS v FROM sales_shipments${mc}`, ...arg) ?? 0);
  const avgLoss = Number(qVal(`SELECT COALESCE(AVG(rb.loss_pct),0) AS v FROM roasting_batches rb JOIN roasting_sessions rs ON rs.id=rb.session_id${mr ? mr + " AND" : " WHERE"} rb.loss_pct IS NOT NULL`, ...arg) ?? 0);
  const periodProfit = r2(rev - exp);
  const period = {
    isAllTime: !monthParam,
    month: monthParam,
    rev: r2(rev), exp: r2(exp), profit: periodProfit,
    roasted: r2(roasted), shipped: r2(shipped), avgLoss: r2(avgLoss),
    profitPerRoastedKg: roasted > 0 ? r2(periodProfit / roasted) : 0,
  };
  // Per-partner equity: total business cash = (capital owed back to each) + (50/50 of the rest).
  const pcaps = partnerCapital();
  const totalUnrecovered = r2(pcaps.reduce((s: number, p: any) => s + Number(p.unrecovered || 0), 0));
  const equityPool = r2(f.cash - totalUnrecovered);
  const partnersEquity = pcaps.map((p: any) => {
    const dividend = r2((equityPool * Number(p.share_pct || 0)) / 100);
    return { ...p, dividend_share: dividend, belongs: r2(Number(p.unrecovered || 0) + dividend) };
  });
  const cafetierBalance = r2(Number(position.accounts["Dinero Cafetier"] || 0));
  const openSales = Number(qVal("SELECT COUNT(*) AS v FROM sales_orders WHERE status NOT IN ('completado','cancelado')") ?? 0);
  const pendingPO = Number(qVal("SELECT COUNT(*) AS v FROM purchase_orders WHERE status IN ('sin_fondos','pendiente','parcial')") ?? 0);
  const partners = position.partners.map((p: any) => ({ ...p, div_available: p.dividends_available }));
  const lastSales = qAll("SELECT so.*, c.name AS client_name, COALESCE((SELECT SUM(amount) FROM sales_payments WHERE order_id=so.id),0) AS paid_amount, COALESCE((SELECT SUM(weight_kg) FROM sales_shipments WHERE order_id=so.id),0) AS shipped_kg FROM sales_orders so LEFT JOIN clients c ON c.id=so.client_id ORDER BY so.id DESC LIMIT 8");
  const lastPO = qAll<any>("SELECT * FROM purchase_orders ORDER BY id DESC LIMIT 8").map(purchaseOrderView);
  const openCapitalRequests = Number(qVal("SELECT COUNT(*) AS v FROM capital_requests WHERE status IN ('open','partially_funded')") ?? 0);
  return c.json(ok({
    month,
    period,
    finance: f,
    inv,
    inventory: { green: inv.verde, roasted: inv.tostado, packaged: inv.empaquetado, supplies: position.inventory.supplies },
    estimatedLossPct: estimatedLoss(),
    openSales,
    pendingPO,
    pendingPurchaseOrders: pendingPO,
    openCapitalRequests,
    partners,
    partnerBreakdown: partners,
    partnersEquity,
    equityPool,
    totalUnrecovered,
    cafetierBalance,
    accounts: position.accounts,
    receivables: position.receivables,
    dividendAdvice: position.dividendAdvice,
    lastSales,
    lastPO,
    lastPurchaseOrders: lastPO,
  }));
});

// ===== LIBRO DE CAJA =====
api.get("/libro-caja", c => {
  const month = c.req.query("month") || thisMonth();
  const ingresos = qAll("SELECT cc.id, cc.contribution_date AS fecha, 'Aporte de capital' AS tipo, cc.partner_name AS quien, cc.description AS detalle, cc.amount AS monto FROM capital_contributions cc WHERE substr(cc.contribution_date,1,7)=? UNION ALL SELECT sp.id+100000, substr(sp.created_at,1,10) AS fecha, 'Cobro de venta' AS tipo, COALESCE(sp.registered_by,'Sistema') AS quien, 'Pago pedido #'||sp.order_id AS detalle, sp.amount AS monto FROM sales_payments sp WHERE substr(sp.created_at,1,7)=? ORDER BY fecha", month, month);
  const egresos = qAll("SELECT e.id, e.expense_date AS fecha, ec.name AS tipo, e.paid_by AS quien, COALESCE(e.description,'') AS detalle, e.amount AS monto FROM expenses e JOIN expense_categories ec ON ec.id=e.category_id WHERE substr(e.expense_date,1,7)=? UNION ALL SELECT w.id+200000, substr(w.created_at,1,10) AS fecha, CASE w.kind WHEN 'capital_return' THEN 'Retorno de capital' ELSE 'Dividendo' END AS tipo, w.partner_name AS quien, COALESCE(w.notes,'') AS detalle, w.amount AS monto FROM withdrawals w WHERE substr(w.created_at,1,7)=? ORDER BY fecha", month, month);
  const f = finance();
  return c.json(ok({ month, ingresos, egresos, saldo: f.cash, total_ingresos: ingresos.reduce((s: number, r: any) => s + r.monto, 0), total_egresos: egresos.reduce((s: number, r: any) => s + r.monto, 0) }));
});

api.get("/cashbook", c => {
  const month = c.req.query("month");
  const start = c.req.query("start") || (month ? `${month}-01` : null);
  const end = c.req.query("end") || (month ? `${month}-31` : null);
  const movements = cashbookRows(start, end);
  return c.json(ok({
    start,
    end,
    movements,
    total_in: r2(movements.filter(m => m.signed_amount > 0).reduce((s, m) => s + m.signed_amount, 0)),
    total_out: r2(Math.abs(movements.filter(m => m.signed_amount < 0).reduce((s, m) => s + m.signed_amount, 0))),
    net: r2(movements.reduce((s, m) => s + m.signed_amount, 0)),
  }));
});

api.put("/cashbook/:source/:id", async c => {
  const source = c.req.param("source");
  const id = Number(c.req.param("id"));
  const b = await body(c);
  const amount = r2(num(b.amount));
  req(amount > 0, "Monto inválido");
  if (source === "capital_contribution") {
    req(b.person || b.partner_name, "Socio obligatorio");
    qRun("UPDATE capital_contributions SET partner_name=?,amount=?,description=?,contribution_date=?,received_account=? WHERE id=?", normPartner(b.person || b.partner_name), amount, b.detail || b.description || "", b.date || today(), normAccount(b.account || b.received_account || b.person), id);
  } else if (source === "sales_payment") {
    const cur = qGet<any>("SELECT * FROM sales_payments WHERE id=?", id);
    req(cur, "Pago no encontrado");
    qRun("UPDATE sales_payments SET amount=?,method=?,notes=?,registered_by=?,received_account=?,created_at=? WHERE id=?", amount, b.method || cur.method || "transferencia", b.detail || b.notes || null, b.person || cur.registered_by || "Sistema", normAccount(b.account || cur.received_account || "Axel"), setIsoDate(cur.created_at, b.date || today()), id);
    recalcSO(Number(cur.order_id));
  } else if (source === "expense") {
    const cur = qGet<any>("SELECT * FROM expenses WHERE id=?", id);
    req(cur, "Gasto no encontrado");
    qRun("UPDATE expenses SET expense_date=?,category_id=?,amount=?,description=?,paid_by=?,supplier=?,notes=?,paid_from_account=? WHERE id=?", b.date || today(), b.category_id || cur.category_id, amount, b.detail || b.description || null, b.person || cur.paid_by || "Sistema", b.supplier || cur.supplier || null, b.notes || cur.notes || null, normAccount(b.account || cur.paid_from_account || cur.paid_by), id);
  } else if (source === "withdrawal") {
    const cur = qGet<any>("SELECT * FROM withdrawals WHERE id=?", id);
    req(cur, "Retiro no encontrado");
    qRun("UPDATE withdrawals SET partner_name=?,amount=?,month=?,paid_from_account=?,notes=?,created_at=? WHERE id=?", normPartner(b.person || cur.partner_name), amount, (b.date || today()).slice(0, 7), normAccount(b.account || cur.paid_from_account || "Axel"), b.detail || b.notes || null, setIsoDate(cur.created_at, b.date || today()), id);
  } else {
    return c.json(fail("Movimiento inválido"), 400);
  }
  return c.json(ok(true));
});

api.delete("/cashbook/:source/:id", c => {
  const source = c.req.param("source");
  const id = Number(c.req.param("id"));
  if (source === "capital_contribution") qRun("DELETE FROM capital_contributions WHERE id=?", id);
  else if (source === "sales_payment") {
    const cur = qGet<any>("SELECT * FROM sales_payments WHERE id=?", id);
    qRun("DELETE FROM sales_payments WHERE id=?", id);
    if (cur?.order_id) recalcSO(Number(cur.order_id));
  } else if (source === "expense") deleteExpenseWithMirror(id);
  else if (source === "withdrawal") qRun("DELETE FROM withdrawals WHERE id=?", id);
  else return c.json(fail("Movimiento inválido"), 400);
  return c.json(ok(true));
});

// ===== SETTINGS =====
api.get("/settings", c => c.json(ok(getSettings())));
api.put("/settings", async c => { const b = await body(c); for (const [k, v] of Object.entries(b)) qRun("INSERT OR REPLACE INTO settings(key,value) VALUES (?,?)", k, String(v)); return c.json(ok(getSettings())); });

// ===== CATALOGS =====
for (const table of ["roast_profiles", "origins", "varieties", "expense_categories", "carriers"]) {
  api.get(`/${table}`, c => c.json(ok(qAll(`SELECT * FROM ${table} WHERE active=1 ORDER BY name`))));
  api.post(`/${table}`, async c => {
    const b = await body(c); req(b.name, "Nombre obligatorio");
    try {
      const r = table === "expense_categories" ? qRun(`INSERT INTO ${table}(name,is_direct_cost,active) VALUES (?,?,1)`, b.name, num(b.is_direct_cost)) : qRun(`INSERT INTO ${table}(name,active) VALUES (?,1)`, b.name);
      return c.json(ok(qGet(`SELECT * FROM ${table} WHERE id=?`, Number(r.lastInsertRowid))));
    } catch (e: any) { if (e.message?.includes("UNIQUE")) return c.json(fail("Ya existe")); throw e; }
  });
  api.put(`/${table}/:id`, async c => { const b = await body(c); qRun(`UPDATE ${table} SET name=? WHERE id=?`, b.name, c.req.param("id")); return c.json(ok(true)); });
  api.delete(`/${table}/:id`, c => { qRun(`UPDATE ${table} SET active=0 WHERE id=?`, c.req.param("id")); return c.json(ok(true)); });
}

// Suppliers carry contact details (contacto, teléfono, email, dirección, notas) and are fully editable.
api.get("/suppliers", c => c.json(ok(qAll("SELECT * FROM suppliers WHERE active=1 ORDER BY name"))));
api.post("/suppliers", async c => {
  const b = await body(c); req(b.name, "Nombre obligatorio");
  try {
    const r = qRun("INSERT INTO suppliers(name,contact_name,phone,email,address,notes,active) VALUES (?,?,?,?,?,?,1)", b.name, b.contact_name || null, b.phone || null, b.email || null, b.address || null, b.notes || null);
    return c.json(ok(qGet("SELECT * FROM suppliers WHERE id=?", Number(r.lastInsertRowid))));
  } catch (e: any) { if (e.message?.includes("UNIQUE")) return c.json(fail("Ya existe un proveedor con ese nombre")); throw e; }
});
api.put("/suppliers/:id", async c => {
  const b = await body(c); req(b.name, "Nombre obligatorio");
  try {
    qRun("UPDATE suppliers SET name=?,contact_name=?,phone=?,email=?,address=?,notes=? WHERE id=?", b.name, b.contact_name || null, b.phone || null, b.email || null, b.address || null, b.notes || null, c.req.param("id"));
    return c.json(ok(qGet("SELECT * FROM suppliers WHERE id=?", c.req.param("id"))));
  } catch (e: any) { if (e.message?.includes("UNIQUE")) return c.json(fail("Ya existe un proveedor con ese nombre")); throw e; }
});
api.delete("/suppliers/:id", c => { qRun("UPDATE suppliers SET active=0 WHERE id=?", c.req.param("id")); return c.json(ok(true)); });

// ===== CLIENTS =====
api.get("/clients", c => c.json(ok(qAll("SELECT * FROM clients WHERE active=1 ORDER BY name"))));
api.post("/clients", async c => {
  const b = await body(c);
  req(b.name, "Nombre obligatorio");
  const r = qRun(
    "INSERT INTO clients(name,cafe_name,contact_name,phone,contact_phone,email,address,neighborhood,municipality,city,state,country,postal_code,address_reference,notes,active,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?)",
    b.name,
    b.cafe_name || null,
    b.contact_name || null,
    b.phone || null,
    b.contact_phone || null,
    b.email || null,
    b.address || null,
    b.neighborhood || b.colonia || null,
    b.municipality || b.alcaldia || null,
    b.city || null,
    b.state || null,
    b.country || "México",
    b.postal_code || null,
    b.address_reference || null,
    b.notes || null,
    now()
  );
  return c.json(ok(qGet("SELECT * FROM clients WHERE id=?", Number(r.lastInsertRowid))));
});
api.put("/clients/:id", async c => {
  const b = await body(c);
  req(b.name, "Nombre obligatorio");
  qRun(
    "UPDATE clients SET name=?,cafe_name=?,contact_name=?,phone=?,contact_phone=?,email=?,address=?,neighborhood=?,municipality=?,city=?,state=?,country=?,postal_code=?,address_reference=?,notes=? WHERE id=?",
    b.name,
    b.cafe_name || null,
    b.contact_name || null,
    b.phone || null,
    b.contact_phone || null,
    b.email || null,
    b.address || null,
    b.neighborhood || b.colonia || null,
    b.municipality || b.alcaldia || null,
    b.city || null,
    b.state || null,
    b.country || "México",
    b.postal_code || null,
    b.address_reference || null,
    b.notes || null,
    c.req.param("id")
  );
  return c.json(ok(qGet("SELECT * FROM clients WHERE id=?", c.req.param("id"))));
});
api.delete("/clients/:id", c => { qRun("UPDATE clients SET active=0 WHERE id=?", c.req.param("id")); return c.json(ok(true)); });

// ===== PRODUCTS =====
api.get("/products", c => c.json(ok(qAll("SELECT p.*, o.name AS origin_name, v.name AS variety_name, rp.name AS roast_name FROM products p LEFT JOIN origins o ON o.id=p.origin_id LEFT JOIN varieties v ON v.id=p.variety_id LEFT JOIN roast_profiles rp ON rp.id=p.roast_profile_id WHERE p.active=1 ORDER BY p.name"))));
api.post("/products", async c => { const b = await body(c); req(b.name, "Nombre obligatorio"); const r = qRun("INSERT INTO products(name,origin_id,variety_id,roast_profile_id,presentation,unit_weight_kg,price,active) VALUES (?,?,?,?,?,?,?,1)", b.name, b.origin_id||null, b.variety_id||null, b.roast_profile_id||null, b.presentation||null, num(b.unit_weight_kg,1), num(b.price)); return c.json(ok(qGet("SELECT * FROM products WHERE id=?", Number(r.lastInsertRowid)))); });
api.put("/products/:id", async c => { const b = await body(c); qRun("UPDATE products SET name=?,origin_id=?,variety_id=?,roast_profile_id=?,presentation=?,unit_weight_kg=?,price=? WHERE id=?", b.name, b.origin_id||null, b.variety_id||null, b.roast_profile_id||null, b.presentation||null, num(b.unit_weight_kg,1), num(b.price), c.req.param("id")); return c.json(ok(true)); });
api.delete("/products/:id", c => { qRun("UPDATE products SET active=0 WHERE id=?", c.req.param("id")); return c.json(ok(true)); });

// ===== INVENTORY CATALOG (items definidos) =====
function catalogTypeFromCategory(category: string, fallback?: string) {
  const c = String(category || "").trim().toLowerCase();
  if (c === "café verde" || c === "cafe verde") return "green_coffee";
  if (c === "café tostado" || c === "cafe tostado") return "roasted_coffee";
  if (c === "café empaquetado" || c === "cafe empaquetado") return "packaged_coffee";
  return normInvType(fallback || "supply");
}
api.get("/inventory-catalog", c => c.json(ok(qAll("SELECT * FROM inventory_catalog WHERE active=1 ORDER BY category, name"))));
api.post("/inventory-catalog", async c => {
  const b = await body(c); req(b.name, "Nombre obligatorio");
  const itemType = catalogTypeFromCategory(b.category, b.item_type);
  try {
    const r = qRun("INSERT INTO inventory_catalog(name,item_type,category,unit,supplier,min_stock,active) VALUES (?,?,?,?,?,?,1)", b.name, itemType, b.category || null, b.unit || "kg", b.supplier || null, num(b.min_stock));
    return c.json(ok(qGet("SELECT * FROM inventory_catalog WHERE id=?", Number(r.lastInsertRowid))));
  } catch (e: any) { if (e.message?.includes("UNIQUE")) return c.json(fail("Ya existe un ítem con ese nombre")); throw e; }
});
api.put("/inventory-catalog/:id", async c => { const b = await body(c); qRun("UPDATE inventory_catalog SET name=?,item_type=?,category=?,unit=?,supplier=?,min_stock=? WHERE id=?", b.name, catalogTypeFromCategory(b.category, b.item_type), b.category || null, b.unit || "kg", b.supplier || null, num(b.min_stock), c.req.param("id")); return c.json(ok(true)); });
api.delete("/inventory-catalog/:id", c => { qRun("UPDATE inventory_catalog SET active=0 WHERE id=?", c.req.param("id")); return c.json(ok(true)); });

// ===== INVENTORY =====
api.get("/inventory", c => c.json(ok(qAll("SELECT i.*, o.name AS origin_name, v.name AS variety_name FROM inventory_items i LEFT JOIN origins o ON o.id=i.origin_id LEFT JOIN varieties v ON v.id=i.variety_id ORDER BY i.item_type, i.item_name"))));
api.get("/inventory/green", c => c.json(ok(qAll("SELECT i.*, o.name AS origin_name, v.name AS variety_name FROM inventory_items i LEFT JOIN origins o ON o.id=i.origin_id LEFT JOIN varieties v ON v.id=i.variety_id WHERE i.item_type='green_coffee' AND i.quantity>0 ORDER BY i.item_name"))));
api.get("/inventory/summary", c => c.json(ok({ verde: invTotal("green_coffee"), tostado: invTotal("roasted_coffee"), empaquetado: invTotal("packaged_coffee"), estimatedLossPct: estimatedLoss(), finance: finance() })));
api.post("/inventory", async c => {
  const b = await body(c); req(b.item_name, "Nombre obligatorio");
  const cat = qGet<any>("SELECT * FROM inventory_catalog WHERE active=1 AND name=?", b.item_name);
  req(cat, "Ese ítem no está definido. Creálo primero en Configuración → Items del inventario.");
  const r = qRun("INSERT INTO inventory_items(item_type,item_name,quantity,unit,min_stock,origin_id,variety_id,lot_label) VALUES (?,?,?,?,?,?,?,?)", cat.item_type, cat.name, num(b.quantity), b.unit || cat.unit || "kg", num(b.min_stock ?? cat.min_stock), b.origin_id||null, b.variety_id||null, b.lot_label||null);
  return c.json(ok(qGet("SELECT * FROM inventory_items WHERE id=?", Number(r.lastInsertRowid))));
});
api.put("/inventory/:id", async c => { const b = await body(c); qRun("UPDATE inventory_items SET item_name=?,quantity=?,unit=?,min_stock=?,origin_id=?,variety_id=?,lot_label=? WHERE id=?", b.item_name, num(b.quantity), b.unit||"kg", num(b.min_stock), b.origin_id||null, b.variety_id||null, b.lot_label||null, c.req.param("id")); return c.json(ok(true)); });
api.post("/inventory/:id/movements", async c => { const b = await body(c); req(["in","out","adjust"].includes(b.direction), "Dirección inválida"); const m = tx(() => { invMove(Number(c.req.param("id")), b.direction, num(b.quantity), b.reason || "Manual", b.registered_by); }); m(); return c.json(ok(true)); });
api.get("/inventory/:id/movements", c => c.json(ok(qAll("SELECT * FROM inventory_movements WHERE item_id=? ORDER BY id DESC", c.req.param("id")))));
// Global movements ledger for the whole warehouse, ordered by date (oldest first).
api.get("/inventory-movements", c => c.json(ok(qAll("SELECT m.*, i.item_name, i.item_type, i.unit FROM inventory_movements m JOIN inventory_items i ON i.id=m.item_id ORDER BY m.created_at ASC, m.id ASC"))));
api.delete("/inventory/:id", c => {
  const id = Number(c.req.param("id"));
  const inBatches = Number(qVal("SELECT COUNT(*) AS v FROM roasting_batches WHERE green_inventory_item_id=?", id) ?? 0);
  const inEntries = Number(qVal("SELECT COUNT(*) AS v FROM purchase_entries WHERE inventory_item_id=?", id) ?? 0);
  if (inBatches > 0 || inEntries > 0) return c.json(fail("No se puede eliminar: este ítem tiene historial de tostado o de compras. Ajustá su cantidad a 0 con un movimiento."), 400);
  qRun("DELETE FROM inventory_items WHERE id=?", id); // movements cascade
  return c.json(ok(true));
});

// ===== SALES ORDERS =====
api.get("/sales-orders", c => c.json(ok(qAll("SELECT so.*, c.name AS client_name, COALESCE((SELECT SUM(amount) FROM sales_payments WHERE order_id=so.id),0) AS paid, COALESCE((SELECT SUM(amount) FROM sales_payments WHERE order_id=so.id),0) AS paid_amount, COALESCE((SELECT SUM(weight_kg) FROM sales_shipments WHERE order_id=so.id),0) AS shipped, COALESCE((SELECT SUM(weight_kg) FROM sales_shipments WHERE order_id=so.id),0) AS shipped_kg FROM sales_orders so LEFT JOIN clients c ON c.id=so.client_id ORDER BY so.created_at ASC, so.id ASC"))));

api.get("/sales-orders/:id", c => {
  const id = Number(c.req.param("id"));
  const order = qGet("SELECT so.*, c.name AS client_name FROM sales_orders so LEFT JOIN clients c ON c.id=so.client_id WHERE so.id=?", id);
  if (!order) return c.json(fail("No encontrado"), 404);
  return c.json(ok({
    order,
    items: qAll("SELECT * FROM sales_order_items WHERE order_id=? ORDER BY id", id),
    payments: qAll("SELECT * FROM sales_payments WHERE order_id=? ORDER BY id DESC", id),
    shipments: qAll<any>("SELECT * FROM sales_shipments WHERE order_id=? ORDER BY id DESC", id).map(s => ({ ...s, packaging: qAll("SELECT * FROM sales_shipment_packaging WHERE shipment_id=? ORDER BY id", s.id) })),
    purchaseOrders: qAll("SELECT * FROM purchase_orders WHERE source_type='sales_order' AND source_id=? ORDER BY id DESC", id),
    batches: qAll("SELECT rb.*, rs.session_date, rp.name AS roast_name FROM roasting_batches rb JOIN roasting_sessions rs ON rs.id=rb.session_id LEFT JOIN roast_profiles rp ON rp.id=rb.roast_profile_id WHERE rb.sales_order_id=? ORDER BY rb.id DESC", id),
  }));
});

api.post("/sales-orders", async c => {
  const b = await body(c);
  const rawType = b.order_type || "mostrador";
  const type = rawType === "retail" ? "mostrador" : rawType === "wholesale" ? "mayoreo" : rawType;
  req(["mostrador", "mayoreo"].includes(type), "Tipo inválido");
  const items = Array.isArray(b.items) ? b.items : [];

  const create = tx(() => {
    const orderNo = docNo(type === "mostrador" ? "POS" : "VTA");
    let totalKg = num(b.total_weight_kg);
    let totalAmount = num(b.total_amount);
    let ppk = num(b.price_per_kg);

    if (type === "mostrador") {
      totalKg = 0; totalAmount = 0;
      for (const i of items) { totalKg += num(i.quantity) * num(i.unit_weight_kg); totalAmount += num(i.quantity) * num(i.unit_price); }
      totalKg = r2(totalKg); totalAmount = r2(totalAmount);
      ppk = totalKg > 0 ? r2(totalAmount / totalKg) : 0;
    } else if (items.length) {
      // Wholesale by product lines: kg and total come from the lines (price editable per line).
      totalKg = 0; totalAmount = 0;
      for (const i of items) { totalKg += num(i.quantity) * num(i.unit_weight_kg); totalAmount += num(i.quantity) * num(i.unit_price); }
      totalKg = r2(totalKg); totalAmount = r2(totalAmount);
      ppk = totalKg > 0 ? r2(totalAmount / totalKg) : num(b.price_per_kg);
    } else {
      totalAmount = totalAmount || r2(totalKg * ppk);
    }

    const res = qRun("INSERT INTO sales_orders(order_no,order_type,client_id,status,delivery_date,total_weight_kg,price_per_kg,total_amount,notes,created_at,updated_at) VALUES (?,?,?,'abierto',?,?,?,?,?,?,?)", orderNo, type, b.client_id||null, b.delivery_date||null, r2(totalKg), r2(ppk), r2(totalAmount), b.notes||null, now(), now());
    const orderId = Number(res.lastInsertRowid);

    for (const i of items) {
      qRun("INSERT INTO sales_order_items(order_id,product_id,description,presentation,quantity,unit,unit_weight_kg,unit_price,subtotal) VALUES (?,?,?,?,?,?,?,?,?)", orderId, i.product_id||null, i.description||i.name||"Producto", i.presentation||null, num(i.quantity), i.unit||"pz", num(i.unit_weight_kg), num(i.unit_price), r2(num(i.quantity)*num(i.unit_price)));
    }

    // Retail: pay + deduct inventory
    if (type === "mostrador" && totalAmount > 0) {
      qRun("INSERT INTO sales_payments(order_id,amount,method,notes,registered_by,received_account,created_at) VALUES (?,?,?,?,?,?,?)", orderId, totalAmount, b.payment_method||"efectivo", "Venta mostrador", b.registered_by||"Sistema", normAccount(b.received_account || "Axel"), now());
      const ri = qGet<{ id: number }>("SELECT id FROM inventory_items WHERE item_type='roasted_coffee' ORDER BY id LIMIT 1");
      if (ri && totalKg > 0) invMove(ri.id, "out", totalKg, `Venta ${orderNo}`, b.registered_by||"Sistema");
    }

    // Wholesale: check green stock
    if (type === "mayoreo" && totalKg > 0) {
      const needGreen = greenNeededForRoasted(totalKg);
      const greenAvail = invTotal("green_coffee");
      const deficit = r2(Math.max(0, needGreen - greenAvail));
      if (deficit > 0) {
        createPO({ sourceType: "sales_order", sourceId: orderId, description: `Café verde para ${orderNo} (merma ${estimatedLoss()}%)`, requestedKg: deficit, estimatedCost: r2(deficit * getNum("default_green_cost_per_kg", 0)) });
      }
    }

    recalcSO(orderId);
    return qGet("SELECT * FROM sales_orders WHERE id=?", orderId);
  });
  return c.json(ok(create()));
});

api.put("/sales-orders/:id", async c => { const b = await body(c); qRun("UPDATE sales_orders SET client_id=?,delivery_date=?,total_weight_kg=?,price_per_kg=?,total_amount=?,notes=?,updated_at=? WHERE id=?", b.client_id||null, b.delivery_date||null, num(b.total_weight_kg), num(b.price_per_kg), num(b.total_amount), b.notes||null, now(), c.req.param("id")); return c.json(ok(recalcSO(Number(c.req.param("id"))))); });
api.patch("/sales-orders/:id/status", async c => { const b = await body(c); qRun("UPDATE sales_orders SET status=?,updated_at=? WHERE id=?", b.status, now(), c.req.param("id")); return c.json(ok(true)); });
api.delete("/sales-orders/:id", c => {
  const id = Number(c.req.param("id"));
  const order = qGet<any>("SELECT * FROM sales_orders WHERE id=?", id);
  if (!order) return c.json(ok(true));
  const del = tx(() => {
    const ri = qGet<{ id: number }>("SELECT id FROM inventory_items WHERE item_type='roasted_coffee' ORDER BY id LIMIT 1");
    // Reverse shipments: restore roasted stock and remove the shipping expense each one generated.
    for (const s of qAll<any>("SELECT * FROM sales_shipments WHERE order_id=?", id)) {
      if (ri?.id && Number(s.weight_kg) > 0) invMove(ri.id, "in", Number(s.weight_kg), `Reverso envío (borrado ${order.order_no})`, "Sistema");
      reverseShipmentPackaging(Number(s.id), "Sistema");
      if (s.expense_id) deleteExpenseAndMirrorRows(Number(s.expense_id));
    }
    // Reverse the roasted stock a counter sale deducted on creation.
    if (order.order_type === "mostrador" && ri?.id && Number(order.total_weight_kg) > 0) {
      invMove(ri.id, "in", Number(order.total_weight_kg), `Reverso venta mostrador ${order.order_no}`, "Sistema");
    }
    // Keep production and purchasing history, just detach it from the deleted order.
    qRun("UPDATE roasting_batches SET sales_order_id=NULL WHERE sales_order_id=?", id);
    qRun("UPDATE purchase_orders SET source_type='manual', source_id=NULL WHERE source_type='sales_order' AND source_id=?", id);
    // Items, payments and shipments cascade with the order.
    qRun("DELETE FROM sales_orders WHERE id=?", id);
  });
  del();
  return c.json(ok(true));
});

// Payments
api.post("/sales-orders/:id/payments", async c => {
  const b = await body(c);
  req(num(b.amount)>0, "Monto inválido");
  const paymentDate = b.payment_date || b.date || today();
  qRun("INSERT INTO sales_payments(order_id,amount,method,notes,registered_by,received_account,created_at) VALUES (?,?,?,?,?,?,?)", c.req.param("id"), r2(num(b.amount)), b.method||"transferencia", b.notes||null, b.registered_by||"Sistema", normAccount(b.received_account || "Axel"), setIsoDate(now(), paymentDate));
  recalcSO(Number(c.req.param("id")));
  return c.json(ok(true));
});
api.put("/sales-payments/:id", async c => {
  const id = Number(c.req.param("id"));
  const cur = qGet<any>("SELECT * FROM sales_payments WHERE id=?", id);
  req(cur, "Pago no encontrado");
  const b = await body(c);
  const amount = r2(num(b.amount ?? cur.amount));
  req(amount > 0, "Monto inválido");
  const paymentDate = b.payment_date || b.date || String(cur.created_at || today()).slice(0, 10);
  qRun("UPDATE sales_payments SET amount=?,method=?,notes=?,registered_by=?,received_account=?,created_at=? WHERE id=?", amount, b.method || cur.method || "transferencia", b.notes ?? cur.notes ?? null, b.registered_by || cur.registered_by || "Sistema", normAccount(b.received_account || cur.received_account || "Axel"), setIsoDate(cur.created_at, paymentDate), id);
  recalcSO(Number(cur.order_id));
  return c.json(ok(qGet("SELECT * FROM sales_payments WHERE id=?", id)));
});
api.delete("/sales-payments/:id", c => { const p = qGet<any>("SELECT * FROM sales_payments WHERE id=?", c.req.param("id")); if (p) { qRun("DELETE FROM sales_payments WHERE id=?", p.id); recalcSO(p.order_id); } return c.json(ok(true)); });

// Packaging (boxes/bags/supplies) consumed by a shipment. Non-blocking: stock may go negative.
function applyShipmentPackaging(shipmentId: number, orderId: number, lines: any[], by: string, movedAt: string) {
  for (const line of lines || []) {
    const name = String(line?.item_name || "").trim();
    const qty = r2(num(line?.quantity));
    if (!name || qty <= 0) continue;
    const cat = qGet<any>("SELECT * FROM inventory_catalog WHERE active=1 AND name=?", name);
    const itemType = normInvType(cat?.item_type || "supply");
    const unit = line?.unit || cat?.unit || "pz";
    const itemId = ensureInvItem({ item_type: itemType, item_name: name, unit });
    invMove(itemId, "out", qty, `Empaque envío #${orderId}`, by, true, movedAt); // allowNegative
    qRun("INSERT INTO sales_shipment_packaging(shipment_id,item_name,item_type,quantity,unit,created_at) VALUES (?,?,?,?,?,?)", shipmentId, name, itemType, qty, unit, movedAt);
  }
}
function reverseShipmentPackaging(shipmentId: number, by: string, movedAt?: string | null) {
  for (const p of qAll<any>("SELECT * FROM sales_shipment_packaging WHERE shipment_id=?", shipmentId)) {
    const itemId = ensureInvItem({ item_type: normInvType(p.item_type || "supply"), item_name: p.item_name, unit: p.unit || "pz" });
    invMove(itemId, "in", r2(num(p.quantity)), "Reverso empaque envío", by, false, movedAt);
  }
  qRun("DELETE FROM sales_shipment_packaging WHERE shipment_id=?", shipmentId);
}

// Shipments (auto expense)
api.post("/sales-orders/:id/shipments", async c => {
  const orderId = Number(c.req.param("id"));
  const b = await body(c);
  req(num(b.weight_kg) > 0, "Peso invalido");
  const shippingCost = r2(num(b.shipping_cost));
  const shipmentDate = b.shipment_date || b.date || today();
  const shipmentCreatedAt = setIsoDate(now(), shipmentDate);
  const fundingSource = String(b.funding_source || "business_account");
  const partner = normPartner(b.partner_name || b.reimbursable_partner || (fundingSource === "partner_contribution" ? b.paid_from_account : ""));
  const paidFromAccount = normAccount(b.paid_from_account || (fundingSource === "partner_contribution" ? partner : "Dinero Cafetier"));
  const fromCashbox = fundingSource === "partner_contribution" ? 0 : paidFromAccount === "Dinero Cafetier" ? 1 : boolFlag(b.from_cashbox, 1);
  const paidBy = fundingSource === "partner_contribution" ? partner : paidFromAccount;
  if (shippingCost > 0 && fundingSource === "partner_contribution") req(["Itza", "Axel"].includes(partner), "Elegi que socio pago el envio");
  // Sin bloqueo por fondos: la cuenta puede quedar en negativo.

  const send = tx(() => {
    const ri = qGet<{ id: number }>("SELECT id FROM inventory_items WHERE item_type='roasted_coffee' ORDER BY id LIMIT 1");
    req(ri?.id, "No existe inventario de cafe tostado");
    invMove(ri!.id, "out", r2(num(b.weight_kg)), `Envio pedido #${orderId}`, b.registered_by || "Sistema", true, shipmentCreatedAt);
    let expId: number | null = null;
    if (shippingCost > 0) {
      expId = autoExpense("Envios", shippingCost, `Envio pedido #${orderId}`, paidBy || b.registered_by || "Sistema", "shipment", orderId, fromCashbox, 0, paidFromAccount, shipmentDate);
      if (fundingSource === "partner_contribution" && expId) {
        registerDirectFunding(partner, shippingCost, shipmentDate, `Gasto pagado por ${partner}: Envio pedido #${orderId}`, partner, null, "expense", expId);
      }
    }
    const shipRes = qRun("INSERT INTO sales_shipments(order_id,weight_kg,destination_address,carrier,tracking_number,shipping_cost,registered_by,notes,expense_id,funding_source,paid_from_account,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", orderId, r2(num(b.weight_kg)), b.destination_address || null, b.carrier || null, b.tracking_number || null, shippingCost, b.registered_by || "Sistema", b.notes || null, expId, fundingSource, paidFromAccount, shipmentCreatedAt);
    applyShipmentPackaging(Number(shipRes.lastInsertRowid), orderId, b.packaging, b.registered_by || "Sistema", shipmentCreatedAt);
  });
  send();
  return c.json(ok(recalcSO(orderId)));
});
api.put("/sales-shipments/:id", async c => {
  const id = Number(c.req.param("id"));
  const row = qGet<any>("SELECT * FROM sales_shipments WHERE id=?", id);
  req(row, "Envio no encontrado");
  const b = await body(c);
  const weight = r2(num(b.weight_kg ?? row.weight_kg));
  req(weight > 0, "Peso invalido");
  const shippingCost = r2(num(b.shipping_cost ?? row.shipping_cost));
  const shipmentDate = b.shipment_date || b.date || String(row.created_at || today()).slice(0, 10);
  const shipmentCreatedAt = setIsoDate(row.created_at, shipmentDate);
  const fundingSource = String(b.funding_source || row.funding_source || "business_account");
  const partner = normPartner(b.partner_name || b.reimbursable_partner || (fundingSource === "partner_contribution" ? (b.paid_from_account || row.paid_from_account) : ""));
  const paidFromAccount = normAccount(b.paid_from_account || (fundingSource === "partner_contribution" ? partner : row.paid_from_account || "Dinero Cafetier"));
  const fromCashbox = fundingSource === "partner_contribution" ? 0 : paidFromAccount === "Dinero Cafetier" ? 1 : boolFlag(b.from_cashbox, 1);
  const paidBy = fundingSource === "partner_contribution" ? partner : paidFromAccount;
  if (shippingCost > 0 && fundingSource === "partner_contribution") req(["Itza", "Axel"].includes(partner), "Elegi que socio pago el envio");
  // Sin bloqueo por fondos: la cuenta puede quedar en negativo.

  const edit = tx(() => {
    const ri = qGet<{ id: number }>("SELECT id FROM inventory_items WHERE item_type='roasted_coffee' ORDER BY id LIMIT 1");
    req(ri?.id, "No existe inventario de cafe tostado");
    const diff = r2(weight - Number(row.weight_kg || 0));
    if (diff > 0) invMove(ri!.id, "out", diff, `Ajuste envio #${id}`, b.registered_by || row.registered_by || "Sistema", true, shipmentCreatedAt);
    else if (diff < 0) invMove(ri!.id, "in", Math.abs(diff), `Ajuste envio #${id}`, b.registered_by || row.registered_by || "Sistema", false, shipmentCreatedAt);

    let expId: number | null = row.expense_id || null;
    if (shippingCost > 0 && expId) {
      qRun("UPDATE expenses SET expense_date=?,amount=?,description=?,paid_by=?,from_cashbox=?,from_utilities=0,paid_from_account=? WHERE id=?", shipmentDate, shippingCost, `Envio pedido #${row.order_id}`, paidBy || b.registered_by || row.registered_by || "Sistema", fromCashbox, paidFromAccount, expId);
      qRun("DELETE FROM capital_contributions WHERE ref_type='expense' AND ref_id=?", expId);
      if (fundingSource === "partner_contribution") registerDirectFunding(partner, shippingCost, shipmentDate, `Gasto pagado por ${partner}: Envio pedido #${row.order_id}`, partner, null, "expense", expId);
    } else if (shippingCost > 0) {
      expId = autoExpense("Envios", shippingCost, `Envio pedido #${row.order_id}`, paidBy || b.registered_by || row.registered_by || "Sistema", "shipment", row.order_id, fromCashbox, 0, paidFromAccount, shipmentDate);
      if (fundingSource === "partner_contribution" && expId) registerDirectFunding(partner, shippingCost, shipmentDate, `Gasto pagado por ${partner}: Envio pedido #${row.order_id}`, partner, null, "expense", expId);
    } else if (expId) {
      deleteExpenseAndMirrorRows(Number(expId));
      expId = null;
    }

    qRun("UPDATE sales_shipments SET weight_kg=?,destination_address=?,carrier=?,tracking_number=?,shipping_cost=?,registered_by=?,notes=?,expense_id=?,funding_source=?,paid_from_account=?,created_at=? WHERE id=?", weight, b.destination_address ?? row.destination_address ?? null, b.carrier ?? row.carrier ?? null, b.tracking_number ?? row.tracking_number ?? null, shippingCost, b.registered_by || row.registered_by || "Sistema", b.notes ?? row.notes ?? null, expId, fundingSource, paidFromAccount, shipmentCreatedAt, id);
    if (Array.isArray(b.packaging)) {
      reverseShipmentPackaging(id, b.registered_by || row.registered_by || "Sistema", shipmentCreatedAt);
      applyShipmentPackaging(id, Number(row.order_id), b.packaging, b.registered_by || row.registered_by || "Sistema", shipmentCreatedAt);
    }
  });
  edit();
  return c.json(ok(recalcSO(Number(row.order_id))));
});
api.delete("/sales-shipments/:id", c => {
  const row = qGet<any>("SELECT * FROM sales_shipments WHERE id=?", c.req.param("id"));
  if (row) {
    const rev = tx(() => {
      const ri = qGet<{ id: number }>("SELECT id FROM inventory_items WHERE item_type='roasted_coffee' ORDER BY id LIMIT 1");
      if (ri?.id) invMove(ri.id, "in", row.weight_kg, `Reverso envío ${row.id}`, "Sistema");
      reverseShipmentPackaging(Number(row.id), "Sistema");
      if (row.expense_id) deleteExpenseAndMirrorRows(Number(row.expense_id));
      qRun("DELETE FROM sales_shipments WHERE id=?", row.id);
    });
    rev(); recalcSO(row.order_id);
  }
  return c.json(ok(true));
});

// ===== PURCHASE ORDERS =====
api.post("/purchase-orders", async c => {
  const b = await body(c);
  const requestedKg = num(b.requested_kg || b.requested_green_kg);
  req(b.description, "Descripcion obligatoria");
  // Only catalog items can be purchased.
  req(qGet("SELECT id FROM inventory_catalog WHERE active=1 AND name=?", b.description), "Solo podés comprar ítems definidos en Datos maestros → Ítems.");
  req(requestedKg > 0, "Cantidad requerida");
  const purchaseDate = b.purchase_date || b.date || today();
  return c.json(ok(purchaseOrderView(createPO({
    sourceType: "manual",
    description: b.description,
    requestedKg,
    estimatedCost: num(b.estimated_cost),
    estimatedShippingCost: num(b.estimated_shipping_cost),
    supplier: b.supplier || null,
    notes: b.notes || null,
    createdAt: setIsoDate(now(), purchaseDate),
  }))));
});
api.get("/purchase-orders", c => c.json(ok(qAll<any>("SELECT * FROM purchase_orders ORDER BY created_at ASC, id ASC").map(purchaseOrderView))));
api.get("/purchase-orders/:id", c => {
  const id = Number(c.req.param("id"));
  const po = purchaseOrderView(qGet("SELECT * FROM purchase_orders WHERE id=?", id));
  const entries = qAll("SELECT pe.*, i.item_name FROM purchase_entries pe JOIN inventory_items i ON i.id=pe.inventory_item_id WHERE pe.purchase_order_id=? ORDER BY pe.id DESC", id);
  const capitalRequests = qAll("SELECT * FROM capital_requests WHERE notes LIKE ? ORDER BY id DESC", `%${po?.po_no || ""}%`);
  return c.json(ok({ po, purchaseOrder: po, entries, capitalRequests }));
});
api.post("/purchase-orders/:id/receive", async c => {
  const poId = Number(c.req.param("id")); const b = await body(c);
  const po = qGet<any>("SELECT * FROM purchase_orders WHERE id=?", poId);
  const entryDate = b.entry_date || b.purchase_date || b.date || today();
  const entryCreatedAt = setIsoDate(now(), entryDate);
  if (!po) return c.json(fail("No encontrada"), 404);
  req(num(b.quantity_kg)>0, "Cantidad inválida");
  const qty = r2(num(b.quantity_kg));
  const cost = r2(num(b.total_cost));
  const ship = r2(num(b.shipping_cost));
  const landed = r2(cost + ship);
  req(landed > 0, "Costo total inválido");
  const fundingSource = String(b.funding_source || "business_account");
  const partner = normPartner(b.partner_name || b.paid_by || b.paid_from_account || "");
  const paidFromAccount = normAccount(b.paid_from_account || (fundingSource === "partner_contribution" ? partner : "Axel"));
  // Sin bloqueo por fondos: la cuenta puede quedar en negativo.

  const receive = tx(() => {
    if (fundingSource === "partner_contribution") req(["Itza", "Axel"].includes(partner), "Elegí qué socio puso el dinero");
    // Resolve what is being received from the catalog (the PO description is the item).
    const cat = qGet<any>("SELECT * FROM inventory_catalog WHERE active=1 AND name=?", b.item_name || po.description);
    const itemType = cat?.item_type || "green_coffee";
    let itemId: number;
    let lotLabel: string | null = null;
    if (itemType === "green_coffee") {
      lotLabel = b.lot_label || `${entryDate}-${po.po_no}`;
      const itemName = b.item_name && cat ? cat.name : ([b.origin_name, b.variety_name, `Lote ${lotLabel}`].filter(Boolean).join(" · ") || `Café verde ${lotLabel}`);
      itemId = ensureInvItem({ item_type: "green_coffee", item_name: itemName, unit: "kg", origin_id: b.origin_id||null, variety_id: b.variety_id||null, lot_label: lotLabel });
    } else {
      // Supplies / packaging / roasted: go straight into their catalog item, no lot.
      itemId = ensureInvItem({ item_type: itemType, item_name: cat.name, unit: cat.unit || "pz" });
    }
    const entryRes = qRun("INSERT INTO purchase_entries(purchase_order_id,inventory_item_id,quantity_kg,unit_cost,total_cost,shipping_cost,supplier,lot_label,origin_id,variety_id,registered_by,funding_source,paid_from_account,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)", poId, itemId, qty, qty>0?r2(cost/qty):0, cost, ship, b.supplier||po.supplier||null, lotLabel, b.origin_id||null, b.variety_id||null, b.registered_by||"Sistema", fundingSource, paidFromAccount, entryCreatedAt);
    applyPurchaseEntryEffects(Number(entryRes.lastInsertRowid), itemId, po, { qty, cost, ship, fundingSource, partner, paidFromAccount, registeredBy: b.registered_by || "Sistema", entryDate });
    recalcPO(poId);
    const actualShipping = Number(qVal("SELECT COALESCE(SUM(shipping_cost),0) AS v FROM purchase_entries WHERE purchase_order_id=?", poId) ?? 0);
    qRun("UPDATE purchase_orders SET actual_shipping_cost=? WHERE id=?", r2(actualShipping), poId);
    if (po.source_type === "sales_order" && po.source_id) recalcSO(po.source_id);
  });
  receive();
  return c.json(ok(purchaseOrderView(qGet("SELECT * FROM purchase_orders WHERE id=?", poId))));
});

// Edit a received entry: reverses its inventory + accounting, then re-applies with new values.
api.put("/purchase-entries/:id", async c => {
  const id = Number(c.req.param("id"));
  const entry = qGet<any>("SELECT * FROM purchase_entries WHERE id=?", id);
  if (!entry) return c.json(fail("Entrada no encontrada"), 404);
  const po = qGet<any>("SELECT * FROM purchase_orders WHERE id=?", entry.purchase_order_id);
  const b = await body(c);
  const qty = r2(num(b.quantity_kg ?? entry.quantity_kg));
  req(qty > 0, "Cantidad inválida");
  const cost = r2(num(b.total_cost ?? entry.total_cost));
  const ship = r2(num(b.shipping_cost ?? entry.shipping_cost));
  const entryDate = b.entry_date || b.date || String(entry.created_at || today()).slice(0, 10);
  const entryCreatedAt = setIsoDate(entry.created_at, entryDate);
  const fundingSource = String(b.funding_source || entry.funding_source || "business_account");
  const partner = normPartner(b.partner_name || (fundingSource === "partner_contribution" ? (b.paid_from_account || entry.paid_from_account) : ""));
  const paidFromAccount = normAccount(b.paid_from_account || (fundingSource === "partner_contribution" ? partner : entry.paid_from_account || "Dinero Cafetier"));
  if (fundingSource === "partner_contribution") req(["Itza", "Axel"].includes(partner), "Elegí qué socio puso el dinero");
  const edit = tx(() => {
    reversePurchaseEntry(entry, po);
    qRun("UPDATE purchase_entries SET quantity_kg=?,unit_cost=?,total_cost=?,shipping_cost=?,supplier=?,registered_by=?,funding_source=?,paid_from_account=?,created_at=? WHERE id=?", qty, qty > 0 ? r2(cost / qty) : 0, cost, ship, b.supplier ?? entry.supplier ?? po.supplier ?? null, b.registered_by || entry.registered_by || "Sistema", fundingSource, paidFromAccount, entryCreatedAt, id);
    applyPurchaseEntryEffects(id, entry.inventory_item_id, po, { qty, cost, ship, fundingSource, partner, paidFromAccount, registeredBy: b.registered_by || entry.registered_by || "Sistema", entryDate });
    recalcPO(po.id);
    qRun("UPDATE purchase_orders SET actual_shipping_cost=? WHERE id=?", r2(Number(qVal("SELECT COALESCE(SUM(shipping_cost),0) AS v FROM purchase_entries WHERE purchase_order_id=?", po.id) ?? 0)), po.id);
    if (po.source_type === "sales_order" && po.source_id) recalcSO(po.source_id);
  });
  edit();
  return c.json(ok(purchaseOrderView(qGet("SELECT * FROM purchase_orders WHERE id=?", po.id))));
});
api.delete("/purchase-entries/:id", c => {
  const id = Number(c.req.param("id"));
  const entry = qGet<any>("SELECT * FROM purchase_entries WHERE id=?", id);
  if (!entry) return c.json(ok(true));
  const po = qGet<any>("SELECT * FROM purchase_orders WHERE id=?", entry.purchase_order_id);
  const del = tx(() => {
    reversePurchaseEntry(entry, po);
    qRun("DELETE FROM purchase_entries WHERE id=?", id);
    recalcPO(po.id);
    qRun("UPDATE purchase_orders SET actual_shipping_cost=? WHERE id=?", r2(Number(qVal("SELECT COALESCE(SUM(shipping_cost),0) AS v FROM purchase_entries WHERE purchase_order_id=?", po.id) ?? 0)), po.id);
    if (po.source_type === "sales_order" && po.source_id) recalcSO(po.source_id);
  });
  del();
  return c.json(ok(true));
});

api.put("/purchase-orders/:id", async c => {
  const id = Number(c.req.param("id"));
  const po = qGet<any>("SELECT * FROM purchase_orders WHERE id=?", id);
  if (!po) return c.json(fail("No encontrada"), 404);
  const b = await body(c);
  const description = b.description ?? po.description;
  req(description, "Descripción obligatoria");
  const requestedKg = r2(num(b.requested_kg ?? b.requested_green_kg ?? po.requested_kg));
  req(requestedKg > 0, "Kg requeridos");
  const est = r2(num(b.estimated_cost ?? po.estimated_cost));
  const ship = r2(num(b.estimated_shipping_cost ?? po.estimated_shipping_cost));
  let status = po.status;
  if (status !== "cancelada" && status !== "recibida") status = est + ship > finance().cash ? "sin_fondos" : po.received_kg > 0 ? "parcial" : "pendiente";
  const purchaseDate = b.purchase_date || b.date || String(po.created_at || today()).slice(0, 10);
  const purchaseCreatedAt = setIsoDate(po.created_at, purchaseDate);
  qRun("UPDATE purchase_orders SET description=?,supplier=?,requested_kg=?,estimated_cost=?,estimated_shipping_cost=?,notes=?,status=?,created_at=?,updated_at=? WHERE id=?", description, b.supplier ?? po.supplier ?? null, requestedKg, est, ship, b.notes ?? po.notes ?? null, status, purchaseCreatedAt, now(), id);
  qRun("UPDATE purchase_entries SET created_at=? WHERE purchase_order_id=?", purchaseCreatedAt, id);
  qRun("UPDATE inventory_movements SET created_at=? WHERE reason=?", purchaseCreatedAt, `Recepción ${po.po_no}`);
  qRun("UPDATE expenses SET expense_date=? WHERE ref_type IN ('purchase_order','purchase_shipping') AND ref_id=?", purchaseDate, id);
  qRun("UPDATE expenses SET expense_date=? WHERE ref_type IN ('purchase_entry','purchase_entry_ship') AND ref_id IN (SELECT id FROM purchase_entries WHERE purchase_order_id=?)", purchaseDate, id);
  qRun("UPDATE capital_contributions SET contribution_date=? WHERE ref_type='purchase_order' AND ref_id=?", purchaseDate, id);
  qRun("UPDATE capital_contributions SET contribution_date=? WHERE ref_type='purchase_entry' AND ref_id IN (SELECT id FROM purchase_entries WHERE purchase_order_id=?)", purchaseDate, id);
  qRun("UPDATE capital_contributions SET contribution_date=? WHERE ref_type IS NULL AND description LIKE ?", purchaseDate, `Compra ${po.po_no} pagada por %`);
  if (po.source_type === "sales_order" && po.source_id) recalcSO(po.source_id);
  return c.json(ok(purchaseOrderView(qGet("SELECT * FROM purchase_orders WHERE id=?", id))));
});
api.delete("/purchase-orders/:id", c => {
  const id = Number(c.req.param("id"));
  const po = qGet<any>("SELECT * FROM purchase_orders WHERE id=?", id);
  if (!po) return c.json(ok(true));
  const entries = Number(qVal("SELECT COUNT(*) AS v FROM purchase_entries WHERE purchase_order_id=?", id) ?? 0);
  if (entries === 0) {
    // Nothing was received yet: delete it outright.
    qRun("DELETE FROM purchase_orders WHERE id=?", id);
    if (po.source_type === "sales_order" && po.source_id) recalcSO(po.source_id);
    return c.json(ok({ deleted: true }));
  }
  // Already received stock/expenses: cancel to preserve inventory and accounting.
  qRun("UPDATE purchase_orders SET status='cancelada',updated_at=? WHERE id=?", now(), id);
  return c.json(ok({ cancelled: true }));
});

// ===== CAPITAL =====
api.get("/capital/summary", c => {
  const f = finance();
  const position = financialPosition(c.req.query("month") || thisMonth());
  const partners = position.partners.map((p: any) => ({ ...p, div_available: p.dividends_available }));
  return c.json(ok({ ...position, finance: f, partners }));
});

api.get("/financial-position", c => c.json(ok(financialPosition(c.req.query("month") || thisMonth()))));

api.get("/capital-requests", c => c.json(ok(qAll("SELECT * FROM capital_requests ORDER BY id DESC"))));
api.post("/capital-requests", async c => {
  const b = await body(c);
  req(num(b.amount_requested) > 0, "Monto requerido inválido");
  const r = qRun("INSERT INTO capital_requests(request_no,amount_requested,amount_funded,status,notes,created_at,updated_at) VALUES (?,?,0,'open',?,?,?)", docNo("CAP"), r2(num(b.amount_requested)), b.notes || null, now(), now());
  return c.json(ok(qGet("SELECT * FROM capital_requests WHERE id=?", Number(r.lastInsertRowid))));
});
api.delete("/capital-requests/:id", c => { qRun("UPDATE capital_requests SET status='cancelled',updated_at=? WHERE id=?", now(), c.req.param("id")); return c.json(ok(true)); });

api.get("/dividend-orders", c => c.json(ok(qAll("SELECT * FROM dividend_orders ORDER BY id DESC"))));
api.post("/dividend-orders", async c => {
  const b = await body(c);
  const f = finance();
  req(f.unrecovered <= 0, "Primero hay que recuperar todo el capital reembolsable");
  const amount = r2(num(b.total_amount, f.distributable));
  req(amount > 0, "No hay utilidades distribuibles");
  req(amount <= f.distributable, "Excede lo distribuible");
  const r = qRun("INSERT INTO dividend_orders(dividend_no,month,total_amount,status,notes,created_at) VALUES (?,?,?,'open',?,?)", docNo("DIV"), b.month || thisMonth(), amount, b.notes || null, now());
  return c.json(ok(qGet("SELECT * FROM dividend_orders WHERE id=?", Number(r.lastInsertRowid))));
});
api.post("/dividend-orders/:id/pay", async c => {
  const b = await body(c);
  const row = qGet<any>("SELECT * FROM dividend_orders WHERE id=?", c.req.param("id"));
  if (!row) return c.json(fail("No encontrada"), 404);
  req(row.status === "open", "La orden ya no está abierta");
  const f = finance();
  req(f.unrecovered <= 0, "Primero hay que recuperar todo el capital");
  req(Number(row.total_amount) <= f.distributable, "Excede lo distribuible actual");
  const partners = qAll<any>("SELECT * FROM partners ORDER BY id");
  const pay = tx(() => {
    for (const p of partners) {
      const share = r2((Number(row.total_amount) * Number(p.share_pct || 0)) / 100);
      if (share > 0) qRun("INSERT INTO withdrawals(kind,partner_name,amount,month,dividend_order_id,paid_from_account,notes,created_at) VALUES ('dividend',?,?,?,?,?,?,?)", p.name, share, row.month, row.id, normAccount(b.paid_from_account || "Dinero Cafetier"), `Dividendos ${row.month}`, now());
    }
    qRun("UPDATE dividend_orders SET status='paid', paid_at=? WHERE id=?", now(), row.id);
  });
  pay();
  return c.json(ok(true));
});

api.get("/partner-assets", c => c.json(ok(qAll("SELECT * FROM partner_assets ORDER BY purchase_date DESC, id DESC"))));
api.post("/partner-assets", async c => {
  const b = await body(c);
  req(b.asset_name, "Nombre del activo obligatorio");
  const owner = normPartner(b.owner_partner);
  req(["Itza", "Axel"].includes(owner), "Dueño obligatorio");
  const r = qRun("INSERT INTO partner_assets(asset_name,owner_partner,purchased_by,purchase_date,amount,notes,status,created_at) VALUES (?,?,?,?,?,?,?,?)", b.asset_name, owner, normPartner(b.purchased_by || owner), b.purchase_date || today(), r2(num(b.amount)), b.notes || null, b.status || "active", now());
  return c.json(ok(qGet("SELECT * FROM partner_assets WHERE id=?", Number(r.lastInsertRowid))));
});
api.put("/partner-assets/:id", async c => {
  const b = await body(c);
  qRun("UPDATE partner_assets SET asset_name=?,owner_partner=?,purchased_by=?,purchase_date=?,amount=?,notes=?,status=? WHERE id=?", b.asset_name, normPartner(b.owner_partner), normPartner(b.purchased_by || b.owner_partner), b.purchase_date || today(), r2(num(b.amount)), b.notes || null, b.status || "active", c.req.param("id"));
  return c.json(ok(true));
});
api.delete("/partner-assets/:id", c => { qRun("UPDATE partner_assets SET status='retired' WHERE id=?", c.req.param("id")); return c.json(ok(true)); });

api.get("/capital-contributions", c => c.json(ok(qAll("SELECT * FROM capital_contributions ORDER BY contribution_date ASC, id ASC"))));
api.post("/capital-contributions", async c => {
  const b = await body(c); req(normPartner(b.partner_name), "Socio obligatorio"); req(num(b.amount)>0, "Monto inválido"); req(b.description, "Descripción obligatoria");
  const requestId = b.capital_request_id ? Number(b.capital_request_id) : null;
  const r = qRun("INSERT INTO capital_contributions(partner_name,amount,description,contribution_date,capital_request_id,received_account,created_at) VALUES (?,?,?,?,?,?,?)", normPartner(b.partner_name), r2(num(b.amount)), b.description, b.contribution_date||today(), requestId, normAccount(b.received_account || b.partner_name), now());
  if (requestId) refreshCapitalRequest(requestId);
  return c.json(ok(qGet("SELECT * FROM capital_contributions WHERE id=?", Number(r.lastInsertRowid))));
});
api.put("/capital-contributions/:id", async c => { const b = await body(c); qRun("UPDATE capital_contributions SET partner_name=?,amount=?,description=?,contribution_date=?,received_account=? WHERE id=?", normPartner(b.partner_name), r2(num(b.amount)), b.description, b.contribution_date, normAccount(b.received_account || b.partner_name), c.req.param("id")); if (b.capital_request_id) refreshCapitalRequest(Number(b.capital_request_id)); return c.json(ok(true)); });
api.delete("/capital-contributions/:id", c => { qRun("DELETE FROM capital_contributions WHERE id=?", c.req.param("id")); return c.json(ok(true)); });

api.get("/withdrawals", c => c.json(ok(qAll("SELECT * FROM withdrawals ORDER BY created_at ASC, id ASC"))));
api.post("/withdrawals/capital-return", async c => {
  const b = await body(c); req(normPartner(b.partner_name), "Socio obligatorio"); req(num(b.amount)>0, "Monto inválido");
  const pn = normPartner(b.partner_name);
  // Sin bloqueos por fondos ni por capital pendiente: se permite dejar saldos en negativo.
  // La fecha la elige el usuario (puede ser un movimiento pasado) y es la que se usa en el libro de caja.
  const date = (b.date || (b.month ? `${b.month}-01` : today())).slice(0, 10);
  const createdAt = setIsoDate(now(), date);
  qRun("INSERT INTO withdrawals(kind,partner_name,amount,month,paid_from_account,notes,created_at) VALUES ('capital_return',?,?,?,?,?,?)", pn, r2(num(b.amount)), date.slice(0, 7), normAccount(b.paid_from_account || "Dinero Cafetier"), b.notes||"Retorno de capital", createdAt);
  return c.json(ok(true));
});
api.post("/withdrawals/dividend", async c => {
  const b = await body(c);
  const f = finance(); req(f.unrecovered <= 0, "Primero hay que recuperar todo el capital"); req(f.distributable > 0, "No hay utilidades distribuibles"); req(num(b.amount) <= f.distributable, "Excede lo distribuible"); req(f.cash >= num(b.amount), "Sin fondos");
  const amount = r2(num(b.amount));
  const partners = qAll<any>("SELECT * FROM partners ORDER BY id");
  const div = tx(() => {
    for (const p of partners) {
      const share = r2((amount * p.share_pct) / 100);
      if (share > 0) qRun("INSERT INTO withdrawals(kind,partner_name,amount,month,paid_from_account,notes,created_at) VALUES ('dividend',?,?,?,?,?,?)", p.name, share, b.month||thisMonth(), normAccount(b.paid_from_account || "Dinero Cafetier"), `Dividendos ${b.month||thisMonth()}`, now());
    }
  });
  div();
  return c.json(ok(true));
});
api.delete("/withdrawals/:id", c => { qRun("DELETE FROM withdrawals WHERE id=?", c.req.param("id")); return c.json(ok(true)); });

// ===== EXPENSES =====
api.get("/expenses", c => { const m = c.req.query("month"); const sql = m ? "SELECT e.*, ec.name AS category_name FROM expenses e JOIN expense_categories ec ON ec.id=e.category_id WHERE substr(e.expense_date,1,7)=? ORDER BY e.expense_date ASC, e.id ASC" : "SELECT e.*, ec.name AS category_name FROM expenses e JOIN expense_categories ec ON ec.id=e.category_id ORDER BY e.expense_date ASC, e.id ASC"; return c.json(ok(m ? qAll(sql, m) : qAll(sql))); });
api.post("/expenses", async c => {
  const b = await body(c); req(b.category_id, "Categoría obligatoria"); req(num(b.amount)>0, "Monto inválido");
  const funding = expenseFunding(b);
  const amount = r2(num(b.amount));
  const date = b.expense_date || today();
  // Sin bloqueo por fondos: la cuenta puede quedar en negativo.
  const create = tx(() => {
    const r = qRun(
      "INSERT INTO expenses(expense_date,category_id,amount,description,paid_by,supplier,notes,auto_generated,from_cashbox,from_utilities,paid_from_account,created_at) VALUES (?,?,?,?,?,?,?,0,?,?,?,?)",
      date,
      b.category_id,
      amount,
      b.description || null,
      funding.paidBy,
      b.supplier || null,
      b.notes || null,
      funding.fromCashbox,
      funding.fromUtilities,
      funding.paidFromAccount,
      now()
    );
    const expenseId = Number(r.lastInsertRowid);
    // Link the mirror capital contribution to this expense so deleting the
    // expense also removes it (keeps the books balanced).
    registerDirectFunding(funding.partner, amount, date, `Gasto pagado por ${funding.partner}: ${b.description || "sin descripción"}`, funding.partner, null, "expense", expenseId);
    return expenseId;
  });
  const id = create();
  return c.json(ok(qGet("SELECT * FROM expenses WHERE id=?", id)));
});
api.put("/expenses/:id", async c => {
  const id = Number(c.req.param("id"));
  const b = await body(c);
  const funding = expenseFunding(b);
  const amount = r2(num(b.amount));
  const date = b.expense_date || today();
  const edit = tx(() => {
    qRun("UPDATE expenses SET expense_date=?,category_id=?,amount=?,description=?,paid_by=?,supplier=?,notes=?,from_cashbox=?,from_utilities=?,paid_from_account=? WHERE id=?", date, b.category_id, amount, b.description ?? null, funding.paidBy, b.supplier ?? null, b.notes ?? null, funding.fromCashbox, funding.fromUtilities, funding.paidFromAccount, id);
    // Re-sync the mirror capital contribution so changing the money source keeps the books right.
    qRun("DELETE FROM capital_contributions WHERE ref_type='expense' AND ref_id=?", id);
    registerDirectFunding(funding.partner, amount, date, `Gasto pagado por ${funding.partner}: ${b.description || "sin descripción"}`, funding.partner, null, "expense", id);
  });
  edit();
  return c.json(ok(true));
});
api.delete("/expenses/:id", c => { deleteExpenseWithMirror(Number(c.req.param("id"))); return c.json(ok(true)); });

// ===== ROASTING =====
api.get("/roasting-sessions", c => c.json(ok(qAll("SELECT rs.*, COALESCE((SELECT COUNT(*) FROM roasting_batches WHERE session_id=rs.id),0) AS batch_count, COALESCE((SELECT SUM(green_kg) FROM roasting_batches WHERE session_id=rs.id),0) AS total_green, COALESCE((SELECT SUM(roasted_kg) FROM roasting_batches WHERE session_id=rs.id),0) AS total_roasted, COALESCE((SELECT SUM(machine_minutes) FROM roasting_batches WHERE session_id=rs.id),0) AS total_minutes FROM roasting_sessions rs ORDER BY rs.session_date DESC"))));

api.get("/roasting-sessions/:id", c => {
  const id = Number(c.req.param("id"));
  const session = qGet("SELECT * FROM roasting_sessions WHERE id=?", id);
  if (!session) return c.json(fail("No encontrada"), 404);
  const batches = qAll<any>("SELECT rb.*, i.item_name AS green_item_name, rp.name AS roast_name, so.order_no FROM roasting_batches rb JOIN inventory_items i ON i.id=rb.green_inventory_item_id LEFT JOIN roast_profiles rp ON rp.id=rb.roast_profile_id LEFT JOIN sales_orders so ON so.id=rb.sales_order_id WHERE rb.session_id=? ORDER BY rb.id DESC", id).map((b: any) => ({ ...b, photos: qAll("SELECT * FROM batch_photos WHERE batch_id=? ORDER BY id DESC", b.id) }));
  return c.json(ok({ session, batches }));
});

api.post("/roasting-sessions", async c => { const b = await body(c); req(b.session_date, "Fecha obligatoria"); req(b.operator, "Operador obligatorio"); const r = qRun("INSERT INTO roasting_sessions(session_date,operator,notes,created_at) VALUES (?,?,?,?)", b.session_date, b.operator, b.notes||null, now()); return c.json(ok(qGet("SELECT * FROM roasting_sessions WHERE id=?", Number(r.lastInsertRowid)))); });
api.put("/roasting-sessions/:id", async c => { const b = await body(c); qRun("UPDATE roasting_sessions SET session_date=?,operator=?,notes=? WHERE id=?", b.session_date, b.operator, b.notes||null, c.req.param("id")); return c.json(ok(true)); });

api.post("/roasting-sessions/:id/batches", async c => {
  const sessionId = Number(c.req.param("id")); const b = await body(c);
  req(b.green_inventory_item_id, "Seleccioná el café verde"); req(num(b.green_kg)>0, "Kg verde inválidos");
  const gi = qGet<any>("SELECT * FROM inventory_items WHERE id=?", b.green_inventory_item_id);
  req(gi, "Inventario no encontrado"); req(gi.item_type === "green_coffee", "Debe ser café verde");
  const greenKg = r2(num(b.green_kg));
  // Not enough green for this batch: trigger a green-coffee purchase order and stop.
  if (Number(gi.quantity || 0) < greenKg) {
    const deficit = r2(greenKg - Number(gi.quantity || 0));
    const po = createPO({ sourceType: "manual", description: `Café verde para tostar: ${gi.item_name}`, requestedKg: deficit, estimatedCost: r2(deficit * getNum("default_green_cost_per_kg", 0)) });
    return c.json(fail(`No hay suficiente café verde (disponible ${Number(gi.quantity || 0).toFixed(1)} kg, requerido ${greenKg.toFixed(1)} kg). Se generó la orden de compra ${po?.po_no} por ${deficit.toFixed(1)} kg.`), 400);
  }
  const create = tx(() => {
    const rkg = b.roasted_kg === null || b.roasted_kg === undefined || b.roasted_kg === "" ? null : r2(num(b.roasted_kg));
    const lp = rkg && num(b.green_kg) > 0 ? r2(((num(b.green_kg) - rkg) / num(b.green_kg)) * 100) : null;
    const bno = docNo("RB");
    invMove(Number(b.green_inventory_item_id), "out", r2(num(b.green_kg)), `Tostado ${bno}`, b.registered_by||"Sistema");
    const ri = qGet<{ id: number }>("SELECT id FROM inventory_items WHERE item_type='roasted_coffee' ORDER BY id LIMIT 1");
    req(ri?.id, "No existe inventario de café tostado");
    if (rkg && rkg > 0) invMove(ri!.id, "in", rkg, `Batch ${bno}`, b.registered_by||"Sistema");
    const r = qRun("INSERT INTO roasting_batches(session_id,batch_no,green_inventory_item_id,roast_profile_id,sales_order_id,green_kg,roasted_kg,loss_pct,machine_minutes,notes,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)", sessionId, bno, b.green_inventory_item_id, b.roast_profile_id||null, b.sales_order_id||null, r2(num(b.green_kg)), rkg, lp, r2(num(b.machine_minutes)), b.notes||null, now());
    if (b.sales_order_id) recalcSO(Number(b.sales_order_id));
    return qGet("SELECT * FROM roasting_batches WHERE id=?", Number(r.lastInsertRowid));
  });
  return c.json(ok(create()));
});

api.patch("/roasting-batches/:id", async c => {
  const id = Number(c.req.param("id")); const b = await body(c);
  const cur = qGet<any>("SELECT * FROM roasting_batches WHERE id=?", id);
  if (!cur) return c.json(fail("No encontrado"), 404);
  const upd = tx(() => {
    const ri = qGet<{ id: number }>("SELECT id FROM inventory_items WHERE item_type='roasted_coffee' ORDER BY id LIMIT 1");
    if (!ri?.id) throw new Error("No existe inventario tostado");
    const newR = b.roasted_kg === null || b.roasted_kg === undefined || b.roasted_kg === "" ? null : r2(num(b.roasted_kg));
    const curR = cur.roasted_kg ? Number(cur.roasted_kg) : 0;
    const delta = r2((newR || 0) - curR);
    if (delta > 0) invMove(ri.id, "in", delta, `Ajuste batch ${cur.batch_no}`, "Sistema");
    else if (delta < 0) invMove(ri.id, "out", Math.abs(delta), `Ajuste batch ${cur.batch_no}`, "Sistema");
    const lp = newR && cur.green_kg > 0 ? r2(((cur.green_kg - newR) / cur.green_kg) * 100) : null;
    qRun("UPDATE roasting_batches SET roast_profile_id=?,sales_order_id=?,roasted_kg=?,loss_pct=?,machine_minutes=?,notes=? WHERE id=?", b.roast_profile_id||cur.roast_profile_id||null, b.sales_order_id||cur.sales_order_id||null, newR, lp, r2(num(b.machine_minutes, cur.machine_minutes)), b.notes??cur.notes??null, id);
    if (cur.sales_order_id) recalcSO(cur.sales_order_id);
    if (b.sales_order_id) recalcSO(Number(b.sales_order_id));
  });
  upd(); return c.json(ok(qGet("SELECT * FROM roasting_batches WHERE id=?", id)));
});

api.delete("/roasting-batches/:id", c => {
  const id = Number(c.req.param("id"));
  const batch = qGet<any>("SELECT * FROM roasting_batches WHERE id=?", id);
  if (!batch) return c.json(fail("No encontrado"), 404);
  const rm = tx(() => {
    invMove(batch.green_inventory_item_id, "in", batch.green_kg, `Reverso ${batch.batch_no}`, "Sistema");
    if (batch.roasted_kg) { const ri = qGet<{ id: number }>("SELECT id FROM inventory_items WHERE item_type='roasted_coffee' ORDER BY id LIMIT 1"); if (ri?.id) invMove(ri.id, "out", batch.roasted_kg, `Reverso ${batch.batch_no}`, "Sistema"); }
    qRun("DELETE FROM roasting_batches WHERE id=?", id);
    if (batch.sales_order_id) recalcSO(batch.sales_order_id);
  });
  rm(); return c.json(ok(true));
});
api.delete("/roasting-sessions/:id", c => {
  const batches = qAll("SELECT id FROM roasting_batches WHERE session_id=?", c.req.param("id"));
  if (batches.length > 0) return c.json(fail("Eliminá los batches primero"), 400);
  qRun("DELETE FROM roasting_sessions WHERE id=?", c.req.param("id")); return c.json(ok(true));
});

// Artisan upload + AI
api.post("/roasting-batches/:id/artisan", async c => {
  const id = Number(c.req.param("id"));
  const batch = qGet<any>("SELECT rb.*, rp.name AS roast_name FROM roasting_batches rb LEFT JOIN roast_profiles rp ON rp.id=rb.roast_profile_id WHERE rb.id=?", id);
  if (!batch) return c.json(fail("No encontrado"), 404);
  const fd = await c.req.formData(); const file = fd.get("file"); req(file && typeof file !== "string", "Adjuntá un archivo");
  const f = file as File; const payload = await f.text();
  qRun("UPDATE roasting_batches SET artisan_file_name=?, artisan_data=? WHERE id=?", f.name, payload, id);
  const apiKey = getSettings().claude_api_key;
  if (!apiKey) return c.json(ok({ artisan_file_name: f.name, ai_review: null, warning: "Configurá la API key de Claude" }));
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" }, body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1400, messages: [{ role: "user", content: `Eres un maestro tostador. Analiza esta curva de Artisan.\nBatch: ${batch.batch_no}\nVerde: ${batch.green_kg}kg → Tostado: ${batch.roasted_kg??'N/D'}kg\nMerma: ${batch.loss_pct??'N/D'}%\nMinutos: ${batch.machine_minutes}\nPerfil: ${batch.roast_name||'N/D'}\n\nArchivo (${f.name}):\n${payload.slice(0,120000)}\n\nDame: 1)Resumen 2)Qué salió bien 3)Qué faltó 4)Problemas 5)Sabor esperado 6)Recomendación para el próximo batch. Español, directo.` }] }) });
    const data = await res.json() as any;
    const review = data?.content?.[0]?.text || null;
    qRun("UPDATE roasting_batches SET ai_review=? WHERE id=?", review, id);
    return c.json(ok({ artisan_file_name: f.name, ai_review: review }));
  } catch (e: any) { return c.json(ok({ artisan_file_name: f.name, ai_review: null, warning: e.message })); }
});

// Batch photos
api.post("/roasting-batches/:id/photos", async c => {
  const id = Number(c.req.param("id"));
  req(qGet("SELECT id FROM roasting_batches WHERE id=?", id), "Batch no encontrado");
  const fd = await c.req.formData(); const file = fd.get("file"); req(file && typeof file !== "string", "Adjuntá una foto");
  const img = file as File; const ext = path.extname(img.name || "") || ".bin";
  const stored = `${Date.now()}-${crypto.randomUUID()}${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, stored), Buffer.from(await img.arrayBuffer()));
  const r = qRun("INSERT INTO batch_photos(batch_id,file_name,stored_name,mime_type,notes,created_at) VALUES (?,?,?,?,NULL,?)", id, img.name||stored, stored, img.type||"application/octet-stream", now());
  return c.json(ok(qGet("SELECT * FROM batch_photos WHERE id=?", Number(r.lastInsertRowid))));
});
api.delete("/batch-photos/:id", c => {
  const row = qGet<any>("SELECT * FROM batch_photos WHERE id=?", c.req.param("id"));
  if (row) { try { fs.unlinkSync(path.join(UPLOAD_DIR, row.stored_name)); } catch {} qRun("DELETE FROM batch_photos WHERE id=?", row.id); }
  return c.json(ok(true));
});
api.get("/uploads/:name", c => {
  const abs = path.join(UPLOAD_DIR, c.req.param("name"));
  if (!fs.existsSync(abs)) return c.json(fail("No encontrado"), 404);
  return new Response(Bun.file(abs));
});

// ===== ADMIN =====
api.get("/admin/loss", c => c.json(ok({ estimatedLossPct: estimatedLoss(), defaultLossPct: getNum("default_loss_pct", 20) })));
api.post("/admin/reset", async c => {
  const b = await body(c);
  req(String(b.confirm || "").trim().toUpperCase() === "REINICIAR", "Escribí REINICIAR para confirmar");
  const scope = b.scope === "todo" ? "todo" : "operativo";
  const result = resetData(scope);
  return c.json(ok(result));
});

export default api;
