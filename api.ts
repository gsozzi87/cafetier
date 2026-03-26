import { Hono } from "hono";
import db from "./db";

const api = new Hono();

// ===================== HELPERS =====================
function ok(data: any) { return { success: true, data }; }
function err(msg: string) { return { success: false, error: msg }; }

// ===================== AUTH =====================
api.post("/auth/login", async (c) => {
  const { username, password } = await c.req.json();
  const user = db.prepare("SELECT id, username, display_name, profit_share FROM users WHERE username = ? AND password = ?").get(username, password) as any;
  if (!user) return c.json(err("Credenciales incorrectas"), 401);
  return c.json(ok(user));
});

// ===================== SETTINGS =====================
api.get("/settings", (c) => {
  const rows = db.prepare("SELECT key, value FROM settings").all() as any[];
  const settings: any = {};
  rows.forEach((r: any) => settings[r.key] = r.value);
  return c.json(ok(settings));
});

api.put("/settings", async (c) => {
  const body = await c.req.json();
  const stmt = db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)");
  for (const [key, value] of Object.entries(body)) {
    stmt.run(key, String(value));
  }
  return c.json(ok(true));
});

// ===================== USERS =====================
api.get("/users", (c) => {
  return c.json(ok(db.prepare("SELECT * FROM users ORDER BY id").all()));
});

api.put("/users/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  db.prepare("UPDATE users SET display_name=?, profit_share=?, password=? WHERE id=?")
    .run(body.display_name, body.profit_share, body.password, id);
  return c.json(ok(true));
});

// ===================== CATALOG LISTS (roast_profiles, origins, varieties, expense_categories) =====================
for (const table of ["roast_profiles", "origins", "varieties", "expense_categories"]) {
  api.get(`/${table}`, (c) => {
    return c.json(ok(db.prepare(`SELECT * FROM ${table} WHERE active=1 ORDER BY name`).all()));
  });

  api.get(`/${table}/all`, (c) => {
    return c.json(ok(db.prepare(`SELECT * FROM ${table} ORDER BY name`).all()));
  });

  api.post(`/${table}`, async (c) => {
    const body = await c.req.json();
    const cols = Object.keys(body).join(",");
    const placeholders = Object.keys(body).map(() => "?").join(",");
    const result = db.prepare(`INSERT INTO ${table} (${cols}) VALUES (${placeholders})`).run(...Object.values(body));
    return c.json(ok({ id: result.lastInsertRowid }));
  });

  api.put(`/${table}/:id`, async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json();
    const sets = Object.keys(body).map(k => `${k}=?`).join(",");
    db.prepare(`UPDATE ${table} SET ${sets} WHERE id=?`).run(...Object.values(body), id);
    return c.json(ok(true));
  });

  api.delete(`/${table}/:id`, (c) => {
    const id = c.req.param("id");
    db.prepare(`UPDATE ${table} SET active=0 WHERE id=?`).run(id);
    return c.json(ok(true));
  });
}

// ===================== CLIENTS =====================
api.get("/clients", (c) => {
  return c.json(ok(db.prepare("SELECT * FROM clients ORDER BY name").all()));
});

api.get("/clients/:id", (c) => {
  const id = c.req.param("id");
  const client = db.prepare("SELECT * FROM clients WHERE id=?").get(id);
  const orders = db.prepare("SELECT * FROM orders WHERE client_id=? ORDER BY created_at DESC").all(id);
  return c.json(ok({ client, orders }));
});

api.post("/clients", async (c) => {
  const body = await c.req.json();
  const result = db.prepare("INSERT INTO clients (name, phone, email, address, city, notes) VALUES (?,?,?,?,?,?)")
    .run(body.name, body.phone, body.email, body.address, body.city, body.notes);
  return c.json(ok({ id: result.lastInsertRowid }));
});

api.put("/clients/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  db.prepare("UPDATE clients SET name=?, phone=?, email=?, address=?, city=?, notes=? WHERE id=?")
    .run(body.name, body.phone, body.email, body.address, body.city, body.notes, id);
  return c.json(ok(true));
});

api.delete("/clients/:id", (c) => {
  db.prepare("DELETE FROM clients WHERE id=?").run(c.req.param("id"));
  return c.json(ok(true));
});

