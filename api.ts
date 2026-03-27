
import { Hono } from "hono";
import {
  computeFinanceSummary,
  createCapitalRequest,
  createPurchaseOrder,
  ensureInventoryItem,
  getSettingNumber,
  getSettingsObject,
  inventoryTotals,
  monthIso,
  newDocNo,
  normalizePartnerName,
  nowIso,
  pushInventoryMovement,
  qAll,
  qGet,
  qRun,
  qVal,
  recalcCapitalRequest,
  recalcPurchaseOrder,
  recalcSalesOrder,
  round2,
  todayIso,
  tx,
} from "./db";

const api = new Hono();

function ok(data: any = null, meta: any = null) {
  return { success: true, data, meta };
}
function fail(message: string, details: any = null) {
  return { success: false, error: message, details };
}
async function bodyOf<T = any>(c: any): Promise<T> {
  try {
    return (await c.req.json()) as T;
  } catch {
    return {} as T;
  }
}
function num(v: any, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function required(cond: any, message: string) {
  if (!cond) throw new Error(message);
}

api.onError((err, c) => {
  console.error(err);
  return c.json(fail(err.message || "Error interno", process.env.NODE_ENV === "development" ? String(err.stack || err) : null), 500);
});

api.get("/health", c => c.json(ok({ status: "ok", at: nowIso() })));

api.get("/master-data", c => {
  const partners = qAll("SELECT * FROM partners ORDER BY id");
  const clients = qAll("SELECT * FROM clients WHERE active = 1 ORDER BY name");
  const products = qAll(
    `SELECT p.*, o.name AS origin_name, v.name AS variety_name, rp.name AS roast_profile_name
       FROM products p
       LEFT JOIN origins o ON o.id = p.origin_id
       LEFT JOIN varieties v ON v.id = p.variety_id
       LEFT JOIN roast_profiles rp ON rp.id = p.roast_profile_id
      WHERE p.active = 1
      ORDER BY p.name`,
  );
  const origins = qAll("SELECT * FROM origins WHERE active = 1 ORDER BY name");
  const varieties = qAll("SELECT * FROM varieties WHERE active = 1 ORDER BY name");
  const roastProfiles = qAll("SELECT * FROM roast_profiles WHERE active = 1 ORDER BY name");
  const expenseCategories = qAll("SELECT * FROM expense_categories WHERE active = 1 ORDER BY name");
  return c.json(ok({ partners, clients, products, origins, varieties, roastProfiles, expenseCategories, settings: getSettingsObject() }));
});

api.get("/dashboard", c => {
  const month = c.req.query("month") || monthIso();
  const finance = computeFinanceSummary();
  const inventory = inventoryTotals();
  const revenueMonth = Number(
    qVal("SELECT COALESCE(SUM(amount),0) AS v FROM sales_payments WHERE substr(created_at,1,7) = ?", month) ?? 0,
  );
  const expenseMonth = Number(
    qVal("SELECT COALESCE(SUM(amount),0) AS v FROM expenses WHERE substr(expense_date,1,7) = ?", month) ?? 0,
  );
  const roastedMonth = Number(
    qVal(
      `SELECT COALESCE(SUM(roasted_kg), 0) AS v
         FROM roasting_batches rb
         JOIN roasting_sessions rs ON rs.id = rb.session_id
        WHERE substr(rs.session_date,1,7) = ?`,
      month,
    ) ?? 0,
  );
  const shippedMonth = Number(
    qVal("SELECT COALESCE(SUM(weight_kg),0) AS v FROM sales_shipments WHERE substr(created_at,1,7) = ?", month) ?? 0,
  );
  const pendingPurchaseOrders = Number(
    qVal("SELECT COUNT(*) AS v FROM purchase_orders WHERE status IN ('pending_capital','pending_purchase','partial')") ?? 0,
  );
  const openCapitalRequests = Number(
    qVal("SELECT COUNT(*) AS v FROM capital_requests WHERE status IN ('open','partially_funded')") ?? 0,
  );
  const openSales = Number(
    qVal("SELECT COUNT(*) AS v FROM sales_orders WHERE status NOT IN ('completed','cancelled')") ?? 0,
  );
  const avgLoss = Number(
    qVal(
      `SELECT COALESCE(AVG(loss_pct),0) AS v
         FROM roasting_batches rb
         JOIN roasting_sessions rs ON rs.id = rb.session_id
        WHERE substr(rs.session_date,1,7) = ? AND loss_pct IS NOT NULL`,
      month,
    ) ?? 0,
  );
  const partners = qAll<any>("SELECT * FROM partners ORDER BY id");
  const partnerBreakdown = partners.map(p => ({
    ...p,
    contributed: Number(qVal("SELECT COALESCE(SUM(amount),0) AS v FROM capital_contributions WHERE partner_name = ?", p.name) ?? 0),
    recovered: Number(qVal("SELECT COALESCE(SUM(amount),0) AS v FROM withdrawals WHERE kind = 'capital_return' AND partner_name = ?", p.name) ?? 0),
    dividends_paid: Number(qVal("SELECT COALESCE(SUM(amount),0) AS v FROM withdrawals WHERE kind = 'dividend' AND partner_name = ?", p.name) ?? 0),
    dividends_available: round2((finance.distributableDividends * p.share_pct) / 100),
  }));
  const lastSales = qAll(
    `SELECT so.id, so.order_no, so.order_type, so.status, so.total_amount, so.total_weight_kg, so.created_at, c.name AS client_name
       FROM sales_orders so
       LEFT JOIN clients c ON c.id = so.client_id
      ORDER BY so.id DESC
      LIMIT 8`,
  );
  const lastPurchaseOrders = qAll(
    `SELECT id, po_no, status, description, requested_green_kg, actual_cost, estimated_cost
       FROM purchase_orders
      ORDER BY id DESC
      LIMIT 8`,
  );

  return c.json(
    ok({
      month,
      revenueMonth,
      expenseMonth,
      roastedMonth,
      shippedMonth,
      avgLoss,
      pendingPurchaseOrders,
      openCapitalRequests,
      openSales,
      inventory,
      finance,
      partnerBreakdown,
      lastSales,
      lastPurchaseOrders,
    }),
  );
});

api.get("/settings", c => c.json(ok(getSettingsObject())));
api.put("/settings", async c => {
  const body = await bodyOf<Record<string, any>>(c);
  for (const [key, value] of Object.entries(body)) {
    qRun("INSERT OR REPLACE INTO settings(key, value) VALUES (?, ?)", key, String(value));
  }
  return c.json(ok(getSettingsObject()));
});

// Catalogs & master data
api.get("/clients", c => c.json(ok(qAll("SELECT * FROM clients WHERE active = 1 ORDER BY name"))));
api.post("/clients", async c => {
  const b = await bodyOf<any>(c);
  required(b.name, "El nombre del cliente es obligatorio.");
  const res = qRun(
    `INSERT INTO clients(name, phone, email, address, city, notes, active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
    b.name,
    b.phone || null,
    b.email || null,
    b.address || null,
    b.city || null,
    b.notes || null,
    nowIso(),
  );
  return c.json(ok(qGet("SELECT * FROM clients WHERE id = ?", Number(res.lastInsertRowid))));
});
api.put("/clients/:id", async c => {
  const id = Number(c.req.param("id"));
  const b = await bodyOf<any>(c);
  required(b.name, "El nombre del cliente es obligatorio.");
  qRun(
    `UPDATE clients
        SET name = ?, phone = ?, email = ?, address = ?, city = ?, notes = ?
      WHERE id = ?`,
    b.name,
    b.phone || null,
    b.email || null,
    b.address || null,
    b.city || null,
    b.notes || null,
    id,
  );
  return c.json(ok(qGet("SELECT * FROM clients WHERE id = ?", id)));
});
api.delete("/clients/:id", c => {
  const id = Number(c.req.param("id"));
  qRun("UPDATE clients SET active = 0 WHERE id = ?", id);
  return c.json(ok(true));
});

api.get("/products", c =>
  c.json(
    ok(
      qAll(
        `SELECT p.*, o.name AS origin_name, v.name AS variety_name, rp.name AS roast_profile_name
           FROM products p
           LEFT JOIN origins o ON o.id = p.origin_id
           LEFT JOIN varieties v ON v.id = p.variety_id
           LEFT JOIN roast_profiles rp ON rp.id = p.roast_profile_id
          WHERE p.active = 1
          ORDER BY p.name`,
      ),
    ),
  ),
);
api.post("/products", async c => {
  const b = await bodyOf<any>(c);
  required(b.name, "El nombre del producto es obligatorio.");
  required(num(b.unit_weight_kg, -1) >= 0, "El peso por unidad debe ser válido.");
  const res = qRun(
    `INSERT INTO products(name, origin_id, variety_id, roast_profile_id, presentation, unit_weight_kg, price, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
    b.name,
    b.origin_id || null,
    b.variety_id || null,
    b.roast_profile_id || null,
    b.presentation || null,
    num(b.unit_weight_kg),
    num(b.price),
  );
  return c.json(ok(qGet("SELECT * FROM products WHERE id = ?", Number(res.lastInsertRowid))));
});
api.put("/products/:id", async c => {
  const id = Number(c.req.param("id"));
  const b = await bodyOf<any>(c);
  required(b.name, "El nombre del producto es obligatorio.");
  qRun(
    `UPDATE products
        SET name = ?, origin_id = ?, variety_id = ?, roast_profile_id = ?, presentation = ?, unit_weight_kg = ?, price = ?
      WHERE id = ?`,
    b.name,
    b.origin_id || null,
    b.variety_id || null,
    b.roast_profile_id || null,
    b.presentation || null,
    num(b.unit_weight_kg),
    num(b.price),
    id,
  );
  return c.json(ok(qGet("SELECT * FROM products WHERE id = ?", id)));
});
api.delete("/products/:id", c => {
  qRun("UPDATE products SET active = 0 WHERE id = ?", Number(c.req.param("id")));
  return c.json(ok(true));
});

function listCatalogTable(table: string) {
  return qAll(`SELECT * FROM ${table} WHERE active = 1 ORDER BY name`);
}
for (const table of ["roast_profiles", "origins", "varieties", "expense_categories"]) {
  api.get(`/${table}`, c => c.json(ok(listCatalogTable(table))));
  api.post(`/${table}`, async c => {
    const b = await bodyOf<any>(c);
    required(b.name, "El nombre es obligatorio.");
    const isDirect = table === "expense_categories" ? num(b.is_direct_cost) : 0;
    const res =
      table === "expense_categories"
        ? qRun(`INSERT INTO ${table}(name, is_direct_cost, active) VALUES (?, ?, 1)`, b.name, isDirect)
        : qRun(`INSERT INTO ${table}(name, active) VALUES (?, 1)`, b.name);
    return c.json(ok(qGet(`SELECT * FROM ${table} WHERE id = ?`, Number(res.lastInsertRowid))));
  });
  api.delete(`/${table}/:id`, c => {
    qRun(`UPDATE ${table} SET active = 0 WHERE id = ?`, Number(c.req.param("id")));
    return c.json(ok(true));
  });
}

// Inventory
api.get("/inventory", c =>
  c.json(
    ok(
      qAll(
        `SELECT i.*, o.name AS origin_name, v.name AS variety_name
           FROM inventory_items i
           LEFT JOIN origins o ON o.id = i.origin_id
           LEFT JOIN varieties v ON v.id = i.variety_id
          ORDER BY i.item_type, i.item_name, i.id`,
      ),
    ),
  ),
);
api.get("/inventory/summary", c => c.json(ok({ ...inventoryTotals(), finance: computeFinanceSummary() })));
api.get("/inventory/green", c =>
  c.json(
    ok(
      qAll(
        `SELECT i.*, o.name AS origin_name, v.name AS variety_name
           FROM inventory_items i
           LEFT JOIN origins o ON o.id = i.origin_id
           LEFT JOIN varieties v ON v.id = i.variety_id
          WHERE i.item_type = 'green_coffee' AND i.quantity > 0
          ORDER BY i.item_name`,
      ),
    ),
  ),
);
api.post("/inventory", async c => {
  const b = await bodyOf<any>(c);
  required(b.item_type, "Tipo de inventario obligatorio.");
  required(b.item_name, "Nombre obligatorio.");
  const res = qRun(
    `INSERT INTO inventory_items(item_type, item_name, quantity, unit, min_stock, origin_id, variety_id, lot_label, presentation, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    b.item_type,
    b.item_name,
    num(b.quantity),
    b.unit || "kg",
    num(b.min_stock),
    b.origin_id || null,
    b.variety_id || null,
    b.lot_label || null,
    b.presentation || null,
    b.notes || null,
    nowIso(),
  );
  return c.json(ok(qGet("SELECT * FROM inventory_items WHERE id = ?", Number(res.lastInsertRowid))));
});
api.post("/inventory/:id/movements", async c => {
  const itemId = Number(c.req.param("id"));
  const b = await bodyOf<any>(c);
  const direction = b.direction as "in" | "out" | "adjust";
  required(["in", "out", "adjust"].includes(direction), "Movimiento inválido.");
  required(num(b.quantity, -1) >= 0, "Cantidad inválida.");

  const move = tx(() => {
    pushInventoryMovement({
      itemId,
      direction,
      quantity: num(b.quantity),
      reason: b.reason || "Movimiento manual",
      registeredBy: b.registered_by || null,
    });
  });
  move();
  return c.json(ok(true));
});
api.get("/inventory/:id/movements", c =>
  c.json(ok(qAll("SELECT * FROM inventory_movements WHERE item_id = ? ORDER BY id DESC", Number(c.req.param("id"))))),
);
api.delete("/inventory/:id", c => {
  qRun("DELETE FROM inventory_items WHERE id = ?", Number(c.req.param("id")));
  return c.json(ok(true));
});

// Sales orders
api.get("/sales-orders", c => {
  const rows = qAll(
    `SELECT so.*, c.name AS client_name,
            COALESCE((SELECT SUM(amount) FROM sales_payments sp WHERE sp.order_id = so.id),0) AS paid_amount,
            COALESCE((SELECT SUM(weight_kg) FROM sales_shipments ss WHERE ss.order_id = so.id),0) AS shipped_kg
       FROM sales_orders so
       LEFT JOIN clients c ON c.id = so.client_id
      ORDER BY so.id DESC`,
  );
  return c.json(ok(rows));
});

api.get("/sales-orders/:id", c => {
  const id = Number(c.req.param("id"));
  const order = qGet(
    `SELECT so.*, c.name AS client_name, c.phone AS client_phone, c.city AS client_city
       FROM sales_orders so
       LEFT JOIN clients c ON c.id = so.client_id
      WHERE so.id = ?`,
    id,
  );
  if (!order) return c.json(fail("Pedido no encontrado"), 404);
  const items = qAll("SELECT * FROM sales_order_items WHERE order_id = ? ORDER BY id", id);
  const payments = qAll("SELECT * FROM sales_payments WHERE order_id = ? ORDER BY id DESC", id);
  const shipments = qAll("SELECT * FROM sales_shipments WHERE order_id = ? ORDER BY id DESC", id);
  const purchaseOrders = qAll("SELECT * FROM purchase_orders WHERE source_type = 'sales_order' AND source_id = ? ORDER BY id DESC", id);
  const batches = qAll(
    `SELECT rb.*, rs.session_date, rp.name AS roast_profile_name
       FROM roasting_batches rb
       JOIN roasting_sessions rs ON rs.id = rb.session_id
       LEFT JOIN roast_profiles rp ON rp.id = rb.roast_profile_id
      WHERE rb.sales_order_id = ?
      ORDER BY rb.id DESC`,
    id,
  );
  return c.json(ok({ order, items, payments, shipments, purchaseOrders, batches }));
});

api.post("/sales-orders", async c => {
  const b = await bodyOf<any>(c);
  const type = b.order_type || "retail";
  required(["retail", "wholesale"].includes(type), "Tipo de pedido inválido.");
  const items = Array.isArray(b.items) ? b.items : [];
  required(items.length > 0 || type === "wholesale", "Agrega al menos un producto o define kilos totales.");

  const create = tx(() => {
    const orderNo = newDocNo(type === "retail" ? "POS" : "SO");
    let totalWeightKg = num(b.total_weight_kg);
    let totalAmount = num(b.total_amount);
    let pricePerKg = num(b.price_per_kg);

    if (type === "retail") {
      totalWeightKg = 0;
      totalAmount = 0;
      for (const item of items) {
        totalWeightKg += num(item.quantity) * num(item.unit_weight_kg);
        totalAmount += num(item.quantity) * num(item.unit_price);
      }
      totalWeightKg = round2(totalWeightKg);
      totalAmount = round2(totalAmount);
      pricePerKg = totalWeightKg > 0 ? round2(totalAmount / totalWeightKg) : 0;
    } else {
      totalAmount = totalAmount || round2(num(b.total_weight_kg) * num(b.price_per_kg));
    }

    const res = qRun(
      `INSERT INTO sales_orders(order_no, order_type, client_id, status, delivery_date, total_weight_kg, price_per_kg, total_amount, notes, created_at, updated_at)
       VALUES (?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?)`,
      orderNo,
      type,
      b.client_id || null,
      b.delivery_date || null,
      round2(totalWeightKg),
      round2(pricePerKg),
      round2(totalAmount),
      b.notes || null,
      nowIso(),
      nowIso(),
    );
    const orderId = Number(res.lastInsertRowid);

    for (const item of items) {
      qRun(
        `INSERT INTO sales_order_items(order_id, product_id, description, presentation, quantity, unit, unit_weight_kg, unit_price, subtotal)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        orderId,
        item.product_id || null,
        item.description || item.name || "Producto",
        item.presentation || null,
        num(item.quantity),
        item.unit || "unit",
        num(item.unit_weight_kg),
        num(item.unit_price),
        round2(num(item.quantity) * num(item.unit_price)),
      );
    }

    if (type === "retail" && num(b.pay_now) !== 0 && totalAmount > 0) {
      qRun(
        `INSERT INTO sales_payments(order_id, amount, method, notes, registered_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        orderId,
        totalAmount,
        b.payment_method || "efectivo",
        "Venta de mostrador",
        b.registered_by || "Sistema",
        nowIso(),
      );
      const roastedItem = qGet<{ id: number }>("SELECT id FROM inventory_items WHERE item_type = 'roasted_coffee' ORDER BY id LIMIT 1");
      if (roastedItem && totalWeightKg > 0) {
        pushInventoryMovement({
          itemId: roastedItem.id,
          direction: "out",
          quantity: totalWeightKg,
          reason: `Venta retail ${orderNo}`,
          refType: "sales_order",
          refId: orderId,
          registeredBy: b.registered_by || "Sistema",
        });
      }
    }

    if (type === "wholesale" && totalWeightKg > 0) {
      const lossPct = getSettingNumber("default_loss_pct", 15);
      const neededGreenKg = round2(totalWeightKg / (1 - lossPct / 100));
      const greenAvailable = inventoryTotals().green;
      const deficit = round2(Math.max(0, neededGreenKg - greenAvailable));

      if (deficit > 0) {
        const estCost = round2(deficit * getSettingNumber("default_green_cost_per_kg", 0));
        createPurchaseOrder({
          sourceType: "sales_order",
          sourceId: orderId,
          description: `Compra de café verde para ${orderNo}`,
          requestedGreenKg: deficit,
          estimatedCost: estCost,
          notes: `Pedido de venta requiere ${neededGreenKg} kg verde con merma ${lossPct}%`,
        });
      }
    }

    if (type === "retail") recalcSalesOrder(orderId);
    else recalcSalesOrder(orderId);

    return qGet("SELECT * FROM sales_orders WHERE id = ?", orderId);
  });

  return c.json(ok(create()));
});

api.post("/sales-orders/:id/payments", async c => {
  const orderId = Number(c.req.param("id"));
  const b = await bodyOf<any>(c);
  required(num(b.amount, 0) > 0, "Monto inválido.");
  qRun(
    `INSERT INTO sales_payments(order_id, amount, method, notes, registered_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    orderId,
    round2(num(b.amount)),
    b.method || "transferencia",
    b.notes || null,
    b.registered_by || "Sistema",
    nowIso(),
  );
  const order = recalcSalesOrder(orderId);
  return c.json(ok(order));
});

api.delete("/sales-payments/:id", c => {
  const payment = qGet<any>("SELECT * FROM sales_payments WHERE id = ?", Number(c.req.param("id")));
  if (!payment) return c.json(fail("Pago no encontrado"), 404);
  qRun("DELETE FROM sales_payments WHERE id = ?", payment.id);
  const order = recalcSalesOrder(payment.order_id);
  return c.json(ok(order));
});

api.post("/sales-orders/:id/shipments", async c => {
  const orderId = Number(c.req.param("id"));
  const b = await bodyOf<any>(c);
  required(num(b.weight_kg, 0) > 0, "Peso de envío inválido.");

  const send = tx(() => {
    const roastedItem = qGet<{ id: number }>("SELECT id FROM inventory_items WHERE item_type = 'roasted_coffee' ORDER BY id LIMIT 1");
    required(roastedItem?.id, "No existe inventario de café tostado.");

    pushInventoryMovement({
      itemId: roastedItem.id,
      direction: "out",
      quantity: round2(num(b.weight_kg)),
      reason: `Envío pedido #${orderId}`,
      refType: "sales_order",
      refId: orderId,
      registeredBy: b.registered_by || "Sistema",
    });

    let expenseId: number | null = null;
    if (num(b.shipping_cost) > 0) {
      const finance = computeFinanceSummary();
      required(finance.availableCash >= num(b.shipping_cost), "No hay capital disponible para cubrir el envío.");
      const shippingCat = qGet<{ id: number }>("SELECT id FROM expense_categories WHERE name = 'Envíos' LIMIT 1");
      const exp = qRun(
        `INSERT INTO expenses(expense_date, category_id, amount, description, paid_by, supplier, notes, auto_generated, ref_type, ref_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'shipment', ?, ?)`,
        todayIso(),
        shippingCat?.id || 1,
        round2(num(b.shipping_cost)),
        `Envío pedido #${orderId}`,
        b.registered_by || "Sistema",
        b.carrier || null,
        b.notes || null,
        orderId,
        nowIso(),
      );
      expenseId = Number(exp.lastInsertRowid);
    }

    qRun(
      `INSERT INTO sales_shipments(order_id, weight_kg, destination_address, carrier, tracking_number, shipping_cost, registered_by, notes, expense_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      orderId,
      round2(num(b.weight_kg)),
      b.destination_address || null,
      b.carrier || null,
      b.tracking_number || null,
      round2(num(b.shipping_cost)),
      b.registered_by || "Sistema",
      b.notes || null,
      expenseId,
      nowIso(),
    );
  });

  send();
  return c.json(ok(recalcSalesOrder(orderId)));
});

api.delete("/sales-shipments/:id", c => {
  const row = qGet<any>("SELECT * FROM sales_shipments WHERE id = ?", Number(c.req.param("id")));
  if (!row) return c.json(fail("Envío no encontrado"), 404);

  const revert = tx(() => {
    const roastedItem = qGet<{ id: number }>("SELECT id FROM inventory_items WHERE item_type = 'roasted_coffee' ORDER BY id LIMIT 1");
    if (roastedItem?.id) {
      pushInventoryMovement({
        itemId: roastedItem.id,
        direction: "in",
        quantity: row.weight_kg,
        reason: `Reverso envío ${row.id}`,
        refType: "sales_shipment",
        refId: row.id,
        registeredBy: "Sistema",
      });
    }
    if (row.expense_id) qRun("DELETE FROM expenses WHERE id = ?", row.expense_id);
    qRun("DELETE FROM sales_shipments WHERE id = ?", row.id);
  });
  revert();

  return c.json(ok(recalcSalesOrder(row.order_id)));
});

api.patch("/sales-orders/:id/status", async c => {
  const id = Number(c.req.param("id"));
  const b = await bodyOf<any>(c);
  const status = String(b.status || "");
  required(["open", "pending_purchase", "in_production", "ready", "partial_shipped", "completed", "cancelled"].includes(status), "Estado inválido.");
  qRun("UPDATE sales_orders SET status = ?, updated_at = ? WHERE id = ?", status, nowIso(), id);
  return c.json(ok(qGet("SELECT * FROM sales_orders WHERE id = ?", id)));
});

api.delete("/sales-orders/:id", c => {
  const id = Number(c.req.param("id"));
  qRun("DELETE FROM sales_orders WHERE id = ?", id);
  return c.json(ok(true));
});

// Purchase orders
api.get("/purchase-orders", c => {
  const rows = qAll(
    `SELECT po.*,
            COALESCE((SELECT amount_requested - amount_funded FROM capital_requests cr WHERE cr.source_type = 'purchase_order' AND cr.source_id = po.id AND cr.status IN ('open','partially_funded') ORDER BY cr.id DESC LIMIT 1),0) AS capital_missing
       FROM purchase_orders po
      ORDER BY po.id DESC`,
  );
  return c.json(ok(rows));
});

api.get("/purchase-orders/:id", c => {
  const id = Number(c.req.param("id"));
  const purchaseOrder = qGet("SELECT * FROM purchase_orders WHERE id = ?", id);
  if (!purchaseOrder) return c.json(fail("Orden de compra no encontrada"), 404);
  const entries = qAll(
    `SELECT pe.*, i.item_name
       FROM purchase_entries pe
       JOIN inventory_items i ON i.id = pe.inventory_item_id
      WHERE pe.purchase_order_id = ?
      ORDER BY pe.id DESC`,
    id,
  );
  const capitalRequests = qAll(
    `SELECT * FROM capital_requests
      WHERE source_type = 'purchase_order' AND source_id = ?
      ORDER BY id DESC`,
    id,
  );
  return c.json(ok({ purchaseOrder, entries, capitalRequests }));
});

api.post("/purchase-orders", async c => {
  const b = await bodyOf<any>(c);
  required(b.description, "Descripción obligatoria.");
  required(num(b.requested_green_kg, 0) > 0, "Kg requeridos inválidos.");
  const requestedKg = num(b.requested_green_kg);
  const estimatedCost = num(b.estimated_cost, 0) > 0 ? num(b.estimated_cost) : round2(requestedKg * num(b.estimated_cost_per_kg, 0));
  const po = createPurchaseOrder({
    sourceType: "manual",
    description: b.description,
    requestedGreenKg: requestedKg,
    estimatedCost,
    estimatedShippingCost: num(b.estimated_shipping_cost),
    supplier: b.supplier || null,
    notes: b.notes || null,
  });
  return c.json(ok(po));
});

api.post("/purchase-orders/:id/receive", async c => {
  const poId = Number(c.req.param("id"));
  const b = await bodyOf<any>(c);
  const po = qGet<any>("SELECT * FROM purchase_orders WHERE id = ?", poId);
  if (!po) return c.json(fail("Orden de compra no encontrada"), 404);
  required(num(b.quantity_kg, 0) > 0, "Cantidad inválida.");

  const quantityKg = round2(num(b.quantity_kg));
  const unitCost = num(b.unit_cost, 0) > 0 ? num(b.unit_cost) : quantityKg > 0 ? round2(num(b.total_cost, 0) / quantityKg) : 0;
  const greenCost = num(b.total_cost, 0) > 0 ? round2(num(b.total_cost)) : round2(quantityKg * unitCost);
  const shippingCost = round2(num(b.shipping_cost, 0));
  const landedCost = round2(greenCost + shippingCost);
  required(unitCost > 0 || greenCost > 0, "Costo por kilo o costo total inválido.");
  required(landedCost > 0, "Costo total inválido.");

  const finance = computeFinanceSummary();
  if (finance.availableCash < landedCost) {
    const missing = round2(landedCost - finance.availableCash);
    const req = createCapitalRequest({
      amountRequested: missing,
      notes: `Capital adicional para ejecutar ${po.po_no}`,
      sourceType: "purchase_order",
      sourceId: poId,
    });
    recalcPurchaseOrder(poId);
    return c.json(fail(`No hay capital disponible para ejecutar la compra. Se creó la orden de ingreso de capital ${req?.request_no}.`), 400);
  }

  const receive = tx(() => {
    const lotLabel = b.lot_label || `${todayIso()}-${po.po_no}`;
    const itemName =
      b.item_name ||
      [b.origin_name || null, b.variety_name || null, lotLabel ? `Lote ${lotLabel}` : null]
        .filter(Boolean)
        .join(" · ") ||
      `Café verde ${lotLabel}`;

    const itemId = ensureInventoryItem({
      item_type: "green_coffee",
      item_name: itemName,
      unit: "kg",
      origin_id: b.origin_id || null,
      variety_id: b.variety_id || null,
      lot_label: lotLabel,
      notes: po.description,
    });

    pushInventoryMovement({
      itemId,
      direction: "in",
      quantity: quantityKg,
      reason: `Recepción ${po.po_no}`,
      refType: "purchase_order",
      refId: poId,
      registeredBy: b.registered_by || "Sistema",
    });

    qRun(
      `INSERT INTO purchase_entries(purchase_order_id, inventory_item_id, quantity_kg, unit_cost, total_cost, shipping_cost, supplier, lot_label, origin_id, variety_id, registered_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      poId,
      itemId,
      quantityKg,
      round2(unitCost),
      greenCost,
      shippingCost,
      b.supplier || po.supplier || null,
      lotLabel,
      b.origin_id || null,
      b.variety_id || null,
      b.registered_by || "Sistema",
      nowIso(),
    );

    const greenCat = qGet<{ id: number }>("SELECT id FROM expense_categories WHERE name = 'Café verde' LIMIT 1");
    qRun(
      `INSERT INTO expenses(expense_date, category_id, amount, description, paid_by, supplier, notes, auto_generated, ref_type, ref_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'purchase_order', ?, ?)`,
      todayIso(),
      greenCat?.id || 1,
      greenCost,
      `Compra verde ${po.po_no}`,
      b.registered_by || "Sistema",
      b.supplier || po.supplier || null,
      b.notes || po.notes || null,
      poId,
      nowIso(),
    );

    if (shippingCost > 0) {
      const shipCat = qGet<{ id: number }>("SELECT id FROM expense_categories WHERE name = 'Envíos' LIMIT 1");
      qRun(
        `INSERT INTO expenses(expense_date, category_id, amount, description, paid_by, supplier, notes, auto_generated, ref_type, ref_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'purchase_order_shipping', ?, ?)`,
        todayIso(),
        shipCat?.id || 1,
        shippingCost,
        `Envío compra ${po.po_no}`,
        b.registered_by || "Sistema",
        b.supplier || po.supplier || null,
        b.shipping_notes || b.notes || po.notes || null,
        poId,
        nowIso(),
      );
    }

    recalcPurchaseOrder(poId);
    if (po.source_type === "sales_order" && po.source_id) recalcSalesOrder(po.source_id);
  });

  receive();
  return c.json(ok(qGet("SELECT * FROM purchase_orders WHERE id = ?", poId)));
});

api.delete("/purchase-orders/:id", c => {
  qRun("UPDATE purchase_orders SET status = 'cancelled', updated_at = ? WHERE id = ?", nowIso(), Number(c.req.param("id")));
  return c.json(ok(true));
});

// Capital and dividends
api.get("/capital/summary", c => {
  const finance = computeFinanceSummary();
  const partners = qAll<any>("SELECT * FROM partners ORDER BY id").map(p => ({
    ...p,
    contributed: Number(qVal("SELECT COALESCE(SUM(amount),0) AS v FROM capital_contributions WHERE partner_name = ?", p.name) ?? 0),
    capital_returned: Number(qVal("SELECT COALESCE(SUM(amount),0) AS v FROM withdrawals WHERE kind = 'capital_return' AND partner_name = ?", p.name) ?? 0),
    dividends_paid: Number(qVal("SELECT COALESCE(SUM(amount),0) AS v FROM withdrawals WHERE kind = 'dividend' AND partner_name = ?", p.name) ?? 0),
    dividend_capacity: round2((finance.distributableDividends * p.share_pct) / 100),
  }));
  return c.json(ok({ finance, partners }));
});

api.get("/capital-requests", c => c.json(ok(qAll("SELECT * FROM capital_requests ORDER BY id DESC"))));
api.post("/capital-requests", async c => {
  const b = await bodyOf<any>(c);
  required(num(b.amount_requested, 0) > 0, "Monto inválido.");
  const row = createCapitalRequest({
    amountRequested: num(b.amount_requested),
    notes: b.notes || "Solicitud manual de ingreso de capital",
    sourceType: "manual",
  });
  return c.json(ok(row));
});

api.get("/capital-contributions", c =>
  c.json(
    ok(
      qAll(
        `SELECT cc.*, cr.request_no
           FROM capital_contributions cc
           LEFT JOIN capital_requests cr ON cr.id = cc.capital_request_id
          ORDER BY cc.id DESC`,
      ),
    ),
  ),
);
api.post("/capital-contributions", async c => {
  const b = await bodyOf<any>(c);
  required(normalizePartnerName(b.partner_name), "Socio obligatorio.");
  required(num(b.amount, 0) > 0, "Monto inválido.");
  required(b.description, "Descripción obligatoria.");
  const res = qRun(
    `INSERT INTO capital_contributions(capital_request_id, partner_name, amount, description, contribution_date, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    b.capital_request_id || null,
    normalizePartnerName(b.partner_name),
    round2(num(b.amount)),
    b.description,
    b.contribution_date || todayIso(),
    nowIso(),
  );
  if (b.capital_request_id) recalcCapitalRequest(Number(b.capital_request_id));
  return c.json(ok(qGet("SELECT * FROM capital_contributions WHERE id = ?", Number(res.lastInsertRowid))));
});

api.get("/dividend-orders", c =>
  c.json(
    ok(
      qAll(
        `SELECT d.*,
                COALESCE((SELECT COUNT(*) FROM dividend_order_lines l WHERE l.dividend_order_id = d.id),0) AS line_count
           FROM dividend_orders d
          ORDER BY d.id DESC`,
      ),
    ),
  ),
);
api.get("/dividend-orders/:id", c => {
  const id = Number(c.req.param("id"));
  const order = qGet("SELECT * FROM dividend_orders WHERE id = ?", id);
  if (!order) return c.json(fail("Orden de dividendos no encontrada"), 404);
  const lines = qAll("SELECT * FROM dividend_order_lines WHERE dividend_order_id = ? ORDER BY id", id);
  return c.json(ok({ order, lines }));
});
api.post("/dividend-orders", async c => {
  const b = await bodyOf<any>(c);
  const finance = computeFinanceSummary();
  required(finance.unrecoveredCapital <= 0, "No se pueden repartir dividendos hasta recuperar todo el capital.");
  required(finance.distributableDividends > 0, "No hay utilidades distribuibles.");
  const requested = b.total_amount ? round2(num(b.total_amount)) : finance.distributableDividends;
  required(requested > 0, "Monto inválido.");
  required(requested <= finance.distributableDividends, "El monto excede las utilidades distribuibles.");
  required(requested <= finance.availableCash, "No hay efectivo suficiente para repartir ese monto.");

  const make = tx(() => {
    const res = qRun(
      `INSERT INTO dividend_orders(dividend_no, month, status, total_amount, notes, created_at, updated_at)
       VALUES (?, ?, 'open', ?, ?, ?, ?)`,
      newDocNo("DIV"),
      b.month || monthIso(),
      requested,
      b.notes || "Orden de reparto mensual",
      nowIso(),
      nowIso(),
    );
    const id = Number(res.lastInsertRowid);
    const partners = qAll<any>("SELECT * FROM partners ORDER BY id");
    for (const partner of partners) {
      qRun(
        `INSERT INTO dividend_order_lines(dividend_order_id, partner_name, share_pct, amount)
         VALUES (?, ?, ?, ?)`,
        id,
        partner.name,
        partner.share_pct,
        round2((requested * partner.share_pct) / 100),
      );
    }
    return qGet("SELECT * FROM dividend_orders WHERE id = ?", id);
  });

  return c.json(ok(make()));
});
api.post("/dividend-orders/:id/pay", async c => {
  const id = Number(c.req.param("id"));
  const order = qGet<any>("SELECT * FROM dividend_orders WHERE id = ?", id);
  if (!order) return c.json(fail("Orden no encontrada"), 404);
  const finance = computeFinanceSummary();
  required(order.status === "open", "La orden ya fue pagada o cancelada.");
  required(finance.unrecoveredCapital <= 0, "No se puede pagar dividendos mientras exista capital por recuperar.");
  required(finance.availableCash >= order.total_amount, "No hay efectivo suficiente para pagar dividendos.");

  const pay = tx(() => {
    const lines = qAll<any>("SELECT * FROM dividend_order_lines WHERE dividend_order_id = ?", id);
    for (const line of lines) {
      qRun(
        `INSERT INTO withdrawals(kind, partner_name, amount, month, dividend_order_id, notes, created_at)
         VALUES ('dividend', ?, ?, ?, ?, ?, ?)`,
        line.partner_name,
        line.amount,
        order.month,
        id,
        `Pago ${order.dividend_no}`,
        nowIso(),
      );
    }
    qRun("UPDATE dividend_orders SET status = 'paid', updated_at = ? WHERE id = ?", nowIso(), id);
  });
  pay();
  return c.json(ok(qGet("SELECT * FROM dividend_orders WHERE id = ?", id)));
});

api.get("/withdrawals", c =>
  c.json(ok(qAll("SELECT * FROM withdrawals ORDER BY id DESC"))),
);

api.post("/withdrawals/capital-return", async c => {
  const b = await bodyOf<any>(c);
  required(normalizePartnerName(b.partner_name), "Socio obligatorio.");
  required(num(b.amount, 0) > 0, "Monto inválido.");
  const finance = computeFinanceSummary();
  required(finance.availableCash >= num(b.amount), "No hay efectivo disponible para devolver capital.");

  const partnerName = normalizePartnerName(b.partner_name);
  const contributed = Number(qVal("SELECT COALESCE(SUM(amount),0) AS v FROM capital_contributions WHERE partner_name = ?", partnerName) ?? 0);
  const recovered = Number(qVal("SELECT COALESCE(SUM(amount),0) AS v FROM withdrawals WHERE kind = 'capital_return' AND partner_name = ?", partnerName) ?? 0);
  required(contributed - recovered >= num(b.amount), "El monto supera el capital pendiente de recuperar de ese socio.");

  const res = qRun(
    `INSERT INTO withdrawals(kind, partner_name, amount, month, contribution_id, notes, created_at)
     VALUES ('capital_return', ?, ?, ?, ?, ?, ?)`,
    normalizePartnerName(b.partner_name),
    round2(num(b.amount)),
    b.month || monthIso(),
    b.contribution_id || null,
    b.notes || "Devolución de capital",
    nowIso(),
  );
  return c.json(ok(qGet("SELECT * FROM withdrawals WHERE id = ?", Number(res.lastInsertRowid))));
});

// Expenses
api.get("/expenses", c => {
  const month = c.req.query("month");
  const sql = month
    ? `SELECT e.*, ec.name AS category_name, ec.is_direct_cost
         FROM expenses e
         JOIN expense_categories ec ON ec.id = e.category_id
        WHERE substr(e.expense_date,1,7) = ?
        ORDER BY e.id DESC`
    : `SELECT e.*, ec.name AS category_name, ec.is_direct_cost
         FROM expenses e
         JOIN expense_categories ec ON ec.id = e.category_id
        ORDER BY e.id DESC`;
  const rows = month ? qAll(sql, month) : qAll(sql);
  return c.json(ok(rows));
});
api.post("/expenses", async c => {
  const b = await bodyOf<any>(c);
  required(b.category_id, "Categoría obligatoria.");
  required(num(b.amount, 0) > 0, "Monto inválido.");
  const fundingSource = b.funding_source || "cash";
  const amount = round2(num(b.amount));
  const create = tx(() => {
    let contributionId: number | null = null;
    if (fundingSource === "cash") {
      const finance = computeFinanceSummary();
      required(finance.availableCash >= amount, "No hay dinero disponible en caja para este gasto.");
    } else {
      const partnerName = normalizePartnerName(fundingSource);
      required(["Itza + Gastón", "Axel"].includes(partnerName), "Fuente de financiamiento inválida.");
      const cres = qRun(
        `INSERT INTO capital_contributions(partner_name, amount, description, contribution_date, capital_request_id, notes, created_at)
         VALUES (?, ?, ?, ?, NULL, ?, ?)`,
        partnerName,
        amount,
        b.description || "Aporte para gasto",
        b.expense_date || todayIso(),
        `Aporte automático para cubrir gasto: ${b.description || "sin descripción"}`,
        nowIso(),
      );
      contributionId = Number(cres.lastInsertRowid);
    }
    const res = qRun(
      `INSERT INTO expenses(expense_date, category_id, amount, description, paid_by, supplier, notes, auto_generated, ref_type, ref_id, funding_source, capital_contribution_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
      b.expense_date || todayIso(),
      b.category_id,
      amount,
      b.description || null,
      fundingSource === "cash" ? "Caja" : normalizePartnerName(fundingSource),
      b.supplier || null,
      b.notes || null,
      b.ref_type || null,
      b.ref_id || null,
      fundingSource,
      contributionId,
      nowIso(),
    );
    return qGet("SELECT * FROM expenses WHERE id = ?", Number(res.lastInsertRowid));
  });
  return c.json(ok(create()));
});
api.delete("/expenses/:id", c => {
  qRun("DELETE FROM expenses WHERE id = ?", Number(c.req.param("id")));
  return c.json(ok(true));
});

// Roasting
api.get("/roasting-sessions", c => {
  const rows = qAll(
    `SELECT rs.*,
            COALESCE((SELECT COUNT(*) FROM roasting_batches rb WHERE rb.session_id = rs.id),0) AS batch_count,
            COALESCE((SELECT SUM(green_kg) FROM roasting_batches rb WHERE rb.session_id = rs.id),0) AS total_green,
            COALESCE((SELECT SUM(roasted_kg) FROM roasting_batches rb WHERE rb.session_id = rs.id),0) AS total_roasted,
            COALESCE((SELECT SUM(machine_minutes) FROM roasting_batches rb WHERE rb.session_id = rs.id),0) AS total_minutes
       FROM roasting_sessions rs
      ORDER BY rs.session_date DESC, rs.id DESC`,
  );
  return c.json(ok(rows));
});

api.get("/roasting-sessions/:id", c => {
  const id = Number(c.req.param("id"));
  const session = qGet("SELECT * FROM roasting_sessions WHERE id = ?", id);
  if (!session) return c.json(fail("Sesión no encontrada"), 404);
  const batches = qAll(
    `SELECT rb.*, i.item_name AS green_item_name, rp.name AS roast_profile_name, so.order_no
       FROM roasting_batches rb
       JOIN inventory_items i ON i.id = rb.green_inventory_item_id
       LEFT JOIN roast_profiles rp ON rp.id = rb.roast_profile_id
       LEFT JOIN sales_orders so ON so.id = rb.sales_order_id
      WHERE rb.session_id = ?
      ORDER BY rb.id DESC`,
    id,
  );
  return c.json(ok({ session, batches }));
});

api.post("/roasting-sessions", async c => {
  const b = await bodyOf<any>(c);
  required(b.session_date, "Fecha obligatoria.");
  required(b.operator, "Operador obligatorio.");
  const res = qRun(
    `INSERT INTO roasting_sessions(session_date, operator, notes, created_at)
     VALUES (?, ?, ?, ?)`,
    b.session_date,
    b.operator,
    b.notes || null,
    nowIso(),
  );
  return c.json(ok(qGet("SELECT * FROM roasting_sessions WHERE id = ?", Number(res.lastInsertRowid))));
});

api.post("/roasting-sessions/:id/batches", async c => {
  const sessionId = Number(c.req.param("id"));
  const b = await bodyOf<any>(c);
  required(b.green_inventory_item_id, "Selecciona el café verde.");
  required(num(b.green_kg, 0) > 0, "Kg verde inválidos.");

  const create = tx(() => {
    const greenItem = qGet<any>("SELECT * FROM inventory_items WHERE id = ?", b.green_inventory_item_id);
    required(greenItem, "Ítem de inventario no encontrado.");
    required(greenItem.item_type === "green_coffee", "El batch debe usar inventario de café verde.");

    const roastedKg = b.roasted_kg === null || b.roasted_kg === undefined || b.roasted_kg === "" ? null : round2(num(b.roasted_kg));
    const lossPct = roastedKg && num(b.green_kg) > 0 ? round2(((num(b.green_kg) - roastedKg) / num(b.green_kg)) * 100) : null;
    const batchNo = newDocNo("RB");

    pushInventoryMovement({
      itemId: Number(b.green_inventory_item_id),
      direction: "out",
      quantity: round2(num(b.green_kg)),
      reason: `Consumo batch ${batchNo}`,
      refType: "roasting_session",
      refId: sessionId,
      registeredBy: b.registered_by || "Sistema",
    });

    const roastedItem = qGet<{ id: number }>("SELECT id FROM inventory_items WHERE item_type = 'roasted_coffee' ORDER BY id LIMIT 1");
    required(roastedItem?.id, "No existe inventario de café tostado.");
    if (roastedKg && roastedKg > 0) {
      pushInventoryMovement({
        itemId: roastedItem.id,
        direction: "in",
        quantity: roastedKg,
        reason: `Salida batch ${batchNo}`,
        refType: "roasting_batch",
        refId: sessionId,
        registeredBy: b.registered_by || "Sistema",
      });
    }

    const res = qRun(
      `INSERT INTO roasting_batches(session_id, batch_no, green_inventory_item_id, roast_profile_id, sales_order_id, green_kg, roasted_kg, loss_pct, machine_minutes, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      sessionId,
      batchNo,
      b.green_inventory_item_id,
      b.roast_profile_id || null,
      b.sales_order_id || null,
      round2(num(b.green_kg)),
      roastedKg,
      lossPct,
      round2(num(b.machine_minutes)),
      b.notes || null,
      nowIso(),
    );

    if (b.sales_order_id) recalcSalesOrder(Number(b.sales_order_id));
    return qGet("SELECT * FROM roasting_batches WHERE id = ?", Number(res.lastInsertRowid));
  });

  return c.json(ok(create()));
});

api.patch("/roasting-batches/:id", async c => {
  const id = Number(c.req.param("id"));
  const b = await bodyOf<any>(c);
  const current = qGet<any>("SELECT * FROM roasting_batches WHERE id = ?", id);
  if (!current) return c.json(fail("Batch no encontrado"), 404);

  const update = tx(() => {
    const roastedItem = qGet<{ id: number }>("SELECT id FROM inventory_items WHERE item_type = 'roasted_coffee' ORDER BY id LIMIT 1");
    if (!roastedItem?.id) throw new Error("No existe inventario de café tostado.");
    const newRoasted = b.roasted_kg === null || b.roasted_kg === undefined || b.roasted_kg === "" ? null : round2(num(b.roasted_kg));
    const currentRoasted = current.roasted_kg ? Number(current.roasted_kg) : 0;
    const delta = round2((newRoasted || 0) - currentRoasted);
    if (delta > 0) {
      pushInventoryMovement({
        itemId: roastedItem.id,
        direction: "in",
        quantity: delta,
        reason: `Ajuste batch ${current.batch_no}`,
        refType: "roasting_batch",
        refId: id,
        registeredBy: b.registered_by || "Sistema",
      });
    } else if (delta < 0) {
      pushInventoryMovement({
        itemId: roastedItem.id,
        direction: "out",
        quantity: Math.abs(delta),
        reason: `Ajuste batch ${current.batch_no}`,
        refType: "roasting_batch",
        refId: id,
        registeredBy: b.registered_by || "Sistema",
      });
    }
    const lossPct = newRoasted && current.green_kg > 0 ? round2(((current.green_kg - newRoasted) / current.green_kg) * 100) : null;
    qRun(
      `UPDATE roasting_batches
          SET roast_profile_id = ?, sales_order_id = ?, roasted_kg = ?, loss_pct = ?, machine_minutes = ?, notes = ?
        WHERE id = ?`,
      b.roast_profile_id || current.roast_profile_id || null,
      b.sales_order_id || current.sales_order_id || null,
      newRoasted,
      lossPct,
      round2(num(b.machine_minutes, current.machine_minutes)),
      b.notes ?? current.notes ?? null,
      id,
    );
    if (current.sales_order_id) recalcSalesOrder(current.sales_order_id);
    if (b.sales_order_id) recalcSalesOrder(Number(b.sales_order_id));
  });

  update();
  return c.json(ok(qGet("SELECT * FROM roasting_batches WHERE id = ?", id)));
});

api.delete("/roasting-batches/:id", c => {
  const id = Number(c.req.param("id"));
  const batch = qGet<any>("SELECT * FROM roasting_batches WHERE id = ?", id);
  if (!batch) return c.json(fail("Batch no encontrado"), 404);

  const remove = tx(() => {
    pushInventoryMovement({
      itemId: batch.green_inventory_item_id,
      direction: "in",
      quantity: batch.green_kg,
      reason: `Reverso batch ${batch.batch_no}`,
      refType: "roasting_batch",
      refId: id,
      registeredBy: "Sistema",
    });
    if (batch.roasted_kg) {
      const roastedItem = qGet<{ id: number }>("SELECT id FROM inventory_items WHERE item_type = 'roasted_coffee' ORDER BY id LIMIT 1");
      if (roastedItem?.id) {
        pushInventoryMovement({
          itemId: roastedItem.id,
          direction: "out",
          quantity: batch.roasted_kg,
          reason: `Reverso batch ${batch.batch_no}`,
          refType: "roasting_batch",
          refId: id,
          registeredBy: "Sistema",
        });
      }
    }
    qRun("DELETE FROM roasting_batches WHERE id = ?", id);
    if (batch.sales_order_id) recalcSalesOrder(batch.sales_order_id);
  });

  remove();
  return c.json(ok(true));
});

api.delete("/roasting-sessions/:id", c => {
  const id = Number(c.req.param("id"));
  const batches = qAll<any>("SELECT id FROM roasting_batches WHERE session_id = ?", id);
  if (batches.length > 0) return c.json(fail("Elimina primero los batches de la sesión."), 400);
  qRun("DELETE FROM roasting_sessions WHERE id = ?", id);
  return c.json(ok(true));
});

// Machine logs
api.get("/machine-logs", c => c.json(ok(qAll("SELECT * FROM machine_logs ORDER BY log_date DESC, id DESC"))));
api.post("/machine-logs", async c => {
  const b = await bodyOf<any>(c);
  required(b.log_date, "Fecha obligatoria.");
  required(b.log_type, "Tipo obligatorio.");
  required(b.description, "Descripción obligatoria.");
  const cost = round2(num(b.cost));
  const fundingSource = b.funding_source || "cash";
  const create = tx(() => {
    let contributionId: number | null = null;
    if (cost > 0) {
      if (fundingSource === "cash") {
        const finance = computeFinanceSummary();
        required(finance.availableCash >= cost, "No hay dinero disponible en caja para este registro.");
      } else {
        const partnerName = normalizePartnerName(fundingSource);
        required(["Itza + Gastón", "Axel"].includes(partnerName), "Fuente de financiamiento inválida.");
        const cres = qRun(
          `INSERT INTO capital_contributions(partner_name, amount, description, contribution_date, capital_request_id, notes, created_at)
           VALUES (?, ?, ?, ?, NULL, ?, ?)`,
          partnerName,
          cost,
          `Aporte para ${b.log_type || 'máquina'}`,
          b.log_date || todayIso(),
          `Aporte automático para bitácora de máquina: ${b.description}`,
          nowIso(),
        );
        contributionId = Number(cres.lastInsertRowid);
      }
    }
    const logRes = qRun(
      `INSERT INTO machine_logs(log_date, log_type, description, cost, registered_by, funding_source, expense_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
      b.log_date,
      b.log_type,
      b.description,
      cost,
      b.registered_by || null,
      fundingSource,
      nowIso(),
    );
    const logId = Number(logRes.lastInsertRowid);
    if (cost > 0) {
      const cat = qGet<{ id: number }>("SELECT id FROM expense_categories WHERE name = 'Mantenimiento' LIMIT 1");
      const expRes = qRun(
        `INSERT INTO expenses(expense_date, category_id, amount, description, paid_by, supplier, notes, auto_generated, ref_type, ref_id, funding_source, capital_contribution_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'machine_log', ?, ?, ?, ?)`,
        b.log_date || todayIso(),
        cat?.id || 1,
        cost,
        `Máquina · ${b.log_type} · ${b.description}`,
        fundingSource === "cash" ? "Caja" : normalizePartnerName(fundingSource),
        null,
        b.notes || null,
        logId,
        fundingSource,
        contributionId,
        nowIso(),
      );
      qRun("UPDATE machine_logs SET expense_id = ? WHERE id = ?", Number(expRes.lastInsertRowid), logId);
    }
    return qGet("SELECT * FROM machine_logs WHERE id = ?", logId);
  });
  return c.json(ok(create()));
});
api.delete("/machine-logs/:id", c => {
  const id = Number(c.req.param("id"));
  const row = qGet<any>("SELECT * FROM machine_logs WHERE id = ?", id);
  if (row?.expense_id) qRun("DELETE FROM expenses WHERE id = ?", row.expense_id);
  qRun("DELETE FROM machine_logs WHERE id = ?", id);
  return c.json(ok(true));
});

export default api;
