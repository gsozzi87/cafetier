import { Hono } from "hono";
import db from "./db";

const api = new Hono();
const ok = (d: any) => ({ success: true, data: d });
const er = (m: string) => ({ success: false, error: m });

// ===== INVENTORY CHECK HELPER =====
function getMaxLoss(): number {
  const r = db.prepare("SELECT MAX(loss_pct) as v FROM roasting_batches WHERE loss_pct IS NOT NULL").get() as any;
  return r?.v || 20; // default 20% if no data
}

function getGreenStock(): number {
  const r = db.prepare("SELECT COALESCE(SUM(quantity),0) as t FROM inventory WHERE item_type='cafe_verde'").get() as any;
  return r?.t || 0;
}

function getRoastedStock(): number {
  const r = db.prepare("SELECT COALESCE(SUM(quantity),0) as t FROM inventory WHERE item_type='cafe_tostado'").get() as any;
  return r?.t || 0;
}

function getPackagedStock(): number {
  const r = db.prepare("SELECT COALESCE(SUM(quantity),0) as t FROM inventory WHERE item_type='cafe_empaquetado'").get() as any;
  return r?.t || 0;
}

interface InventoryCheck {
  kg_needed: number;
  roasted_available: number;
  green_available: number;
  max_loss_pct: number;
  has_roasted: boolean;
  has_green_for_roast: boolean;
  green_needed_for_roast: number;
  green_deficit: number;
  actions: string[];
  auto_actions: { type: string; description: string; kg: number }[];
}

function checkInventoryForKg(kgNeeded: number): InventoryCheck {
  const ml = getMaxLoss();
  const roasted = getRoastedStock();
  const green = getGreenStock();
  const greenNeeded = kgNeeded / (1 - ml / 100);

  const actions: string[] = [];
  const autoActions: { type: string; description: string; kg: number }[] = [];

  let hasRoasted = roasted >= kgNeeded;
  let hasGreen = green >= greenNeeded;
  let greenDeficit = 0;

  if (hasRoasted) {
    actions.push(`✅ Hay ${roasted.toFixed(1)} kg tostados disponibles. Se descontarán ${kgNeeded.toFixed(1)} kg del inventario.`);
  } else if (roasted > 0 && roasted < kgNeeded) {
    const remaining = kgNeeded - roasted;
    const greenForRemaining = remaining / (1 - ml / 100);
    actions.push(`☕ Hay ${roasted.toFixed(1)} kg tostados. Faltan ${remaining.toFixed(1)} kg por tostar.`);

    if (green >= greenForRemaining) {
      actions.push(`🌿 Hay ${green.toFixed(1)} kg de verde. Se necesitan ${greenForRemaining.toFixed(1)} kg para tostar los ${remaining.toFixed(1)} kg faltantes (merma máx ${ml.toFixed(1)}%).`);
      autoActions.push({ type: 'orden_tueste', description: `Tostar ${greenForRemaining.toFixed(1)} kg verde para obtener ~${remaining.toFixed(1)} kg tostado`, kg: greenForRemaining });
    } else {
      greenDeficit = greenForRemaining - green;
      actions.push(`⚠️ Solo hay ${green.toFixed(1)} kg de verde. Se necesitan ${greenForRemaining.toFixed(1)} kg. Faltan ${greenDeficit.toFixed(1)} kg de café verde.`);
      autoActions.push({ type: 'orden_compra', description: `Comprar al menos ${greenDeficit.toFixed(1)} kg de café verde`, kg: greenDeficit });
      if (green > 0) {
        autoActions.push({ type: 'orden_tueste', description: `Tostar los ${green.toFixed(1)} kg de verde disponibles`, kg: green });
      }
    }
  } else {
    // No roasted at all
    if (green >= greenNeeded) {
      actions.push(`🌿 No hay café tostado. Hay ${green.toFixed(1)} kg de verde. Se necesitan ${greenNeeded.toFixed(1)} kg para tostar ${kgNeeded.toFixed(1)} kg (merma máx ${ml.toFixed(1)}%).`);
      autoActions.push({ type: 'orden_tueste', description: `Tostar ${greenNeeded.toFixed(1)} kg verde para obtener ~${kgNeeded.toFixed(1)} kg tostado`, kg: greenNeeded });
    } else {
      greenDeficit = greenNeeded - green;
      actions.push(`⚠️ No hay café tostado. Solo ${green.toFixed(1)} kg de verde. Se necesitan ${greenNeeded.toFixed(1)} kg verde. Faltan ${greenDeficit.toFixed(1)} kg.`);
      autoActions.push({ type: 'orden_compra', description: `Comprar al menos ${greenDeficit.toFixed(1)} kg de café verde`, kg: greenDeficit });
      if (green > 0) {
        autoActions.push({ type: 'orden_tueste', description: `Tostar los ${green.toFixed(1)} kg de verde disponibles`, kg: green });
      }
    }
  }

  return {
    kg_needed: kgNeeded,
    roasted_available: roasted,
    green_available: green,
    max_loss_pct: ml,
    has_roasted: hasRoasted,
    has_green_for_roast: hasGreen,
    green_needed_for_roast: greenNeeded,
    green_deficit: greenDeficit,
    actions,
    auto_actions: autoActions
  };
}

