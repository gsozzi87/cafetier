import { Hono } from "hono";
import db from "./db";
import fs from "fs";
import path from "path";

const api = new Hono();
const ok = (d: any) => ({ success: true, data: d });
const er = (m: string) => ({ success: false, error: m });
const UPLOAD_PATH = process.env.UPLOAD_PATH || path.join(process.cwd(), "data", "uploads");
if (!fs.existsSync(UPLOAD_PATH)) fs.mkdirSync(UPLOAD_PATH, { recursive: true });

// ========== HELPERS ==========
function getMaxLoss(): number {
  const r = db.prepare("SELECT MAX(loss_pct) as v FROM roasting_batches WHERE loss_pct IS NOT NULL").get() as any;
  return r?.v || 20;
}
function getInvByType(t: string): number {
  return (db.prepare("SELECT COALESCE(SUM(quantity),0) as t FROM inventory WHERE item_type=?").get(t) as any)?.t || 0;
}
function getAvailableCapital(): number {
  const contributed = (db.prepare("SELECT COALESCE(SUM(amount),0) as t FROM capital_contributions").get() as any)?.t || 0;
  const allExpenses = (db.prepare("SELECT COALESCE(SUM(amount),0) as t FROM expenses").get() as any)?.t || 0;
  const revenue = (db.prepare("SELECT COALESCE(SUM(amount),0) as t FROM order_payments").get() as any)?.t || 0;
  const withdrawn = (db.prepare("SELECT COALESCE(SUM(amount),0) as t FROM profit_withdrawals").get() as any)?.t || 0;
  return contributed + revenue - allExpenses - withdrawn;
}
function getTotalContributed(): number {
  return (db.prepare("SELECT COALESCE(SUM(amount),0) as t FROM capital_contributions").get() as any)?.t || 0;
}
function getTotalRecovered(): number {
  return (db.prepare("SELECT COALESCE(SUM(amount),0) as t FROM profit_withdrawals WHERE withdrawal_type='aporte_retorno'").get() as any)?.t || 0;
}
function getUnrecoveredCapital(): number {
  return getTotalContributed() - getTotalRecovered();
}
function deductInventory(invId: number, qty: number, reason: string) {
  db.prepare("UPDATE inventory SET quantity = MAX(0, quantity - ?) WHERE id = ?").run(qty, invId);
  db.prepare("INSERT INTO inventory_movements (inventory_id,movement_type,quantity,reason,registered_by) VALUES (?,'salida',?,?,'Sistema')").run(invId, qty, reason);
}
function addInventory(invId: number, qty: number, reason: string) {
  db.prepare("UPDATE inventory SET quantity = quantity + ? WHERE id = ?").run(qty, invId);
  db.prepare("INSERT INTO inventory_movements (inventory_id,movement_type,quantity,reason,registered_by) VALUES (?,'entrada',?,?,'Sistema')").run(invId, qty, reason);
}
function createAutoExpense(catName: string, amount: number, desc: string, paidBy: string, refType: string, refId: number) {
  const cat = db.prepare("SELECT id FROM expense_categories WHERE name=?").get(catName) as any;
  if (!cat) return null;
  const r = db.prepare("INSERT INTO expenses (category_id,amount,description,paid_by,auto_generated,reference_type,reference_id) VALUES (?,?,?,?,1,?,?)").run(cat.id, amount, desc, paidBy, refType, refId);
  return r.lastInsertRowid;
}

// ========== SETTINGS ==========
api.get("/settings", (c) => {
  const rows = db.prepare("SELECT key,value FROM settings").all() as any[];
  const s: any = {}; rows.forEach((r: any) => s[r.key] = r.value);
  return c.json(ok(s));
});
api.put("/settings", async (c) => {
  const body = await c.req.json();
  const stmt = db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)");
  for (const [k, v] of Object.entries(body)) stmt.run(k, String(v));
  return c.json(ok(true));
});

// ========== PARTNERS ==========
api.get("/partners", (c) => c.json(ok(db.prepare("SELECT * FROM partners ORDER BY id").all())));

// ========== CATALOG LISTS ==========
for (const table of ["roast_profiles", "origins", "varieties", "expense_categories"]) {
  api.get(`/${table}`, (c) => c.json(ok(db.prepare(`SELECT * FROM ${table} WHERE active=1 ORDER BY name`).all())));
  api.post(`/${table}`, async (c) => {
    const body = await c.req.json();
    try {
      const cols = Object.keys(body).join(","); const ph = Object.keys(body).map(()=>"?").join(",");
      const r = db.prepare(`INSERT INTO ${table} (${cols}) VALUES (${ph})`).run(...Object.values(body));
      return c.json(ok({ id: r.lastInsertRowid }));
    } catch(e: any) {
      if (e.message?.includes("UNIQUE")) return c.json(er("Ya existe"));
      throw e;
    }
  });
  api.put(`/${table}/:id`, async (c) => { const body = await c.req.json(); const sets = Object.keys(body).map(k=>`${k}=?`).join(","); db.prepare(`UPDATE ${table} SET ${sets} WHERE id=?`).run(...Object.values(body),c.req.param("id")); return c.json(ok(true)); });
  api.delete(`/${table}/:id`, (c) => { db.prepare(`UPDATE ${table} SET active=0 WHERE id=?`).run(c.req.param("id")); return c.json(ok(true)); });
}

