const state = {
  view: "dashboard",
  params: {},
  master: null,
};

const VIEWS = {
  dashboard: "Dashboard",
  sales: "Ventas",
  salesDetail: "Detalle de venta",
  purchases: "Compras",
  purchaseDetail: "Detalle de compra",
  capital: "Capital & Utilidades",
  roasting: "Tostado",
  roastingDetail: "Detalle de sesión",
  inventory: "Inventario",
  expenses: "Gastos",
  machine: "Máquina",
  config: "Configuración",
};

const moneyFmt = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 2 });
const numFmt = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 2 });

function money(n) { return moneyFmt.format(Number(n || 0)); }
function kg(n) { return `${numFmt.format(Number(n || 0))} kg`; }
function pct(n) { return `${numFmt.format(Number(n || 0))}%`; }
function esc(v) { return String(v ?? "").replace(/[&<>"]/g, m => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" }[m])); }
function val(id) { return document.getElementById(id)?.value; }
function setStatus(text) { document.getElementById("statusPill").textContent = text; }
function statusBadge(status) { return `<span class="badge ${status}">${esc(status)}</span>`; }
function titleize(text) { return text.charAt(0).toUpperCase() + text.slice(1); }

async function api(path, options = {}) {
  const opts = { ...options };
  opts.headers = { ...(opts.headers || {}) };
  if (opts.body && !(opts.body instanceof FormData)) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(opts.body);
  }
  const res = await fetch(`/api${path}`, opts);
  let payload = null;
  try {
    payload = await res.json();
  } catch {
    payload = { success: false, error: `Respuesta inválida de ${path}` };
  }
  if (!res.ok || payload.success === false) {
    throw new Error(payload.error || `Error en ${path}`);
  }
  return payload.data;
}

async function refreshMaster(force = false) {
  if (state.master && !force) return state.master;
  state.master = await api("/master-data");
  return state.master;
}

function toast(text, kind = "info") {
  const wrap = document.getElementById("toasts");
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = text;
  if (kind === "error") el.style.background = "#7a1f1f";
  if (kind === "ok") el.style.background = "#166534";
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 4500);
}

function loading(text = "Cargando...") {
  document.getElementById("content").innerHTML = `<div class="empty">${esc(text)}</div>`;
}

function renderError(err) {
  document.getElementById("content").innerHTML = `
    <div class="card">
      <h3>No pude cargar esta vista</h3>
      <p class="muted">${esc(err.message || String(err))}</p>
      <div class="footer-actions">
        <button class="btn primary" onclick="App.render()">Reintentar</button>
      </div>
    </div>
  `;
}

function openModal(title, html, actions = []) {
  const back = document.createElement("div");
  back.className = "modal-backdrop";
  const modal = document.createElement("div");
  modal.className = "modal";
  modal.innerHTML = `
    <div class="modal-header">
      <h3 class="modal-title">${esc(title)}</h3>
      <button class="btn ghost sm" id="closeModalBtn">Cerrar</button>
    </div>
    <div class="modal-body">${html}</div>
    <div class="footer-actions" id="modalActions"></div>
  `;
  back.appendChild(modal);
  document.body.appendChild(back);
  modal.querySelector("#closeModalBtn").onclick = () => back.remove();
  back.addEventListener("click", e => { if (e.target === back) back.remove(); });

  const actionsWrap = modal.querySelector("#modalActions");
  actions.forEach(action => {
    const btn = document.createElement("button");
    btn.className = `btn ${action.kind || "secondary"}`;
    btn.textContent = action.label;
    btn.onclick = async () => {
      try {
        await action.onClick(back);
      } catch (err) {
        toast(err.message || String(err), "error");
      }
    };
    actionsWrap.appendChild(btn);
  });
  return back;
}

function setView(view, params = {}) {
  state.view = view;
  state.params = params;
  document.getElementById("pageTitle").textContent = VIEWS[view] || "CAFETIER";
  document.querySelectorAll(".nav-item").forEach(node => {
    node.classList.toggle("active", node.dataset.view === (view === "salesDetail" ? "sales" : view === "purchaseDetail" ? "purchases" : view === "roastingDetail" ? "roasting" : view));
  });
  render();
}

async function render() {
  setStatus("Conectado");
  loading();
  try {
    if (!state.master) await refreshMaster();
    if (state.view === "dashboard") return await renderDashboard();
    if (state.view === "sales") return await renderSales();
    if (state.view === "salesDetail") return await renderSalesDetail(state.params.id);
    if (state.view === "purchases") return await renderPurchases();
    if (state.view === "purchaseDetail") return await renderPurchaseDetail(state.params.id);
    if (state.view === "capital") return await renderCapital();
    if (state.view === "roasting") return await renderRoasting();
    if (state.view === "roastingDetail") return await renderRoastingDetail(state.params.id);
    if (state.view === "inventory") return await renderInventory();
    if (state.view === "expenses") return await renderExpenses();
    if (state.view === "machine") return await renderMachine();
    if (state.view === "config") return await renderConfig();
  } catch (err) {
    renderError(err);
  }
}

async function renderDashboard() {
  const d = await api("/dashboard");
  document.getElementById("content").innerHTML = `
    <div class="grid cards">
      <div class="card metric"><div class="label">Ingresos del mes</div><div class="value money">${money(d.revenueMonth)}</div><small>Ventas cobradas</small></div>
      <div class="card metric"><div class="label">Gastos del mes</div><div class="value money">${money(d.expenseMonth)}</div><small>Incluye compras y costos</small></div>
      <div class="card metric"><div class="label">Caja disponible</div><div class="value money">${money(d.finance.availableCash)}</div><small>Capital + cobros - gastos - retiros</small></div>
      <div class="card metric"><div class="label">Dividendos distribuibles</div><div class="value money">${money(d.finance.distributableDividends)}</div><small>${d.finance.unrecoveredCapital > 0 ? "Bloqueado hasta recuperar capital" : "Listo para fin de mes"}</small></div>
    </div>

    <div class="split" style="margin-top:12px">
      <div class="stack">
        <div class="card">
          <h3>Operación</h3>
          <div class="kpi-strip">
            <div><div class="muted tiny">Pedidos abiertos</div><div class="value number">${d.openSales}</div></div>
            <div><div class="muted tiny">OC pendientes</div><div class="value number">${d.pendingPurchaseOrders}</div></div>
            <div><div class="muted tiny">Órdenes de capital</div><div class="value number">${d.openCapitalRequests}</div></div>
          </div>
          <div class="hr"></div>
          <div class="kpi-strip">
            <div><div class="muted tiny">Tostado del mes</div><div class="value">${kg(d.roastedMonth)}</div></div>
            <div><div class="muted tiny">Enviado del mes</div><div class="value">${kg(d.shippedMonth)}</div></div>
            <div><div class="muted tiny">Merma promedio</div><div class="value">${pct(d.avgLoss)}</div></div>
          </div>
        </div>

        <div class="card">
          <div class="row between"><h3>Inventario</h3><button class="btn ghost sm" onclick="App.setView('inventory')">Ver inventario</button></div>
          <div class="kpi-strip">
            <div><div class="muted tiny">Verde</div><div class="value">${kg(d.inventory.green)}</div></div>
            <div><div class="muted tiny">Tostado</div><div class="value">${kg(d.inventory.roasted)}</div></div>
            <div><div class="muted tiny">Empaquetado</div><div class="value">${kg(d.inventory.packaged)}</div></div>
          </div>
        </div>

        <div class="card">
          <div class="row between"><h3>Últimas ventas</h3><button class="btn ghost sm" onclick="App.setView('sales')">Ver ventas</button></div>
          ${d.lastSales.length ? `
          <table class="table">
            <thead><tr><th>Pedido</th><th>Cliente</th><th>Estado</th><th>Monto</th></tr></thead>
            <tbody>
              ${d.lastSales.map(row => `
                <tr onclick="App.openSale(${row.id})" style="cursor:pointer">
                  <td>${esc(row.order_no)}</td>
                  <td>${esc(row.client_name || "Mostrador")}</td>
                  <td>${statusBadge(row.status)}</td>
                  <td class="money">${money(row.total_amount)}</td>
                </tr>`).join("")}
            </tbody>
          </table>` : `<div class="empty">Sin ventas todavía</div>`}
        </div>
      </div>

      <div class="stack">
        <div class="card">
          <div class="row between"><h3>Capital & dividendos</h3><button class="btn ghost sm" onclick="App.setView('capital')">Abrir módulo</button></div>
          <div class="list">
            <div class="item">
              <div class="row between"><strong>Aportes totales</strong><span class="money">${money(d.finance.totalContributed)}</span></div>
              <div class="row between small"><span class="muted">Capital recuperado</span><span class="money">${money(d.finance.capitalRecovered)}</span></div>
              <div class="row between small"><span class="muted">Capital pendiente</span><span class="money">${money(d.finance.unrecoveredCapital)}</span></div>
            </div>
            ${d.partnerBreakdown.map(p => `
              <div class="item">
                <div class="row between"><strong>${esc(p.name)} · ${p.share_pct}%</strong><span class="money">${money(p.dividends_available)}</span></div>
                <div class="small muted">Aportó ${money(p.contributed)} · recuperó ${money(p.recovered)}</div>
              </div>`).join("")}
          </div>
        </div>

        <div class="card">
          <div class="row between"><h3>Últimas órdenes de compra</h3><button class="btn ghost sm" onclick="App.setView('purchases')">Ver compras</button></div>
          ${d.lastPurchaseOrders.length ? `
          <table class="table">
            <thead><tr><th>OC</th><th>Estado</th><th>Kg</th><th>Costo</th></tr></thead>
            <tbody>
              ${d.lastPurchaseOrders.map(row => `
                <tr onclick="App.openPurchase(${row.id})" style="cursor:pointer">
                  <td>${esc(row.po_no)}</td>
                  <td>${statusBadge(row.status)}</td>
                  <td>${kg(row.requested_green_kg)}</td>
                  <td>${money(row.actual_cost || row.estimated_cost)}</td>
                </tr>`).join("")}
            </tbody>
          </table>` : `<div class="empty">Sin órdenes de compra</div>`}
        </div>
      </div>
    </div>
  `;
}

