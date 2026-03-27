import { Hono } from "hono";
import db from "./db";

const api = new Hono();
function ok(data: any) { return { success: true, data }; }
function err(msg: string) { return { success: false, error: msg }; }

// ===== SETTINGS =====
api.get("/settings", (c) => {
  const rows = db.prepare("SELECT key, value FROM settings").all() as any[];
  const s: any = {}; rows.forEach((r: any) => s[r.key] = r.value);
  return c.json(ok(s));
});
api.put("/settings", async (c) => {
  const body = await c.req.json();
  const stmt = db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)");
  for (const [k, v] of Object.entries(body)) stmt.run(k, String(v));
  return c.json(ok(true));
});

// ===== PARTNERS =====
api.get("/partners", (c) => c.json(ok(db.prepare("SELECT * FROM partners ORDER BY id").all())));
api.put("/partners/:id", async (c) => {
  const b = await c.req.json();
  db.prepare("UPDATE partners SET name=?, profit_share=? WHERE id=?").run(b.name, b.profit_share, c.req.param("id"));
  return c.json(ok(true));
});

// ===== CATALOG LISTS =====
for (const table of ["roast_profiles", "origins", "varieties", "expense_categories"]) {
  api.get(`/${table}`, (c) => c.json(ok(db.prepare(`SELECT * FROM ${table} WHERE active=1 ORDER BY name`).all())));
  api.get(`/${table}/all`, (c) => c.json(ok(db.prepare(`SELECT * FROM ${table} ORDER BY name`).all())));
  api.post(`/${table}`, async (c) => {
    const body = await c.req.json();
    const cols = Object.keys(body).join(",");
    const ph = Object.keys(body).map(() => "?").join(",");
    const r = db.prepare(`INSERT INTO ${table} (${cols}) VALUES (${ph})`).run(...Object.values(body));
    return c.json(ok({ id: r.lastInsertRowid }));
  });
  api.put(`/${table}/:id`, async (c) => {
    const body = await c.req.json();
    const sets = Object.keys(body).map(k => `${k}=?`).join(",");
    db.prepare(`UPDATE ${table} SET ${sets} WHERE id=?`).run(...Object.values(body), c.req.param("id"));
    return c.json(ok(true));
  });
  api.delete(`/${table}/:id`, (c) => { db.prepare(`UPDATE ${table} SET active=0 WHERE id=?`).run(c.req.param("id")); return c.json(ok(true)); });
}

// ===== CLIENTS =====
api.get("/clients", (c) => c.json(ok(db.prepare("SELECT * FROM clients ORDER BY name").all())));
api.get("/clients/:id", (c) => {
  const id = c.req.param("id");
  return c.json(ok({ client: db.prepare("SELECT * FROM clients WHERE id=?").get(id), orders: db.prepare("SELECT * FROM orders WHERE client_id=? ORDER BY created_at DESC").all(id) }));
});
api.post("/clients", async (c) => {
  const b = await c.req.json();
  const r = db.prepare("INSERT INTO clients (name,phone,email,address,city,notes) VALUES (?,?,?,?,?,?)").run(b.name,b.phone,b.email,b.address,b.city,b.notes);
  return c.json(ok({ id: r.lastInsertRowid }));
});
api.put("/clients/:id", async (c) => {
  const b = await c.req.json();
  db.prepare("UPDATE clients SET name=?,phone=?,email=?,address=?,city=?,notes=? WHERE id=?").run(b.name,b.phone,b.email,b.address,b.city,b.notes,c.req.param("id"));
  return c.json(ok(true));
});
api.delete("/clients/:id", (c) => { db.prepare("DELETE FROM clients WHERE id=?").run(c.req.param("id")); return c.json(ok(true)); });