// ========== CLIENTS ==========
api.get("/clients", (c) => c.json(ok(db.prepare("SELECT * FROM clients ORDER BY name").all())));
api.get("/clients/:id", (c) => {
  const id = c.req.param("id");
  return c.json(ok({ client: db.prepare("SELECT * FROM clients WHERE id=?").get(id), orders: db.prepare("SELECT * FROM orders WHERE client_id=? ORDER BY created_at DESC").all(id) }));
});
api.post("/clients", async (c) => { const b = await c.req.json(); const r = db.prepare("INSERT INTO clients (name,phone,email,address,city,notes) VALUES (?,?,?,?,?,?)").run(b.name,b.phone||null,b.email||null,b.address||null,b.city||null,b.notes||null); return c.json(ok({ id: r.lastInsertRowid })); });
api.put("/clients/:id", async (c) => { const b = await c.req.json(); db.prepare("UPDATE clients SET name=?,phone=?,email=?,address=?,city=?,notes=? WHERE id=?").run(b.name,b.phone,b.email,b.address,b.city,b.notes,c.req.param("id")); return c.json(ok(true)); });
api.delete("/clients/:id", (c) => { db.prepare("DELETE FROM clients WHERE id=?").run(c.req.param("id")); return c.json(ok(true)); });

// ========== PRODUCTS ==========
api.get("/products", (c) => c.json(ok(db.prepare(`SELECT p.*, o.name as origin_name, v.name as variety_name, rp.name as roast_name FROM products p LEFT JOIN origins o ON p.origin_id=o.id LEFT JOIN varieties v ON p.variety_id=v.id LEFT JOIN roast_profiles rp ON p.roast_profile_id=rp.id WHERE p.active=1 ORDER BY p.name`).all())));
api.post("/products", async (c) => { const b = await c.req.json(); const r = db.prepare("INSERT INTO products (name,origin_id,variety_id,roast_profile_id,presentation,price) VALUES (?,?,?,?,?,?)").run(b.name,b.origin_id||null,b.variety_id||null,b.roast_profile_id||null,b.presentation,b.price); return c.json(ok({ id: r.lastInsertRowid })); });
api.put("/products/:id", async (c) => { const b = await c.req.json(); db.prepare("UPDATE products SET name=?,origin_id=?,variety_id=?,roast_profile_id=?,presentation=?,price=?,active=? WHERE id=?").run(b.name,b.origin_id||null,b.variety_id||null,b.roast_profile_id||null,b.presentation,b.price,b.active??1,c.req.param("id")); return c.json(ok(true)); });
api.delete("/products/:id", (c) => { db.prepare("UPDATE products SET active=0 WHERE id=?").run(c.req.param("id")); return c.json(ok(true)); });

// ========== INVENTORY ==========
api.get("/inventory", (c) => c.json(ok(db.prepare(`SELECT i.*, o.name as origin_name, v.name as variety_name FROM inventory i LEFT JOIN origins o ON i.origin_id=o.id LEFT JOIN varieties v ON i.variety_id=v.id ORDER BY i.item_type, i.item_name`).all())));
api.get("/inventory/green", (c) => c.json(ok(db.prepare(`SELECT i.*, o.name as origin_name, v.name as variety_name FROM inventory i LEFT JOIN origins o ON i.origin_id=o.id LEFT JOIN varieties v ON i.variety_id=v.id WHERE i.item_type='cafe_verde' AND i.quantity > 0 ORDER BY i.item_name`).all())));
api.get("/inventory/summary", (c) => c.json(ok({
  cafe_verde: getInvByType('cafe_verde'), cafe_tostado: getInvByType('cafe_tostado'),
  cafe_empaquetado: getInvByType('cafe_empaquetado'), available_capital: getAvailableCapital()
})));
api.post("/inventory", async (c) => { const b = await c.req.json(); const r = db.prepare("INSERT INTO inventory (item_type,item_name,quantity,unit,min_stock,origin_id,variety_id,lot_label,notes) VALUES (?,?,?,?,?,?,?,?,?)").run(b.item_type,b.item_name,b.quantity||0,b.unit||'kg',b.min_stock||0,b.origin_id||null,b.variety_id||null,b.lot_label||null,b.notes||null); return c.json(ok({id:r.lastInsertRowid})); });
api.put("/inventory/:id", async (c) => { const b = await c.req.json(); db.prepare("UPDATE inventory SET item_name=?,quantity=?,unit=?,min_stock=?,origin_id=?,variety_id=?,lot_label=?,notes=? WHERE id=?").run(b.item_name,b.quantity,b.unit,b.min_stock,b.origin_id||null,b.variety_id||null,b.lot_label||null,b.notes||null,c.req.param("id")); return c.json(ok(true)); });
api.delete("/inventory/:id", (c) => { db.prepare("DELETE FROM inventory WHERE id=?").run(c.req.param("id")); return c.json(ok(true)); });
api.post("/inventory/:id/movements", async (c) => {
  const b = await c.req.json(); const invId = c.req.param("id");
  db.prepare("INSERT INTO inventory_movements (inventory_id,movement_type,quantity,reason,registered_by) VALUES (?,?,?,?,?)").run(invId,b.movement_type,b.quantity,b.reason,b.registered_by);
  const mod = b.movement_type === 'salida' ? -b.quantity : b.quantity;
  db.prepare("UPDATE inventory SET quantity=MAX(0,quantity+?) WHERE id=?").run(mod, invId);
  return c.json(ok(true));
});
api.get("/inventory/:id/movements", (c) => c.json(ok(db.prepare("SELECT * FROM inventory_movements WHERE inventory_id=? ORDER BY created_at DESC").all(c.req.param("id")))));

// ========== ORDERS ==========
api.get("/orders", (c) => c.json(ok(db.prepare(`SELECT o.*, c.name as client_name, (SELECT COALESCE(SUM(amount),0) FROM order_payments WHERE order_id=o.id) as total_paid, (SELECT COALESCE(SUM(kg_shipped),0) FROM order_shipments WHERE order_id=o.id) as total_shipped FROM orders o LEFT JOIN clients c ON o.client_id=c.id ORDER BY o.created_at DESC`).all())));