function salesTotals(order) {
  const paid = Number(order.paid_amount || 0);
  const shipped = Number(order.shipped_kg || 0);
  return { paid, shipped, pending: Math.max(0, Number(order.total_amount || 0) - paid) };
}

async function renderSales() {
  const rows = await api("/sales-orders");
  document.getElementById("content").innerHTML = `
    <div class="row between" style="margin-bottom:12px">
      <div class="row wrap">
        <button class="btn primary" onclick="App.newRetailSale()">Nueva venta mostrador</button>
        <button class="btn secondary" onclick="App.newWholesaleSale()">Nuevo pedido mayoreo</button>
      </div>
      <input class="search" style="max-width:280px" placeholder="Buscar pedido o cliente" oninput="App.filterTable(this,'salesTable')" />
    </div>

    <div class="card">
      <table class="table" id="salesTable">
        <thead>
          <tr><th>Pedido</th><th>Tipo</th><th>Cliente</th><th>Estado</th><th>Kg</th><th>Total</th><th>Pagado</th><th>Enviado</th><th></th></tr>
        </thead>
        <tbody>
          ${rows.map(order => {
            const t = salesTotals(order);
            return `
              <tr>
                <td><strong>${esc(order.order_no)}</strong><div class="tiny muted">${esc(order.delivery_date || "")}</div></td>
                <td>${esc(order.order_type)}</td>
                <td>${esc(order.client_name || "Mostrador")}</td>
                <td>${statusBadge(order.status)}</td>
                <td>${kg(order.total_weight_kg)}</td>
                <td class="money">${money(order.total_amount)}</td>
                <td class="money">${money(t.paid)}</td>
                <td>${kg(t.shipped)}</td>
                <td><button class="btn ghost sm" onclick="App.openSale(${order.id})">Abrir</button></td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
      ${rows.length ? "" : `<div class="empty">Todavía no hay ventas registradas.</div>`}
    </div>
  `;
}

async function renderSalesDetail(id) {
  const data = await api(`/sales-orders/${id}`);
  const { order, items, payments, shipments, purchaseOrders, batches } = data;
  const paid = payments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
  const shipped = shipments.reduce((sum, s) => sum + Number(s.weight_kg || 0), 0);
  const roasted = batches.reduce((sum, b) => sum + Number(b.roasted_kg || 0), 0);

  document.getElementById("content").innerHTML = `
    <div class="row between" style="margin-bottom:12px">
      <div class="row wrap">
        <button class="btn ghost" onclick="App.setView('sales')">← Volver a ventas</button>
        <span class="pill">${esc(order.order_no)}</span>
        ${statusBadge(order.status)}
      </div>
      <div class="row wrap">
        <button class="btn secondary" onclick="App.addPayment(${order.id})">Registrar pago</button>
        ${order.order_type === "wholesale" ? `<button class="btn secondary" onclick="App.addShipment(${order.id})">Registrar envío</button>` : ""}
      </div>
    </div>

    <div class="grid cards">
      <div class="card metric"><div class="label">Cliente</div><div class="value" style="font-size:22px">${esc(order.client_name || "Mostrador")}</div><small>${esc(order.client_city || "")}</small></div>
      <div class="card metric"><div class="label">Total</div><div class="value money">${money(order.total_amount)}</div><small>${kg(order.total_weight_kg)}</small></div>
      <div class="card metric"><div class="label">Pagado</div><div class="value money">${money(paid)}</div><small>Pendiente ${money(Math.max(0, order.total_amount - paid))}</small></div>
      <div class="card metric"><div class="label">Producción / envío</div><div class="value">${kg(roasted)} / ${kg(shipped)}</div><small>Listo ${kg(Math.max(0, order.total_weight_kg - shipped))}</small></div>
    </div>

    <div class="split" style="margin-top:12px">
      <div class="stack">
        <div class="card">
          <h3>Items</h3>
          ${items.length ? `<table class="table"><thead><tr><th>Descripción</th><th>Cantidad</th><th>Peso unidad</th><th>Precio</th><th>Subtotal</th></tr></thead><tbody>
            ${items.map(it => `<tr><td>${esc(it.description)}</td><td>${numFmt.format(it.quantity)}</td><td>${kg(it.unit_weight_kg)}</td><td>${money(it.unit_price)}</td><td>${money(it.subtotal)}</td></tr>`).join("")}
          </tbody></table>` : `<div class="empty">Sin líneas.</div>`}
        </div>

        <div class="card">
          <div class="row between"><h3>Pagos</h3><button class="btn ghost sm" onclick="App.addPayment(${order.id})">+ Pago</button></div>
          ${payments.length ? payments.map(p => `
            <div class="item">
              <div class="row between"><strong>${money(p.amount)}</strong><div class="line-actions"><span class="pill">${esc(p.method || "-")}</span><button class="btn red sm" onclick="App.deletePayment(${p.id},${order.id})">Eliminar</button></div></div>
              <div class="small muted">${esc((p.created_at || "").slice(0, 10))} ${p.notes ? "· " + esc(p.notes) : ""}</div>
            </div>`).join("") : `<div class="empty">Sin pagos.</div>`}
        </div>

        ${order.order_type === "wholesale" ? `
        <div class="card">
          <div class="row between"><h3>Envíos</h3><button class="btn ghost sm" onclick="App.addShipment(${order.id})">+ Envío</button></div>
          ${shipments.length ? shipments.map(s => `
            <div class="item">
              <div class="row between"><strong>${kg(s.weight_kg)}</strong><div class="line-actions"><span class="pill">${esc(s.carrier || "Sin paquetería")}</span><button class="btn red sm" onclick="App.deleteShipment(${s.id},${order.id})">Eliminar</button></div></div>
              <div class="small muted">${esc((s.created_at || "").slice(0, 10))} ${s.destination_address ? "· " + esc(s.destination_address) : ""} ${s.shipping_cost ? "· " + money(s.shipping_cost) : ""}</div>
            </div>`).join("") : `<div class="empty">Sin envíos.</div>`}
        </div>` : ""}
      </div>

      <div class="stack">
        ${purchaseOrders.length ? `
          <div class="card">
            <div class="row between"><h3>Órdenes de compra ligadas</h3><button class="btn ghost sm" onclick="App.setView('purchases')">Ver todas</button></div>
            ${purchaseOrders.map(po => `
              <div class="item">
                <div class="row between"><strong>${esc(po.po_no)}</strong><button class="btn ghost sm" onclick="App.openPurchase(${po.id})">Abrir</button></div>
                <div class="small muted">${esc(po.description)}</div>
                <div class="row between small"><span>${statusBadge(po.status)}</span><span>${kg(po.requested_green_kg)}</span></div>
              </div>`).join("")}
          </div>` : ""}

        <div class="card">
          <div class="row between"><h3>Batches ligados</h3>${order.order_type === "wholesale" ? `<button class="btn ghost sm" onclick="App.setView('roasting')">Ir a tostado</button>` : ""}</div>
          ${batches.length ? batches.map(b => `
            <div class="item">
              <div class="row between"><strong>${esc(b.batch_no)}</strong><span class="pill">${esc(b.roast_profile_name || "Sin perfil")}</span></div>
              <div class="small muted">${esc(b.session_date || "")} · ${kg(b.green_kg)} → ${kg(b.roasted_kg || 0)} · ${pct(b.loss_pct || 0)}</div>
            </div>`).join("") : `<div class="empty">Aún no hay batches ligados a este pedido.</div>`}
        </div>

        <div class="card">
          <h3>Notas</h3>
          <div class="code">${esc(order.notes || "Sin notas")}</div>
        </div>
      </div>
    </div>
  `;
}

async function renderPurchases() {
  const rows = await api("/purchase-orders");
  document.getElementById("content").innerHTML = `
    <div class="row between" style="margin-bottom:12px">
      <div class="row wrap">
        <button class="btn primary" onclick="App.newManualPurchase()">Nueva orden de compra</button>
        <button class="btn secondary" onclick="App.setView('capital')">Ver capital</button>
      </div>
      <input class="search" style="max-width:280px" placeholder="Buscar OC o descripción" oninput="App.filterTable(this,'poTable')" />
    </div>

    <div class="card">
      <table class="table" id="poTable">
        <thead><tr><th>OC</th><th>Descripción</th><th>Estado</th><th>Kg</th><th>Costo est.</th><th>Falta capital</th><th></th></tr></thead>
        <tbody>
          ${rows.map(po => `
            <tr>
              <td><strong>${esc(po.po_no)}</strong></td>
              <td>${esc(po.description)}</td>
              <td>${statusBadge(po.status)}</td>
              <td>${kg(po.requested_green_kg)}</td>
              <td class="money">${money(po.estimated_cost)}</td>
              <td class="money">${money(po.capital_missing)}</td>
              <td><button class="btn ghost sm" onclick="App.openPurchase(${po.id})">Abrir</button></td>
            </tr>`).join("")}
        </tbody>
      </table>
      ${rows.length ? "" : `<div class="empty">No hay órdenes de compra.</div>`}
    </div>
  `;
}

async function renderPurchaseDetail(id) {
  const data = await api(`/purchase-orders/${id}`);
  const { purchaseOrder: po, entries, capitalRequests } = data;
  document.getElementById("content").innerHTML = `
    <div class="row between" style="margin-bottom:12px">
      <div class="row wrap">
        <button class="btn ghost" onclick="App.setView('purchases')">← Volver a compras</button>
        <span class="pill">${esc(po.po_no)}</span>
        ${statusBadge(po.status)}
      </div>
      <div class="row wrap">
        ${po.status !== "received" && po.status !== "cancelled" ? `<button class="btn primary" onclick="App.receivePurchase(${po.id})">Registrar recepción</button>` : ""}
      </div>
    </div>

    <div class="grid cards">
      <div class="card metric"><div class="label">Kg solicitados</div><div class="value">${kg(po.requested_green_kg)}</div><small>Recibidos ${kg(po.received_green_kg)}</small></div>
      <div class="card metric"><div class="label">Costo estimado</div><div class="value money">${money(po.estimated_cost)}</div><small>Real ${money(po.actual_cost)}</small></div>
      <div class="card metric"><div class="label">Proveedor</div><div class="value" style="font-size:22px">${esc(po.supplier || "Sin proveedor")}</div><small>${esc(po.source_type)}</small></div>
      <div class="card metric"><div class="label">Progreso</div><div class="value">${pct(po.requested_green_kg ? (po.received_green_kg / po.requested_green_kg) * 100 : 0)}</div><small>${esc(po.status)}</small></div>
    </div>

    ${capitalRequests.some(r => r.status !== "funded" && r.status !== "cancelled") ? `
      <div class="notice error" style="margin-top:12px">
        Esta orden tiene capital pendiente. Registrá aportes en el módulo de capital antes de recibir más café.
      </div>` : ""}

    <div class="split" style="margin-top:12px">
      <div class="card">
        <h3>Entradas recibidas</h3>
        ${entries.length ? `
        <table class="table">
          <thead><tr><th>Fecha</th><th>Lote</th><th>Kg</th><th>Costo</th><th>Proveedor</th></tr></thead>
          <tbody>${entries.map(e => `
            <tr>
              <td>${esc((e.created_at || "").slice(0, 10))}</td>
              <td>${esc(e.lot_label || e.item_name)}</td>
              <td>${kg(e.quantity_kg)}</td>
              <td class="money">${money(e.total_cost)}</td>
              <td>${esc(e.supplier || "")}</td>
            </tr>`).join("")}
          </tbody>
        </table>` : `<div class="empty">Aún no hay recepciones.</div>`}
      </div>

      <div class="card">
        <h3>Órdenes de ingreso de capital</h3>
        ${capitalRequests.length ? capitalRequests.map(r => `
          <div class="item">
            <div class="row between"><strong>${esc(r.request_no)}</strong>${statusBadge(r.status)}</div>
            <div class="small muted">Solicitado ${money(r.amount_requested)} · fondeado ${money(r.amount_funded)}</div>
            <div class="small muted">${esc(r.notes || "")}</div>
          </div>`).join("") : `<div class="empty">Sin solicitudes de capital.</div>`}
      </div>
    </div>
  `;
}

async function renderCapital() {
  const [summary, requests, contributions, dividends, withdrawals] = await Promise.all([
    api("/capital/summary"),
    api("/capital-requests"),
    api("/capital-contributions"),
    api("/dividend-orders"),
    api("/withdrawals"),
  ]);

  document.getElementById("content").innerHTML = `
    <div class="row between" style="margin-bottom:12px">
      <div class="row wrap">
        <button class="btn primary" onclick="App.newCapitalRequest()">Orden de ingreso de capital</button>
        <button class="btn secondary" onclick="App.newContribution()">Registrar aporte</button>
        <button class="btn secondary" onclick="App.newCapitalReturn()">Devolver capital</button>
        <button class="btn green" onclick="App.newDividendOrder()">Orden de dividendos fin de mes</button>
      </div>
    </div>

    <div class="grid cards">
      <div class="card metric"><div class="label">Caja disponible</div><div class="value money">${money(summary.finance.availableCash)}</div><small>Liquidez actual</small></div>
      <div class="card metric"><div class="label">Capital aportado</div><div class="value money">${money(summary.finance.totalContributed)}</div><small>Recuperado ${money(summary.finance.capitalRecovered)}</small></div>
      <div class="card metric"><div class="label">Capital pendiente</div><div class="value money">${money(summary.finance.unrecoveredCapital)}</div><small>${summary.finance.unrecoveredCapital > 0 ? "Bloquea dividendos" : "Capital totalmente recuperado"}</small></div>
      <div class="card metric"><div class="label">Dividendos distribuibles</div><div class="value money">${money(summary.finance.distributableDividends)}</div><small>Solo al recuperar el capital</small></div>
    </div>

    <div class="split" style="margin-top:12px">
      <div class="stack">
        <div class="card">
          <h3>Capital por socio</h3>
          ${summary.partners.map(p => `
            <div class="item">
              <div class="row between"><strong>${esc(p.name)} · ${p.share_pct}%</strong><span class="money">${money(p.dividend_capacity)}</span></div>
              <div class="small muted">Aportó ${money(p.contributed)} · recuperó ${money(p.capital_returned)} · dividendos pagados ${money(p.dividends_paid)}</div>
            </div>`).join("")}
        </div>

        <div class="card">
          <div class="row between"><h3>Órdenes de ingreso de capital</h3><span class="pill">${requests.length}</span></div>
          ${requests.length ? requests.map(r => `
            <div class="item">
              <div class="row between"><strong>${esc(r.request_no)}</strong>${statusBadge(r.status)}</div>
              <div class="small muted">${money(r.amount_requested)} solicitado · ${money(r.amount_funded)} fondeado</div>
              <div class="small muted">${esc(r.notes || "")}</div>
            </div>`).join("") : `<div class="empty">No hay órdenes de capital.</div>`}
        </div>

        <div class="card">
          <div class="row between"><h3>Aportes de capital</h3><span class="pill">${contributions.length}</span></div>
          ${contributions.length ? contributions.map(c => `
            <div class="item">
              <div class="row between"><strong>${esc(c.partner_name)}</strong><span class="money">${money(c.amount)}</span></div>
              <div class="small muted">${esc(c.contribution_date)} ${c.request_no ? "· " + esc(c.request_no) : ""}</div>
              <div class="small muted">${esc(c.description)}</div>
            </div>`).join("") : `<div class="empty">Sin aportes.</div>`}
        </div>
      </div>

      <div class="stack">
        <div class="card">
          <div class="row between"><h3>Órdenes de dividendos</h3><span class="pill">${dividends.length}</span></div>
          ${dividends.length ? dividends.map(d => `
            <div class="item">
              <div class="row between"><strong>${esc(d.dividend_no)}</strong><div class="line-actions">${statusBadge(d.status)} ${d.status === "open" ? `<button class="btn green sm" onclick="App.payDividendOrder(${d.id})">Pagar</button>` : ""}</div></div>
              <div class="small muted">${esc(d.month)} · ${money(d.total_amount)}</div>
              <div class="small muted">${esc(d.notes || "")}</div>
            </div>`).join("") : `<div class="empty">Sin órdenes de dividendos.</div>`}
        </div>

        <div class="card">
          <div class="row between"><h3>Retiros</h3><span class="pill">${withdrawals.length}</span></div>
          ${withdrawals.length ? withdrawals.map(w => `
            <div class="item">
              <div class="row between"><strong>${esc(w.partner_name)}</strong><span class="money">${money(w.amount)}</span></div>
              <div class="small muted">${esc(w.kind)} · ${esc(w.month || "")}</div>
              <div class="small muted">${esc((w.created_at || "").slice(0, 10))} ${w.notes ? "· " + esc(w.notes) : ""}</div>
            </div>`).join("") : `<div class="empty">Sin retiros.</div>`}
        </div>
      </div>
    </div>
  `;
}

async function renderRoasting() {
  const rows = await api("/roasting-sessions");
  document.getElementById("content").innerHTML = `
    <div class="row between" style="margin-bottom:12px">
      <div class="row wrap">
        <button class="btn primary" onclick="App.newRoastingSession()">Nueva sesión</button>
      </div>
    </div>
    <div class="card">
      <table class="table">
        <thead><tr><th>Fecha</th><th>Operador</th><th>Batches</th><th>Verde</th><th>Tostado</th><th>Min</th><th></th></tr></thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              <td><strong>${esc(r.session_date)}</strong></td>
              <td>${esc(r.operator)}</td>
              <td>${r.batch_count}</td>
              <td>${kg(r.total_green)}</td>
              <td>${kg(r.total_roasted)}</td>
              <td>${numFmt.format(r.total_minutes || 0)}</td>
              <td><button class="btn ghost sm" onclick="App.openRoasting(${r.id})">Abrir</button></td>
            </tr>`).join("")}
        </tbody>
      </table>
      ${rows.length ? "" : `<div class="empty">Sin sesiones de tueste.</div>`}
    </div>
  `;
}