// ===================== PRODUCTS =====================
api.get("/products", (c) => {
  return c.json(ok(db.prepare(`
    SELECT p.*, o.name as origin_name, v.name as variety_name, rp.name as roast_name
    FROM products p
    LEFT JOIN origins o ON p.origin_id=o.id
    LEFT JOIN varieties v ON p.variety_id=v.id
    LEFT JOIN roast_profiles rp ON p.roast_profile_id=rp.id
    WHERE p.active=1 ORDER BY p.name
  `).all()));
});

api.post("/products", async (c) => {
  const b = await c.req.json();
  const result = db.prepare("INSERT INTO products (name,origin_id,variety_id,roast_profile_id,presentation,price) VALUES (?,?,?,?,?,?)")
    .run(b.name, b.origin_id, b.variety_id, b.roast_profile_id, b.presentation, b.price);
  return c.json(ok({ id: result.lastInsertRowid }));
});

api.put("/products/:id", async (c) => {
  const b = await c.req.json();
  db.prepare("UPDATE products SET name=?,origin_id=?,variety_id=?,roast_profile_id=?,presentation=?,price=?,active=? WHERE id=?")
    .run(b.name, b.origin_id, b.variety_id, b.roast_profile_id, b.presentation, b.price, b.active ?? 1, c.req.param("id"));
  return c.json(ok(true));
});

api.delete("/products/:id", (c) => {
  db.prepare("UPDATE products SET active=0 WHERE id=?").run(c.req.param("id"));
  return c.json(ok(true));
});

// ===================== ORDERS =====================
api.get("/orders", (c) => {
  const orders = db.prepare(`
    SELECT o.*, c.name as client_name_full,
    (SELECT COALESCE(SUM(amount),0) FROM order_payments WHERE order_id=o.id) as total_paid,
    (SELECT COALESCE(SUM(kg_shipped),0) FROM order_shipments WHERE order_id=o.id) as total_shipped
    FROM orders o LEFT JOIN clients c ON o.client_id=c.id
    ORDER BY o.created_at DESC
  `).all();
  return c.json(ok(orders));
});

api.get("/orders/:id", (c) => {
  const id = c.req.param("id");
  const order = db.prepare(`
    SELECT o.*, c.name as client_name_full
    FROM orders o LEFT JOIN clients c ON o.client_id=c.id WHERE o.id=?
  `).get(id);
  const items = db.prepare("SELECT * FROM order_items WHERE order_id=?").all(id);
  const payments = db.prepare("SELECT * FROM order_payments WHERE order_id=? ORDER BY payment_date").all(id);
  const shipments = db.prepare("SELECT * FROM order_shipments WHERE order_id=? ORDER BY shipment_date").all(id);

  // Calculate production progress
  const batches = db.prepare("SELECT * FROM roasting_batches WHERE order_id=?").all(id) as any[];
  const roasted_kg = batches.reduce((sum: number, b: any) => sum + (b.roasted_kg || 0), 0);

  // Green coffee check with max loss
  const maxLoss = db.prepare("SELECT MAX(loss_pct) as max_loss FROM roasting_batches WHERE loss_pct IS NOT NULL").get() as any;
  const maxLossPct = maxLoss?.max_loss || 20;

  return c.json(ok({ order, items, payments, shipments, batches, roasted_kg, max_loss_pct: maxLossPct }));
});