// ===== PRODUCTS =====
api.get("/products", (c) => c.json(ok(db.prepare(`SELECT p.*, o.name as origin_name, v.name as variety_name, rp.name as roast_name FROM products p LEFT JOIN origins o ON p.origin_id=o.id LEFT JOIN varieties v ON p.variety_id=v.id LEFT JOIN roast_profiles rp ON p.roast_profile_id=rp.id WHERE p.active=1 ORDER BY p.name`).all())));
api.post("/products", async (c) => {
  const b = await c.req.json();
  const r = db.prepare("INSERT INTO products (name,origin_id,variety_id,roast_profile_id,presentation,price) VALUES (?,?,?,?,?,?)").run(b.name,b.origin_id,b.variety_id,b.roast_profile_id,b.presentation,b.price);
  return c.json(ok({ id: r.lastInsertRowid }));
});
api.put("/products/:id", async (c) => {
  const b = await c.req.json();
  db.prepare("UPDATE products SET name=?,origin_id=?,variety_id=?,roast_profile_id=?,presentation=?,price=?,active=? WHERE id=?").run(b.name,b.origin_id,b.variety_id,b.roast_profile_id,b.presentation,b.price,b.active??1,c.req.param("id"));
  return c.json(ok(true));
});
api.delete("/products/:id", (c) => { db.prepare("UPDATE products SET active=0 WHERE id=?").run(c.req.param("id")); return c.json(ok(true)); });