async function renderRoastingDetail(id) {
  const [data, greenStock, sales] = await Promise.all([
    api(`/roasting-sessions/${id}`),
    api("/inventory/green"),
    api("/sales-orders"),
  ]);
  const { session, batches } = data;
  const openSales = sales.filter(s => s.order_type === "wholesale" && !["completed","cancelled"].includes(s.status));

  document.getElementById("content").innerHTML = `
    <div class="row between" style="margin-bottom:12px">
      <div class="row wrap">
        <button class="btn ghost" onclick="App.setView('roasting')">← Volver a tostado</button>
        <span class="pill">${esc(session.session_date)}</span>
      </div>
      <div class="row wrap">
        <button class="btn primary" onclick="App.newBatch(${session.id})">Nuevo batch</button>
      </div>
    </div>

    <div class="card">
      <div class="row between"><div><strong>Operador:</strong> ${esc(session.operator)}</div><div class="muted small">${esc(session.notes || "")}</div></div>
    </div>

    <div class="split" style="margin-top:12px">
      <div class="card">
        <h3>Batches de la sesión</h3>
        ${batches.length ? batches.map(b => `
          <div class="item">
            <div class="row between"><strong>${esc(b.batch_no)}</strong><div class="line-actions">
              <span class="pill">${esc(b.roast_profile_name || "Sin perfil")}</span>
              <button class="btn ghost sm" onclick="App.editBatch(${b.id},${session.id})">Editar</button>
              <button class="btn red sm" onclick="App.deleteBatch(${b.id},${session.id})">Eliminar</button>
            </div></div>
            <div class="small muted">${esc(b.green_item_name)} · ${kg(b.green_kg)} → ${kg(b.roasted_kg || 0)} · ${pct(b.loss_pct || 0)} · ${numFmt.format(b.machine_minutes || 0)} min</div>
            <div class="small muted">${b.order_no ? "Pedido " + esc(b.order_no) : "Sin pedido ligado"} ${b.notes ? "· " + esc(b.notes) : ""}</div>
          </div>`).join("") : `<div class="empty">Sin batches.</div>`}
      </div>

      <div class="card">
        <h3>Referencias rápidas</h3>
        <div class="small muted">Café verde disponible</div>
        ${greenStock.length ? greenStock.map(g => `<div class="item"><div class="row between"><strong>${esc(g.item_name)}</strong><span>${kg(g.quantity)}</span></div></div>`).join("") : `<div class="empty">No hay café verde.</div>`}
        <div class="hr"></div>
        <div class="small muted">Pedidos mayoreo abiertos</div>
        ${openSales.length ? openSales.map(s => `<div class="item"><div class="row between"><strong>${esc(s.order_no)}</strong><span>${kg(s.total_weight_kg)}</span></div><div class="small muted">${esc(s.client_name || "")} · ${statusBadge(s.status)}</div></div>`).join("") : `<div class="empty">Sin pedidos abiertos.</div>`}
      </div>
    </div>
  `;
}