function deductFromInventory(kgToDeduct: number, itemType: string, reason: string) {
  const items = db.prepare("SELECT * FROM inventory WHERE item_type=? AND quantity > 0 ORDER BY id").all(itemType) as any[];
  let remaining = kgToDeduct;
  for (const item of items) {
    if (remaining <= 0) break;
    const deduct = Math.min(remaining, item.quantity);
    db.prepare("UPDATE inventory SET quantity = quantity - ? WHERE id = ?").run(deduct, item.id);
    db.prepare("INSERT INTO inventory_movements (inventory_id, movement_type, quantity, reason, registered_by) VALUES (?,?,?,?,?)").run(item.id, 'salida', deduct, reason, 'Sistema');
    remaining -= deduct;
  }
}

function createPendingActions(orderId: number, autoActions: any[]) {
  const stmt = db.prepare("INSERT INTO pending_actions (action_type, order_id, description, kg_needed) VALUES (?,?,?,?)");
  for (const a of autoActions) {
    stmt.run(a.type, orderId, a.description, a.kg);
  }
}

// ===== INVENTORY CHECK ENDPOINT =====
api.get("/inventory-check", (c) => {
  const kg = parseFloat(c.req.query("kg") || "0");
  if (!kg) return c.json(er("Especifica kg"));
  return c.json(ok(checkInventoryForKg(kg)));
});

// ===== PENDING ACTIONS =====
api.get("/pending-actions", (c) => {
  return c.json(ok(db.prepare("SELECT pa.*, o.client_name FROM pending_actions pa LEFT JOIN orders o ON pa.order_id=o.id WHERE pa.status='pendiente' ORDER BY pa.created_at DESC").all()));
});
api.put("/pending-actions/:id", async (c) => {
  const b = await c.req.json();
  db.prepare("UPDATE pending_actions SET status=? WHERE id=?").run(b.status, c.req.param("id"));
  return c.json(ok(true));
});

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