api.get("/orders/:id", (c) => {
  const id = c.req.param("id");
  const order = db.prepare(`SELECT o.*, c.name as client_name FROM orders o LEFT JOIN clients c ON o.client_id=c.id WHERE o.id=?`).get(id);
  const items = db.prepare("SELECT * FROM order_items WHERE order_id=?").all(id);
  const payments = db.prepare("SELECT * FROM order_payments WHERE order_id=? ORDER BY payment_date").all(id);
  const shipments = db.prepare("SELECT * FROM order_shipments WHERE order_id=? ORDER BY shipment_date").all(id);
  const batches = db.prepare("SELECT * FROM roasting_batches WHERE order_id=?").all(id) as any[];
  const roasted_kg = batches.reduce((s: number, b: any) => s + (b.roasted_kg || 0), 0);
  const purchase_orders = db.prepare("SELECT * FROM purchase_orders WHERE order_id=?").all(id);
  return c.json(ok({ order, items, payments, shipments, batches, roasted_kg, max_loss_pct: getMaxLoss(), purchase_orders }));
});

api.post("/orders", async (c) => {
  const b = await c.req.json();
  if (!b.client_id) return c.json(er("Selecciona un cliente"), 400);

  const r = db.prepare(`INSERT INTO orders (client_id,delivery_date,total_kg,price_per_kg,total_amount,status,notes,is_retail,payment_method,created_by) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(b.client_id,b.delivery_date||null,b.total_kg||null,b.price_per_kg||null,b.total_amount,b.status||'pendiente',b.notes||null,b.is_retail?1:0,b.payment_method||null,b.created_by||null);
  const oid = Number(r.lastInsertRowid);

  if (b.items?.length) {
    const st = db.prepare("INSERT INTO order_items (order_id,product_id,product_name,quantity,unit,unit_price,subtotal) VALUES (?,?,?,?,?,?,?)");
    for (const i of b.items) st.run(oid,i.product_id,i.product_name,i.quantity,i.unit||'pz',i.unit_price,i.subtotal);
  }

  // Retail immediate payment
  if (b.is_retail && b.total_amount > 0 && b.payment_method) {
    db.prepare("INSERT INTO order_payments (order_id,amount,payment_method,registered_by) VALUES (?,?,?,?)").run(oid,b.total_amount,b.payment_method,b.created_by);
    db.prepare("UPDATE orders SET status='pagado' WHERE id=?").run(oid);
    // Deduct from roasted/packaged inventory for retail
    const kgNeeded = (b.items || []).reduce((s: number, i: any) => {
      const p = i.presentation || '';
      if (p === '250g') return s + 0.25 * i.quantity;
      if (p === '500g') return s + 0.5 * i.quantity;
      if (p === '1kg') return s + 1 * i.quantity;
      return s + i.quantity;
    }, 0);
    if (kgNeeded > 0) {
      const roastedItems = db.prepare("SELECT * FROM inventory WHERE item_type IN ('cafe_tostado','cafe_empaquetado') AND quantity > 0 ORDER BY item_type DESC, id").all() as any[];
      let rem = kgNeeded;
      for (const item of roastedItems) {
        if (rem <= 0) break;
        const d = Math.min(rem, item.quantity);
        deductInventory(item.id, d, `Venta mostrador #${oid}`);
        rem -= d;
      }
    }
  }

  // Big order: check green stock
  if (!b.is_retail && b.total_kg) {
    const ml = getMaxLoss();
    const greenNeeded = b.total_kg / (1 - ml / 100);
    const greenStock = getInvByType('cafe_verde');
    if (greenStock < greenNeeded) {
      const deficit = greenNeeded - greenStock;
      db.prepare("INSERT INTO purchase_orders (order_id,description,kg_needed,status) VALUES (?,?,?,'pendiente')").run(oid, `Café verde para pedido #${oid} (${b.total_kg} kg tostado, merma ${ml.toFixed(0)}%)`, deficit);
      db.prepare("UPDATE orders SET status='esperando_compra' WHERE id=?").run(oid);
    }
  }

  return c.json(ok({ id: oid }));
});

api.put("/orders/:id", async (c) => { const b = await c.req.json(); db.prepare(`UPDATE orders SET client_id=?,delivery_date=?,total_kg=?,price_per_kg=?,total_amount=?,status=?,notes=? WHERE id=?`).run(b.client_id,b.delivery_date,b.total_kg,b.price_per_kg,b.total_amount,b.status,b.notes,c.req.param("id")); return c.json(ok(true)); });
api.delete("/orders/:id", (c) => { db.prepare("DELETE FROM orders WHERE id=?").run(c.req.param("id")); return c.json(ok(true)); });

// Payments
api.post("/orders/:id/payments", async (c) => { const b = await c.req.json(); db.prepare("INSERT INTO order_payments (order_id,amount,payment_method,notes,registered_by) VALUES (?,?,?,?,?)").run(c.req.param("id"),b.amount,b.payment_method,b.notes||null,b.registered_by||null); return c.json(ok(true)); });
api.delete("/payments/:id", (c) => { db.prepare("DELETE FROM order_payments WHERE id=?").run(c.req.param("id")); return c.json(ok(true)); });