async function renderInventory() {
  const rows = await api("/inventory");
  document.getElementById("content").innerHTML = `
    <div class="row between" style="margin-bottom:12px">
      <div class="row wrap">
        <button class="btn primary" onclick="App.newInventoryItem()">Nuevo ítem</button>
      </div>
    </div>
    <div class="card">
      <table class="table">
        <thead><tr><th>Tipo</th><th>Ítem</th><th>Lote</th><th>Cantidad</th><th>Mínimo</th><th></th></tr></thead>
        <tbody>
          ${rows.map(i => `
            <tr>
              <td>${esc(i.item_type)}</td>
              <td><strong>${esc(i.item_name)}</strong><div class="tiny muted">${esc(i.origin_name || "")} ${i.variety_name ? "· " + esc(i.variety_name) : ""}</div></td>
              <td>${esc(i.lot_label || "-")}</td>
              <td>${numFmt.format(i.quantity)} ${esc(i.unit)}</td>
              <td>${numFmt.format(i.min_stock)} ${esc(i.unit)}</td>
              <td><div class="line-actions"><button class="btn ghost sm" onclick="App.newInventoryMovement(${i.id},'${esc(i.item_name).replace(/'/g,"&#39;")}')">Movimiento</button><button class="btn red sm" onclick="App.deleteInventoryItem(${i.id})">Eliminar</button></div></td>
            </tr>`).join("")}
        </tbody>
      </table>
      ${rows.length ? "" : `<div class="empty">Inventario vacío.</div>`}
    </div>
  `;
}

async function renderExpenses() {
  const month = new Date().toISOString().slice(0, 7);
  const rows = await api(`/expenses?month=${month}`);
  document.getElementById("content").innerHTML = `
    <div class="row between" style="margin-bottom:12px">
      <div class="row wrap">
        <button class="btn primary" onclick="App.newExpense()">Nuevo gasto</button>
      </div>
      <span class="pill">${month}</span>
    </div>
    <div class="card">
      <table class="table">
        <thead><tr><th>Fecha</th><th>Concepto</th><th>Categoría</th><th>Pagó</th><th>Monto</th><th></th></tr></thead>
        <tbody>
          ${rows.map(e => `
            <tr>
              <td>${esc(e.expense_date)}</td>
              <td><strong>${esc(e.description || e.category_name)}</strong><div class="tiny muted">${esc(e.supplier || "")}</div></td>
              <td>${esc(e.category_name)}</td>
              <td>${esc(e.paid_by)}</td>
              <td class="money">${money(e.amount)}</td>
              <td><button class="btn red sm" onclick="App.deleteExpense(${e.id})">Eliminar</button></td>
            </tr>`).join("")}
        </tbody>
      </table>
      ${rows.length ? "" : `<div class="empty">Sin gastos este mes.</div>`}
    </div>
  `;
}