// ===== CATALOG LISTS =====
for (const table of ["roast_profiles", "origins", "varieties", "expense_categories"]) {
  api.get(`/${table}`, (c) => c.json(ok(db.prepare(`SELECT * FROM ${table} WHERE active=1 ORDER BY name`).all())));
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
api.post("/clients", async (c) => { const b = await c.req.json(); const r = db.prepare("INSERT INTO clients (name,phone,email,address,city,notes) VALUES (?,?,?,?,?,?)").run(b.name,b.phone,b.email,b.address,b.city,b.notes); return c.json(ok({ id: r.lastInsertRowid })); });
api.put("/clients/:id", async (c) => { const b = await c.req.json(); db.prepare("UPDATE clients SET name=?,phone=?,email=?,address=?,city=?,notes=? WHERE id=?").run(b.name,b.phone,b.email,b.address,b.city,b.notes,c.req.param("id")); return c.json(ok(true)); });
api.delete("/clients/:id", (c) => { db.prepare("DELETE FROM clients WHERE id=?").run(c.req.param("id")); return c.json(ok(true)); });

// ===== PRODUCTS =====
api.get("/products", (c) => c.json(ok(db.prepare(`SELECT p.*, o.name as origin_name, v.name as variety_name, rp.name as roast_name FROM products p LEFT JOIN origins o ON p.origin_id=o.id LEFT JOIN varieties v ON p.variety_id=v.id LEFT JOIN roast_profiles rp ON p.roast_profile_id=rp.id WHERE p.active=1 ORDER BY p.name`).all())));
api.post("/products", async (c) => { const b = await c.req.json(); const r = db.prepare("INSERT INTO products (name,origin_id,variety_id,roast_profile_id,presentation,price) VALUES (?,?,?,?,?,?)").run(b.name,b.origin_id,b.variety_id,b.roast_profile_id,b.presentation,b.price); return c.json(ok({ id: r.lastInsertRowid })); });
api.put("/products/:id", async (c) => { const b = await c.req.json(); db.prepare("UPDATE products SET name=?,origin_id=?,variety_id=?,roast_profile_id=?,presentation=?,price=?,active=? WHERE id=?").run(b.name,b.origin_id,b.variety_id,b.roast_profile_id,b.presentation,b.price,b.active??1,c.req.param("id")); return c.json(ok(true)); });
api.delete("/products/:id", (c) => { db.prepare("UPDATE products SET active=0 WHERE id=?").run(c.req.param("id")); return c.json(ok(true)); });

// ===== ORDERS (with inventory check) =====
api.get("/orders", (c) => c.json(ok(db.prepare(`SELECT o.*, c.name as client_name_full, (SELECT COALESCE(SUM(amount),0) FROM order_payments WHERE order_id=o.id) as total_paid, (SELECT COALESCE(SUM(kg_shipped),0) FROM order_shipments WHERE order_id=o.id) as total_shipped FROM orders o LEFT JOIN clients c ON o.client_id=c.id ORDER BY o.created_at DESC`).all())));

api.get("/orders/:id", (c) => {
  const id = c.req.param("id");
  const order = db.prepare(`SELECT o.*, c.name as client_name_full FROM orders o LEFT JOIN clients c ON o.client_id=c.id WHERE o.id=?`).get(id);
  const items = db.prepare("SELECT * FROM order_items WHERE order_id=?").all(id);
  const payments = db.prepare("SELECT * FROM order_payments WHERE order_id=? ORDER BY payment_date").all(id);
  const shipments = db.prepare("SELECT * FROM order_shipments WHERE order_id=? ORDER BY shipment_date").all(id);
  const batches = db.prepare("SELECT * FROM roasting_batches WHERE order_id=?").all(id) as any[];
  const roasted_kg = batches.reduce((s: number, b: any) => s + (b.roasted_kg || 0), 0);
  const mlp = getMaxLoss();
  const pending = db.prepare("SELECT * FROM pending_actions WHERE order_id=? AND status='pendiente'").all(id);
  return c.json(ok({ order, items, payments, shipments, batches, roasted_kg, max_loss_pct: mlp, pending_actions: pending }));
});

api.post("/orders", async (c) => {
  const b = await c.req.json();
  const r = db.prepare(`INSERT INTO orders (client_id,client_name,delivery_date,total_kg,price_per_kg,total_amount,status,notes,is_retail,payment_method,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(b.client_id,b.client_name,b.delivery_date,b.total_kg,b.price_per_kg,b.total_amount,b.status||'pendiente',b.notes,b.is_retail?1:0,b.payment_method,b.created_by);
  const oid = Number(r.lastInsertRowid);

  if (b.items?.length) {
    const st = db.prepare("INSERT INTO order_items (order_id,product_id,product_name,quantity,unit,unit_price,subtotal) VALUES (?,?,?,?,?,?,?)");
    for (const i of b.items) st.run(oid,i.product_id,i.product_name,i.quantity,i.unit||'pz',i.unit_price,i.subtotal);
  }

  // Immediate payment for retail
  if (b.is_retail && b.total_amount > 0 && b.payment_method) {
    db.prepare("INSERT INTO order_payments (order_id,amount,payment_method,registered_by) VALUES (?,?,?,?)").run(oid,b.total_amount,b.payment_method,b.created_by);
    db.prepare("UPDATE orders SET status='pagado' WHERE id=?").run(oid);
  }

  // INVENTORY CHECK: if order has kg, check and create actions
  const kgToCheck = b.total_kg || 0;
  // For retail, calculate kg from items (product presentations)
  let retailKg = 0;
  if (b.is_retail && b.items?.length) {
    for (const item of b.items) {
      const pres = item.presentation || '';
      if (pres === '250g') retailKg += 0.25 * item.quantity;
      else if (pres === '500g') retailKg += 0.5 * item.quantity;
      else if (pres === '1kg') retailKg += 1 * item.quantity;
      else retailKg += item.quantity; // granel or unknown
    }
  }

  const totalKg = kgToCheck || retailKg;
  if (totalKg > 0) {
    const check = checkInventoryForKg(totalKg);

    // If roasted coffee available, deduct it
    if (check.has_roasted) {
      deductFromInventory(totalKg, 'cafe_tostado', `Venta/Pedido #${oid}`);
    } else if (check.roasted_available > 0) {
      // Deduct what we have roasted
      deductFromInventory(check.roasted_available, 'cafe_tostado', `Venta/Pedido #${oid} (parcial)`);
    }

    // Create pending actions (roast orders, purchase orders)
    if (check.auto_actions.length > 0) {
      createPendingActions(oid, check.auto_actions);
    }
  }

  // Return with inventory check info
  const invCheck = totalKg > 0 ? checkInventoryForKg(totalKg) : null;
  return c.json(ok({ id: oid, inventory_check: invCheck }));
});