// ===== ORDERS =====
api.get("/orders", (c) => c.json(ok(db.prepare(`SELECT o.*, c.name as client_name_full, (SELECT COALESCE(SUM(amount),0) FROM order_payments WHERE order_id=o.id) as total_paid, (SELECT COALESCE(SUM(kg_shipped),0) FROM order_shipments WHERE order_id=o.id) as total_shipped FROM orders o LEFT JOIN clients c ON o.client_id=c.id ORDER BY o.created_at DESC`).all())));
api.get("/orders/:id", (c) => {
  const id = c.req.param("id");
  const order = db.prepare(`SELECT o.*, c.name as client_name_full FROM orders o LEFT JOIN clients c ON o.client_id=c.id WHERE o.id=?`).get(id);
  const items = db.prepare("SELECT * FROM order_items WHERE order_id=?").all(id);
  const payments = db.prepare("SELECT * FROM order_payments WHERE order_id=? ORDER BY payment_date").all(id);
  const shipments = db.prepare("SELECT * FROM order_shipments WHERE order_id=? ORDER BY shipment_date").all(id);
  const batches = db.prepare("SELECT * FROM roasting_batches WHERE order_id=?").all(id) as any[];
  const roasted_kg = batches.reduce((s: number, b: any) => s + (b.roasted_kg || 0), 0);
  const maxLoss = db.prepare("SELECT MAX(loss_pct) as ml FROM roasting_batches WHERE loss_pct IS NOT NULL").get() as any;
  return c.json(ok({ order, items, payments, shipments, batches, roasted_kg, max_loss_pct: maxLoss?.ml || 20 }));
});
api.post("/orders", async (c) => {
  const b = await c.req.json();
  const r = db.prepare(`INSERT INTO orders (client_id,client_name,delivery_date,total_kg,price_per_kg,total_amount,status,notes,is_retail,payment_method,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(b.client_id,b.client_name,b.delivery_date,b.total_kg,b.price_per_kg,b.total_amount,b.status||'pendiente',b.notes,b.is_retail?1:0,b.payment_method,b.created_by);
  const oid = r.lastInsertRowid;
  if (b.items?.length) {
    const st = db.prepare("INSERT INTO order_items (order_id,product_id,product_name,quantity,unit,unit_price,subtotal) VALUES (?,?,?,?,?,?,?)");
    for (const i of b.items) st.run(oid,i.product_id,i.product_name,i.quantity,i.unit||'kg',i.unit_price,i.subtotal);
  }
  if (b.is_retail && b.total_amount > 0 && b.payment_method) {
    db.prepare("INSERT INTO order_payments (order_id,amount,payment_method,registered_by) VALUES (?,?,?,?)").run(oid,b.total_amount,b.payment_method,b.created_by);
    db.prepare("UPDATE orders SET status='pagado' WHERE id=?").run(oid);
  }
  return c.json(ok({ id: oid }));
});
api.put("/orders/:id", async (c) => {
  const b = await c.req.json();
  db.prepare(`UPDATE orders SET client_id=?,client_name=?,delivery_date=?,total_kg=?,price_per_kg=?,total_amount=?,status=?,notes=? WHERE id=?`).run(b.client_id,b.client_name,b.delivery_date,b.total_kg,b.price_per_kg,b.total_amount,b.status,b.notes,c.req.param("id"));
  return c.json(ok(true));
});
api.delete("/orders/:id", (c) => { db.prepare("DELETE FROM orders WHERE id=?").run(c.req.param("id")); return c.json(ok(true)); });

api.post("/orders/:id/payments", async (c) => {
  const b = await c.req.json();
  db.prepare("INSERT INTO order_payments (order_id,amount,payment_method,notes,registered_by) VALUES (?,?,?,?,?)").run(c.req.param("id"),b.amount,b.payment_method,b.notes,b.registered_by);
  return c.json(ok(true));
});
api.delete("/payments/:id", (c) => { db.prepare("DELETE FROM order_payments WHERE id=?").run(c.req.param("id")); return c.json(ok(true)); });

api.post("/orders/:id/shipments", async (c) => {
  const b = await c.req.json();
  db.prepare("INSERT INTO order_shipments (order_id,kg_shipped,destination_address,carrier,tracking_number,shipping_cost,notes,registered_by) VALUES (?,?,?,?,?,?,?,?)").run(c.req.param("id"),b.kg_shipped,b.destination_address,b.carrier,b.tracking_number,b.shipping_cost,b.notes,b.registered_by);
  return c.json(ok(true));
});
api.delete("/shipments/:id", (c) => { db.prepare("DELETE FROM order_shipments WHERE id=?").run(c.req.param("id")); return c.json(ok(true)); });

// ===== ROASTING =====
api.get("/roasting", (c) => c.json(ok(db.prepare(`SELECT rs.*, (SELECT COUNT(*) FROM roasting_batches WHERE session_id=rs.id) as batch_count, (SELECT COALESCE(SUM(green_kg),0) FROM roasting_batches WHERE session_id=rs.id) as total_green, (SELECT COALESCE(SUM(roasted_kg),0) FROM roasting_batches WHERE session_id=rs.id) as total_roasted FROM roasting_sessions rs ORDER BY rs.session_date DESC`).all())));
api.get("/roasting/:id", (c) => {
  const id = c.req.param("id");
  return c.json(ok({ session: db.prepare("SELECT * FROM roasting_sessions WHERE id=?").get(id), batches: db.prepare(`SELECT rb.*, o.name as origin_name, v.name as variety_name, rp.name as roast_name FROM roasting_batches rb LEFT JOIN origins o ON rb.origin_id=o.id LEFT JOIN varieties v ON rb.variety_id=v.id LEFT JOIN roast_profiles rp ON rb.roast_profile_id=rp.id WHERE rb.session_id=? ORDER BY rb.batch_number`).all(id) }));
});
api.post("/roasting", async (c) => {
  const b = await c.req.json();
  const r = db.prepare("INSERT INTO roasting_sessions (session_date,operator,notes) VALUES (?,?,?)").run(b.session_date,b.operator,b.notes);
  return c.json(ok({ id: r.lastInsertRowid }));
});
api.put("/roasting/:id", async (c) => {
  const b = await c.req.json();
  db.prepare("UPDATE roasting_sessions SET session_date=?,operator=?,notes=? WHERE id=?").run(b.session_date,b.operator,b.notes,c.req.param("id"));
  return c.json(ok(true));
});
api.delete("/roasting/:id", (c) => { db.prepare("DELETE FROM roasting_sessions WHERE id=?").run(c.req.param("id")); return c.json(ok(true)); });

api.post("/roasting/:id/batches", async (c) => {
  const sid = c.req.param("id"); const b = await c.req.json();
  const cnt = db.prepare("SELECT COUNT(*) as c FROM roasting_batches WHERE session_id=?").get(sid) as any;
  const sess = db.prepare("SELECT session_date FROM roasting_sessions WHERE id=?").get(sid) as any;
  const bn = `B-${sess.session_date.replace(/-/g,'')}-${String(cnt.c+1).padStart(2,'0')}`;
  const lp = b.roasted_kg ? ((b.green_kg - b.roasted_kg) / b.green_kg * 100) : null;
  const r = db.prepare(`INSERT INTO roasting_batches (session_id,batch_number,origin_id,variety_id,roast_profile_id,green_kg,roasted_kg,loss_pct,order_id,machine_hours,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(sid,bn,b.origin_id,b.variety_id,b.roast_profile_id,b.green_kg,b.roasted_kg,lp,b.order_id,b.machine_hours,b.notes);
  return c.json(ok({ id: r.lastInsertRowid, batch_number: bn }));
});
api.put("/batches/:id", async (c) => {
  const b = await c.req.json();
  const lp = b.roasted_kg ? ((b.green_kg - b.roasted_kg) / b.green_kg * 100) : null;
  db.prepare(`UPDATE roasting_batches SET origin_id=?,variety_id=?,roast_profile_id=?,green_kg=?,roasted_kg=?,loss_pct=?,order_id=?,machine_hours=?,quality_rating=?,ai_analysis=?,notes=? WHERE id=?`).run(b.origin_id,b.variety_id,b.roast_profile_id,b.green_kg,b.roasted_kg,lp,b.order_id,b.machine_hours,b.quality_rating,b.ai_analysis,b.notes,c.req.param("id"));
  return c.json(ok(true));
});
api.delete("/batches/:id", (c) => { db.prepare("DELETE FROM roasting_batches WHERE id=?").run(c.req.param("id")); return c.json(ok(true)); });

// Artisan upload + AI
api.post("/batches/:id/artisan", async (c) => {
  const id = c.req.param("id");
  const fd = await c.req.formData(); const file = fd.get("file") as File;
  if (!file) return c.json(err("No file"), 400);
  const content = await file.text();
  db.prepare("UPDATE roasting_batches SET artisan_file_name=?, artisan_file_path=? WHERE id=?").run(file.name, content, id);
  const apiKey = (db.prepare("SELECT value FROM settings WHERE key='claude_api_key'").get() as any)?.value;
  if (!apiKey) return c.json(ok({ analysis: "⚠️ Configura tu API Key de Claude en Configuración para obtener análisis AI." }));
  const batch = db.prepare(`SELECT rb.*, o.name as origin_name, v.name as variety_name, rp.name as roast_name FROM roasting_batches rb LEFT JOIN origins o ON rb.origin_id=o.id LEFT JOIN varieties v ON rb.variety_id=v.id LEFT JOIN roast_profiles rp ON rb.roast_profile_id=rp.id WHERE rb.id=?`).get(id) as any;
  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type":"application/json", "x-api-key":apiKey, "anthropic-version":"2023-06-01" },
      body: JSON.stringify({ model:"claude-sonnet-4-20250514", max_tokens:2000, messages:[{role:"user",content:`Eres un experto tostador de café. Analiza esta curva de Artisan.\n\nBatch: ${batch.batch_number}\nOrigen: ${batch.origin_name||'?'}\nVariedad: ${batch.variety_name||'?'}\nPerfil: ${batch.roast_name||'?'}\nVerde: ${batch.green_kg}kg → Tostado: ${batch.roasted_kg||'?'}kg\nMerma: ${batch.loss_pct?batch.loss_pct.toFixed(1)+'%':'?'}\n\nCurva:\n${content}\n\nAnaliza: 1)Desarrollo general 2)RoR 3)Primer crack 4)Cambios de gas/aire 5)Problemas(baking,stalling,etc) 6)Perfil de sabor esperado 7)RECOMENDACIÓN: ✅Vender 🔄Blendear ❌Descartar\n\nResponde en español, sé directo.`}]})
    });
    const ai = await resp.json() as any;
    const analysis = ai.content?.[0]?.text || "No se pudo analizar";
    let q = null;
    if (analysis.includes("✅")) q = "vender"; else if (analysis.includes("🔄")) q = "blendear"; else if (analysis.includes("❌")) q = "descartar";
    db.prepare("UPDATE roasting_batches SET ai_analysis=?, quality_rating=? WHERE id=?").run(analysis, q, id);
    return c.json(ok({ analysis, quality_rating: q }));
  } catch (e: any) { return c.json(ok({ analysis: `Error: ${e.message}` })); }
});