async function renderMachine() {
  const rows = await api("/machine-logs");
  document.getElementById("content").innerHTML = `
    <div class="row between" style="margin-bottom:12px">
      <div class="row wrap">
        <button class="btn primary" onclick="App.newMachineLog()">Nuevo registro</button>
      </div>
    </div>
    <div class="card">
      <table class="table">
        <thead><tr><th>Fecha</th><th>Tipo</th><th>Descripción</th><th>Costo</th><th></th></tr></thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              <td>${esc(r.log_date)}</td>
              <td>${esc(r.log_type)}</td>
              <td>${esc(r.description)}</td>
              <td class="money">${money(r.cost)}</td>
              <td><button class="btn red sm" onclick="App.deleteMachineLog(${r.id})">Eliminar</button></td>
            </tr>`).join("")}
        </tbody>
      </table>
      ${rows.length ? "" : `<div class="empty">Sin bitácora.</div>`}
    </div>
  `;
}

async function renderConfig() {
  const master = await refreshMaster(true);
  const settings = master.settings || {};
  document.getElementById("content").innerHTML = `
    <div class="split">
      <div class="stack">
        <div class="card">
          <h3>Parámetros</h3>
          <div class="form-grid">
            <div class="field"><label>Nombre del negocio</label><input class="input" id="cfgBusiness" value="${esc(settings.business_name || "CAFETIER")}" /></div>
            <div class="field"><label>Merma estándar %</label><input class="input" id="cfgLoss" type="number" step="0.01" value="${esc(settings.default_loss_pct || "15")}" /></div>
            <div class="field"><label>kW máquina</label><input class="input" id="cfgKw" type="number" step="0.01" value="${esc(settings.machine_kw || "0")}" /></div>
            <div class="field"><label>$ por kWh</label><input class="input" id="cfgKwh" type="number" step="0.01" value="${esc(settings.kwh_price || "0")}" /></div>
            <div class="field"><label>Costo verde/kg por defecto</label><input class="input" id="cfgGreen" type="number" step="0.01" value="${esc(settings.default_green_cost_per_kg || "0")}" /></div>
          </div>
          <div class="footer-actions">
            <button class="btn primary" onclick="App.saveSettings()">Guardar configuración</button>
          </div>
        </div>

        <div class="card">
          <div class="row between"><h3>Clientes</h3><button class="btn secondary sm" onclick="App.newClient()">+ Cliente</button></div>
          ${master.clients.map(c => `<div class="item"><div class="row between"><strong>${esc(c.name)}</strong><button class="btn red sm" onclick="App.deleteClient(${c.id})">Eliminar</button></div><div class="small muted">${esc(c.phone || "")} ${c.city ? "· " + esc(c.city) : ""}</div></div>`).join("") || `<div class="empty">Sin clientes.</div>`}
        </div>
      </div>

      <div class="stack">
        <div class="card">
          <div class="row between"><h3>Productos</h3><button class="btn secondary sm" onclick="App.newProduct()">+ Producto</button></div>
          ${master.products.map(p => `<div class="item"><div class="row between"><strong>${esc(p.name)}</strong><button class="btn red sm" onclick="App.deleteProduct(${p.id})">Eliminar</button></div><div class="small muted">${esc(p.presentation || "")} · ${kg(p.unit_weight_kg)} · ${money(p.price)}</div></div>`).join("") || `<div class="empty">Sin productos.</div>`}
        </div>

        <div class="card">
          <h3>Catálogos</h3>
          <div class="list">
            ${[
              ["roast_profiles","Perfiles de tueste", master.roastProfiles],
              ["origins","Orígenes", master.origins],
              ["varieties","Variedades", master.varieties],
              ["expense_categories","Categorías de gasto", master.expenseCategories],
            ].map(([table, label, rows]) => `
              <div class="item">
                <div class="row between"><strong>${label}</strong><button class="btn ghost sm" onclick="App.newCatalogItem('${table}','${label}')">+ Agregar</button></div>
                <div class="small muted">${rows.map(r => esc(r.name)).join(" · ") || "Sin datos"}</div>
              </div>`).join("")}
          </div>
        </div>
      </div>
    </div>
  `;
}

function filterTable(input, tableId) {
  const q = input.value.toLowerCase();
  document.querySelectorAll(`#${tableId} tbody tr`).forEach(tr => {
    tr.style.display = tr.textContent.toLowerCase().includes(q) ? "" : "none";
  });
}

function clientOptions() {
  return (state.master.clients || []).map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("");
}
function partnerOptions() {
  return (state.master.partners || []).map(p => `<option value="${esc(p.name)}">${esc(p.name)}</option>`).join("");
}
function expenseCategoryOptions() {
  return (state.master.expenseCategories || []).map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("");
}
function productQtyRows() {
  return (state.master.products || []).map(p => `
    <tr>
      <td>${esc(p.name)}</td>
      <td>${esc(p.presentation || "")}</td>
      <td>${kg(p.unit_weight_kg)}</td>
      <td>${money(p.price)}</td>
      <td><input class="input" style="max-width:90px" type="number" min="0" step="1" data-product-id="${p.id}" data-product-qty /></td>
    </tr>`).join("");
}

async function newRetailSale() {
  openModal("Nueva venta de mostrador", `
    <div class="notice ok">Se descontará café tostado disponible y se registrará el pago al momento.</div>
    <div class="field"><label>Cliente opcional</label><select class="select" id="retClient"><option value="">Mostrador</option>${clientOptions()}</select></div>
    <div class="field"><label>Método de pago</label><select class="select" id="retMethod"><option>efectivo</option><option>transferencia</option><option>tarjeta</option></select></div>
    <div class="field"><label>Productos</label>
      <table class="table">
        <thead><tr><th>Producto</th><th>Presentación</th><th>Peso</th><th>Precio</th><th>Cant.</th></tr></thead>
        <tbody>${productQtyRows()}</tbody>
      </table>
    </div>
  `, [{
    label: "Guardar venta",
    kind: "primary",
    onClick: async modal => {
      const lines = [];
      document.querySelectorAll("[data-product-qty]").forEach(input => {
        const qty = Number(input.value || 0);
        if (qty > 0) {
          const prod = state.master.products.find(p => p.id === Number(input.dataset.productId));
          lines.push({
            product_id: prod.id,
            description: prod.name,
            presentation: prod.presentation,
            quantity: qty,
            unit: "unit",
            unit_weight_kg: Number(prod.unit_weight_kg),
            unit_price: Number(prod.price),
          });
        }
      });
      if (!lines.length) throw new Error("Elegí al menos un producto.");
      await api("/sales-orders", {
        method: "POST",
        body: {
          order_type: "retail",
          client_id: val("retClient") || null,
          payment_method: val("retMethod"),
          pay_now: 1,
          items: lines,
        },
      });
      modal.remove();
      toast("Venta registrada.", "ok");
      await refreshMaster(true);
      setView("sales");
    }
  }]);
}

async function newWholesaleSale() {
  openModal("Nuevo pedido mayoreo", `
    <div class="form-grid">
      <div class="field"><label>Cliente</label><select class="select" id="whClient">${clientOptions()}</select></div>
      <div class="field"><label>Entrega</label><input class="input" id="whDelivery" type="date" /></div>
      <div class="field"><label>Kg a entregar</label><input class="input" id="whKg" type="number" step="0.01" /></div>
      <div class="field"><label>Precio por kg</label><input class="input" id="whPriceKg" type="number" step="0.01" /></div>
    </div>
    <div class="field"><label>Notas</label><textarea class="textarea" id="whNotes"></textarea></div>
  `, [{
    label: "Crear pedido",
    kind: "primary",
    onClick: async modal => {
      await api("/sales-orders", {
        method: "POST",
        body: {
          order_type: "wholesale",
          client_id: Number(val("whClient")),
          delivery_date: val("whDelivery") || null,
          total_weight_kg: Number(val("whKg")),
          price_per_kg: Number(val("whPriceKg")),
          total_amount: Number(val("whKg")) * Number(val("whPriceKg")),
          notes: val("whNotes") || null,
        },
      });
      modal.remove();
      toast("Pedido creado. Si falta café verde, se generó la OC automáticamente.", "ok");
      setView("sales");
    }
  }]);
}

function openSale(id) { setView("salesDetail", { id }); }

function addPayment(orderId) {
  openModal("Registrar pago", `
    <div class="form-grid">
      <div class="field"><label>Monto</label><input class="input" id="payAmount" type="number" step="0.01" /></div>
      <div class="field"><label>Método</label><select class="select" id="payMethod"><option>transferencia</option><option>efectivo</option><option>tarjeta</option></select></div>
    </div>
    <div class="field"><label>Notas</label><input class="input" id="payNotes" /></div>
  `, [{
    label: "Guardar",
    kind: "primary",
    onClick: async modal => {
      await api(`/sales-orders/${orderId}/payments`, {
        method: "POST",
        body: { amount: Number(val("payAmount")), method: val("payMethod"), notes: val("payNotes") || null },
      });
      modal.remove();
      toast("Pago registrado.", "ok");
      openSale(orderId);
    }
  }]);
}

function deletePayment(paymentId, orderId) {
  if (!confirm("¿Eliminar este pago?")) return;
  api(`/sales-payments/${paymentId}`, { method: "DELETE" })
    .then(() => { toast("Pago eliminado.", "ok"); openSale(orderId); })
    .catch(err => toast(err.message, "error"));
}

function addShipment(orderId) {
  openModal("Registrar envío", `
    <div class="form-grid">
      <div class="field"><label>Kg enviados</label><input class="input" id="shipKg" type="number" step="0.01" /></div>
      <div class="field"><label>Costo de envío</label><input class="input" id="shipCost" type="number" step="0.01" value="0" /></div>
      <div class="field"><label>Paquetería</label><input class="input" id="shipCarrier" /></div>
      <div class="field"><label>Guía</label><input class="input" id="shipTracking" /></div>
    </div>
    <div class="field"><label>Dirección destino</label><input class="input" id="shipAddress" /></div>
    <div class="field"><label>Registrado por</label><select class="select" id="shipBy">${partnerOptions()}</select></div>
  `, [{
    label: "Guardar",
    kind: "primary",
    onClick: async modal => {
      await api(`/sales-orders/${orderId}/shipments`, {
        method: "POST",
        body: {
          weight_kg: Number(val("shipKg")),
          shipping_cost: Number(val("shipCost")),
          carrier: val("shipCarrier") || null,
          tracking_number: val("shipTracking") || null,
          destination_address: val("shipAddress") || null,
          registered_by: val("shipBy"),
        },
      });
      modal.remove();
      toast("Envío registrado.", "ok");
      openSale(orderId);
    }
  }]);
}

