import { Hono } from "hono";
import fs from "fs";
import path from "path";
import { accountBalances, autoExpense, createPO, docNo, ensureInvItem, finance, financialPosition, getNum, getSettings, invMove, invTotal, normAccount, normInvType, normPartner, now, qAll, qGet, qRun, qVal, r2, recalcPO, recalcSO, thisMonth, today, tx } from "./db";

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
  const paidBy = explicitPartner || b.paid_by || (fromCashbox ? "Caja chica" : "Itza");
  const partner = ["Itza", "Axel"].includes(normPartner(paidBy)) ? normPartner(paidBy) : "";
  const paidFromAccount = normAccount(b.paid_from_account || b.account || (fromCashbox ? paidBy : partner || paidBy));
  return { fromCashbox, fromUtilities, paidBy: partner || paidBy, partner: fromCashbox ? "" : partner, paidFromAccount };
}
function registerDirectFunding(partner: string, amount: number, date: string, description: string, receivedAccount?: string | null, capitalRequestId?: number | null) {
  if (!partner) return;
  const res = qRun("INSERT INTO capital_contributions(partner_name,amount,description,contribution_date,capital_request_id,received_account,created_at) VALUES (?,?,?,?,?,?,?)", partner, r2(amount), description, date, capitalRequestId || null, normAccount(receivedAccount || partner), now());
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
  };
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
  return c.json(ok({ partners, clients, products, origins, varieties, roastProfiles, expenseCategories, settings: getSettings() }));
});