// ===== PACKAGING =====
api.get("/packaging", (c) => c.json(ok(db.prepare(`SELECT p.*, rb.batch_number FROM packaging p LEFT JOIN roasting_batches rb ON p.batch_id=rb.id ORDER BY p.packaging_date DESC`).all())));
api.post("/packaging", async (c) => { const b = await c.req.json(); const r = db.prepare("INSERT INTO packaging (batch_id,packaging_date,presentation,units,total_kg,operator,notes) VALUES (?,?,?,?,?,?,?)").run(b.batch_id,b.packaging_date,b.presentation,b.units,b.total_kg,b.operator,b.notes); return c.json(ok({id:r.lastInsertRowid})); });
api.put("/packaging/:id", async (c) => { const b = await c.req.json(); db.prepare("UPDATE packaging SET batch_id=?,packaging_date=?,presentation=?,units=?,total_kg=?,operator=?,notes=? WHERE id=?").run(b.batch_id,b.packaging_date,b.presentation,b.units,b.total_kg,b.operator,b.notes,c.req.param("id")); return c.json(ok(true)); });
api.delete("/packaging/:id", (c) => { db.prepare("DELETE FROM packaging WHERE id=?").run(c.req.param("id")); return c.json(ok(true)); });

// ===== INVENTORY =====
api.get("/inventory", (c) => c.json(ok(db.prepare(`SELECT i.*, o.name as origin_name, v.name as variety_name FROM inventory i LEFT JOIN origins o ON i.origin_id=o.id LEFT JOIN varieties v ON i.variety_id=v.id ORDER BY i.item_type, i.item_name`).all())));
api.post("/inventory", async (c) => { const b = await c.req.json(); const r = db.prepare("INSERT INTO inventory (item_type,item_name,quantity,unit,min_stock,origin_id,variety_id,lot_label,notes) VALUES (?,?,?,?,?,?,?,?,?)").run(b.item_type,b.item_name,b.quantity,b.unit,b.min_stock,b.origin_id,b.variety_id,b.lot_label,b.notes); return c.json(ok({id:r.lastInsertRowid})); });
api.put("/inventory/:id", async (c) => { const b = await c.req.json(); db.prepare("UPDATE inventory SET item_type=?,item_name=?,quantity=?,unit=?,min_stock=?,origin_id=?,variety_id=?,lot_label=?,notes=? WHERE id=?").run(b.item_type,b.item_name,b.quantity,b.unit,b.min_stock,b.origin_id,b.variety_id,b.lot_label,b.notes,c.req.param("id")); return c.json(ok(true)); });
api.delete("/inventory/:id", (c) => { db.prepare("DELETE FROM inventory WHERE id=?").run(c.req.param("id")); return c.json(ok(true)); });
api.post("/inventory/:id/movements", async (c) => {
  const b = await c.req.json(); const invId = c.req.param("id");
  db.prepare("INSERT INTO inventory_movements (inventory_id,movement_type,quantity,reason,reference_type,reference_id,registered_by) VALUES (?,?,?,?,?,?,?)").run(invId,b.movement_type,b.quantity,b.reason,b.reference_type,b.reference_id,b.registered_by);
  const mod = b.movement_type === 'entrada' ? b.quantity : -b.quantity;
  db.prepare("UPDATE inventory SET quantity=quantity+? WHERE id=?").run(mod, invId);
  return c.json(ok(true));
});
api.get("/inventory/:id/movements", (c) => c.json(ok(db.prepare("SELECT * FROM inventory_movements WHERE inventory_id=? ORDER BY created_at DESC").all(c.req.param("id")))));