function deleteShipment(shipmentId, orderId) {
  if (!confirm("¿Eliminar este envío?")) return;
  api(`/sales-shipments/${shipmentId}`, { method: "DELETE" })
    .then(() => { toast("Envío eliminado.", "ok"); openSale(orderId); })
    .catch(err => toast(err.message, "error"));
}

function newManualPurchase() {
  openModal("Nueva orden de compra", `
    <div class="form-grid">
      <div class="field"><label>Descripción</label><input class="input" id="poDesc" /></div>
      <div class="field"><label>Proveedor</label><input class="input" id="poSupplier" /></div>
      <div class="field"><label>Kg requeridos</label><input class="input" id="poKg" type="number" step="0.01" /></div>
      <div class="field"><label>Costo estimado</label><input class="input" id="poCost" type="number" step="0.01" /></div>
    </div>
    <div class="field"><label>Notas</label><textarea class="textarea" id="poNotes"></textarea></div>
  `, [{
    label: "Crear OC",
    kind: "primary",
    onClick: async modal => {
      await api("/purchase-orders", {
        method: "POST",
        body: {
          description: val("poDesc"),
          supplier: val("poSupplier") || null,
          requested_green_kg: Number(val("poKg")),
          estimated_cost: Number(val("poCost")),
          notes: val("poNotes") || null,
        },
      });
      modal.remove();
      toast("OC creada. Si no alcanza caja, quedó en espera de capital.", "ok");
      setView("purchases");
    }
  }]);
}

function openPurchase(id) { setView("purchaseDetail", { id }); }

function receivePurchase(poId) {
  const o = state.master.origins || [];
  const v = state.master.varieties || [];
  openModal("Registrar recepción de compra", `
    <div class="form-grid">
      <div class="field"><label>Kg recibidos</label><input class="input" id="rcvKg" type="number" step="0.01" /></div>
      <div class="field"><label>Costo total</label><input class="input" id="rcvCost" type="number" step="0.01" /></div>
      <div class="field"><label>Proveedor</label><input class="input" id="rcvSupplier" /></div>
      <div class="field"><label>Lote</label><input class="input" id="rcvLot" /></div>
      <div class="field"><label>Origen</label><select class="select" id="rcvOrigin"><option value="">-</option>${o.map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join("")}</select></div>
      <div class="field"><label>Variedad</label><select class="select" id="rcvVar"><option value="">-</option>${v.map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join("")}</select></div>
    </div>
    <div class="field"><label>Registrado por</label><select class="select" id="rcvBy">${partnerOptions()}</select></div>
  `, [{
    label: "Guardar recepción",
    kind: "primary",
    onClick: async modal => {
      await api(`/purchase-orders/${poId}/receive`, {
        method: "POST",
        body: {
          quantity_kg: Number(val("rcvKg")),
          total_cost: Number(val("rcvCost")),
          supplier: val("rcvSupplier") || null,
          lot_label: val("rcvLot") || null,
          origin_id: val("rcvOrigin") || null,
          variety_id: val("rcvVar") || null,
          registered_by: val("rcvBy"),
        },
      });
      modal.remove();
      toast("Recepción registrada.", "ok");
      openPurchase(poId);
    }
  }]);
}

function newCapitalRequest() {
  openModal("Orden de ingreso de capital", `
    <div class="field"><label>Monto requerido</label><input class="input" id="capReqAmount" type="number" step="0.01" /></div>
    <div class="field"><label>Notas</label><textarea class="textarea" id="capReqNotes"></textarea></div>
  `, [{
    label: "Crear orden",
    kind: "primary",
    onClick: async modal => {
      await api("/capital-requests", {
        method: "POST",
        body: { amount_requested: Number(val("capReqAmount")), notes: val("capReqNotes") || null },
      });
      modal.remove();
      toast("Orden de ingreso de capital creada.", "ok");
      setView("capital");
    }
  }]);
}

async function newContribution() {
  const requests = await api("/capital-requests");
  openModal("Registrar aporte de capital", `
    <div class="form-grid">
      <div class="field"><label>Socio</label><select class="select" id="contribPartner">${partnerOptions()}</select></div>
      <div class="field"><label>Monto</label><input class="input" id="contribAmount" type="number" step="0.01" /></div>
      <div class="field"><label>Fecha</label><input class="input" id="contribDate" type="date" value="${new Date().toISOString().slice(0,10)}" /></div>
      <div class="field"><label>Orden de capital</label><select class="select" id="contribReq"><option value="">Sin ligar</option>${requests.filter(r => r.status !== "funded" && r.status !== "cancelled").map(r => `<option value="${r.id}">${esc(r.request_no)} · ${money(r.amount_requested - r.amount_funded)}</option>`).join("")}</select></div>
    </div>
    <div class="field"><label>Descripción</label><input class="input" id="contribDesc" /></div>
  `, [{
    label: "Guardar aporte",
    kind: "primary",
    onClick: async modal => {
      await api("/capital-contributions", {
        method: "POST",
        body: {
          partner_name: val("contribPartner"),
          amount: Number(val("contribAmount")),
          contribution_date: val("contribDate"),
          capital_request_id: val("contribReq") || null,
          description: val("contribDesc"),
        },
      });
      modal.remove();
      toast("Aporte registrado.", "ok");
      setView("capital");
    }
  }]);
}

function newCapitalReturn() {
  openModal("Devolver capital", `
    <div class="form-grid">
      <div class="field"><label>Socio</label><select class="select" id="capRetPartner">${partnerOptions()}</select></div>
      <div class="field"><label>Monto</label><input class="input" id="capRetAmount" type="number" step="0.01" /></div>
      <div class="field"><label>Mes</label><input class="input" id="capRetMonth" type="month" value="${new Date().toISOString().slice(0,7)}" /></div>
    </div>
    <div class="field"><label>Notas</label><input class="input" id="capRetNotes" /></div>
  `, [{
    label: "Registrar devolución",
    kind: "primary",
    onClick: async modal => {
      await api("/withdrawals/capital-return", {
        method: "POST",
        body: {
          partner_name: val("capRetPartner"),
          amount: Number(val("capRetAmount")),
          month: val("capRetMonth"),
          notes: val("capRetNotes") || null,
        },
      });
      modal.remove();
      toast("Devolución de capital registrada.", "ok");
      setView("capital");
    }
  }]);
}

function newDividendOrder() {
  openModal("Orden de dividendos fin de mes", `
    <div class="notice warn">Solo podés repartir dividendos cuando todo el capital fue recuperado y hay caja disponible.</div>
    <div class="form-grid">
      <div class="field"><label>Mes</label><input class="input" id="divMonth" type="month" value="${new Date().toISOString().slice(0,7)}" /></div>
      <div class="field"><label>Monto total (opcional)</label><input class="input" id="divAmount" type="number" step="0.01" placeholder="Si queda vacío toma el máximo distribuible" /></div>
    </div>
    <div class="field"><label>Notas</label><input class="input" id="divNotes" /></div>
  `, [{
    label: "Crear orden",
    kind: "primary",
    onClick: async modal => {
      await api("/dividend-orders", {
        method: "POST",
        body: {
          month: val("divMonth"),
          total_amount: val("divAmount") ? Number(val("divAmount")) : null,
          notes: val("divNotes") || null,
        },
      });
      modal.remove();
      toast("Orden de dividendos creada.", "ok");
      setView("capital");
    }
  }]);
}

function payDividendOrder(id) {
  if (!confirm("¿Pagar esta orden de dividendos?")) return;
  api(`/dividend-orders/${id}/pay`, { method: "POST" })
    .then(() => { toast("Dividendos pagados.", "ok"); setView("capital"); })
    .catch(err => toast(err.message, "error"));
}

function newRoastingSession() {
  openModal("Nueva sesión de tostado", `
    <div class="form-grid">
      <div class="field"><label>Fecha</label><input class="input" id="rsDate" type="date" value="${new Date().toISOString().slice(0,10)}" /></div>
      <div class="field"><label>Operador</label><select class="select" id="rsOperator">${partnerOptions()}</select></div>
    </div>
    <div class="field"><label>Notas</label><textarea class="textarea" id="rsNotes"></textarea></div>
  `, [{
    label: "Crear sesión",
    kind: "primary",
    onClick: async modal => {
      await api("/roasting-sessions", {
        method: "POST",
        body: { session_date: val("rsDate"), operator: val("rsOperator"), notes: val("rsNotes") || null },
      });
      modal.remove();
      toast("Sesión creada.", "ok");
      setView("roasting");
    }
  }]);
}