api.put("/orders/:id", async (c) => { const b = await c.req.json(); db.prepare(`UPDATE orders SET client_id=?,client_name=?,delivery_date=?,total_kg=?,price_per_kg=?,total_amount=?,status=?,notes=? WHERE id=?`).run(b.client_id,b.client_name,b.delivery_date,b.total_kg,b.price_per_kg,b.total_amount,b.status,b.notes,c.req.param("id")); return c.json(ok(true)); });
api.delete("/orders/:id", (c) => { db.prepare("DELETE FROM orders WHERE id=?").run(c.req.param("id")); return c.json(ok(true)); });

api.post("/orders/:id/payments", async (c) => { const b = await c.req.json(); db.prepare("INSERT INTO order_payments (order_id,amount,payment_method,notes,registered_by) VALUES (?,?,?,?,?)").run(c.req.param("id"),b.amount,b.payment_method,b.notes,b.registered_by); return c.json(ok(true)); });
api.delete("/payments/:id", (c) => { db.prepare("DELETE FROM order_payments WHERE id=?").run(c.req.param("id")); return c.json(ok(true)); });

api.post("/orders/:id/shipments", async (c) => { const b = await c.req.json(); db.prepare("INSERT INTO order_shipments (order_id,kg_shipped,destination_address,carrier,tracking_number,shipping_cost,notes,registered_by) VALUES (?,?,?,?,?,?,?,?)").run(c.req.param("id"),b.kg_shipped,b.destination_address,b.carrier,b.tracking_number,b.shipping_cost,b.notes,b.registered_by); return c.json(ok(true)); });
api.delete("/shipments/:id", (c) => { db.prepare("DELETE FROM order_shipments WHERE id=?").run(c.req.param("id")); return c.json(ok(true)); });