api.post("/orders", async (c) => {
  const b = await c.req.json();
  const result = db.prepare(`INSERT INTO orders (client_id, client_name, delivery_date, total_kg, price_per_kg, total_amount, status, notes, is_retail, payment_method, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(b.client_id, b.client_name, b.delivery_date, b.total_kg, b.price_per_kg, b.total_amount, b.status || 'pendiente', b.notes, b.is_retail ? 1 : 0, b.payment_method, b.created_by);

  const orderId = result.lastInsertRowid;

  // Insert items if any
  if (b.items && b.items.length > 0) {
    const stmt = db.prepare("INSERT INTO order_items (order_id, product_id, product_name, quantity, unit, unit_price, subtotal) VALUES (?,?,?,?,?,?,?)");
    for (const item of b.items) {
      stmt.run(orderId, item.product_id, item.product_name, item.quantity, item.unit || 'kg', item.unit_price, item.subtotal);
    }
  }

  // If retail with immediate payment
  if (b.is_retail && b.total_amount > 0 && b.payment_method) {
    db.prepare("INSERT INTO order_payments (order_id, amount, payment_method, registered_by) VALUES (?,?,?,?)")
      .run(orderId, b.total_amount, b.payment_method, b.created_by);
    db.prepare("UPDATE orders SET status='pagado' WHERE id=?").run(orderId);
  }

  return c.json(ok({ id: orderId }));
});

api.put("/orders/:id", async (c) => {
  const b = await c.req.json();
  db.prepare(`UPDATE orders SET client_id=?, client_name=?, delivery_date=?, total_kg=?, price_per_kg=?, total_amount=?, status=?, notes=? WHERE id=?`)
    .run(b.client_id, b.client_name, b.delivery_date, b.total_kg, b.price_per_kg, b.total_amount, b.status, b.notes, c.req.param("id"));
  return c.json(ok(true));
});

api.delete("/orders/:id", (c) => {
  db.prepare("DELETE FROM orders WHERE id=?").run(c.req.param("id"));
  return c.json(ok(true));
});

// Order Payments
api.post("/orders/:id/payments", async (c) => {
  const b = await c.req.json();
  db.prepare("INSERT INTO order_payments (order_id, amount, payment_method, notes, registered_by) VALUES (?,?,?,?,?)")
    .run(c.req.param("id"), b.amount, b.payment_method, b.notes, b.registered_by);
  return c.json(ok(true));
});

api.delete("/payments/:id", (c) => {
  db.prepare("DELETE FROM order_payments WHERE id=?").run(c.req.param("id"));
  return c.json(ok(true));
});

// Order Shipments
api.post("/orders/:id/shipments", async (c) => {
  const b = await c.req.json();
  db.prepare("INSERT INTO order_shipments (order_id, kg_shipped, destination_address, carrier, tracking_number, shipping_cost, notes, registered_by) VALUES (?,?,?,?,?,?,?,?)")
    .run(c.req.param("id"), b.kg_shipped, b.destination_address, b.carrier, b.tracking_number, b.shipping_cost, b.notes, b.registered_by);
  return c.json(ok(true));
});

api.delete("/shipments/:id", (c) => {
  db.prepare("DELETE FROM order_shipments WHERE id=?").run(c.req.param("id"));
  return c.json(ok(true));
});

// ===================== ROASTING SESSIONS & BATCHES =====================
api.get("/roasting", (c) => {
  const sessions = db.prepare(`
    SELECT rs.*, 
    (SELECT COUNT(*) FROM roasting_batches WHERE session_id=rs.id) as batch_count,
    (SELECT COALESCE(SUM(green_kg),0) FROM roasting_batches WHERE session_id=rs.id) as total_green,
    (SELECT COALESCE(SUM(roasted_kg),0) FROM roasting_batches WHERE session_id=rs.id) as total_roasted
    FROM roasting_sessions rs ORDER BY rs.session_date DESC
  `).all();
  return c.json(ok(sessions));
});

api.get("/roasting/:id", (c) => {
  const id = c.req.param("id");
  const session = db.prepare("SELECT * FROM roasting_sessions WHERE id=?").get(id);
  const batches = db.prepare(`
    SELECT rb.*, o.name as origin_name, v.name as variety_name, rp.name as roast_name
    FROM roasting_batches rb
    LEFT JOIN origins o ON rb.origin_id=o.id
    LEFT JOIN varieties v ON rb.variety_id=v.id
    LEFT JOIN roast_profiles rp ON rb.roast_profile_id=rp.id
    WHERE rb.session_id=? ORDER BY rb.batch_number
  `).all(id);
  return c.json(ok({ session, batches }));
});

api.post("/roasting", async (c) => {
  const b = await c.req.json();
  const result = db.prepare("INSERT INTO roasting_sessions (session_date, operator, notes) VALUES (?,?,?)")
    .run(b.session_date, b.operator, b.notes);
  return c.json(ok({ id: result.lastInsertRowid }));
});

api.put("/roasting/:id", async (c) => {
  const b = await c.req.json();
  db.prepare("UPDATE roasting_sessions SET session_date=?, operator=?, notes=? WHERE id=?")
    .run(b.session_date, b.operator, b.notes, c.req.param("id"));
  return c.json(ok(true));
});

api.delete("/roasting/:id", (c) => {
  db.prepare("DELETE FROM roasting_sessions WHERE id=?").run(c.req.param("id"));
  return c.json(ok(true));
});

// Batches
api.post("/roasting/:id/batches", async (c) => {
  const sessionId = c.req.param("id");
  const b = await c.req.json();

  // Auto-generate batch number
  const count = db.prepare("SELECT COUNT(*) as c FROM roasting_batches WHERE session_id=?").get(sessionId) as any;
  const session = db.prepare("SELECT session_date FROM roasting_sessions WHERE id=?").get(sessionId) as any;
  const dateStr = session.session_date.replace(/-/g, '');
  const batchNum = `B-${dateStr}-${String(count.c + 1).padStart(2, '0')}`;

  const lossPct = b.roasted_kg ? ((b.green_kg - b.roasted_kg) / b.green_kg * 100) : null;

  const result = db.prepare(`INSERT INTO roasting_batches (session_id, batch_number, origin_id, variety_id, roast_profile_id, green_kg, roasted_kg, loss_pct, order_id, machine_hours, notes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(sessionId, batchNum, b.origin_id, b.variety_id, b.roast_profile_id, b.green_kg, b.roasted_kg, lossPct, b.order_id, b.machine_hours, b.notes);

  return c.json(ok({ id: result.lastInsertRowid, batch_number: batchNum }));
});

api.put("/batches/:id", async (c) => {
  const b = await c.req.json();
  const lossPct = b.roasted_kg ? ((b.green_kg - b.roasted_kg) / b.green_kg * 100) : null;
  db.prepare(`UPDATE roasting_batches SET origin_id=?, variety_id=?, roast_profile_id=?, green_kg=?, roasted_kg=?, loss_pct=?, order_id=?, machine_hours=?, quality_rating=?, ai_analysis=?, notes=? WHERE id=?`)
    .run(b.origin_id, b.variety_id, b.roast_profile_id, b.green_kg, b.roasted_kg, lossPct, b.order_id, b.machine_hours, b.quality_rating, b.ai_analysis, b.notes, c.req.param("id"));
  return c.json(ok(true));
});

api.delete("/batches/:id", (c) => {
  db.prepare("DELETE FROM roasting_batches WHERE id=?").run(c.req.param("id"));
  return c.json(ok(true));
});

// Artisan file upload & AI analysis
api.post("/batches/:id/artisan", async (c) => {
  const id = c.req.param("id");
  const formData = await c.req.formData();
  const file = formData.get("file") as File;
  if (!file) return c.json(err("No file"), 400);

  const content = await file.text();
  const fileName = file.name;

  // Save file reference
  db.prepare("UPDATE roasting_batches SET artisan_file_name=?, artisan_file_path=? WHERE id=?")
    .run(fileName, content, id);

  // Get API key
  const apiKey = (db.prepare("SELECT value FROM settings WHERE key='claude_api_key'").get() as any)?.value;
  if (!apiKey) return c.json(ok({ analysis: "⚠️ Configura tu API Key de Claude en Configuración para obtener análisis AI de las curvas." }));

  // Get batch details
  const batch = db.prepare(`
    SELECT rb.*, o.name as origin_name, v.name as variety_name, rp.name as roast_name
    FROM roasting_batches rb
    LEFT JOIN origins o ON rb.origin_id=o.id
    LEFT JOIN varieties v ON rb.variety_id=v.id
    LEFT JOIN roast_profiles rp ON rb.roast_profile_id=rp.id
    WHERE rb.id=?
  `).get(id) as any;

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2000,
        messages: [{
          role: "user",
          content: `Eres un experto tostador de café y analista de curvas de tueste. Analiza esta curva de Artisan y dame tu evaluación profesional.

Datos del batch:
- Origen: ${batch.origin_name || 'No especificado'}
- Variedad: ${batch.variety_name || 'No especificada'}
- Perfil objetivo: ${batch.roast_name || 'No especificado'}
- Café verde entrada: ${batch.green_kg} kg
- Café tostado salida: ${batch.roasted_kg || 'No registrado'} kg
- Merma: ${batch.loss_pct ? batch.loss_pct.toFixed(1) + '%' : 'No calculada'}

Archivo de curva Artisan:
${content}

Analiza:
1. Desarrollo general del tueste (tiempo total, fases de secado/Maillard/desarrollo)
2. Comportamiento del Rate of Rise (RoR) - ¿fue limpio y descendente?
3. Punto de primer crack - ¿timing y temperatura adecuados?
4. Cambios de presión de gas y aire - ¿fueron oportunos?
5. ¿Hubo problemas como baking, stalling, scorching, tipping o crashing del RoR?
6. Perfil de sabor esperado basado en la curva
7. RECOMENDACIÓN FINAL: ¿Este café es apto para VENDER tal cual, debería ser MEZCLADO/BLENDED con otro, o debe ser DESCARTADO?

Responde en español, sé directo y práctico. Usa emojis para la recomendación final: ✅ Vender, 🔄 Blendear, ❌ Descartar.`
        }]
      })
    });

    const aiData = await resp.json() as any;
    const analysis = aiData.content?.[0]?.text || "No se pudo obtener análisis";

    // Determine quality rating from analysis
    let quality = null;
    if (analysis.includes("✅")) quality = "vender";
    else if (analysis.includes("🔄")) quality = "blendear";
    else if (analysis.includes("❌")) quality = "descartar";

    db.prepare("UPDATE roasting_batches SET ai_analysis=?, quality_rating=? WHERE id=?").run(analysis, quality, id);

    return c.json(ok({ analysis, quality_rating: quality }));
  } catch (e: any) {
    return c.json(ok({ analysis: `Error al conectar con Claude API: ${e.message}` }));
  }
});