// Shipments (auto-creates expense)
api.post("/orders/:id/shipments", async (c) => {
  const b = await c.req.json(); const oid = c.req.param("id");
  let expId = null;
  if (b.shipping_cost > 0) {
    expId = createAutoExpense('Envíos / Transporte', b.shipping_cost, `Envío pedido #${oid} - ${b.carrier||''}`, b.registered_by || 'Sistema', 'shipment', 0);
  }
  db.prepare("INSERT INTO order_shipments (order_id,kg_shipped,destination_address,carrier,tracking_number,shipping_cost,notes,registered_by,expense_id) VALUES (?,?,?,?,?,?,?,?,?)").run(oid,b.kg_shipped,b.destination_address||null,b.carrier||null,b.tracking_number||null,b.shipping_cost||0,b.notes||null,b.registered_by||null,expId);
  return c.json(ok(true));
});
api.delete("/shipments/:id", (c) => {
  const ship = db.prepare("SELECT expense_id FROM order_shipments WHERE id=?").get(c.req.param("id")) as any;
  if (ship?.expense_id) db.prepare("DELETE FROM expenses WHERE id=?").run(ship.expense_id);
  db.prepare("DELETE FROM order_shipments WHERE id=?").run(c.req.param("id"));
  return c.json(ok(true));
});

// ========== PURCHASE ORDERS ==========
api.get("/purchase-orders", (c) => c.json(ok(db.prepare(`SELECT po.*, o.client_id, c.name as client_name FROM purchase_orders po LEFT JOIN orders o ON po.order_id=o.id LEFT JOIN clients c ON o.client_id=c.id ORDER BY po.created_at DESC`).all())));

api.get("/purchase-orders/:id", (c) => {
  const id = c.req.param("id");
  const po = db.prepare("SELECT * FROM purchase_orders WHERE id=?").get(id);
  const entries = db.prepare(`SELECT poe.*, o.name as origin_name, v.name as variety_name FROM purchase_order_entries poe LEFT JOIN origins o ON poe.origin_id=o.id LEFT JOIN varieties v ON poe.variety_id=v.id WHERE poe.purchase_order_id=? ORDER BY poe.entry_date DESC`).all(id);
  return c.json(ok({ purchase_order: po, entries }));
});

// Register a purchase (entry) against a purchase order
api.post("/purchase-orders/:id/entries", async (c) => {
  const poId = c.req.param("id");
  const b = await c.req.json();
  const po = db.prepare("SELECT * FROM purchase_orders WHERE id=?").get(poId) as any;
  if (!po) return c.json(er("No encontrada"), 404);

  // Check available capital
  const avail = getAvailableCapital();
  if (b.cost > avail) return c.json(er(`Capital insuficiente. Disponible: $${avail.toFixed(2)}. Necesario: $${b.cost.toFixed(2)}`), 400);

  // Create or find inventory item for this green coffee
  let invId = b.inventory_id;
  if (!invId) {
    const originName = b.origin_id ? (db.prepare("SELECT name FROM origins WHERE id=?").get(b.origin_id) as any)?.name : 'General';
    const varietyName = b.variety_id ? (db.prepare("SELECT name FROM varieties WHERE id=?").get(b.variety_id) as any)?.name : '';
    const invName = `${originName}${varietyName ? ' - ' + varietyName : ''} ${b.lot_label || ''}`.trim();
    const existing = db.prepare("SELECT id FROM inventory WHERE item_type='cafe_verde' AND item_name=?").get(invName) as any;
    if (existing) { invId = existing.id; }
    else {
      const ir = db.prepare("INSERT INTO inventory (item_type,item_name,quantity,unit,origin_id,variety_id,lot_label) VALUES ('cafe_verde',?,0,'kg',?,?,?)").run(invName, b.origin_id||null, b.variety_id||null, b.lot_label||null);
      invId = ir.lastInsertRowid;
    }
  }

  // Add to inventory
  addInventory(Number(invId), b.quantity, `Compra OC-${poId}`);

  // Create expense
  const expId = createAutoExpense('Café verde', b.cost, `Compra ${b.quantity}kg verde - OC-${poId}${b.supplier ? ' - ' + b.supplier : ''}`, b.registered_by || 'Sistema', 'purchase_order', Number(poId));

  // Register entry
  db.prepare("INSERT INTO purchase_order_entries (purchase_order_id,quantity,cost,supplier,lot_label,origin_id,variety_id,inventory_id,expense_id,registered_by) VALUES (?,?,?,?,?,?,?,?,?,?)").run(poId, b.quantity, b.cost, b.supplier||null, b.lot_label||null, b.origin_id||null, b.variety_id||null, invId, expId, b.registered_by||null);

  // Update PO totals
  const totalPurchased = (db.prepare("SELECT COALESCE(SUM(quantity),0) as t FROM purchase_order_entries WHERE purchase_order_id=?").get(poId) as any)?.t || 0;
  const totalCost = (db.prepare("SELECT COALESCE(SUM(cost),0) as t FROM purchase_order_entries WHERE purchase_order_id=?").get(poId) as any)?.t || 0;
  const newStatus = totalPurchased >= po.kg_needed ? 'completada' : 'parcial';
  db.prepare("UPDATE purchase_orders SET kg_purchased=?, actual_cost=?, status=?, completed_at=? WHERE id=?").run(totalPurchased, totalCost, newStatus, newStatus === 'completada' ? new Date().toISOString() : null, poId);

  // If PO completed and linked to order, update order status
  if (newStatus === 'completada' && po.order_id) {
    const orderPOs = db.prepare("SELECT * FROM purchase_orders WHERE order_id=? AND status != 'completada' AND status != 'cancelada'").all(po.order_id);
    if (orderPOs.length === 0) {
      db.prepare("UPDATE orders SET status='pendiente' WHERE id=? AND status='esperando_compra'").run(po.order_id);
    }
  }

  return c.json(ok(true));
});

api.delete("/purchase-orders/:id", (c) => { db.prepare("DELETE FROM purchase_orders WHERE id=?").run(c.req.param("id")); return c.json(ok(true)); });