// ===== EXPENSES =====
api.get("/expenses", (c) => {
  const m = c.req.query("month");
  let q = `SELECT e.*, ec.name as category_name, ec.is_direct_cost FROM expenses e LEFT JOIN expense_categories ec ON e.category_id=ec.id`;
  if (m) q += ` WHERE e.expense_date LIKE '${m}%'`;
  return c.json(ok(db.prepare(q + " ORDER BY e.expense_date DESC").all()));
});
api.post("/expenses", async (c) => { const b = await c.req.json(); const r = db.prepare("INSERT INTO expenses (expense_date,category_id,amount,description,paid_by,lot_label,supplier,quantity,quantity_unit,notes) VALUES (?,?,?,?,?,?,?,?,?,?)").run(b.expense_date,b.category_id,b.amount,b.description,b.paid_by,b.lot_label,b.supplier,b.quantity,b.quantity_unit,b.notes); return c.json(ok({id:r.lastInsertRowid})); });
api.put("/expenses/:id", async (c) => { const b = await c.req.json(); db.prepare("UPDATE expenses SET expense_date=?,category_id=?,amount=?,description=?,paid_by=?,lot_label=?,supplier=?,quantity=?,quantity_unit=?,notes=? WHERE id=?").run(b.expense_date,b.category_id,b.amount,b.description,b.paid_by,b.lot_label,b.supplier,b.quantity,b.quantity_unit,b.notes,c.req.param("id")); return c.json(ok(true)); });
api.delete("/expenses/:id", (c) => { db.prepare("DELETE FROM expenses WHERE id=?").run(c.req.param("id")); return c.json(ok(true)); });