// ===================== PACKAGING =====================
api.get("/packaging", (c) => {
  return c.json(ok(db.prepare(`
    SELECT p.*, rb.batch_number FROM packaging p
    LEFT JOIN roasting_batches rb ON p.batch_id=rb.id
    ORDER BY p.packaging_date DESC
  `).all()));
});

api.post("/packaging", async (c) => {
  const b = await c.req.json();
  const result = db.prepare("INSERT INTO packaging (batch_id, packaging_date, presentation, units, total_kg, operator, notes) VALUES (?,?,?,?,?,?,?)")
    .run(b.batch_id, b.packaging_date, b.presentation, b.units, b.total_kg, b.operator, b.notes);
  return c.json(ok({ id: result.lastInsertRowid }));
});

api.put("/packaging/:id", async (c) => {
  const b = await c.req.json();
  db.prepare("UPDATE packaging SET batch_id=?, packaging_date=?, presentation=?, units=?, total_kg=?, operator=?, notes=? WHERE id=?")
    .run(b.batch_id, b.packaging_date, b.presentation, b.units, b.total_kg, b.operator, b.notes, c.req.param("id"));
  return c.json(ok(true));
});

api.delete("/packaging/:id", (c) => {
  db.prepare("DELETE FROM packaging WHERE id=?").run(c.req.param("id"));
  return c.json(ok(true));
});