// ===== DASHBOARD (Resumen General) =====
api.get("/dashboard", c => {
  const month = c.req.query("month") || thisMonth();
  const f = finance();
  const position = financialPosition(month);
  const inv = { verde: invTotal("green_coffee"), tostado: invTotal("roasted_coffee"), empaquetado: invTotal("packaged_coffee") };
  const revMonth = Number(qVal("SELECT COALESCE(SUM(amount),0) AS v FROM sales_payments WHERE substr(created_at,1,7)=?", month) ?? 0);
  const expMonth = Number(qVal("SELECT COALESCE(SUM(amount),0) AS v FROM expenses WHERE substr(expense_date,1,7)=?", month) ?? 0);
  const roastedMonth = Number(qVal("SELECT COALESCE(SUM(rb.roasted_kg),0) AS v FROM roasting_batches rb JOIN roasting_sessions rs ON rs.id=rb.session_id WHERE substr(rs.session_date,1,7)=?", month) ?? 0);
  const shippedMonth = Number(qVal("SELECT COALESCE(SUM(weight_kg),0) AS v FROM sales_shipments WHERE substr(created_at,1,7)=?", month) ?? 0);
  const minMonth = Number(qVal("SELECT COALESCE(SUM(rb.machine_minutes),0) AS v FROM roasting_batches rb JOIN roasting_sessions rs ON rs.id=rb.session_id WHERE substr(rs.session_date,1,7)=?", month) ?? 0);
  const avgLoss = Number(qVal("SELECT COALESCE(AVG(rb.loss_pct),0) AS v FROM roasting_batches rb JOIN roasting_sessions rs ON rs.id=rb.session_id WHERE substr(rs.session_date,1,7)=? AND rb.loss_pct IS NOT NULL", month) ?? 0);
  const openSales = Number(qVal("SELECT COUNT(*) AS v FROM sales_orders WHERE status NOT IN ('completado','cancelado')") ?? 0);
  const pendingPO = Number(qVal("SELECT COUNT(*) AS v FROM purchase_orders WHERE status IN ('sin_fondos','pendiente','parcial')") ?? 0);
  const mkw = getNum("machine_kw"); const kwp = getNum("kwh_price");
  const elecCost = r2(mkw * kwp * (minMonth / 60));
  const partners = position.partners.map((p: any) => ({ ...p, div_available: p.dividends_available }));
  const lastSales = qAll("SELECT so.*, c.name AS client_name, COALESCE((SELECT SUM(amount) FROM sales_payments WHERE order_id=so.id),0) AS paid_amount, COALESCE((SELECT SUM(weight_kg) FROM sales_shipments WHERE order_id=so.id),0) AS shipped_kg FROM sales_orders so LEFT JOIN clients c ON c.id=so.client_id ORDER BY so.id DESC LIMIT 8");
  const lastPO = qAll<any>("SELECT * FROM purchase_orders ORDER BY id DESC LIMIT 8").map(purchaseOrderView);
  const openCapitalRequests = Number(qVal("SELECT COUNT(*) AS v FROM capital_requests WHERE status IN ('open','partially_funded')") ?? 0);
  return c.json(ok({
    month,
    finance: f,
    inv,
    inventory: { green: inv.verde, roasted: inv.tostado, packaged: inv.empaquetado, supplies: position.inventory.supplies },
    revMonth,
    expMonth,
    revenueMonth: revMonth,
    expenseMonth: expMonth,
    roastedMonth,
    shippedMonth,
    minMonth,
    avgLoss,
    openSales,
    pendingPO,
    pendingPurchaseOrders: pendingPO,
    openCapitalRequests,
    elecCost,
    partners,
    partnerBreakdown: partners,
    accounts: position.accounts,
    settlement: position.settlement,
    receivables: position.receivables,
    monthly: position.monthly,
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

// ===== SETTINGS =====
api.get("/settings", c => c.json(ok(getSettings())));
api.put("/settings", async c => { const b = await body(c); for (const [k, v] of Object.entries(b)) qRun("INSERT OR REPLACE INTO settings(key,value) VALUES (?,?)", k, String(v)); return c.json(ok(getSettings())); });

// ===== CATALOGS =====
for (const table of ["roast_profiles", "origins", "varieties", "expense_categories"]) {
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

// ===== CLIENTS =====
api.get("/clients", c => c.json(ok(qAll("SELECT * FROM clients WHERE active=1 ORDER BY name"))));
api.post("/clients", async c => {
  const b = await body(c);
  req(b.name, "Nombre obligatorio");
  const r = qRun(
    "INSERT INTO clients(name,cafe_name,contact_name,phone,contact_phone,email,address,city,postal_code,notes,active,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,1,?)",
    b.name,
    b.cafe_name || null,
    b.contact_name || null,
    b.phone || null,
    b.contact_phone || null,
    b.email || null,
    b.address || null,
    b.city || null,
    b.postal_code || null,
    b.notes || null,
    now()
  );
  return c.json(ok(qGet("SELECT * FROM clients WHERE id=?", Number(r.lastInsertRowid))));
});
api.put("/clients/:id", async c => {
  const b = await body(c);
  req(b.name, "Nombre obligatorio");
  qRun(
    "UPDATE clients SET name=?,cafe_name=?,contact_name=?,phone=?,contact_phone=?,email=?,address=?,city=?,postal_code=?,notes=? WHERE id=?",
    b.name,
    b.cafe_name || null,
    b.contact_name || null,
    b.phone || null,
    b.contact_phone || null,
    b.email || null,
    b.address || null,
    b.city || null,
    b.postal_code || null,
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

// ===== INVENTORY =====
api.get("/inventory", c => c.json(ok(qAll("SELECT i.*, o.name AS origin_name, v.name AS variety_name FROM inventory_items i LEFT JOIN origins o ON o.id=i.origin_id LEFT JOIN varieties v ON v.id=i.variety_id ORDER BY i.item_type, i.item_name"))));
api.get("/inventory/green", c => c.json(ok(qAll("SELECT i.*, o.name AS origin_name, v.name AS variety_name FROM inventory_items i LEFT JOIN origins o ON o.id=i.origin_id LEFT JOIN varieties v ON v.id=i.variety_id WHERE i.item_type='green_coffee' AND i.quantity>0 ORDER BY i.item_name"))));
api.get("/inventory/summary", c => c.json(ok({ verde: invTotal("green_coffee"), tostado: invTotal("roasted_coffee"), empaquetado: invTotal("packaged_coffee"), finance: finance() })));
api.post("/inventory", async c => { const b = await body(c); req(b.item_type, "Tipo obligatorio"); req(b.item_name, "Nombre obligatorio"); const r = qRun("INSERT INTO inventory_items(item_type,item_name,quantity,unit,min_stock,origin_id,variety_id,lot_label) VALUES (?,?,?,?,?,?,?,?)", normInvType(b.item_type), b.item_name, num(b.quantity), b.unit||"kg", num(b.min_stock), b.origin_id||null, b.variety_id||null, b.lot_label||null); return c.json(ok(qGet("SELECT * FROM inventory_items WHERE id=?", Number(r.lastInsertRowid)))); });
api.put("/inventory/:id", async c => { const b = await body(c); qRun("UPDATE inventory_items SET item_name=?,quantity=?,unit=?,min_stock=?,origin_id=?,variety_id=?,lot_label=? WHERE id=?", b.item_name, num(b.quantity), b.unit||"kg", num(b.min_stock), b.origin_id||null, b.variety_id||null, b.lot_label||null, c.req.param("id")); return c.json(ok(true)); });
api.post("/inventory/:id/movements", async c => { const b = await body(c); req(["in","out","adjust"].includes(b.direction), "Dirección inválida"); const m = tx(() => { invMove(Number(c.req.param("id")), b.direction, num(b.quantity), b.reason || "Manual", b.registered_by); }); m(); return c.json(ok(true)); });
api.get("/inventory/:id/movements", c => c.json(ok(qAll("SELECT * FROM inventory_movements WHERE item_id=? ORDER BY id DESC", c.req.param("id")))));
api.delete("/inventory/:id", c => { qRun("DELETE FROM inventory_items WHERE id=?", c.req.param("id")); return c.json(ok(true)); });

// ===== SALES ORDERS =====
api.get("/sales-orders", c => c.json(ok(qAll("SELECT so.*, c.name AS client_name, COALESCE((SELECT SUM(amount) FROM sales_payments WHERE order_id=so.id),0) AS paid, COALESCE((SELECT SUM(amount) FROM sales_payments WHERE order_id=so.id),0) AS paid_amount, COALESCE((SELECT SUM(weight_kg) FROM sales_shipments WHERE order_id=so.id),0) AS shipped, COALESCE((SELECT SUM(weight_kg) FROM sales_shipments WHERE order_id=so.id),0) AS shipped_kg FROM sales_orders so LEFT JOIN clients c ON c.id=so.client_id ORDER BY so.id DESC"))));

api.get("/sales-orders/:id", c => {
  const id = Number(c.req.param("id"));
  const order = qGet("SELECT so.*, c.name AS client_name FROM sales_orders so LEFT JOIN clients c ON c.id=so.client_id WHERE so.id=?", id);
  if (!order) return c.json(fail("No encontrado"), 404);
  return c.json(ok({
    order,
    items: qAll("SELECT * FROM sales_order_items WHERE order_id=? ORDER BY id", id),
    payments: qAll("SELECT * FROM sales_payments WHERE order_id=? ORDER BY id DESC", id),
    shipments: qAll("SELECT * FROM sales_shipments WHERE order_id=? ORDER BY id DESC", id),
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
      const loss = getNum("default_loss_pct", 15);
      const needGreen = r2(totalKg / (1 - loss / 100));
      const greenAvail = invTotal("green_coffee");
      const deficit = r2(Math.max(0, needGreen - greenAvail));
      if (deficit > 0) {
        createPO({ sourceType: "sales_order", sourceId: orderId, description: `Café verde para ${orderNo}`, requestedKg: deficit, estimatedCost: r2(deficit * getNum("default_green_cost_per_kg", 0)) });
      }
    }

    recalcSO(orderId);
    return qGet("SELECT * FROM sales_orders WHERE id=?", orderId);
  });
  return c.json(ok(create()));
});

api.put("/sales-orders/:id", async c => { const b = await body(c); qRun("UPDATE sales_orders SET client_id=?,delivery_date=?,total_weight_kg=?,price_per_kg=?,total_amount=?,notes=?,updated_at=? WHERE id=?", b.client_id||null, b.delivery_date||null, num(b.total_weight_kg), num(b.price_per_kg), num(b.total_amount), b.notes||null, now(), c.req.param("id")); return c.json(ok(recalcSO(Number(c.req.param("id"))))); });
api.patch("/sales-orders/:id/status", async c => { const b = await body(c); qRun("UPDATE sales_orders SET status=?,updated_at=? WHERE id=?", b.status, now(), c.req.param("id")); return c.json(ok(true)); });
api.delete("/sales-orders/:id", c => { qRun("DELETE FROM sales_orders WHERE id=?", c.req.param("id")); return c.json(ok(true)); });

// Payments
api.post("/sales-orders/:id/payments", async c => { const b = await body(c); req(num(b.amount)>0, "Monto inválido"); qRun("INSERT INTO sales_payments(order_id,amount,method,notes,registered_by,received_account,created_at) VALUES (?,?,?,?,?,?,?)", c.req.param("id"), r2(num(b.amount)), b.method||"transferencia", b.notes||null, b.registered_by||"Sistema", normAccount(b.received_account || "Axel"), now()); recalcSO(Number(c.req.param("id"))); return c.json(ok(true)); });
api.delete("/sales-payments/:id", c => { const p = qGet<any>("SELECT * FROM sales_payments WHERE id=?", c.req.param("id")); if (p) { qRun("DELETE FROM sales_payments WHERE id=?", p.id); recalcSO(p.order_id); } return c.json(ok(true)); });

// Shipments (auto expense)
api.post("/sales-orders/:id/shipments", async c => {
  const orderId = Number(c.req.param("id")); const b = await body(c);
  req(num(b.weight_kg)>0, "Peso inválido");
  const send = tx(() => {
    const ri = qGet<{ id: number }>("SELECT id FROM inventory_items WHERE item_type='roasted_coffee' ORDER BY id LIMIT 1");
    req(ri?.id, "No existe inventario de café tostado");
    invMove(ri!.id, "out", r2(num(b.weight_kg)), `Envío pedido #${orderId}`, b.registered_by||"Sistema");
    let expId: number | null = null;
    if (num(b.shipping_cost) > 0) {
      const f = finance(); req(f.cash >= num(b.shipping_cost), "Sin fondos para el envío");
      expId = autoExpense("Envíos", num(b.shipping_cost), `Envío pedido #${orderId}`, b.registered_by||"Sistema", "shipment", orderId);
    }
    qRun("INSERT INTO sales_shipments(order_id,weight_kg,destination_address,carrier,tracking_number,shipping_cost,registered_by,notes,expense_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)", orderId, r2(num(b.weight_kg)), b.destination_address||null, b.carrier||null, b.tracking_number||null, r2(num(b.shipping_cost)), b.registered_by||"Sistema", b.notes||null, expId, now());
  });
  send(); return c.json(ok(recalcSO(orderId)));
});
api.delete("/sales-shipments/:id", c => {
  const row = qGet<any>("SELECT * FROM sales_shipments WHERE id=?", c.req.param("id"));
  if (row) {
    const rev = tx(() => {
      const ri = qGet<{ id: number }>("SELECT id FROM inventory_items WHERE item_type='roasted_coffee' ORDER BY id LIMIT 1");
      if (ri?.id) invMove(ri.id, "in", row.weight_kg, `Reverso envío ${row.id}`, "Sistema");
      if (row.expense_id) qRun("DELETE FROM expenses WHERE id=?", row.expense_id);
      qRun("DELETE FROM sales_shipments WHERE id=?", row.id);
    });
    rev(); recalcSO(row.order_id);
  }
  return c.json(ok(true));
});

// ===== PURCHASE ORDERS =====
api.get("/purchase-orders", c => c.json(ok(qAll<any>("SELECT * FROM purchase_orders ORDER BY id DESC").map(purchaseOrderView))));
api.get("/purchase-orders/:id", c => {
  const id = Number(c.req.param("id"));
  const po = purchaseOrderView(qGet("SELECT * FROM purchase_orders WHERE id=?", id));
  const entries = qAll("SELECT pe.*, i.item_name FROM purchase_entries pe JOIN inventory_items i ON i.id=pe.inventory_item_id WHERE pe.purchase_order_id=? ORDER BY pe.id DESC", id);
  const capitalRequests = qAll("SELECT * FROM capital_requests WHERE notes LIKE ? ORDER BY id DESC", `%${po?.po_no || ""}%`);
  return c.json(ok({ po, purchaseOrder: po, entries, capitalRequests }));
});
api.post("/purchase-orders", async c => { const b = await body(c); const requestedKg = num(b.requested_kg || b.requested_green_kg); req(b.description, "Descripción obligatoria"); req(requestedKg>0, "Kg requeridos"); return c.json(ok(purchaseOrderView(createPO({ sourceType: "manual", description: b.description, requestedKg, estimatedCost: num(b.estimated_cost), estimatedShippingCost: num(b.estimated_shipping_cost), supplier: b.supplier||null, notes: b.notes || null })))); });

api.post("/purchase-orders/:id/receive", async c => {
  const poId = Number(c.req.param("id")); const b = await body(c);
  const po = qGet<any>("SELECT * FROM purchase_orders WHERE id=?", poId);
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
  if (fundingSource !== "partner_contribution") {
    const balances = accountBalances();
    const accountBalance = Number(balances[paidFromAccount] || 0);
    if (paidFromAccount === "Caja chica" && accountBalance < landed) return c.json(fail(`Sin fondos en ${paidFromAccount}. Disponible: $${accountBalance.toFixed(2)}, necesario: $${landed.toFixed(2)}`), 400);
  }

  const receive = tx(() => {
    if (fundingSource === "partner_contribution") {
      req(["Itza", "Axel"].includes(partner), "Elegí qué socio puso el dinero");
      registerDirectFunding(partner, landed, today(), `Compra ${po.po_no} pagada por ${partner}`, partner);
    }
    const lotLabel = b.lot_label || `${today()}-${po.po_no}`;
    const itemName = b.item_name || [b.origin_name, b.variety_name, `Lote ${lotLabel}`].filter(Boolean).join(" · ") || `Café verde ${lotLabel}`;
    const itemId = ensureInvItem({ item_type: "green_coffee", item_name: itemName, unit: "kg", origin_id: b.origin_id||null, variety_id: b.variety_id||null, lot_label: lotLabel });
    invMove(itemId, "in", qty, `Recepción ${po.po_no}`, b.registered_by||"Sistema");
    qRun("INSERT INTO purchase_entries(purchase_order_id,inventory_item_id,quantity_kg,unit_cost,total_cost,shipping_cost,supplier,lot_label,origin_id,variety_id,registered_by,funding_source,paid_from_account,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)", poId, itemId, qty, qty>0?r2(cost/qty):0, cost, ship, b.supplier||po.supplier||null, lotLabel, b.origin_id||null, b.variety_id||null, b.registered_by||"Sistema", fundingSource, paidFromAccount, now());
    autoExpense("Café verde", cost, `Compra verde ${po.po_no}`, b.registered_by||paidFromAccount, "purchase_order", poId, fundingSource === "partner_contribution" ? 0 : 1, 0, paidFromAccount);
    if (ship > 0) autoExpense("Envíos", ship, `Envío compra ${po.po_no}`, b.registered_by||paidFromAccount, "purchase_shipping", poId, fundingSource === "partner_contribution" ? 0 : 1, 0, paidFromAccount);
    recalcPO(poId);
    const actualShipping = Number(qVal("SELECT COALESCE(SUM(shipping_cost),0) AS v FROM purchase_entries WHERE purchase_order_id=?", poId) ?? 0);
    qRun("UPDATE purchase_orders SET actual_shipping_cost=? WHERE id=?", r2(actualShipping), poId);
    if (po.source_type === "sales_order" && po.source_id) recalcSO(po.source_id);
  });
  receive();
  return c.json(ok(purchaseOrderView(qGet("SELECT * FROM purchase_orders WHERE id=?", poId))));
});
api.delete("/purchase-orders/:id", c => { qRun("UPDATE purchase_orders SET status='cancelada',updated_at=? WHERE id=?", now(), c.req.param("id")); return c.json(ok(true)); });

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
      if (share > 0) qRun("INSERT INTO withdrawals(kind,partner_name,amount,month,dividend_order_id,paid_from_account,notes,created_at) VALUES ('dividend',?,?,?,?,?,?,?)", p.name, share, row.month, row.id, normAccount(b.paid_from_account || "Axel"), `Dividendos ${row.month}`, now());
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

api.get("/capital-contributions", c => c.json(ok(qAll("SELECT * FROM capital_contributions ORDER BY id DESC"))));
api.post("/capital-contributions", async c => {
  const b = await body(c); req(normPartner(b.partner_name), "Socio obligatorio"); req(num(b.amount)>0, "Monto inválido"); req(b.description, "Descripción obligatoria");
  const requestId = b.capital_request_id ? Number(b.capital_request_id) : null;
  const r = qRun("INSERT INTO capital_contributions(partner_name,amount,description,contribution_date,capital_request_id,received_account,created_at) VALUES (?,?,?,?,?,?,?)", normPartner(b.partner_name), r2(num(b.amount)), b.description, b.contribution_date||today(), requestId, normAccount(b.received_account || b.partner_name), now());
  if (requestId) refreshCapitalRequest(requestId);
  return c.json(ok(qGet("SELECT * FROM capital_contributions WHERE id=?", Number(r.lastInsertRowid))));
});
api.put("/capital-contributions/:id", async c => { const b = await body(c); qRun("UPDATE capital_contributions SET partner_name=?,amount=?,description=?,contribution_date=?,received_account=? WHERE id=?", normPartner(b.partner_name), r2(num(b.amount)), b.description, b.contribution_date, normAccount(b.received_account || b.partner_name), c.req.param("id")); if (b.capital_request_id) refreshCapitalRequest(Number(b.capital_request_id)); return c.json(ok(true)); });
api.delete("/capital-contributions/:id", c => { qRun("DELETE FROM capital_contributions WHERE id=?", c.req.param("id")); return c.json(ok(true)); });

api.get("/withdrawals", c => c.json(ok(qAll("SELECT * FROM withdrawals ORDER BY id DESC"))));
api.post("/withdrawals/capital-return", async c => {
  const b = await body(c); req(normPartner(b.partner_name), "Socio obligatorio"); req(num(b.amount)>0, "Monto inválido");
  const f = finance(); req(f.cash >= num(b.amount), "Sin fondos");
  const pn = normPartner(b.partner_name);
  const contrib = Number(qVal("SELECT COALESCE(SUM(amount),0) AS v FROM capital_contributions WHERE partner_name=?", pn) ?? 0);
  const recovered = Number(qVal("SELECT COALESCE(SUM(amount),0) AS v FROM withdrawals WHERE kind='capital_return' AND partner_name=?", pn) ?? 0);
  req(contrib - recovered >= num(b.amount), "Excede el capital pendiente");
  qRun("INSERT INTO withdrawals(kind,partner_name,amount,month,paid_from_account,notes,created_at) VALUES ('capital_return',?,?,?,?,?,?)", pn, r2(num(b.amount)), b.month||thisMonth(), normAccount(b.paid_from_account || "Axel"), b.notes||"Retorno de capital", now());
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
      if (share > 0) qRun("INSERT INTO withdrawals(kind,partner_name,amount,month,paid_from_account,notes,created_at) VALUES ('dividend',?,?,?,?,?,?)", p.name, share, b.month||thisMonth(), normAccount(b.paid_from_account || "Axel"), `Dividendos ${b.month||thisMonth()}`, now());
    }
  });
  div();
  return c.json(ok(true));
});
api.delete("/withdrawals/:id", c => { qRun("DELETE FROM withdrawals WHERE id=?", c.req.param("id")); return c.json(ok(true)); });

// ===== EXPENSES =====
api.get("/expenses", c => { const m = c.req.query("month"); const sql = m ? "SELECT e.*, ec.name AS category_name FROM expenses e JOIN expense_categories ec ON ec.id=e.category_id WHERE substr(e.expense_date,1,7)=? ORDER BY e.id DESC" : "SELECT e.*, ec.name AS category_name FROM expenses e JOIN expense_categories ec ON ec.id=e.category_id ORDER BY e.id DESC"; return c.json(ok(m ? qAll(sql, m) : qAll(sql))); });
api.post("/expenses", async c => {
  const b = await body(c); req(b.category_id, "Categoría obligatoria"); req(num(b.amount)>0, "Monto inválido");
  const funding = expenseFunding(b);
  const amount = r2(num(b.amount));
  const date = b.expense_date || today();
  if (funding.fromCashbox && funding.paidFromAccount === "Caja chica") {
    const balances = accountBalances();
    const available = Number(balances["Caja chica"] || 0);
    req(available >= amount, `Sin fondos en caja chica. Disponible: $${available.toFixed(2)}`);
  }
  const create = tx(() => {
    registerDirectFunding(funding.partner, amount, date, `Gasto pagado por ${funding.partner}: ${b.description || "sin descripción"}`, funding.partner);
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
    return Number(r.lastInsertRowid);
  });
  const id = create();
  return c.json(ok(qGet("SELECT * FROM expenses WHERE id=?", id)));
});
api.put("/expenses/:id", async c => {
  const b = await body(c);
  const funding = expenseFunding(b);
  qRun("UPDATE expenses SET expense_date=?,category_id=?,amount=?,description=?,paid_by=?,supplier=?,notes=?,from_cashbox=?,from_utilities=?,paid_from_account=? WHERE id=?", b.expense_date, b.category_id, r2(num(b.amount)), b.description, funding.paidBy, b.supplier, b.notes, funding.fromCashbox, funding.fromUtilities, funding.paidFromAccount, c.req.param("id"));
  return c.json(ok(true));
});
api.delete("/expenses/:id", c => { qRun("DELETE FROM expenses WHERE id=?", c.req.param("id")); return c.json(ok(true)); });

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
  const create = tx(() => {
    const gi = qGet<any>("SELECT * FROM inventory_items WHERE id=?", b.green_inventory_item_id);
    req(gi, "Inventario no encontrado"); req(gi.item_type === "green_coffee", "Debe ser café verde");
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

// ===== MACHINE LOGS =====
api.get("/machine-logs", c => c.json(ok(qAll("SELECT * FROM machine_logs ORDER BY log_date DESC, id DESC"))));
api.post("/machine-logs", async c => {
  const b = await body(c); req(b.log_date, "Fecha obligatoria"); req(b.log_type, "Tipo obligatorio"); req(b.description, "Descripción obligatoria");
  const cost = r2(num(b.cost));
  const funding = expenseFunding(b);
  const create = tx(() => {
    if (cost > 0 && funding.fromCashbox && funding.paidFromAccount === "Caja chica") { const balances = accountBalances(); req(Number(balances["Caja chica"] || 0) >= cost, "Sin fondos en caja chica"); }
    if (cost > 0) registerDirectFunding(funding.partner, cost, b.log_date, `Máquina pagada por ${funding.partner}: ${b.description}`, funding.partner);
    const r = qRun("INSERT INTO machine_logs(log_date,log_type,description,cost,registered_by,expense_id,created_at) VALUES (?,?,?,?,?,NULL,?)", b.log_date, b.log_type, b.description, cost, b.registered_by||null, now());
    const logId = Number(r.lastInsertRowid);
    if (cost > 0) {
      const expId = autoExpense("Mantenimiento", cost, `Máquina · ${b.log_type} · ${b.description}`, funding.paidBy || b.registered_by || "Caja chica", "machine_log", logId, funding.fromCashbox, funding.fromUtilities, funding.paidFromAccount);
      qRun("UPDATE machine_logs SET expense_id=? WHERE id=?", expId, logId);
    }
    return qGet("SELECT * FROM machine_logs WHERE id=?", logId);
  });
  return c.json(ok(create()));
});
api.put("/machine-logs/:id", async c => { const b = await body(c); qRun("UPDATE machine_logs SET log_date=?,log_type=?,description=?,cost=?,registered_by=? WHERE id=?", b.log_date, b.log_type, b.description, r2(num(b.cost)), b.registered_by, c.req.param("id")); return c.json(ok(true)); });
api.delete("/machine-logs/:id", c => {
  const row = qGet<any>("SELECT * FROM machine_logs WHERE id=?", c.req.param("id"));
  if (row?.expense_id) qRun("DELETE FROM expenses WHERE id=?", row.expense_id);
  qRun("DELETE FROM machine_logs WHERE id=?", c.req.param("id")); return c.json(ok(true));
});

export default api;