// ========== ROASTING ==========
api.get("/roasting", (c) => c.json(ok(db.prepare(`SELECT rs.*, (SELECT COUNT(*) FROM roasting_batches WHERE session_id=rs.id) as batch_count, (SELECT COALESCE(SUM(green_kg),0) FROM roasting_batches WHERE session_id=rs.id) as total_green, (SELECT COALESCE(SUM(roasted_kg),0) FROM roasting_batches WHERE session_id=rs.id) as total_roasted, (SELECT COALESCE(SUM(machine_minutes),0) FROM roasting_batches WHERE session_id=rs.id) as total_minutes FROM roasting_sessions rs ORDER BY rs.session_date DESC`).all())));

api.get("/roasting/:id", (c) => {
  const id = c.req.param("id");
  return c.json(ok({
    session: db.prepare("SELECT * FROM roasting_sessions WHERE id=?").get(id),
    batches: db.prepare(`SELECT rb.*, o.name as origin_name, v.name as variety_name, rp.name as roast_name, inv.item_name as green_item_name FROM roasting_batches rb LEFT JOIN origins o ON rb.origin_id=o.id LEFT JOIN varieties v ON rb.variety_id=v.id LEFT JOIN roast_profiles rp ON rb.roast_profile_id=rp.id LEFT JOIN inventory inv ON rb.green_inventory_id=inv.id WHERE rb.session_id=? ORDER BY rb.batch_number`).all(id)
  }));
});

api.post("/roasting", async (c) => { const b = await c.req.json(); const r = db.prepare("INSERT INTO roasting_sessions (session_date,operator,notes) VALUES (?,?,?)").run(b.session_date,b.operator,b.notes||null); return c.json(ok({ id: r.lastInsertRowid })); });
api.put("/roasting/:id", async (c) => { const b = await c.req.json(); db.prepare("UPDATE roasting_sessions SET session_date=?,operator=?,notes=? WHERE id=?").run(b.session_date,b.operator,b.notes,c.req.param("id")); return c.json(ok(true)); });
api.delete("/roasting/:id", (c) => { db.prepare("DELETE FROM roasting_sessions WHERE id=?").run(c.req.param("id")); return c.json(ok(true)); });