// ===== CAPITAL =====
api.get("/capital", (c) => c.json(ok(db.prepare("SELECT * FROM capital_contributions ORDER BY contribution_date DESC").all())));
api.post("/capital", async (c) => { const b = await c.req.json(); const r = db.prepare("INSERT INTO capital_contributions (partner_name,amount,description,contribution_date) VALUES (?,?,?,?)").run(b.partner_name,b.amount,b.description,b.contribution_date); return c.json(ok({id:r.lastInsertRowid})); });
api.put("/capital/:id", async (c) => { const b = await c.req.json(); db.prepare("UPDATE capital_contributions SET partner_name=?,amount=?,description=?,contribution_date=?,recovered=?,fully_recovered=? WHERE id=?").run(b.partner_name,b.amount,b.description,b.contribution_date,b.recovered,b.fully_recovered?1:0,c.req.param("id")); return c.json(ok(true)); });
api.delete("/capital/:id", (c) => { db.prepare("DELETE FROM capital_contributions WHERE id=?").run(c.req.param("id")); return c.json(ok(true)); });

api.get("/withdrawals", (c) => c.json(ok(db.prepare("SELECT * FROM profit_withdrawals ORDER BY withdrawal_date DESC").all())));
api.post("/withdrawals", async (c) => { const b = await c.req.json(); const r = db.prepare("INSERT INTO profit_withdrawals (partner_name,amount,month,notes) VALUES (?,?,?,?)").run(b.partner_name,b.amount,b.month,b.notes); return c.json(ok({id:r.lastInsertRowid})); });
api.delete("/withdrawals/:id", (c) => { db.prepare("DELETE FROM profit_withdrawals WHERE id=?").run(c.req.param("id")); return c.json(ok(true)); });

// ===== MACHINE LOG =====
api.get("/machine-log", (c) => c.json(ok(db.prepare("SELECT * FROM machine_log ORDER BY log_date DESC").all())));
api.post("/machine-log", async (c) => { const b = await c.req.json(); const r = db.prepare("INSERT INTO machine_log (log_date,log_type,description,cost,hours,registered_by) VALUES (?,?,?,?,?,?)").run(b.log_date,b.log_type,b.description,b.cost,b.hours,b.registered_by); return c.json(ok({id:r.lastInsertRowid})); });
api.put("/machine-log/:id", async (c) => { const b = await c.req.json(); db.prepare("UPDATE machine_log SET log_date=?,log_type=?,description=?,cost=?,hours=?,registered_by=? WHERE id=?").run(b.log_date,b.log_type,b.description,b.cost,b.hours,b.registered_by,c.req.param("id")); return c.json(ok(true)); });
api.delete("/machine-log/:id", (c) => { db.prepare("DELETE FROM machine_log WHERE id=?").run(c.req.param("id")); return c.json(ok(true)); });