function openRoasting(id) { setView("roastingDetail", { id }); }

async function newBatch(sessionId) {
  const green = await api("/inventory/green");
  const sales = await api("/sales-orders");
  openModal("Nuevo batch", `
    <div class="form-grid">
      <div class="field"><label>Café verde</label><select class="select" id="batchGreen">${green.map(g => `<option value="${g.id}">${esc(g.item_name)} · ${kg(g.quantity)}</option>`).join("")}</select></div>
      <div class="field"><label>Perfil de tueste</label><select class="select" id="batchProfile"><option value="">-</option>${state.master.roastProfiles.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join("")}</select></div>
      <div class="field"><label>Kg verde</label><input class="input" id="batchGreenKg" type="number" step="0.01" /></div>
      <div class="field"><label>Kg tostado</label><input class="input" id="batchRoastedKg" type="number" step="0.01" /></div>
      <div class="field"><label>Minutos</label><input class="input" id="batchMinutes" type="number" step="0.01" value="18" /></div>
      <div class="field"><label>Pedido ligado</label><select class="select" id="batchSale"><option value="">Sin ligar</option>${sales.filter(s => s.order_type === "wholesale" && s.status !== "completed" && s.status !== "cancelled").map(s => `<option value="${s.id}">${esc(s.order_no)} · ${esc(s.client_name || "")}</option>`).join("")}</select></div>
    </div>
    <div class="field"><label>Notas</label><textarea class="textarea" id="batchNotes"></textarea></div>
  `, [{
    label: "Guardar batch",
    kind: "primary",
    onClick: async modal => {
      await api(`/roasting-sessions/${sessionId}/batches`, {
        method: "POST",
        body: {
          green_inventory_item_id: Number(val("batchGreen")),
          roast_profile_id: val("batchProfile") || null,
          green_kg: Number(val("batchGreenKg")),
          roasted_kg: val("batchRoastedKg") ? Number(val("batchRoastedKg")) : null,
          machine_minutes: Number(val("batchMinutes")),
          sales_order_id: val("batchSale") || null,
          notes: val("batchNotes") || null,
        },
      });
      modal.remove();
      toast("Batch guardado.", "ok");
      openRoasting(sessionId);
    }
  }]);
}