// Create batch - MUST select from green inventory
api.post("/roasting/:id/batches", async (c) => {
  const sid = c.req.param("id"); const b = await c.req.json();
  // Validate green inventory
  const greenInv = db.prepare("SELECT * FROM inventory WHERE id=? AND item_type='cafe_verde'").get(b.green_inventory_id) as any;
  if (!greenInv) return c.json(er("Selecciona café verde del inventario"), 400);
  if (greenInv.quantity < b.green_kg) return c.json(er(`Solo hay ${greenInv.quantity.toFixed(1)} kg disponibles de ${greenInv.item_name}`), 400);

  const cnt = db.prepare("SELECT COUNT(*) as c FROM roasting_batches WHERE session_id=?").get(sid) as any;
  const sess = db.prepare("SELECT session_date FROM roasting_sessions WHERE id=?").get(sid) as any;
  const bn = `B-${sess.session_date.replace(/-/g,'')}-${String(cnt.c+1).padStart(2,'0')}`;
  const lp = b.roasted_kg ? ((b.green_kg - b.roasted_kg) / b.green_kg * 100) : null;

  const r = db.prepare(`INSERT INTO roasting_batches (session_id,batch_number,green_inventory_id,origin_id,variety_id,roast_profile_id,green_kg,roasted_kg,loss_pct,order_id,machine_minutes,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(sid,bn,b.green_inventory_id,greenInv.origin_id,greenInv.variety_id,b.roast_profile_id,b.green_kg,b.roasted_kg||null,lp,b.order_id||null,b.machine_minutes||0,b.notes||null);

  // Deduct green
  deductInventory(b.green_inventory_id, b.green_kg, `Tostado ${bn}`);

  // Add roasted to inventory
  if (b.roasted_kg) {
    let roastedInv = db.prepare("SELECT id FROM inventory WHERE item_type='cafe_tostado' LIMIT 1").get() as any;
    if (!roastedInv) {
      const ir = db.prepare("INSERT INTO inventory (item_type,item_name,quantity,unit) VALUES ('cafe_tostado','Café tostado',0,'kg')").run();
      roastedInv = { id: ir.lastInsertRowid };
    }
    addInventory(Number(roastedInv.id), b.roasted_kg, `Batch ${bn}`);
  }

  return c.json(ok({ id: r.lastInsertRowid, batch_number: bn }));
});

api.put("/batches/:id", async (c) => {
  const b = await c.req.json();
  const lp = b.roasted_kg && b.green_kg ? ((b.green_kg - b.roasted_kg) / b.green_kg * 100) : null;
  db.prepare(`UPDATE roasting_batches SET roast_profile_id=?,roasted_kg=?,loss_pct=?,order_id=?,machine_minutes=?,quality_rating=?,ai_analysis=?,notes=? WHERE id=?`).run(b.roast_profile_id,b.roasted_kg,lp,b.order_id||null,b.machine_minutes||0,b.quality_rating||null,b.ai_analysis||null,b.notes||null,c.req.param("id"));
  return c.json(ok(true));
});
api.delete("/batches/:id", (c) => { db.prepare("DELETE FROM roasting_batches WHERE id=?").run(c.req.param("id")); return c.json(ok(true)); });

// Artisan upload
api.post("/batches/:id/artisan", async (c) => {
  const id = c.req.param("id");
  const fd = await c.req.formData(); const file = fd.get("file") as File;
  if (!file) return c.json(er("No file"), 400);
  const content = await file.text();
  db.prepare("UPDATE roasting_batches SET artisan_file_name=?, artisan_data=? WHERE id=?").run(file.name, content, id);
  const apiKey = (db.prepare("SELECT value FROM settings WHERE key='claude_api_key'").get() as any)?.value;
  if (!apiKey) return c.json(ok({ analysis: "⚠️ Configura tu API Key de Claude en Configuración." }));
  const batch = db.prepare(`SELECT rb.*, o.name as origin_name, v.name as variety_name, rp.name as roast_name FROM roasting_batches rb LEFT JOIN origins o ON rb.origin_id=o.id LEFT JOIN varieties v ON rb.variety_id=v.id LEFT JOIN roast_profiles rp ON rb.roast_profile_id=rp.id WHERE rb.id=?`).get(id) as any;
  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", headers: { "Content-Type":"application/json", "x-api-key":apiKey, "anthropic-version":"2023-06-01" },
      body: JSON.stringify({ model:"claude-sonnet-4-20250514", max_tokens:2000, messages:[{role:"user",content:`Eres un experto tostador de café. Analiza esta curva de Artisan.\nBatch: ${batch.batch_number}\nOrigen: ${batch.origin_name||'?'}\nVariedad: ${batch.variety_name||'?'}\nPerfil: ${batch.roast_name||'?'}\nVerde: ${batch.green_kg}kg → Tostado: ${batch.roasted_kg||'?'}kg\nMerma: ${batch.loss_pct?batch.loss_pct.toFixed(1)+'%':'?'}\nMinutos: ${batch.machine_minutes}\n\nCurva:\n${content}\n\nAnaliza: 1)Desarrollo 2)RoR 3)Primer crack 4)Gas/aire 5)Problemas 6)Sabor esperado 7)RECOMENDACIÓN: ✅Vender 🔄Blendear ❌Descartar\nEspañol, directo.`}]})
    });
    const ai = await resp.json() as any;
    const analysis = ai.content?.[0]?.text || "No se pudo analizar";
    let q = null;
    if (analysis.includes("✅")) q = "vender"; else if (analysis.includes("🔄")) q = "blendear"; else if (analysis.includes("❌")) q = "descartar";
    db.prepare("UPDATE roasting_batches SET ai_analysis=?, quality_rating=? WHERE id=?").run(analysis, q, id);
    return c.json(ok({ analysis, quality_rating: q }));
  } catch (e: any) { return c.json(ok({ analysis: `Error: ${e.message}` })); }
});

// Batch photos
api.get("/batches/:id/photos", (c) => c.json(ok(db.prepare("SELECT * FROM batch_photos WHERE batch_id=? ORDER BY created_at DESC").all(c.req.param("id")))));
api.post("/batches/:id/photos", async (c) => {
  const id = c.req.param("id");
  const fd = await c.req.formData(); const file = fd.get("file") as File; const notes = fd.get("notes") as string;
  if (!file) return c.json(er("No file"), 400);
  const fileName = `batch_${id}_${Date.now()}_${file.name}`;
  const filePath = path.join(UPLOAD_PATH, fileName);
  const buf = await file.arrayBuffer();
  fs.writeFileSync(filePath, Buffer.from(buf));
  db.prepare("INSERT INTO batch_photos (batch_id,file_name,file_path,notes) VALUES (?,?,?,?)").run(id, file.name, fileName, notes||null);
  return c.json(ok(true));
});
api.delete("/batch-photos/:id", (c) => {
  const photo = db.prepare("SELECT file_path FROM batch_photos WHERE id=?").get(c.req.param("id")) as any;
  if (photo) { try { fs.unlinkSync(path.join(UPLOAD_PATH, photo.file_path)); } catch(e){} }
  db.prepare("DELETE FROM batch_photos WHERE id=?").run(c.req.param("id"));
  return c.json(ok(true));
});

// Serve uploaded files
api.get("/uploads/:file", (c) => {
  const filePath = path.join(UPLOAD_PATH, c.req.param("file"));
  if (!fs.existsSync(filePath)) return c.json(er("Not found"), 404);
  const buf = fs.readFileSync(filePath);
  return new Response(buf, { headers: { "Content-Type": "image/jpeg" } });
});

// ========== PACKAGING ==========
api.get("/packaging", (c) => c.json(ok(db.prepare(`SELECT p.*, rb.batch_number FROM packaging p LEFT JOIN roasting_batches rb ON p.batch_id=rb.id ORDER BY p.packaging_date DESC`).all())));
api.post("/packaging", async (c) => { const b = await c.req.json(); db.prepare("INSERT INTO packaging (batch_id,packaging_date,presentation,units,total_kg,operator,notes) VALUES (?,?,?,?,?,?,?)").run(b.batch_id,b.packaging_date,b.presentation,b.units,b.total_kg,b.operator||null,b.notes||null); return c.json(ok(true)); });
api.delete("/packaging/:id", (c) => { db.prepare("DELETE FROM packaging WHERE id=?").run(c.req.param("id")); return c.json(ok(true)); });

// ========== EXPENSES ==========
api.get("/expenses", (c) => {
  const m = c.req.query("month");
  let q = `SELECT e.*, ec.name as category_name, ec.is_direct_cost FROM expenses e LEFT JOIN expense_categories ec ON e.category_id=ec.id`;
  if (m) q += ` WHERE e.expense_date LIKE '${m}%'`;
  return c.json(ok(db.prepare(q + " ORDER BY e.expense_date DESC").all()));
});
api.post("/expenses", async (c) => {
  const b = await c.req.json();
  // Check capital
  if (!b.skip_capital_check) {
    const avail = getAvailableCapital();
    if (b.amount > avail) return c.json(er(`Capital insuficiente. Disponible: $${avail.toFixed(2)}`), 400);
  }
  const r = db.prepare("INSERT INTO expenses (expense_date,category_id,amount,description,paid_by,lot_label,supplier,quantity,quantity_unit,notes) VALUES (?,?,?,?,?,?,?,?,?,?)").run(b.expense_date,b.category_id,b.amount,b.description||null,b.paid_by,b.lot_label||null,b.supplier||null,b.quantity||null,b.quantity_unit||null,b.notes||null);
  return c.json(ok({id:r.lastInsertRowid}));
});
api.put("/expenses/:id", async (c) => { const b = await c.req.json(); db.prepare("UPDATE expenses SET expense_date=?,category_id=?,amount=?,description=?,paid_by=?,lot_label=?,supplier=?,quantity=?,quantity_unit=?,notes=? WHERE id=?").run(b.expense_date,b.category_id,b.amount,b.description,b.paid_by,b.lot_label,b.supplier,b.quantity,b.quantity_unit,b.notes,c.req.param("id")); return c.json(ok(true)); });
api.delete("/expenses/:id", (c) => { db.prepare("DELETE FROM expenses WHERE id=?").run(c.req.param("id")); return c.json(ok(true)); });

// ========== CAPITAL ==========
api.get("/capital", (c) => c.json(ok(db.prepare("SELECT * FROM capital_contributions ORDER BY contribution_date DESC").all())));
api.get("/capital/summary", (c) => {
  const contributed = getTotalContributed();
  const recovered = getTotalRecovered();
  const unrecovered = contributed - recovered;
  const revenue = (db.prepare("SELECT COALESCE(SUM(amount),0) as t FROM order_payments").get() as any)?.t || 0;
  const expenses = (db.prepare("SELECT COALESCE(SUM(amount),0) as t FROM expenses").get() as any)?.t || 0;
  const withdrawn = (db.prepare("SELECT COALESCE(SUM(amount),0) as t FROM profit_withdrawals").get() as any)?.t || 0;
  const available = contributed + revenue - expenses - withdrawn;
  const netProfit = revenue - expenses;
  const distributable = netProfit > unrecovered ? netProfit - unrecovered : 0;
  const partners = db.prepare("SELECT * FROM partners ORDER BY id").all() as any[];
  const byPartner = partners.map((p: any) => {
    const pContrib = (db.prepare("SELECT COALESCE(SUM(amount),0) as t FROM capital_contributions WHERE partner_name=?").get(p.name) as any)?.t || 0;
    const pRecovered = (db.prepare("SELECT COALESCE(SUM(amount),0) as t FROM profit_withdrawals WHERE partner_name=? AND withdrawal_type='aporte_retorno'").get(p.name) as any)?.t || 0;
    const pDivid = (db.prepare("SELECT COALESCE(SUM(amount),0) as t FROM profit_withdrawals WHERE partner_name=? AND withdrawal_type='utilidad'").get(p.name) as any)?.t || 0;
    return { name: p.name, share: p.profit_share, contributed: pContrib, recovered: pRecovered, pending_recovery: pContrib - pRecovered, dividends_taken: pDivid, dividends_available: distributable * p.profit_share / 100 };
  });
  return c.json(ok({ contributed, recovered, unrecovered, revenue, expenses, net_profit: netProfit, available_cash: available, distributable, by_partner: byPartner }));
});
api.post("/capital", async (c) => {
  const b = await c.req.json();
  if (!b.partner_name || !b.amount || !b.description) return c.json(er("Completa todos los campos"), 400);
  const r = db.prepare("INSERT INTO capital_contributions (partner_name,amount,description,contribution_date) VALUES (?,?,?,?)").run(b.partner_name,b.amount,b.description,b.contribution_date || new Date().toISOString().slice(0,10));
  return c.json(ok({ id: r.lastInsertRowid }));
});
api.put("/capital/:id", async (c) => { const b = await c.req.json(); db.prepare("UPDATE capital_contributions SET partner_name=?,amount=?,description=?,contribution_date=? WHERE id=?").run(b.partner_name,b.amount,b.description,b.contribution_date,c.req.param("id")); return c.json(ok(true)); });
api.delete("/capital/:id", (c) => { db.prepare("DELETE FROM capital_contributions WHERE id=?").run(c.req.param("id")); return c.json(ok(true)); });

// Withdrawals
api.get("/withdrawals", (c) => c.json(ok(db.prepare("SELECT * FROM profit_withdrawals ORDER BY withdrawal_date DESC").all())));
api.post("/withdrawals", async (c) => {
  const b = await c.req.json();
  // Validate: must recover capital before dividends
  if (b.withdrawal_type === 'utilidad') {
    const unrecovered = getUnrecoveredCapital();
    if (unrecovered > 0) return c.json(er(`Primero hay que recuperar $${unrecovered.toFixed(2)} de aportes antes de repartir utilidades`), 400);
  }
  const avail = getAvailableCapital();
  if (b.amount > avail) return c.json(er(`Capital insuficiente. Disponible: $${avail.toFixed(2)}`), 400);
  db.prepare("INSERT INTO profit_withdrawals (partner_name,amount,withdrawal_type,month,notes) VALUES (?,?,?,?,?)").run(b.partner_name,b.amount,b.withdrawal_type||'utilidad',b.month,b.notes||null);
  // If returning capital, update contribution
  if (b.withdrawal_type === 'aporte_retorno' && b.contribution_id) {
    db.prepare("UPDATE capital_contributions SET recovered = recovered + ? WHERE id=?").run(b.amount, b.contribution_id);
    const cap = db.prepare("SELECT * FROM capital_contributions WHERE id=?").get(b.contribution_id) as any;
    if (cap && cap.recovered >= cap.amount) db.prepare("UPDATE capital_contributions SET fully_recovered=1 WHERE id=?").run(b.contribution_id);
  }
  return c.json(ok(true));
});
api.delete("/withdrawals/:id", (c) => { db.prepare("DELETE FROM profit_withdrawals WHERE id=?").run(c.req.param("id")); return c.json(ok(true)); });

// ========== MACHINE LOG ==========
api.get("/machine-log", (c) => c.json(ok(db.prepare("SELECT * FROM machine_log ORDER BY log_date DESC").all())));
api.post("/machine-log", async (c) => { const b = await c.req.json(); db.prepare("INSERT INTO machine_log (log_date,log_type,description,cost,registered_by) VALUES (?,?,?,?,?)").run(b.log_date,b.log_type,b.description,b.cost||0,b.registered_by||null); return c.json(ok(true)); });
api.put("/machine-log/:id", async (c) => { const b = await c.req.json(); db.prepare("UPDATE machine_log SET log_date=?,log_type=?,description=?,cost=?,registered_by=? WHERE id=?").run(b.log_date,b.log_type,b.description,b.cost,b.registered_by,c.req.param("id")); return c.json(ok(true)); });
api.delete("/machine-log/:id", (c) => { db.prepare("DELETE FROM machine_log WHERE id=?").run(c.req.param("id")); return c.json(ok(true)); });

// ========== DASHBOARD ==========
api.get("/dashboard", (c) => {
  const month = c.req.query("month") || new Date().toISOString().slice(0,7);
  const rev = (db.prepare(`SELECT COALESCE(SUM(amount),0) as t FROM order_payments WHERE payment_date LIKE '${month}%'`).get() as any)?.t || 0;
  const dc = (db.prepare(`SELECT COALESCE(SUM(e.amount),0) as t FROM expenses e JOIN expense_categories ec ON e.category_id=ec.id WHERE ec.is_direct_cost=1 AND e.expense_date LIKE '${month}%'`).get() as any)?.t || 0;
  const mkw = parseFloat((db.prepare("SELECT value FROM settings WHERE key='machine_kw'").get() as any)?.value||"0");
  const kwp = parseFloat((db.prepare("SELECT value FROM settings WHERE key='kwh_price'").get() as any)?.value||"0");
  const totalMin = (db.prepare(`SELECT COALESCE(SUM(rb.machine_minutes),0) as t FROM roasting_batches rb JOIN roasting_sessions rs ON rb.session_id=rs.id WHERE rs.session_date LIKE '${month}%'`).get() as any)?.t || 0;
  const elec = mkw * kwp * (totalMin / 60);
  const oe = (db.prepare(`SELECT COALESCE(SUM(e.amount),0) as t FROM expenses e JOIN expense_categories ec ON e.category_id=ec.id WHERE ec.is_direct_cost=0 AND e.expense_date LIKE '${month}%'`).get() as any)?.t || 0;
  const kgS = (db.prepare(`SELECT COALESCE(SUM(oi.quantity),0) as t FROM order_items oi JOIN orders o ON oi.order_id=o.id WHERE o.created_at LIKE '${month}%'`).get() as any)?.t || 0;
  const kgR = db.prepare(`SELECT COALESCE(SUM(rb.roasted_kg),0) as roasted, COALESCE(SUM(rb.green_kg),0) as green FROM roasting_batches rb JOIN roasting_sessions rs ON rb.session_id=rs.id WHERE rs.session_date LIKE '${month}%'`).get() as any;
  const ml = getMaxLoss();
  const al = (db.prepare(`SELECT AVG(loss_pct) as v FROM roasting_batches rb JOIN roasting_sessions rs ON rb.session_id=rs.id WHERE rb.loss_pct IS NOT NULL AND rs.session_date LIKE '${month}%'`).get() as any)?.v || 0;
  const ao = (db.prepare(`SELECT COUNT(*) as c FROM orders WHERE status NOT IN ('pagado','cancelado','entregado')`).get() as any)?.c || 0;
  const pendingPO = (db.prepare("SELECT COUNT(*) as c FROM purchase_orders WHERE status IN ('pendiente','parcial')").get() as any)?.c || 0;
  const cap = db.prepare(`SELECT partner_name, SUM(amount) as invested, SUM(recovered) as recovered FROM capital_contributions GROUP BY partner_name`).all();
  const ebu = db.prepare(`SELECT paid_by, SUM(amount) as total FROM expenses WHERE expense_date LIKE '${month}%' GROUP BY paid_by`).all();

  const tdc = dc + elec;
  const np = rev - tdc - oe;
  const cpk = kgS > 0 ? tdc / kgS : 0;
  const rpk = kgS > 0 ? rev / kgS : 0;
  const partners = db.prepare("SELECT * FROM partners ORDER BY id").all() as any[];
  const shares = partners.map((p: any) => ({ name: p.name, share: p.profit_share, amount: np > 0 ? (np * p.profit_share / 100) : 0 }));

  return c.json(ok({
    month, revenue: rev, direct_costs: tdc, electricity_cost: elec, electricity_minutes: totalMin,
    other_expenses: oe, net_profit: np, kg_sold: kgS,
    kg_roasted: kgR?.roasted||0, kg_green_used: kgR?.green||0,
    cost_per_kg: cpk, revenue_per_kg: rpk, profit_per_kg: rpk - cpk,
    max_loss_pct: ml, avg_loss_pct: al, active_orders: ao, pending_purchase_orders: pendingPO,
    capital: cap, expenses_by_user: ebu, profit_shares: shares,
    green_stock: getInvByType('cafe_verde'), roasted_stock: getInvByType('cafe_tostado'),
    packaged_stock: getInvByType('cafe_empaquetado'), available_capital: getAvailableCapital(),
    unrecovered_capital: getUnrecoveredCapital()
  }));
});

export default api;