// ===================== INVENTORY =====================
api.get("/inventory", (c) => {
  return c.json(ok(db.prepare(`
    SELECT i.*, o.name as origin_name, v.name as variety_name
    FROM inventory i
    LEFT JOIN origins o ON i.origin_id=o.id
    LEFT JOIN varieties v ON i.variety_id=v.id
    ORDER BY i.item_type, i.item_name
  `).all()));
});

api.post("/inventory", async (c) => {
  const b = await c.req.json();
  const result = db.prepare("INSERT INTO inventory (item_type, item_name, quantity, unit, min_stock, origin_id, variety_id, lot_label, notes) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(b.item_type, b.item_name, b.quantity, b.unit, b.min_stock, b.origin_id, b.variety_id, b.lot_label, b.notes);
  return c.json(ok({ id: result.lastInsertRowid }));
});

api.put("/inventory/:id", async (c) => {
  const b = await c.req.json();
  db.prepare("UPDATE inventory SET item_type=?, item_name=?, quantity=?, unit=?, min_stock=?, origin_id=?, variety_id=?, lot_label=?, notes=? WHERE id=?")
    .run(b.item_type, b.item_name, b.quantity, b.unit, b.min_stock, b.origin_id, b.variety_id, b.lot_label, b.notes, c.req.param("id"));
  return c.json(ok(true));
});

api.delete("/inventory/:id", (c) => {
  db.prepare("DELETE FROM inventory WHERE id=?").run(c.req.param("id"));
  return c.json(ok(true));
});

api.post("/inventory/:id/movements", async (c) => {
  const b = await c.req.json();
  const invId = c.req.param("id");
  db.prepare("INSERT INTO inventory_movements (inventory_id, movement_type, quantity, reason, reference_type, reference_id, registered_by) VALUES (?,?,?,?,?,?,?)")
    .run(invId, b.movement_type, b.quantity, b.reason, b.reference_type, b.reference_id, b.registered_by);
  // Update inventory quantity
  const modifier = b.movement_type === 'entrada' ? b.quantity : -b.quantity;
  db.prepare("UPDATE inventory SET quantity = quantity + ? WHERE id=?").run(modifier, invId);
  return c.json(ok(true));
});

api.get("/inventory/:id/movements", (c) => {
  return c.json(ok(db.prepare("SELECT * FROM inventory_movements WHERE inventory_id=? ORDER BY created_at DESC").all(c.req.param("id"))));
});

// ===================== EXPENSES =====================
api.get("/expenses", (c) => {
  const month = c.req.query("month");
  let query = `SELECT e.*, ec.name as category_name, ec.is_direct_cost
    FROM expenses e LEFT JOIN expense_categories ec ON e.category_id=ec.id`;
  if (month) query += ` WHERE e.expense_date LIKE '${month}%'`;
  query += " ORDER BY e.expense_date DESC";
  return c.json(ok(db.prepare(query).all()));
});

api.post("/expenses", async (c) => {
  const b = await c.req.json();
  const result = db.prepare("INSERT INTO expenses (expense_date, category_id, amount, description, paid_by, lot_label, supplier, quantity, quantity_unit, notes) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run(b.expense_date, b.category_id, b.amount, b.description, b.paid_by, b.lot_label, b.supplier, b.quantity, b.quantity_unit, b.notes);
  return c.json(ok({ id: result.lastInsertRowid }));
});

api.put("/expenses/:id", async (c) => {
  const b = await c.req.json();
  db.prepare("UPDATE expenses SET expense_date=?, category_id=?, amount=?, description=?, paid_by=?, lot_label=?, supplier=?, quantity=?, quantity_unit=?, notes=? WHERE id=?")
    .run(b.expense_date, b.category_id, b.amount, b.description, b.paid_by, b.lot_label, b.supplier, b.quantity, b.quantity_unit, b.notes, c.req.param("id"));
  return c.json(ok(true));
});

api.delete("/expenses/:id", (c) => {
  db.prepare("DELETE FROM expenses WHERE id=?").run(c.req.param("id"));
  return c.json(ok(true));
});

// ===================== CAPITAL CONTRIBUTIONS =====================
api.get("/capital", (c) => {
  return c.json(ok(db.prepare("SELECT * FROM capital_contributions ORDER BY contribution_date DESC").all()));
});

api.post("/capital", async (c) => {
  const b = await c.req.json();
  const result = db.prepare("INSERT INTO capital_contributions (user_name, amount, description, contribution_date) VALUES (?,?,?,?)")
    .run(b.user_name, b.amount, b.description, b.contribution_date);
  return c.json(ok({ id: result.lastInsertRowid }));
});

api.put("/capital/:id", async (c) => {
  const b = await c.req.json();
  db.prepare("UPDATE capital_contributions SET user_name=?, amount=?, description=?, contribution_date=?, recovered=?, fully_recovered=? WHERE id=?")
    .run(b.user_name, b.amount, b.description, b.contribution_date, b.recovered, b.fully_recovered ? 1 : 0, c.req.param("id"));
  return c.json(ok(true));
});

api.delete("/capital/:id", (c) => {
  db.prepare("DELETE FROM capital_contributions WHERE id=?").run(c.req.param("id"));
  return c.json(ok(true));
});

// ===================== PROFIT WITHDRAWALS =====================
api.get("/withdrawals", (c) => {
  return c.json(ok(db.prepare("SELECT * FROM profit_withdrawals ORDER BY withdrawal_date DESC").all()));
});

api.post("/withdrawals", async (c) => {
  const b = await c.req.json();
  const result = db.prepare("INSERT INTO profit_withdrawals (user_name, amount, month, notes) VALUES (?,?,?,?)")
    .run(b.user_name, b.amount, b.month, b.notes);
  return c.json(ok({ id: result.lastInsertRowid }));
});

api.delete("/withdrawals/:id", (c) => {
  db.prepare("DELETE FROM profit_withdrawals WHERE id=?").run(c.req.param("id"));
  return c.json(ok(true));
});

// ===================== MACHINE LOG =====================
api.get("/machine-log", (c) => {
  return c.json(ok(db.prepare("SELECT * FROM machine_log ORDER BY log_date DESC").all()));
});

api.post("/machine-log", async (c) => {
  const b = await c.req.json();
  const result = db.prepare("INSERT INTO machine_log (log_date, log_type, description, cost, hours, registered_by) VALUES (?,?,?,?,?,?)")
    .run(b.log_date, b.log_type, b.description, b.cost, b.hours, b.registered_by);
  return c.json(ok({ id: result.lastInsertRowid }));
});

api.put("/machine-log/:id", async (c) => {
  const b = await c.req.json();
  db.prepare("UPDATE machine_log SET log_date=?, log_type=?, description=?, cost=?, hours=?, registered_by=? WHERE id=?")
    .run(b.log_date, b.log_type, b.description, b.cost, b.hours, b.registered_by, c.req.param("id"));
  return c.json(ok(true));
});

api.delete("/machine-log/:id", (c) => {
  db.prepare("DELETE FROM machine_log WHERE id=?").run(c.req.param("id"));
  return c.json(ok(true));
});

// ===================== DASHBOARD / FINANCES =====================
api.get("/dashboard", (c) => {
  const month = c.req.query("month") || new Date().toISOString().slice(0, 7);

  // Revenue this month (payments received)
  const revenue = db.prepare(`
    SELECT COALESCE(SUM(amount),0) as total FROM order_payments
    WHERE payment_date LIKE '${month}%'
  `).get() as any;

  // Direct costs this month
  const directCosts = db.prepare(`
    SELECT COALESCE(SUM(e.amount),0) as total FROM expenses e
    JOIN expense_categories ec ON e.category_id=ec.id
    WHERE ec.is_direct_cost=1 AND e.expense_date LIKE '${month}%'
  `).get() as any;

  // Electricity cost from roasting
  const machineKw = parseFloat((db.prepare("SELECT value FROM settings WHERE key='machine_kw'").get() as any)?.value || "0");
  const kwhPrice = parseFloat((db.prepare("SELECT value FROM settings WHERE key='kwh_price'").get() as any)?.value || "0");
  const machineHours = db.prepare(`
    SELECT COALESCE(SUM(rb.machine_hours),0) as total FROM roasting_batches rb
    JOIN roasting_sessions rs ON rb.session_id=rs.id
    WHERE rs.session_date LIKE '${month}%'
  `).get() as any;
  const electricityCost = machineKw * kwhPrice * (machineHours?.total || 0);

  // Other expenses (non-direct)
  const otherExpenses = db.prepare(`
    SELECT COALESCE(SUM(e.amount),0) as total FROM expenses e
    JOIN expense_categories ec ON e.category_id=ec.id
    WHERE ec.is_direct_cost=0 AND e.expense_date LIKE '${month}%'
  `).get() as any;

  // KG sold this month
  const kgSold = db.prepare(`
    SELECT COALESCE(SUM(oi.quantity),0) as total FROM order_items oi
    JOIN orders o ON oi.order_id=o.id
    WHERE o.created_at LIKE '${month}%'
  `).get() as any;

  // KG roasted this month
  const kgRoasted = db.prepare(`
    SELECT COALESCE(SUM(rb.roasted_kg),0) as roasted, COALESCE(SUM(rb.green_kg),0) as green
    FROM roasting_batches rb
    JOIN roasting_sessions rs ON rb.session_id=rs.id
    WHERE rs.session_date LIKE '${month}%'
  `).get() as any;

  // Max loss ever
  const maxLoss = db.prepare("SELECT MAX(loss_pct) as max_loss FROM roasting_batches WHERE loss_pct IS NOT NULL").get() as any;

  // Avg loss this month
  const avgLoss = db.prepare(`
    SELECT AVG(loss_pct) as avg_loss FROM roasting_batches rb
    JOIN roasting_sessions rs ON rb.session_id=rs.id
    WHERE rb.loss_pct IS NOT NULL AND rs.session_date LIKE '${month}%'
  `).get() as any;

  // Active orders
  const activeOrders = db.prepare(`
    SELECT COUNT(*) as c FROM orders WHERE status NOT IN ('pagado','cancelado','entregado')
  `).get() as any;

  // Capital per user
  const capital = db.prepare(`
    SELECT user_name, SUM(amount) as invested, SUM(recovered) as recovered
    FROM capital_contributions GROUP BY user_name
  `).all();

  // Withdrawals per user
  const withdrawals = db.prepare(`
    SELECT user_name, SUM(amount) as withdrawn FROM profit_withdrawals GROUP BY user_name
  `).all();

  // Expenses by who paid
  const expensesByUser = db.prepare(`
    SELECT paid_by, SUM(amount) as total FROM expenses
    WHERE expense_date LIKE '${month}%' GROUP BY paid_by
  `).all();

  const totalDirectCosts = directCosts.total + electricityCost;
  const grossProfit = revenue.total - totalDirectCosts;
  const netProfit = grossProfit - otherExpenses.total;
  const costPerKg = kgSold.total > 0 ? totalDirectCosts / kgSold.total : 0;
  const revenuePerKg = kgSold.total > 0 ? revenue.total / kgSold.total : 0;

// Profit split fijo Cafetier
const profitShares = [
  {
    name: "Itza + Gastón",
    share: 50,
    amount: netProfit > 0 ? netProfit * 0.5 : 0
  },
  {
    name: "Axel",
    share: 50,
    amount: netProfit > 0 ? netProfit * 0.5 : 0
  }
];

  return c.json(ok({
    month,
    revenue: revenue.total,
    direct_costs: totalDirectCosts,
    electricity_cost: electricityCost,
    other_expenses: otherExpenses.total,
    gross_profit: grossProfit,
    net_profit: netProfit,
    kg_sold: kgSold.total,
    kg_roasted: kgRoasted.roasted,
    kg_green_used: kgRoasted.green,
    cost_per_kg: costPerKg,
    revenue_per_kg: revenuePerKg,
    profit_per_kg: revenuePerKg - costPerKg,
    max_loss_pct: maxLoss?.max_loss || 0,
    avg_loss_pct: avgLoss?.avg_loss || 0,
    active_orders: activeOrders.c,
    capital,
    withdrawals,
    expenses_by_user: expensesByUser,
    profit_shares: profitShares
  }));
});

// Loss history for chart
api.get("/analytics/loss-history", (c) => {
  return c.json(ok(db.prepare(`
    SELECT rb.batch_number, rb.loss_pct, rs.session_date, o.name as origin_name
    FROM roasting_batches rb
    JOIN roasting_sessions rs ON rb.session_id=rs.id
    LEFT JOIN origins o ON rb.origin_id=o.id
    WHERE rb.loss_pct IS NOT NULL
    ORDER BY rs.session_date, rb.batch_number
  `).all()));
});

// Green coffee check for an order
api.get("/orders/:id/green-check", (c) => {
  const id = c.req.param("id");
  const order = db.prepare("SELECT total_kg FROM orders WHERE id=?").get(id) as any;
  if (!order) return c.json(err("Pedido no encontrado"), 404);

  const maxLoss = db.prepare("SELECT MAX(loss_pct) as max_loss FROM roasting_batches WHERE loss_pct IS NOT NULL").get() as any;
  const maxLossPct = maxLoss?.max_loss || 20;
  const greenNeeded = order.total_kg / (1 - maxLossPct / 100);

  const greenStock = db.prepare(`
    SELECT COALESCE(SUM(quantity),0) as total FROM inventory WHERE item_type='cafe_verde'
  `).get() as any;

  // Already roasted for this order
  const roastedForOrder = db.prepare(`
    SELECT COALESCE(SUM(roasted_kg),0) as roasted, COALESCE(SUM(green_kg),0) as green_used
    FROM roasting_batches WHERE order_id=?
  `).get(id) as any;

  const remaining_kg = order.total_kg - roastedForOrder.roasted;
  const greenNeededRemaining = remaining_kg > 0 ? remaining_kg / (1 - maxLossPct / 100) : 0;

  return c.json(ok({
    total_kg_ordered: order.total_kg,
    max_loss_pct: maxLossPct,
    green_needed_total: greenNeeded,
    green_stock: greenStock.total,
    green_already_used: roastedForOrder.green_used,
    roasted_so_far: roastedForOrder.roasted,
    remaining_to_roast: remaining_kg,
    green_needed_remaining: greenNeededRemaining,
    sufficient: greenStock.total >= greenNeededRemaining,
    deficit: greenNeededRemaining > greenStock.total ? greenNeededRemaining - greenStock.total : 0
  }));
});

export default api;