async function editBatch(batchId, sessionId) {
  const data = await api(`/roasting-sessions/${sessionId}`);
  const batch = data.batches.find(b => b.id === batchId);
  if (!batch) return;
  const sales = await api("/sales-orders");
  openModal("Editar batch", `
    <div class="form-grid">
      <div class="field"><label>Perfil</label><select class="select" id="ebatchProfile"><option value="">-</option>${state.master.roastProfiles.map(p => `<option value="${p.id}" ${Number(batch.roast_profile_id) === Number(p.id) ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></div>
      <div class="field"><label>Kg tostado</label><input class="input" id="ebatchRoastedKg" type="number" step="0.01" value="${esc(batch.roasted_kg || "")}" /></div>
      <div class="field"><label>Minutos</label><input class="input" id="ebatchMinutes" type="number" step="0.01" value="${esc(batch.machine_minutes || 0)}" /></div>
      <div class="field"><label>Pedido ligado</label><select class="select" id="ebatchSale"><option value="">Sin ligar</option>${sales.filter(s => s.order_type === "wholesale" && s.status !== "completed" && s.status !== "cancelled").map(s => `<option value="${s.id}" ${Number(batch.sales_order_id) === Number(s.id) ? "selected" : ""}>${esc(s.order_no)} · ${esc(s.client_name || "")}</option>`).join("")}</select></div>
    </div>
    <div class="field"><label>Notas</label><textarea class="textarea" id="ebatchNotes">${esc(batch.notes || "")}</textarea></div>
  `, [{
    label: "Guardar cambios",
    kind: "primary",
    onClick: async modal => {
      await api(`/roasting-batches/${batchId}`, {
        method: "PATCH",
        body: {
          roast_profile_id: val("ebatchProfile") || null,
          roasted_kg: val("ebatchRoastedKg") ? Number(val("ebatchRoastedKg")) : null,
          machine_minutes: Number(val("ebatchMinutes")),
          sales_order_id: val("ebatchSale") || null,
          notes: val("ebatchNotes") || null,
        },
      });
      modal.remove();
      toast("Batch actualizado.", "ok");
      openRoasting(sessionId);
    }
  }]);
}

function deleteBatch(batchId, sessionId) {
  if (!confirm("¿Eliminar el batch y revertir inventario?")) return;
  api(`/roasting-batches/${batchId}`, { method: "DELETE" })
    .then(() => { toast("Batch eliminado.", "ok"); openRoasting(sessionId); })
    .catch(err => toast(err.message, "error"));
}

function newInventoryItem() {
  openModal("Nuevo ítem de inventario", `
    <div class="form-grid">
      <div class="field"><label>Tipo</label>
        <select class="select" id="invType">
          <option value="green_coffee">Café verde</option>
          <option value="roasted_coffee">Café tostado</option>
          <option value="packaged_coffee">Café empaquetado</option>
          <option value="supply">Insumo</option>
        </select>
      </div>
      <div class="field"><label>Nombre</label><input class="input" id="invName" /></div>
      <div class="field"><label>Cantidad inicial</label><input class="input" id="invQty" type="number" step="0.01" value="0" /></div>
      <div class="field"><label>Unidad</label><input class="input" id="invUnit" value="kg" /></div>
      <div class="field"><label>Stock mínimo</label><input class="input" id="invMin" type="number" step="0.01" value="0" /></div>
      <div class="field"><label>Lote</label><input class="input" id="invLot" /></div>
      <div class="field"><label>Origen</label><select class="select" id="invOrigin"><option value="">-</option>${state.master.origins.map(o => `<option value="${o.id}">${esc(o.name)}</option>`).join("")}</select></div>
      <div class="field"><label>Variedad</label><select class="select" id="invVar"><option value="">-</option>${state.master.varieties.map(v => `<option value="${v.id}">${esc(v.name)}</option>`).join("")}</select></div>
    </div>
    <div class="field"><label>Notas</label><textarea class="textarea" id="invNotes"></textarea></div>
  `, [{
    label: "Guardar ítem",
    kind: "primary",
    onClick: async modal => {
      await api("/inventory", {
        method: "POST",
        body: {
          item_type: val("invType"),
          item_name: val("invName"),
          quantity: Number(val("invQty")),
          unit: val("invUnit"),
          min_stock: Number(val("invMin")),
          lot_label: val("invLot") || null,
          origin_id: val("invOrigin") || null,
          variety_id: val("invVar") || null,
          notes: val("invNotes") || null,
        },
      });
      modal.remove();
      toast("Ítem agregado.", "ok");
      setView("inventory");
    }
  }]);
}

function newInventoryMovement(itemId, itemName) {
  openModal(`Movimiento: ${itemName}`, `
    <div class="form-grid">
      <div class="field"><label>Tipo</label><select class="select" id="mvType"><option value="in">Entrada</option><option value="out">Salida</option><option value="adjust">Ajuste absoluto</option></select></div>
      <div class="field"><label>Cantidad</label><input class="input" id="mvQty" type="number" step="0.01" /></div>
    </div>
    <div class="field"><label>Razón</label><input class="input" id="mvReason" /></div>
    <div class="field"><label>Registrado por</label><select class="select" id="mvBy">${partnerOptions()}</select></div>
  `, [{
    label: "Registrar",
    kind: "primary",
    onClick: async modal => {
      await api(`/inventory/${itemId}/movements`, {
        method: "POST",
        body: {
          direction: val("mvType"),
          quantity: Number(val("mvQty")),
          reason: val("mvReason") || "Movimiento manual",
          registered_by: val("mvBy"),
        },
      });
      modal.remove();
      toast("Movimiento guardado.", "ok");
      setView("inventory");
    }
  }]);
}

function deleteInventoryItem(id) {
  if (!confirm("¿Eliminar este ítem del inventario?")) return;
  api(`/inventory/${id}`, { method: "DELETE" })
    .then(() => { toast("Ítem eliminado.", "ok"); setView("inventory"); })
    .catch(err => toast(err.message, "error"));
}

function newExpense() {
  openModal("Nuevo gasto", `
    <div class="form-grid">
      <div class="field"><label>Fecha</label><input class="input" id="expDate" type="date" value="${new Date().toISOString().slice(0,10)}" /></div>
      <div class="field"><label>Categoría</label><select class="select" id="expCat">${expenseCategoryOptions()}</select></div>
      <div class="field"><label>Monto</label><input class="input" id="expAmount" type="number" step="0.01" /></div>
      <div class="field"><label>Pagado por</label><select class="select" id="expBy">${partnerOptions()}</select></div>
      <div class="field"><label>Proveedor</label><input class="input" id="expSupplier" /></div>
    </div>
    <div class="field"><label>Descripción</label><input class="input" id="expDesc" /></div>
    <div class="field"><label>Notas</label><textarea class="textarea" id="expNotes"></textarea></div>
  `, [{
    label: "Guardar gasto",
    kind: "primary",
    onClick: async modal => {
      await api("/expenses", {
        method: "POST",
        body: {
          expense_date: val("expDate"),
          category_id: Number(val("expCat")),
          amount: Number(val("expAmount")),
          paid_by: val("expBy"),
          supplier: val("expSupplier") || null,
          description: val("expDesc") || null,
          notes: val("expNotes") || null,
        },
      });
      modal.remove();
      toast("Gasto registrado.", "ok");
      setView("expenses");
    }
  }]);
}

function deleteExpense(id) {
  if (!confirm("¿Eliminar este gasto?")) return;
  api(`/expenses/${id}`, { method: "DELETE" })
    .then(() => { toast("Gasto eliminado.", "ok"); setView("expenses"); })
    .catch(err => toast(err.message, "error"));
}

function newMachineLog() {
  openModal("Nuevo registro de máquina", `
    <div class="form-grid">
      <div class="field"><label>Fecha</label><input class="input" id="mlDate" type="date" value="${new Date().toISOString().slice(0,10)}" /></div>
      <div class="field"><label>Tipo</label><select class="select" id="mlType"><option value="maintenance">mantenimiento</option><option value="improvement">mejora</option><option value="part">pieza</option><option value="incident">incidencia</option></select></div>
      <div class="field"><label>Costo</label><input class="input" id="mlCost" type="number" step="0.01" value="0" /></div>
      <div class="field"><label>Registrado por</label><select class="select" id="mlBy">${partnerOptions()}</select></div>
    </div>
    <div class="field"><label>Descripción</label><textarea class="textarea" id="mlDesc"></textarea></div>
  `, [{
    label: "Guardar",
    kind: "primary",
    onClick: async modal => {
      await api("/machine-logs", {
        method: "POST",
        body: {
          log_date: val("mlDate"),
          log_type: val("mlType"),
          cost: Number(val("mlCost")),
          registered_by: val("mlBy"),
          description: val("mlDesc"),
        },
      });
      modal.remove();
      toast("Registro guardado.", "ok");
      setView("machine");
    }
  }]);
}

function deleteMachineLog(id) {
  if (!confirm("¿Eliminar este registro?")) return;
  api(`/machine-logs/${id}`, { method: "DELETE" })
    .then(() => { toast("Registro eliminado.", "ok"); setView("machine"); })
    .catch(err => toast(err.message, "error"));
}

async function saveSettings() {
  await api("/settings", {
    method: "PUT",
    body: {
      business_name: val("cfgBusiness"),
      default_loss_pct: val("cfgLoss"),
      machine_kw: val("cfgKw"),
      kwh_price: val("cfgKwh"),
      default_green_cost_per_kg: val("cfgGreen"),
    },
  });
  await refreshMaster(true);
  toast("Configuración guardada.", "ok");
}

function newClient() {
  openModal("Nuevo cliente", `
    <div class="form-grid">
      <div class="field"><label>Nombre</label><input class="input" id="clName" /></div>
      <div class="field"><label>Teléfono</label><input class="input" id="clPhone" /></div>
      <div class="field"><label>Email</label><input class="input" id="clEmail" /></div>
      <div class="field"><label>Ciudad</label><input class="input" id="clCity" /></div>
    </div>
    <div class="field"><label>Dirección</label><input class="input" id="clAddress" /></div>
    <div class="field"><label>Notas</label><textarea class="textarea" id="clNotes"></textarea></div>
  `, [{
    label: "Guardar",
    kind: "primary",
    onClick: async modal => {
      await api("/clients", {
        method: "POST",
        body: {
          name: val("clName"),
          phone: val("clPhone") || null,
          email: val("clEmail") || null,
          city: val("clCity") || null,
          address: val("clAddress") || null,
          notes: val("clNotes") || null,
        },
      });
      modal.remove();
      await refreshMaster(true);
      toast("Cliente guardado.", "ok");
      setView("config");
    }
  }]);
}

function deleteClient(id) {
  if (!confirm("¿Eliminar cliente?")) return;
  api(`/clients/${id}`, { method: "DELETE" })
    .then(async () => { await refreshMaster(true); toast("Cliente eliminado.", "ok"); setView("config"); })
    .catch(err => toast(err.message, "error"));
}

function newProduct() {
  openModal("Nuevo producto", `
    <div class="form-grid">
      <div class="field"><label>Nombre</label><input class="input" id="prName" /></div>
      <div class="field"><label>Presentación</label><input class="input" id="prPresentation" placeholder="250g / 500g / 1kg / granel" /></div>
      <div class="field"><label>Peso unitario kg</label><input class="input" id="prWeight" type="number" step="0.01" /></div>
      <div class="field"><label>Precio</label><input class="input" id="prPrice" type="number" step="0.01" /></div>
      <div class="field"><label>Origen</label><select class="select" id="prOrigin"><option value="">-</option>${state.master.origins.map(o => `<option value="${o.id}">${esc(o.name)}</option>`).join("")}</select></div>
      <div class="field"><label>Variedad</label><select class="select" id="prVar"><option value="">-</option>${state.master.varieties.map(v => `<option value="${v.id}">${esc(v.name)}</option>`).join("")}</select></div>
      <div class="field"><label>Perfil</label><select class="select" id="prProfile"><option value="">-</option>${state.master.roastProfiles.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join("")}</select></div>
    </div>
  `, [{
    label: "Guardar",
    kind: "primary",
    onClick: async modal => {
      await api("/products", {
        method: "POST",
        body: {
          name: val("prName"),
          presentation: val("prPresentation") || null,
          unit_weight_kg: Number(val("prWeight")),
          price: Number(val("prPrice")),
          origin_id: val("prOrigin") || null,
          variety_id: val("prVar") || null,
          roast_profile_id: val("prProfile") || null,
        },
      });
      modal.remove();
      await refreshMaster(true);
      toast("Producto guardado.", "ok");
      setView("config");
    }
  }]);
}

function deleteProduct(id) {
  if (!confirm("¿Eliminar producto?")) return;
  api(`/products/${id}`, { method: "DELETE" })
    .then(async () => { await refreshMaster(true); toast("Producto eliminado.", "ok"); setView("config"); })
    .catch(err => toast(err.message, "error"));
}

function newCatalogItem(table, label) {
  openModal(`Nuevo: ${label}`, `
    <div class="field"><label>Nombre</label><input class="input" id="catName" /></div>
    ${table === "expense_categories" ? `<div class="field"><label>¿Es costo directo?</label><select class="select" id="catDirect"><option value="0">No</option><option value="1">Sí</option></select></div>` : ""}
  `, [{
    label: "Guardar",
    kind: "primary",
    onClick: async modal => {
      await api(`/${table}`, {
        method: "POST",
        body: {
          name: val("catName"),
          ...(table === "expense_categories" ? { is_direct_cost: Number(val("catDirect")) } : {})
        },
      });
      modal.remove();
      await refreshMaster(true);
      toast("Catálogo actualizado.", "ok");
      setView("config");
    }
  }]);
}

const App = {
  setView,
  render,
  filterTable,
  newRetailSale,
  newWholesaleSale,
  openSale,
  addPayment,
  deletePayment,
  addShipment,
  deleteShipment,
  newManualPurchase,
  openPurchase,
  receivePurchase,
  newCapitalRequest,
  newContribution,
  newCapitalReturn,
  newDividendOrder,
  payDividendOrder,
  newRoastingSession,
  openRoasting,
  newBatch,
  editBatch,
  deleteBatch,
  newInventoryItem,
  newInventoryMovement,
  deleteInventoryItem,
  newExpense,
  deleteExpense,
  newMachineLog,
  deleteMachineLog,
  saveSettings,
  newClient,
  deleteClient,
  newProduct,
  deleteProduct,
  newCatalogItem,
};
window.App = App;

document.querySelectorAll(".nav-item").forEach(node => {
  node.addEventListener("click", () => setView(node.dataset.view));
});
document.getElementById("reloadBtn").addEventListener("click", async () => {
  state.master = null;
  await refreshMaster(true);
  toast("Datos recargados.", "ok");
  render();
});

(async function boot() {
  try {
    setStatus("Sincronizando...");
    await refreshMaster(true);
    setStatus("Conectado");
    render();
  } catch (err) {
    setStatus("Error");
    renderError(err);
  }
})();