// ===== ROASTING =====
api.get("/roasting", (c) => c.json(ok(db.prepare(`SELECT rs.*, (SELECT COUNT(*) FROM roasting_batches WHERE session_id=rs.id) as batch_count, (SELECT COALESCE(SUM(green_kg),0) FROM roasting_batches WHERE session_id=rs.id) as total_green, (SELECT COALESCE(SUM(roasted_kg),0) FROM roasting_batches WHERE session_id=rs.id) as total_roasted FROM roasting_sessions rs ORDER BY rs.session_date DESC`).all())));
api.get("/roasting/:id", (c) => {
  const id = c.req.param("id");
  return c.json(ok({ session: db.prepare("SELECT * FROM roasting_sessions WHERE id=?").get(id), batches: db.prepare(`SELECT rb.*, o.name as origin_name, v.name as variety_name, rp.name as roast_name FROM roasting_batches rb LEFT JOIN origins o ON rb.origin_id=o.id LEFT JOIN varieties v ON rb.variety_id=v.id LEFT JOIN roast_profiles rp ON rb.roast_profile_id=rp.id WHERE rb.session_id=? ORDER BY rb.batch_number`).all(id) }));
});
api.post("/roasting", async (c) => { const b = await c.req.json(); const r = db.prepare("INSERT INTO roasting_sessions (session_date,operator,notes) VALUES (?,?,?)").run(b.session_date,b.operator,b.notes); return c.json(ok({ id: r.lastInsertRowid })); });
api.put("/roasting/:id", async (c) => { const b = await c.req.json(); db.prepare("UPDATE roasting_sessions SET session_date=?,operator=?,notes=? WHERE id=?").run(b.session_date,b.operator,b.notes,c.req.param("id")); return c.json(ok(true)); });
api.delete("/roasting/:id", (c) => { db.prepare("DELETE FROM roasting_sessions WHERE id=?").run(c.req.param("id")); return c.json(ok(true)); });