// ===== DASHBOARD =====
api.get("/dashboard", (c) => {
  const month = c.req.query("month") || new Date().toISOString().slice(0,7);
  const rev = db.prepare(`SELECT COALESCE(SUM(amount),0) as t FROM order_payments WHERE payment_date LIKE '${month}%'`).get() as any;
  const dc = db.prepare(`SELECT COALESCE(SUM(e.amount),0) as t FROM expenses e JOIN expense_categories ec ON e.category_id=ec.id WHERE ec.is_direct_cost=1 AND e.expense_date LIKE '${month}%'`).get() as any;
  const mkw = parseFloat((db.prepare("SELECT value FROM settings WHERE key='machine_kw'").get() as any)?.value||"0");
  const kwp = parseFloat((db.prepare("SELECT value FROM settings WHERE key='kwh_price'").get() as any)?.value||"0");
  const mh = db.prepare(`SELECT COALESCE(SUM(rb.machine_hours),0) as t FROM roasting_batches rb JOIN roasting_sessions rs ON rb.session_id=rs.id WHERE rs.session_date LIKE '${month}%'`).get() as any;
  const elec = mkw * kwp * (mh?.t||0);
  const oe = db.prepare(`SELECT COALESCE(SUM(e.amount),0) as t FROM expenses e JOIN expense_categories ec ON e.category_id=ec.id WHERE ec.is_direct_cost=0 AND e.expense_date LIKE '${month}%'`).get() as any;
  const kgS = db.prepare(`SELECT COALESCE(SUM(oi.quantity),0) as t FROM order_items oi JOIN orders o ON oi.order_id=o.id WHERE o.created_at LIKE '${month}%'`).get() as any;
  const kgR = db.prepare(`SELECT COALESCE(SUM(rb.roasted_kg),0) as roasted, COALESCE(SUM(rb.green_kg),0) as green FROM roasting_batches rb JOIN roasting_sessions rs ON rb.session_id=rs.id WHERE rs.session_date LIKE '${month}%'`).get() as any;
  const ml = db.prepare("SELECT MAX(loss_pct) as v FROM roasting_batches WHERE loss_pct IS NOT NULL").get() as any;
  const al = db.prepare(`SELECT AVG(loss_pct) as v FROM roasting_batches rb JOIN roasting_sessions rs ON rb.session_id=rs.id WHERE rb.loss_pct IS NOT NULL AND rs.session_date LIKE '${month}%'`).get() as any;
  const ao = db.prepare(`SELECT COUNT(*) as c FROM orders WHERE status NOT IN ('pagado','cancelado','entregado')`).get() as any;
  const cap = db.prepare(`SELECT partner_name, SUM(amount) as invested, SUM(recovered) as recovered FROM capital_contributions GROUP BY partner_name`).all();
  const wth = db.prepare(`SELECT partner_name, SUM(amount) as withdrawn FROM profit_withdrawals GROUP BY partner_name`).all();
  const ebu = db.prepare(`SELECT paid_by, SUM(amount) as total FROM expenses WHERE expense_date LIKE '${month}%' GROUP BY paid_by`).all();

  const tdc = dc.t + elec;
  const gp = rev.t - tdc;
  const np = gp - oe.t;
  const cpk = kgS.t > 0 ? tdc / kgS.t : 0;
  const rpk = kgS.t > 0 ? rev.t / kgS.t : 0;

  // Profit shares: Itza+Gaston together 50%, Axel 50%
  const partners = db.prepare("SELECT * FROM partners ORDER BY id").all() as any[];
  const shares = partners.map((p: any) => ({ name: p.name, share: p.profit_share, amount: np > 0 ? (np * p.profit_share / 100) : 0 }));

  return c.json(ok({
    month, revenue: rev.t, direct_costs: tdc, electricity_cost: elec, other_expenses: oe.t,
    gross_profit: gp, net_profit: np, kg_sold: kgS.t, kg_roasted: kgR.roasted, kg_green_used: kgR.green,
    cost_per_kg: cpk, revenue_per_kg: rpk, profit_per_kg: rpk - cpk,
    max_loss_pct: ml?.v||0, avg_loss_pct: al?.v||0, active_orders: ao.c,
    capital: cap, withdrawals: wth, expenses_by_user: ebu, profit_shares: shares
  }));
});

api.get("/orders/:id/green-check", (c) => {
  const id = c.req.param("id");
  const order = db.prepare("SELECT total_kg FROM orders WHERE id=?").get(id) as any;
  if (!order) return c.json(err("No encontrado"),404);
  const ml = db.prepare("SELECT MAX(loss_pct) as v FROM roasting_batches WHERE loss_pct IS NOT NULL").get() as any;
  const mlp = ml?.v||20;
  const gn = order.total_kg / (1 - mlp/100);
  const gs = db.prepare(`SELECT COALESCE(SUM(quantity),0) as t FROM inventory WHERE item_type='cafe_verde'`).get() as any;
  const rfo = db.prepare(`SELECT COALESCE(SUM(roasted_kg),0) as r, COALESCE(SUM(green_kg),0) as g FROM roasting_batches WHERE order_id=?`).get(id) as any;
  const rem = order.total_kg - rfo.r;
  const gnr = rem > 0 ? rem / (1 - mlp/100) : 0;
  return c.json(ok({ total_kg_ordered:order.total_kg, max_loss_pct:mlp, green_needed_total:gn, green_stock:gs.t, green_already_used:rfo.g, roasted_so_far:rfo.r, remaining_to_roast:rem, green_needed_remaining:gnr, sufficient:gs.t>=gnr, deficit:gnr>gs.t?gnr-gs.t:0 }));
});

export default api;