api.post("/roasting/:id/batches", async (c) => {
  const sid = c.req.param("id"); const b = await c.req.json();
  const cnt = db.prepare("SELECT COUNT(*) as c FROM roasting_batches WHERE session_id=?").get(sid) as any;
  const sess = db.prepare("SELECT session_date FROM roasting_sessions WHERE id=?").get(sid) as any;
  const bn = `B-${sess.session_date.replace(/-/g,'')}-${String(cnt.c+1).padStart(2,'0')}`;
  const lp = b.roasted_kg ? ((b.green_kg - b.roasted_kg) / b.green_kg * 100) : null;
  const r = db.prepare(`INSERT INTO roasting_batches (session_id,batch_number,origin_id,variety_id,roast_profile_id,green_kg,roasted_kg,loss_pct,order_id,machine_hours,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(sid,bn,b.origin_id,b.variety_id,b.roast_profile_id,b.green_kg,b.roasted_kg,lp,b.order_id,b.machine_hours,b.notes);

  // Deduct green from inventory
  deductFromInventory(b.green_kg, 'cafe_verde', `Tostado batch ${bn}`);

  // Add roasted to inventory if we have roasted kg
  if (b.roasted_kg) {
    // Find or create roasted inventory item
    let roastedInv = db.prepare("SELECT id FROM inventory WHERE item_type='cafe_tostado' AND item_name LIKE '%tostado%' LIMIT 1").get() as any;
    if (!roastedInv) {
      const ir = db.prepare("INSERT INTO inventory (item_type, item_name, quantity, unit) VALUES ('cafe_tostado', 'Café tostado general', 0, 'kg')").run();
      roastedInv = { id: ir.lastInsertRowid };
    }
    db.prepare("UPDATE inventory SET quantity = quantity + ? WHERE id = ?").run(b.roasted_kg, roastedInv.id);
    db.prepare("INSERT INTO inventory_movements (inventory_id, movement_type, quantity, reason, registered_by) VALUES (?,?,?,?,?)").run(roastedInv.id, 'entrada', b.roasted_kg, `Batch ${bn}`, 'Sistema');
  }

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
  if (!file) return c.json(er("No file"), 400);
  const content = await file.text();
  db.prepare("UPDATE roasting_batches SET artisan_file_name=?, artisan_file_path=? WHERE id=?").run(file.name, content, id);
  const apiKey = (db.prepare("SELECT value FROM settings WHERE key='claude_api_key'").get() as any)?.value;
  if (!apiKey) return c.json(ok({ analysis: "⚠️ Configura tu API Key de Claude en Configuración." }));
  const batch = db.prepare(`SELECT rb.*, o.name as origin_name, v.name as variety_name, rp.name as roast_name FROM roasting_batches rb LEFT JOIN origins o ON rb.origin_id=o.id LEFT JOIN varieties v ON rb.variety_id=v.id LEFT JOIN roast_profiles rp ON rb.roast_profile_id=rp.id WHERE rb.id=?`).get(id) as any;
  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type":"application/json", "x-api-key":apiKey, "anthropic-version":"2023-06-01" },
      body: JSON.stringify({ model:"claude-sonnet-4-20250514", max_tokens:2000, messages:[{role:"user",content:`Eres un experto tostador de café. Analiza esta curva de Artisan.\nBatch: ${batch.batch_number}\nOrigen: ${batch.origin_name||'?'}\nVariedad: ${batch.variety_name||'?'}\nPerfil: ${batch.roast_name||'?'}\nVerde: ${batch.green_kg}kg → Tostado: ${batch.roasted_kg||'?'}kg\nMerma: ${batch.loss_pct?batch.loss_pct.toFixed(1)+'%':'?'}\n\nCurva:\n${content}\n\nAnaliza: 1)Desarrollo 2)RoR 3)Primer crack 4)Gas/aire 5)Problemas 6)Sabor esperado 7)RECOMENDACIÓN: ✅Vender 🔄Blendear ❌Descartar\nEspañol, directo.`}]})
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
api.delete("/packaging/:id", (c) => { db.prepare("DELETE FROM packaging WHERE id=?").run(c.req.param("id")); return c.json(ok(true)); });

// ===== INVENTORY =====
api.get("/inventory", (c) => c.json(ok(db.prepare(`SELECT i.*, o.name as origin_name, v.name as variety_name FROM inventory i LEFT JOIN origins o ON i.origin_id=o.id LEFT JOIN varieties v ON i.variety_id=v.id ORDER BY i.item_type, i.item_name`).all())));
api.post("/inventory", async (c) => { const b = await c.req.json(); const r = db.prepare("INSERT INTO inventory (item_type,item_name,quantity,unit,min_stock,origin_id,variety_id,lot_label,notes) VALUES (?,?,?,?,?,?,?,?,?)").run(b.item_type,b.item_name,b.quantity,b.unit,b.min_stock,b.origin_id,b.variety_id,b.lot_label,b.notes); return c.json(ok({id:r.lastInsertRowid})); });
api.put("/inventory/:id", async (c) => { const b = await c.req.json(); db.prepare("UPDATE inventory SET item_type=?,item_name=?,quantity=?,unit=?,min_stock=?,origin_id=?,variety_id=?,lot_label=?,notes=? WHERE id=?").run(b.item_type,b.item_name,b.quantity,b.unit,b.min_stock,b.origin_id,b.variety_id,b.lot_label,b.notes,c.req.param("id")); return c.json(ok(true)); });
api.delete("/inventory/:id", (c) => { db.prepare("DELETE FROM inventory WHERE id=?").run(c.req.param("id")); return c.json(ok(true)); });
api.post("/inventory/:id/movements", async (c) => {
  const b = await c.req.json(); const invId = c.req.param("id");
  db.prepare("INSERT INTO inventory_movements (inventory_id,movement_type,quantity,reason,registered_by) VALUES (?,?,?,?,?)").run(invId,b.movement_type,b.quantity,b.reason,b.registered_by);
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
api.post("/withdrawals", async (c) => { const b = await c.req.json(); db.prepare("INSERT INTO profit_withdrawals (partner_name,amount,month,notes) VALUES (?,?,?,?)").run(b.partner_name,b.amount,b.month,b.notes); return c.json(ok(true)); });
api.delete("/withdrawals/:id", (c) => { db.prepare("DELETE FROM profit_withdrawals WHERE id=?").run(c.req.param("id")); return c.json(ok(true)); });

// ===== MACHINE LOG =====
api.get("/machine-log", (c) => c.json(ok(db.prepare("SELECT * FROM machine_log ORDER BY log_date DESC").all())));
api.post("/machine-log", async (c) => { const b = await c.req.json(); db.prepare("INSERT INTO machine_log (log_date,log_type,description,cost,hours,registered_by) VALUES (?,?,?,?,?,?)").run(b.log_date,b.log_type,b.description,b.cost,b.hours,b.registered_by); return c.json(ok(true)); });
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
  const ml = getMaxLoss();
  const al = db.prepare(`SELECT AVG(loss_pct) as v FROM roasting_batches rb JOIN roasting_sessions rs ON rb.session_id=rs.id WHERE rb.loss_pct IS NOT NULL AND rs.session_date LIKE '${month}%'`).get() as any;
  const ao = db.prepare(`SELECT COUNT(*) as c FROM orders WHERE status NOT IN ('pagado','cancelado','entregado')`).get() as any;
  const cap = db.prepare(`SELECT partner_name, SUM(amount) as invested, SUM(recovered) as recovered FROM capital_contributions GROUP BY partner_name`).all();
  const wth = db.prepare(`SELECT partner_name, SUM(amount) as withdrawn FROM profit_withdrawals GROUP BY partner_name`).all();
  const ebu = db.prepare(`SELECT paid_by, SUM(amount) as total FROM expenses WHERE expense_date LIKE '${month}%' GROUP BY paid_by`).all();
  const pendAct = db.prepare("SELECT COUNT(*) as c FROM pending_actions WHERE status='pendiente'").get() as any;

  const tdc = dc.t + elec;
  const gp = rev.t - tdc;
  const np = gp - oe.t;
  const cpk = kgS.t > 0 ? tdc / kgS.t : 0;
  const rpk = kgS.t > 0 ? rev.t / kgS.t : 0;

  const partners = db.prepare("SELECT * FROM partners ORDER BY id").all() as any[];
  const shares = partners.map((p: any) => ({ name: p.name, share: p.profit_share, amount: np > 0 ? (np * p.profit_share / 100) : 0 }));

  return c.json(ok({
    month, revenue: rev.t, direct_costs: tdc, electricity_cost: elec, other_expenses: oe.t,
    gross_profit: gp, net_profit: np, kg_sold: kgS.t, kg_roasted: kgR.roasted, kg_green_used: kgR.green,
    cost_per_kg: cpk, revenue_per_kg: rpk, profit_per_kg: rpk - cpk,
    max_loss_pct: ml, avg_loss_pct: al?.v||0, active_orders: ao.c,
    capital: cap, withdrawals: wth, expenses_by_user: ebu, profit_shares: shares,
    pending_actions_count: pendAct.c,
    green_stock: getGreenStock(), roasted_stock: getRoastedStock(), packaged_stock: getPackagedStock()
  }));
});

export default api;
