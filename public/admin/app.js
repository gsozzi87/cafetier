const state = {
  view: "dashboard",
  params: {},
  master: null,
};

const VIEWS = {
  dashboard: "Dashboard",
  sales: "Ventas",
  maestros: "Datos",
  clients: "Datos",
  salesDetail: "Detalle de venta",
  purchases: "Compras",
  purchaseDetail: "Detalle de compra",
  cashbook: "Libro de caja",
  capital: "Capital & Utilidades",
  roasting: "Tostado",
  roastingDetail: "Detalle de sesión",
  inventory: "Inventario",
  expenses: "Gastos",
  config: "Configuración",
};

const moneyFmt = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 2 });
const numFmt = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 2 });

function money(n) { return moneyFmt.format(Number(n || 0)); }
function kg(n) { return `${numFmt.format(Number(n || 0))} kg`; }
function pct(n) { return `${numFmt.format(Number(n || 0))}%`; }
function round2(n) { return Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100; }
function esc(v) { return String(v ?? "").replace(/[&<>"]/g, m => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" }[m])); }
function todayStr() { return new Date().toISOString().slice(0, 10); }
function val(id) { return document.getElementById(id)?.value; }
function setStatus(text) { document.getElementById("statusPill").textContent = text; }
function statusBadge(status) { return `<span class="badge ${status}">${esc(status)}</span>`; }
function titleize(text) { return text.charAt(0).toUpperCase() + text.slice(1); }
function moneySourceOptions(selected = "Dinero Cafetier") {
  const opts = [["Dinero Cafetier", "Dinero Cafetier (usa dividendos del negocio)"], ["Axel", "Axel (se le devuelve)"], ["Itza", "Itza (se le devuelve)"]];
  return opts.map(([v, l]) => `<option value="${v}" ${v === selected ? "selected" : ""}>${l}</option>`).join("");
}
// Ordena una tabla por la columna del encabezado clickeado, alternando asc/desc.
function sortTableByColumn(th) {
  const table = th.closest("table"); const thead = th.closest("thead");
  if (!table || !thead) return;
  const ths = Array.from(thead.querySelectorAll("th"));
  const idx = ths.indexOf(th);
  const tbody = table.querySelector("tbody");
  if (!tbody || idx < 0 || !(th.textContent || "").trim()) return;
  const rows = Array.from(tbody.querySelectorAll(":scope > tr"));
  if (rows.length < 2) return;
  const asc = th.getAttribute("data-sort") !== "asc";
  ths.forEach(h => { h.removeAttribute("data-sort"); const s = h.querySelector(".sort-ind"); if (s) s.remove(); });
  th.setAttribute("data-sort", asc ? "asc" : "desc");
  const cellVal = row => {
    const t = (row.children[idx]?.textContent || "").trim();
    const dm = t.match(/\d{4}-\d{2}-\d{2}/);
    if (dm) return new Date(dm[0]).getTime();
    const cleaned = t.replace(/[^\d.\-]/g, "");
    if (cleaned && /\d/.test(t) && !isNaN(parseFloat(cleaned))) return parseFloat(cleaned);
    return t.toLowerCase();
  };
  rows.sort((a, b) => {
    const va = cellVal(a), vb = cellVal(b);
    if (va < vb) return asc ? -1 : 1;
    if (va > vb) return asc ? 1 : -1;
    return 0;
  });
  rows.forEach(r => tbody.appendChild(r));
  const ind = document.createElement("span"); ind.className = "sort-ind"; ind.textContent = asc ? " ▲" : " ▼";
  th.appendChild(ind);
}
function isWholesale(type) { return ["mayoreo", "wholesale"].includes(String(type || "")); }
function isClosedStatus(status) { return ["completado", "cancelado", "completed", "cancelled"].includes(String(status || "")); }
function shipmentFundingLabel(s) {
  if (!Number(s.shipping_cost || 0)) return "";
  const account = s.paid_from_account || "Dinero Cafetier";
  return account === "Dinero Cafetier" ? "Dinero Cafetier" : `Pagado por ${account}`;
}
function editIcon(call, title = "Editar") { return `<button class="icon-btn edit" title="${title}" aria-label="${title}" onclick="${call}">✎</button>`; }
function delIcon(call, title = "Eliminar") { return `<button class="icon-btn del" title="${title}" aria-label="${title}" onclick="${call}">🗑</button>`; }

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
  decorateTables(modal);
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

// On phones the tables render as stacked cards (CSS), so each cell needs its column label.
function decorateTables(root) {
  (root || document).querySelectorAll("table.table").forEach(tbl => {
    const heads = [...tbl.querySelectorAll("thead th")].map(th => th.textContent.trim());
    if (!heads.length) return;
    tbl.querySelectorAll("tbody tr").forEach(tr => {
      [...tr.children].forEach((td, i) => {
        if (heads[i] != null) td.setAttribute("data-label", heads[i]);
      });
    });
  });
}

function setView(view, params = {}) {
  state.view = view;
  state.params = params;
  document.body.classList.remove("nav-open");
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
    if (state.view === "maestros" || state.view === "clients") return await renderMaestros();
    if (state.view === "salesDetail") return await renderSalesDetail(state.params.id);
    if (state.view === "purchases") return await renderPurchases();
    if (state.view === "purchaseDetail") return await renderPurchaseDetail(state.params.id);
    if (state.view === "cashbook") return await renderCashbook();
    if (state.view === "capital") return await renderCapital();
    if (state.view === "roasting") return await renderRoasting();
    if (state.view === "roastingDetail") return await renderRoastingDetail(state.params.id);
    if (state.view === "inventory") return await renderInventory();
    if (state.view === "expenses") return await renderExpenses();
    if (state.view === "config") return await renderConfig();
  } catch (err) {
    renderError(err);
  }
}

async function renderDashboard() {
  const dm = state.params.dashMonth || null;
  const d = await api(`/dashboard${dm ? "?month=" + encodeURIComponent(dm) : ""}`);
  const per = d.period || { isAllTime: true, rev: 0, exp: 0, profit: 0, roasted: 0, shipped: 0, avgLoss: 0, profitPerRoastedKg: 0 };
  const plabel = per.isAllTime ? "(total)" : "· " + per.month;
  document.getElementById("content").innerHTML = `
    <div class="row between" style="margin-bottom:12px">
      <div class="row wrap">
        <button class="btn ${per.isAllTime ? "primary" : "ghost"} sm" onclick="App.dashAll()">Total (desde el inicio)</button>
        <div class="field inline-field"><label>Mes</label><input class="input" id="dashMonth" type="month" value="${esc(dm || todayStr().slice(0, 7))}" /></div>
        <button class="btn ${per.isAllTime ? "ghost" : "primary"} sm" onclick="App.applyDashMonth()">Ver mes</button>
      </div>
      <span class="pill">${per.isAllTime ? "Totales desde el inicio" : "Mes " + per.month}</span>
    </div>

    <div class="grid cards">
      <div class="card metric"><div class="label">Ingresos ${plabel}</div><div class="value money">${money(per.rev)}</div><small>Ventas cobradas</small></div>
      <div class="card metric"><div class="label">Gastos ${plabel}</div><div class="value money">${money(per.exp)}</div><small>Incluye compras y costos</small></div>
      <div class="card metric"><div class="label">Resultado ${plabel}</div><div class="value money">${money(per.profit)}</div><small>Ingresos - gastos</small></div>
      <div class="card metric"><div class="label">Caja disponible</div><div class="value money">${money(d.finance.availableCash)}</div><small>Total del negocio (3 cuentas)</small></div>
      <div class="card metric accent"><div class="label">Dinero Cafetier</div><div class="value money">${money(d.cafetierBalance)}</div><small>Saldo en la cuenta del negocio</small></div>
      <div class="card metric"><div class="label">Utilidad repartible</div><div class="value money">${money(d.equityPool)}</div><small>${d.totalUnrecovered > 0 ? "Después de devolver aportes" : "Lista para repartir"}</small></div>
      <div class="card metric"><div class="label">Cuentas por cobrar</div><div class="value money">${money(d.receivables || 0)}</div><small>Ventas pendientes de pago</small></div>
      <div class="card metric"><div class="label">Utilidad/kg tostado ${plabel}</div><div class="value money">${money(per.profitPerRoastedKg)}</div><small>${kg(per.roasted)} tostados</small></div>
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
            <div><div class="muted tiny">Tostado ${plabel}</div><div class="value">${kg(per.roasted)}</div></div>
            <div><div class="muted tiny">Enviado ${plabel}</div><div class="value">${kg(per.shipped)}</div></div>
            <div><div class="muted tiny">Merma promedio</div><div class="value">${pct(per.avgLoss)}</div></div>
          </div>
        </div>

        <div class="card">
          <div class="row between"><h3>Dinero por cuenta</h3><button class="btn ghost sm" onclick="App.setView('cashbook')">Libro de caja</button></div>
          <div class="kpi-strip">
            <div><div class="muted tiny">Dinero Cafetier</div><div class="value money">${money(d.accounts?.["Dinero Cafetier"] || 0)}</div></div>
            <div><div class="muted tiny">En cuenta de Axel</div><div class="value money">${money(d.accounts?.Axel || 0)}</div></div>
            <div><div class="muted tiny">En cuenta de Itza</div><div class="value money">${money(d.accounts?.Itza || 0)}</div></div>
          </div>
          <div class="tiny muted" style="margin-top:6px">Dónde está físicamente el dinero del negocio. La cuenta de un socio en negativo significa que el negocio le debe.</div>
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
          <div class="row between"><h3>Capital &amp; dividendos (total)</h3><button class="btn ghost sm" onclick="App.setView('capital')">Abrir módulo</button></div>
          <div class="list">
            <div class="item">
              <div class="row between"><strong>Aportes totales</strong><span class="money">${money(d.finance.totalContributed)}</span></div>
              <div class="row between small"><span class="muted">Capital recuperado</span><span class="money">${money(d.finance.capitalRecovered)}</span></div>
              <div class="row between small"><span class="muted">Capital pendiente de devolver</span><span class="money">${money(d.finance.unrecoveredCapital)}</span></div>
              <div class="row between small"><span class="muted">Utilidad repartible total</span><span class="money">${money(d.equityPool)}</span></div>
            </div>
            ${(d.partnersEquity || []).map(p => `
              <div class="item">
                <div class="row between"><strong>${esc(p.name)} · ${p.share_pct}%</strong><span class="money">${money(p.belongs)}</span></div>
                <div class="small muted">Aportó ${money(p.contributed)} · le falta cobrar ${money(p.unrecovered)} · dividendos ${money(p.dividend_share)}</div>
                <div class="tiny muted">Le pertenece = aporte pendiente + su parte de la utilidad (lo haya sacado o no).</div>
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

function applyDashMonth() { const m = val("dashMonth"); setView("dashboard", m ? { dashMonth: m } : {}); }
function dashAll() { setView("dashboard", {}); }

function salesTotals(order) {
  const paid = Number(order.paid_amount ?? order.paid ?? 0);
  const shipped = Number(order.shipped_kg ?? order.shipped ?? 0);
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
          <tr><th>Fecha</th><th>Folio</th><th>Tipo</th><th>Cliente / Proveedor</th><th>Estado</th><th>Kg</th><th>Precio/kg</th><th>Total</th><th>Pagado</th><th>Enviado</th><th></th></tr>
        </thead>
        <tbody>
          ${rows.map(order => {
            const t = salesTotals(order);
            return `
              <tr>
                <td>${esc((order.created_at || "").slice(0, 10))}${order.delivery_date ? `<div class="tiny muted">entrega ${esc(order.delivery_date)}</div>` : ""}</td>
                <td><strong>${esc(order.order_no)}</strong></td>
                <td>${esc(order.order_type)}</td>
                <td>${esc(order.client_name || "Mostrador")}</td>
                <td>${statusBadge(order.status)}</td>
                <td>${kg(order.total_weight_kg)}</td>
                <td class="money">${money(order.price_per_kg)}</td>
                <td class="money">${money(order.total_amount)}</td>
                <td class="money">${money(t.paid)}</td>
                <td>${kg(t.shipped)}</td>
                <td><div class="line-actions">${editIcon(`App.editSale(${order.id})`)}${delIcon(`App.deleteSale(${order.id})`)}<button class="btn ghost sm" onclick="App.openSale(${order.id})">Abrir</button></div></td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
      ${rows.length ? "" : `<div class="empty">Todavía no hay ventas registradas.</div>`}
    </div>
  `;
}

function tabBar(view, paramKey, current, tabs) {
  return `<div class="tabbar">${tabs.map(([k, l]) => `<button class="btn ${current === k ? "primary" : "ghost"} sm" onclick="App.setView('${view}',{${paramKey}:'${k}'})">${l}</button>`).join("")}</div>`;
}

function clientsCard(master) {
  const rows = master.clients || [];
  return `
    <div class="row between" style="margin-bottom:12px">
      <button class="btn primary" onclick="App.newClient()">Nuevo cliente</button>
      <input class="search" style="max-width:280px" placeholder="Buscar cliente" oninput="App.filterTable(this,'clientsTable')" />
    </div>
    <div class="card">
      <table class="table" id="clientsTable">
        <thead><tr><th>Cliente</th><th>Cafetería</th><th>Encargado</th><th>Contacto</th><th>Dirección</th><th></th></tr></thead>
        <tbody>
          ${rows.map(c => `
            <tr>
              <td><strong>${esc(c.name)}</strong><div class="tiny muted">${esc(c.email || "")}</div></td>
              <td>${esc(c.cafe_name || "")}</td>
              <td>${esc(c.contact_name || "")}</td>
              <td>${esc(c.phone || "")}${c.contact_phone ? `<div class="tiny muted">Enc. ${esc(c.contact_phone)}</div>` : ""}</td>
              <td>${esc([c.address, c.neighborhood ? `Col. ${c.neighborhood}` : "", c.municipality, c.city, c.state, c.postal_code ? `CP ${c.postal_code}` : ""].filter(Boolean).join(" · "))}</td>
              <td><div class="line-actions"><button class="btn ghost sm" onclick="App.editClient(${c.id})">Editar</button>${delIcon(`App.deleteClient(${c.id})`)}</div></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
      ${rows.length ? "" : `<div class="empty">Sin clientes registrados.</div>`}
    </div>`;
}

function productsCard(master) {
  return `
    <div class="card">
      <div class="row between"><h3>Productos</h3><button class="btn secondary sm" onclick="App.newProduct()">+ Producto</button></div>
      <div class="small muted" style="margin-bottom:6px">Aparecen al vender (mostrador y mayoreo). El precio acá es el de lista; se puede editar en cada venta sin cambiar el de lista.</div>
      ${(master.products || []).length ? (master.products || []).map(p => `<div class="item"><div class="row between"><strong>${esc(p.name)}</strong><div class="line-actions">${editIcon(`App.editProduct(${p.id})`)}${delIcon(`App.deleteProduct(${p.id})`)}</div></div><div class="small muted">${esc(p.presentation || "")} · ${kg(p.unit_weight_kg)} · ${money(p.price)}</div></div>`).join("") : `<div class="empty">Sin productos.</div>`}
    </div>`;
}

function itemsCard(master) {
  return `
    <div class="card">
      <div class="row between"><h3>Ítems del inventario</h3><button class="btn secondary sm" onclick="App.newInventoryCatalogItem()">+ Ítem</button></div>
      <div class="small muted" style="margin-bottom:6px">Definí acá todo lo que manejás (café, cajas, bolsas, marketing, insumos…). Solo estos se pueden cargar al inventario o comprar.</div>
      ${(master.inventoryCatalog || []).length ? (master.inventoryCatalog || []).map(it => `<div class="item"><div class="row between"><strong>${esc(it.name)}</strong><div class="line-actions"><span class="pill">${esc(it.category || it.item_type)}</span>${editIcon(`App.editInventoryCatalogItem(${it.id})`)}${delIcon(`App.deleteInventoryCatalogItem(${it.id})`)}</div></div><div class="small muted">${esc(it.unit || "")}${it.supplier ? " · " + esc(it.supplier) : ""}${Number(it.min_stock) > 0 ? " · mín " + numFmt.format(it.min_stock) : ""}</div></div>`).join("") : `<div class="empty">Sin ítems definidos.</div>`}
    </div>`;
}

function suppliersCard(master) {
  return `
    <div class="card">
      <div class="row between"><h3>Proveedores</h3><button class="btn secondary sm" onclick="App.newSupplier()">+ Proveedor</button></div>
      <div class="small muted" style="margin-bottom:6px">Con contacto, teléfono y dirección. Se eligen al comprar café, etiquetas o cualquier ítem.</div>
      ${(master.suppliers || []).length ? (master.suppliers || []).map(s => `<div class="item"><div class="row between"><strong>${esc(s.name)}</strong><div class="line-actions">${editIcon(`App.editSupplier(${s.id})`)}${delIcon(`App.deleteSupplier(${s.id})`)}</div></div><div class="small muted">${[s.contact_name, s.phone, s.email].filter(Boolean).map(esc).join(" · ") || "Sin contacto"}${s.address ? `<div class="tiny muted">${esc(s.address)}</div>` : ""}</div></div>`).join("") : `<div class="empty">Sin proveedores. Agregá uno con "+ Proveedor".</div>`}
    </div>`;
}

function catalogManageCard(table, label, rows, hint) {
  return `
    <div class="card">
      <div class="row between"><h3>${label}</h3><button class="btn secondary sm" onclick="App.newCatalogItem('${table}','${label}')">+ Agregar</button></div>
      ${hint ? `<div class="small muted" style="margin-bottom:6px">${hint}</div>` : ""}
      ${(rows || []).length ? (rows || []).map(r => `<div class="item"><div class="row between"><strong>${esc(r.name)}</strong><div class="line-actions">${editIcon(`App.editCatalogItem('${table}',${r.id})`)}${delIcon(`App.deleteCatalogItem('${table}',${r.id})`)}</div></div></div>`).join("") : `<div class="empty">Sin datos.</div>`}
    </div>`;
}

function carriersCard(master) {
  return catalogManageCard("carriers", "Paqueterías", master.carriers, "Se eligen al registrar un envío de venta.");
}

function otrosCard(master) {
  return `
    <div class="split">
      <div class="stack">
        ${catalogManageCard("roast_profiles", "Perfiles de tueste", master.roastProfiles)}
        ${catalogManageCard("origins", "Orígenes", master.origins)}
      </div>
      <div class="stack">
        ${catalogManageCard("varieties", "Variedades", master.varieties)}
        ${catalogManageCard("expense_categories", "Categorías de gasto", master.expenseCategories)}
      </div>
    </div>`;
}

async function renderMaestros() {
  const master = await refreshMaster(true);
  const tabKeys = ["clientes", "proveedores", "paqueterias", "items", "productos", "otros"];
  const tab = tabKeys.includes(state.params.mdTab) ? state.params.mdTab : "clientes";
  const tabs = tabBar("maestros", "mdTab", tab, [["clientes", "Clientes"], ["proveedores", "Proveedores"], ["paqueterias", "Paqueterías"], ["items", "Ítems"], ["productos", "Productos"], ["otros", "Otros"]]);
  let body = "";
  if (tab === "clientes") body = clientsCard(master);
  else if (tab === "proveedores") body = suppliersCard(master);
  else if (tab === "paqueterias") body = carriersCard(master);
  else if (tab === "items") body = itemsCard(master);
  else if (tab === "productos") body = productsCard(master);
  else body = otrosCard(master);
  document.getElementById("content").innerHTML = `${tabs}${body}`;
}

async function renderSalesDetail(id) {
  const data = await api(`/sales-orders/${id}`);
  const { order, items, payments, shipments, purchaseOrders, batches } = data;
  const paid = payments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
  const shipped = shipments.reduce((sum, s) => sum + Number(s.weight_kg || 0), 0);
  const roasted = batches.reduce((sum, b) => sum + Number(b.roasted_kg || 0), 0);
  const pendingRoast = Math.max(0, Number(order.total_weight_kg || 0) - roasted);
  const pendingShip = Math.max(0, Number(order.total_weight_kg || 0) - shipped);

  document.getElementById("content").innerHTML = `
    <div class="row between" style="margin-bottom:12px">
      <div class="row wrap">
        <button class="btn ghost" onclick="App.setView('sales')">← Volver a ventas</button>
        <span class="pill">${esc(order.order_no)}</span>
        ${statusBadge(order.status)}
      </div>
      <div class="row wrap">
        <button class="btn secondary" onclick="App.addPayment(${order.id})">Registrar pago</button>
        ${isWholesale(order.order_type) ? `<button class="btn secondary" onclick="App.addShipment(${order.id})">Registrar envío</button>` : ""}
        <button class="btn ghost" onclick="App.editSale(${order.id})">✎ Editar</button>
        <button class="btn red" onclick="App.deleteSale(${order.id})">🗑 Eliminar</button>
      </div>
    </div>

    <div class="grid cards">
      <div class="card metric"><div class="label">Cliente</div><div class="value" style="font-size:22px">${esc(order.client_name || "Mostrador")}</div><small>${esc(order.client_city || "")}</small></div>
      <div class="card metric"><div class="label">Total</div><div class="value money">${money(order.total_amount)}</div><small>${kg(order.total_weight_kg)}</small></div>
      <div class="card metric"><div class="label">Pagado</div><div class="value money">${money(paid)}</div><small>Pendiente ${money(Math.max(0, order.total_amount - paid))}</small></div>
      <div class="card metric"><div class="label">Producción / envío</div><div class="value">${kg(roasted)} / ${kg(shipped)}</div><small>Falta por tostar ${kg(pendingRoast)} · falta por enviar ${kg(pendingShip)}</small></div>
    </div>

    <div class="split" style="margin-top:12px">
      <div class="stack">
        ${isWholesale(order.order_type) ? `
        <div class="card">
          <h3>Pedido por kilo</h3>
          <div class="grid cards">
            <div class="metric flat"><div class="label">Kg solicitados</div><div class="value">${kg(order.total_weight_kg)}</div></div>
            <div class="metric flat"><div class="label">Precio por kg</div><div class="value money">${money(order.price_per_kg)}</div></div>
            <div class="metric flat"><div class="label">Total pedido</div><div class="value money">${money(order.total_amount)}</div></div>
          </div>
        </div>` : `
        <div class="card">
          <h3>Productos</h3>
          ${items.length ? `<table class="table"><thead><tr><th>Descripción</th><th>Cantidad</th><th>Peso unidad</th><th>Precio</th><th>Subtotal</th></tr></thead><tbody>
            ${items.map(it => `<tr><td>${esc(it.description)}</td><td>${numFmt.format(it.quantity)}</td><td>${kg(it.unit_weight_kg)}</td><td>${money(it.unit_price)}</td><td>${money(it.subtotal)}</td></tr>`).join("")}
          </tbody></table>` : `<div class="empty">Sin productos cargados.</div>`}
        </div>`}

        <div class="card">
          <div class="row between"><h3>Pagos</h3><button class="btn ghost sm" onclick="App.addPayment(${order.id})">+ Pago</button></div>
          ${payments.length ? payments.map(p => `
            <div class="item">
              <div class="row between"><strong>${money(p.amount)}</strong><div class="line-actions"><span class="pill">${esc(p.method || "-")}</span>${editIcon(`App.editPayment(${p.id},${order.id})`)}<button class="btn red sm" onclick="App.deletePayment(${p.id},${order.id})">Eliminar</button></div></div>
              <div class="small muted">${esc((p.created_at || "").slice(0, 10))} · ${esc(p.received_account || "Axel")} ${p.notes ? "· " + esc(p.notes) : ""}</div>
            </div>`).join("") : `<div class="empty">Sin pagos.</div>`}
        </div>

        ${isWholesale(order.order_type) ? `
        <div class="card">
          <div class="row between"><h3>Envíos</h3><button class="btn ghost sm" onclick="App.addShipment(${order.id})">+ Envío</button></div>
          ${shipments.length ? shipments.map(s => `
            <div class="item">
              <div class="row between"><strong>${kg(s.weight_kg)}</strong><div class="line-actions"><span class="pill">${esc(s.carrier || "Sin paquetería")}</span>${editIcon(`App.editShipment(${s.id},${order.id})`)}<button class="btn red sm" onclick="App.deleteShipment(${s.id},${order.id})">Eliminar</button></div></div>
              <div class="small muted">${esc((s.created_at || "").slice(0, 10))} ${s.destination_address ? "· " + esc(s.destination_address) : ""} ${s.shipping_cost ? "· " + money(s.shipping_cost) : ""} ${shipmentFundingLabel(s) ? "· " + esc(shipmentFundingLabel(s)) : ""}</div>
              ${(s.packaging && s.packaging.length) ? `<div class="small muted">📦 ${s.packaging.map(p => esc(p.item_name) + " ×" + esc(p.quantity)).join(" · ")}</div>` : ""}
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
          <div class="row between"><h3>Batches ligados</h3>${isWholesale(order.order_type) ? `<button class="btn ghost sm" onclick="App.setView('roasting')">Ir a tostado</button>` : ""}</div>
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
        <thead><tr><th>Fecha</th><th>Folio</th><th>Descripción</th><th>Proveedor</th><th>Estado</th><th>Cantidad</th><th>Costo unit.</th><th>Monto total</th><th>Origen del dinero</th><th></th></tr></thead>
        <tbody>
          ${rows.map(po => {
            const recibido = Number(po.received_green_kg || 0) > 0;
            const totalPO = Number(po.actual_cost || 0) > 0 ? Number(po.actual_cost || 0) : (Number(po.estimated_cost || 0) + Number(po.estimated_shipping_cost || 0));
            const cantRef = recibido ? Number(po.received_green_kg) : Number(po.requested_green_kg || 0);
            const merca = Number(po.actual_cost || 0) > 0 ? (Number(po.actual_cost) - Number(po.actual_shipping_cost || 0)) : Number(po.estimated_cost || 0);
            const costoUnit = cantRef > 0 ? merca / cantRef : 0;
            return `
            <tr>
              <td>${esc((po.created_at || "").slice(0, 10))}</td>
              <td><strong>${esc(po.po_no)}</strong></td>
              <td>${esc(po.description)}</td>
              <td>${esc(po.supplier || "—")}</td>
              <td>${statusBadge(po.status)}</td>
              <td>${numFmt.format(po.requested_green_kg)} ${esc(po.unit || "kg")}</td>
              <td class="money">${money(costoUnit)}</td>
              <td class="money">${money(totalPO)}<div class="tiny muted">${Number(po.actual_cost || 0) > 0 ? "real (con envío)" : "estimado (con envío)"}</div></td>
              <td>${po.paid_from ? esc(po.paid_from) : `<span class="muted">— sin recibir —</span>`}</td>
              <td><div class="line-actions">${["cancelled","cancelada"].includes(po.status) ? "" : editIcon(`App.editPurchase(${po.id})`)}${delIcon(`App.deletePurchase(${po.id})`, "Eliminar / cancelar")}<button class="btn ghost sm" onclick="App.openPurchase(${po.id})">Abrir</button></div></td>
            </tr>`;
          }).join("")}
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
        ${!["received", "recibida", "cancelled", "cancelada"].includes(po.status) ? `<button class="btn primary" onclick="App.receivePurchase(${po.id})">Ejecutar compra / recibir café</button>` : ""}
        ${!["cancelled", "cancelada"].includes(po.status) ? `<button class="btn ghost" onclick="App.editPurchase(${po.id})">✎ Editar</button>` : ""}
        ${po.status !== "cancelada" && po.status !== "cancelled" ? `<button class="btn red" onclick="App.deletePurchase(${po.id})">🗑 Eliminar</button>` : ""}
      </div>
    </div>

    <div class="grid cards">
      <div class="card metric"><div class="label">Cantidad solicitada</div><div class="value">${numFmt.format(po.requested_green_kg)} ${esc(po.unit || "kg")}</div><small>Recibido ${numFmt.format(po.received_green_kg)} ${esc(po.unit || "kg")}</small></div>
      <div class="card metric"><div class="label">Mercancía estimada</div><div class="value money">${money(po.estimated_cost)}</div><small>Real mercancía ${money((po.actual_cost || 0) - (po.actual_shipping_cost || 0))}</small></div>
      <div class="card metric"><div class="label">Proveedor</div><div class="value" style="font-size:22px">${esc(po.supplier || "Sin proveedor")}</div><small>${esc(po.source_type)}</small></div>
      <div class="card metric"><div class="label">Envío compra</div><div class="value money">${money(po.actual_shipping_cost || po.estimated_shipping_cost || 0)}</div><small>Est. ${money(po.estimated_shipping_cost || 0)} · Real ${money(po.actual_shipping_cost || 0)}</small></div>
      <div class="card metric"><div class="label">Progreso</div><div class="value">${pct(po.requested_green_kg ? (po.received_green_kg / po.requested_green_kg) * 100 : 0)}</div><small>${esc(po.status)}</small></div>
    </div>

    ${capitalRequests.some(r => r.status !== "funded" && r.status !== "cancelled") ? `
      <div class="notice error" style="margin-top:12px">
        Esta orden tiene capital pendiente. Al ejecutar la compra se valida caja total (mercancía + envío). Si no alcanza, debés fondear la orden de capital antes de recibir café.
      </div>` : ""}

    <div class="split" style="margin-top:12px">
      <div class="card">
        <h3>Entradas recibidas</h3>
        ${entries.length ? `
        <table class="table">
          <thead><tr><th>Fecha</th><th>Ítem</th><th>Cantidad</th><th>Costo/u</th><th>Mercancía</th><th>Envío</th><th>Total</th><th>Origen del dinero</th><th>Proveedor</th><th></th></tr></thead>
          <tbody>${entries.map(e => `
            <tr>
              <td>${esc((e.created_at || "").slice(0, 10))}</td>
              <td>${esc(e.item_name)}</td>
              <td>${numFmt.format(e.quantity_kg)} ${esc(e.item_unit || "kg")}</td>
              <td class="money">${money(e.unit_cost || 0)}</td>
              <td class="money">${money(e.total_cost)}</td>
              <td class="money">${money(e.shipping_cost || 0)}</td>
              <td class="money">${money((e.total_cost || 0) + (e.shipping_cost || 0))}</td>
              <td>${esc(e.paid_from_account || "")}<div class="tiny muted">${e.funding_source === "partner_contribution" ? "aporte de socio" : "cuenta del negocio"}</div></td>
              <td>${esc(e.supplier || "")}</td>
              <td><div class="line-actions">${editIcon(`App.editPurchaseEntry(${e.id},${po.id})`)}${delIcon(`App.deletePurchaseEntry(${e.id},${po.id})`)}</div></td>
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

function cashClassBadge(clase) {
  const map = {
    "Venta": ["var(--green-soft)", "var(--green)"],
    "Compra": ["var(--blue-soft)", "var(--blue)"],
    "Envío": ["var(--orange-soft)", "var(--orange)"],
    "Gasto": ["var(--red-soft)", "var(--red)"],
    "Aporte": ["var(--accent-soft)", "var(--accent)"],
    "Retiro": ["#efe9fb", "#6b4ea8"],
    "Dividendo": ["var(--green-soft)", "var(--green)"],
  };
  const [bg, fg] = map[clase] || ["#f0f0f0", "#666"];
  return `<span class="badge" style="background:${bg};color:${fg}">${esc(clase || "—")}</span>`;
}
// Quita del detalle la palabra de la clase (Compra/Envío/Gasto…), que es redundante con la columna Clase.
function cashDetail(m) {
  return String(m.detail || "")
    .replace(/^Compra\s+/i, "")
    .replace(/^Env[ií]o\s+compra\s+/i, "")
    .replace(/^Env[ií]o\s+/i, "")
    .replace(/^Gasto\s+/i, "")
    .trim();
}

async function renderCashbook() {
  const nowDate = new Date();
  const start = state.params.start || "2000-01-01";
  const end = state.params.end || nowDate.toISOString().slice(0, 10);
  const data = await api(`/cashbook?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`);
  document.getElementById("content").innerHTML = `
    <div class="row between" style="margin-bottom:12px">
      <div class="row wrap">
        <div class="field inline-field"><label>Desde</label><input class="input" id="cashStart" type="date" value="${esc(start)}" /></div>
        <div class="field inline-field"><label>Hasta</label><input class="input" id="cashEnd" type="date" value="${esc(end)}" /></div>
        <button class="btn secondary" onclick="App.applyCashbookFilter()">Ver</button>
        <button class="btn ghost" onclick="App.cashbookAll()">Desde el inicio</button>
      </div>
      <span class="pill">${data.movements.length} movimientos</span>
    </div>

    <div class="grid cards" style="margin-bottom:12px">
      <div class="card metric"><div class="label">Entradas</div><div class="value money">${money(data.total_in)}</div><small>Aportes + cobros</small></div>
      <div class="card metric"><div class="label">Salidas</div><div class="value money">${money(data.total_out)}</div><small>Gastos + retiros</small></div>
      <div class="card metric ${data.net >= 0 ? "accent" : ""}"><div class="label">Neto del periodo</div><div class="value money">${money(data.net)}</div><small>${esc(start)} a ${esc(end)}</small></div>
      <div class="card metric"><div class="label">Rango</div><div class="value" style="font-size:20px">${esc(start)}</div><small>hasta ${esc(end)}</small></div>
    </div>

    <div class="card">
      <table class="table" id="cashbookTable">
        <thead><tr><th>Fecha</th><th>Clase</th><th>Tipo</th><th>Detalle</th><th>Cuenta</th><th>Entrada</th><th>Salida</th><th></th></tr></thead>
        <tbody>
          ${data.movements.map(m => `
            <tr>
              <td><strong>${esc(m.date)}</strong></td>
              <td>${cashClassBadge(m.clase)}</td>
              <td>${esc(m.type)}</td>
              <td>${esc(cashDetail(m))}</td>
              <td>${esc(m.account || "")}</td>
              <td class="money">${m.signed_amount > 0 ? money(m.amount) : ""}</td>
              <td class="money">${m.signed_amount < 0 ? money(m.amount) : ""}</td>
              <td><div class="line-actions"><button class="btn ghost sm" onclick="App.editCashbookMovement('${esc(m.source)}', ${Number(m.source_id)})">Editar</button><button class="btn red sm" onclick="App.deleteCashbookMovement('${esc(m.source)}', ${Number(m.source_id)})">Borrar</button></div></td>
            </tr>`).join("")}
        </tbody>
      </table>
      ${data.movements.length ? "" : `<div class="empty">No hay movimientos en este rango.</div>`}
    </div>
  `;
}

function applyCashbookFilter() {
  setView("cashbook", { start: val("cashStart"), end: val("cashEnd") });
}

function cashbookAll() {
  setView("cashbook", { start: "2000-01-01", end: new Date().toISOString().slice(0, 10) });
}

async function editCashbookMovement(source, id) {
  const start = state.params.start || "2000-01-01";
  const end = state.params.end || new Date().toISOString().slice(0, 10);
  const data = await api(`/cashbook?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`);
  const movement = data.movements.find(m => m.source === source && Number(m.source_id) === Number(id));
  if (!movement) throw new Error("No pude encontrar el movimiento en el rango actual.");
  const isPartnerRow = ["capital_contribution", "withdrawal"].includes(source);
  const isExpense = source === "expense";
  const expenseDetail = isExpense ? (await api("/expenses")).find(e => Number(e.id) === Number(id)) : null;
  openModal("Editar movimiento de caja", `
    <div class="form-grid">
      <div class="field"><label>Fecha</label><input class="input" id="cbDate" type="date" value="${esc(movement.date)}" /></div>
      <div class="field"><label>Monto</label><input class="input" id="cbAmount" type="number" step="0.01" value="${esc(movement.amount)}" /></div>
      <div class="field"><label>Cuenta</label><select class="select" id="cbAccount">${accountOptions(movement.account || "Axel")}</select></div>
      <div class="field"><label>${isPartnerRow ? "Socio" : "Persona"}</label>${isPartnerRow ? `<select class="select" id="cbPerson">${partnerOptions(movement.person)}</select>` : `<input class="input" id="cbPerson" value="${esc(movement.person || "")}" />`}</div>
      ${isExpense ? `<div class="field"><label>Categoría</label><select class="select" id="cbCategory">${expenseCategoryOptions(expenseDetail?.category_id)}</select></div><div class="field"><label>Proveedor</label><input class="input" id="cbSupplier" value="${esc(expenseDetail?.supplier || "")}" /></div>` : ""}
    </div>
    <div class="field"><label>Detalle</label><textarea class="textarea" id="cbDetail">${esc(movement.detail || "")}</textarea></div>
  `, [{
    label: "Guardar cambios",
    kind: "primary",
    onClick: async modal => {
      await api(`/cashbook/${source}/${id}`, {
        method: "PUT",
        body: {
          date: val("cbDate"),
          amount: Number(val("cbAmount")),
          account: val("cbAccount"),
          person: val("cbPerson"),
          detail: val("cbDetail") || null,
          category_id: isExpense ? Number(val("cbCategory")) : null,
          supplier: isExpense ? val("cbSupplier") || null : null,
        },
      });
      modal.remove();
      toast("Movimiento actualizado.", "ok");
      setView("cashbook", state.params);
    }
  }]);
}

function deleteCashbookMovement(source, id) {
  if (!confirm("¿Borrar este movimiento de caja? Esta acción afecta los números del ERP.")) return;
  api(`/cashbook/${source}/${id}`, { method: "DELETE" })
    .then(() => { toast("Movimiento borrado.", "ok"); setView("cashbook", state.params); })
    .catch(err => toast(err.message, "error"));
}

async function renderCapital() {
  const [summary, requests, contributions, dividends, withdrawals, assets] = await Promise.all([
    api("/capital/summary"),
    api("/capital-requests"),
    api("/capital-contributions"),
    api("/dividend-orders"),
    api("/withdrawals"),
    api("/partner-assets"),
  ]);

  document.getElementById("content").innerHTML = `
    <div class="row between" style="margin-bottom:12px">
      <div class="row wrap">
        <button class="btn primary" onclick="App.newCapitalReturn()">Devolver capital</button>
        <button class="btn green" onclick="App.newDividendOrder()">Orden de dividendos fin de mes</button>
      </div>
    </div>

    <div class="grid cards">
      <div class="card metric"><div class="label">Caja disponible</div><div class="value money">${money(summary.finance.availableCash)}</div><small>Liquidez actual</small></div>
      <div class="card metric"><div class="label">Capital aportado</div><div class="value money">${money(summary.finance.totalContributed)}</div><small>Recuperado ${money(summary.finance.capitalRecovered)}</small></div>
      <div class="card metric"><div class="label">Capital pendiente</div><div class="value money">${money(summary.finance.unrecoveredCapital)}</div><small>${summary.finance.unrecoveredCapital > 0 ? "Bloquea dividendos" : "Capital totalmente recuperado"}</small></div>
      <div class="card metric"><div class="label">Dividendos distribuibles</div><div class="value money">${money(summary.finance.distributableDividends)}</div><small>Solo al recuperar el capital</small></div>
      <div class="card metric accent"><div class="label">Axel → Itza sugerido</div><div class="value money">${money(summary.settlement?.axelToItza || 0)}</div><small>${esc(summary.settlement?.reason || "")}</small></div>
      <div class="card metric"><div class="label">Cuentas por cobrar</div><div class="value money">${money(summary.receivables || 0)}</div><small>Pedidos aún no pagados</small></div>
      <div class="card metric"><div class="label">Utilidad/kg tostado</div><div class="value money">${money(summary.monthly?.profitPerRoastedKg || 0)}</div><small>${kg(summary.monthly?.roastedKg || 0)} tostados en ${esc(summary.monthly?.month || "")}</small></div>
      <div class="card metric"><div class="label">Dividendos pagados</div><div class="value money">${money(summary.dividendAdvice?.alreadyPaid || 0)}</div><small>${summary.dividendAdvice?.canDistribute ? "Puede evaluarse reparto" : esc(summary.dividendAdvice?.blockedReason || "")}</small></div>
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
          <h3>Dónde está el dinero</h3>
          ${Object.entries(summary.accounts || {}).map(([name, amount]) => `
            <div class="item">
              <div class="row between"><strong>${esc(name)}</strong><span class="money">${money(amount)}</span></div>
              <div class="small muted">Saldo operativo registrado en esa cuenta/custodia.</div>
            </div>`).join("")}
        </div>

        <div class="card">
          <div class="row between"><h3>Aportes de capital por socio</h3><span class="pill">${contributions.length}</span></div>
          <div class="small muted" style="margin-bottom:6px">Se generan solos cuando un gasto o compra sale de la cuenta de un socio. Para corregir uno, editá el gasto/compra de origen.</div>
          ${contributions.length ? contributions.map(c => `
            <div class="item">
              <div class="row between"><strong>${esc(c.partner_name)}</strong><span class="money">${money(c.amount)}</span></div>
              <div class="small muted">${esc((c.contribution_date || "").slice(0, 10))}</div>
              <div class="small muted">${esc(c.description)}</div>
            </div>`).join("") : `<div class="empty">Aún no hay aportes. Se generan al pagar un gasto o compra desde la cuenta de un socio.</div>`}
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
              <div class="row between"><strong>${esc(w.partner_name)}</strong><div class="line-actions"><span class="money">${money(w.amount)}</span>${editIcon(`App.editWithdrawal(${w.id})`)}${delIcon(`App.deleteWithdrawal(${w.id})`)}</div></div>
              <div class="small muted">${w.kind === "capital_return" ? "Devolución de capital" : "Dividendo"} · sale de ${esc(w.paid_from_account || "Dinero Cafetier")} · ${esc(w.month || "")}</div>
              <div class="small muted">${esc((w.created_at || "").slice(0, 10))} ${w.notes ? "· " + esc(w.notes) : ""}</div>
            </div>`).join("") : `<div class="empty">Sin retiros.</div>`}
        </div>
      </div>
    </div>
  `;
}

async function renderRoasting() {
  const [rows, loss] = await Promise.all([
    api("/roasting-sessions"),
    api("/admin/loss").catch(() => ({ estimatedLossPct: null })),
  ]);
  document.getElementById("content").innerHTML = `
    <div class="row between" style="margin-bottom:12px">
      <div class="row wrap">
        <button class="btn primary" onclick="App.newRoastingSession()">Nueva sesión</button>
      </div>
      <span class="pill" title="Promedio de los últimos tuestes; se usa para estimar el café verde necesario">Merma estimada: ${loss.estimatedLossPct != null ? pct(loss.estimatedLossPct) : "—"}</span>
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
              <td><div class="line-actions">${editIcon(`App.editRoastingSession(${r.id})`)}${Number(r.batch_count) === 0 ? delIcon(`App.deleteRoastingSession(${r.id})`) : ""}<button class="btn ghost sm" onclick="App.openRoasting(${r.id})">Abrir</button></div></td>
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
  const openSales = sales.filter(s => isWholesale(s.order_type) && !isClosedStatus(s.status));

  document.getElementById("content").innerHTML = `
    <div class="row between" style="margin-bottom:12px">
      <div class="row wrap">
        <button class="btn ghost" onclick="App.setView('roasting')">← Volver a tostado</button>
        <span class="pill">${esc(session.session_date)}</span>
      </div>
      <div class="row wrap">
        <button class="btn primary" onclick="App.newBatch(${session.id})">Nuevo batch</button>
        <button class="btn ghost" onclick="App.editRoastingSession(${session.id})">✎ Editar sesión</button>
        ${batches.length === 0 ? `<button class="btn red" onclick="App.deleteRoastingSession(${session.id})">🗑 Eliminar sesión</button>` : ""}
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
              <label class="btn ghost sm file-btn">Curva Artisan<input type="file" accept=".alog,.csv,.json,.txt" onchange="App.uploadArtisan(${b.id}, ${session.id}, this)" hidden></label>
              <label class="btn ghost sm file-btn">Fotos<input type="file" accept="image/*" multiple onchange="App.uploadBatchPhoto(${b.id}, ${session.id}, this)" hidden></label>
              <button class="btn red sm" onclick="App.deleteBatch(${b.id},${session.id})">Eliminar</button>
            </div></div>
            <div class="small muted">${esc(b.green_item_name)} · ${kg(b.green_kg)} → ${kg(b.roasted_kg || 0)} · ${pct(b.loss_pct || 0)} · ${numFmt.format(b.machine_minutes || 0)} min</div>
            <div class="small muted">${b.order_no ? "Pedido " + esc(b.order_no) : "Sin pedido ligado"} ${b.notes ? "· " + esc(b.notes) : ""}</div>
            ${b.ai_review ? `<div class="code" style="margin-top:10px"><strong>Reseña IA:</strong>
${esc(b.ai_review)}</div>` : ``}
            ${b.artisan_file_name ? `<div class="small muted" style="margin-top:8px">Curva cargada: ${esc(b.artisan_file_name)}</div>` : ``}
            ${(b.photos || []).length ? `<div class="photo-grid">${b.photos.map(p => `<div class="photo-card"><img src="/api/uploads/${encodeURIComponent(p.stored_name)}" alt="${esc(p.file_name)}" /><div class="photo-actions"><span class="tiny muted">${esc(p.file_name)}</span><button class="btn red sm" onclick="App.deleteBatchPhoto(${p.id}, ${b.id}, ${session.id})">Quitar</button></div></div>`).join("")}</div>` : ``}
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

const INV_TYPE_LABELS = { green_coffee: "Café verde", roasted_coffee: "Café tostado", packaged_coffee: "Café empaquetado", supply: "Insumos y empaques" };
const INV_TYPE_ORDER = ["green_coffee", "roasted_coffee", "packaged_coffee", "supply"];

function inventoryTabs(tab) {
  return tabBar("inventory", "invTab", tab, [["stock", "Existencias actuales"], ["history", "Historial de movimientos"]]);
}
const inventoryHeader = `
  <div class="row between" style="margin-bottom:12px">
    <div class="row wrap"><button class="btn primary" onclick="App.newInventoryItem()">Nuevo ítem</button></div>
  </div>`;

async function renderInventory() {
  const tab = state.params.invTab === "history" ? "history" : "stock";
  if (tab === "history") return renderInventoryHistory();
  const rows = await api("/inventory");
  const catByName = {};
  (state.master.inventoryCatalog || []).forEach(c => { catByName[c.name] = c; });

  const groups = INV_TYPE_ORDER
    .map(type => ({ type, label: INV_TYPE_LABELS[type], items: rows.filter(i => i.item_type === type) }))
    .filter(g => g.items.length);
  const known = new Set(INV_TYPE_ORDER);
  const others = rows.filter(i => !known.has(i.item_type));
  if (others.length) groups.push({ type: "otros", label: "Otros", items: others });

  const section = g => `
    <div class="card" style="margin-bottom:14px">
      <div class="row between" style="margin-bottom:8px"><h3 style="margin:0">${esc(g.label)}</h3><span class="pill">${g.items.length} ítem${g.items.length === 1 ? "" : "s"}</span></div>
      <table class="table">
        <thead><tr><th>Ítem</th><th>Cantidad actual</th><th>Mínimo</th><th></th></tr></thead>
        <tbody>
          ${g.items.map(i => {
            const safeName = esc(i.item_name).replace(/'/g, "&#39;");
            const cat = catByName[i.item_name];
            const sub = [i.origin_name, i.variety_name].filter(Boolean).join(" · ") || (g.type === "supply" && cat && cat.category ? esc(cat.category) : "");
            const low = Number(i.min_stock) > 0 && Number(i.quantity) <= Number(i.min_stock);
            const neg = Number(i.quantity) < 0;
            return `<tr>
              <td><strong>${esc(i.item_name)}</strong>${sub ? `<div class="tiny muted">${sub}</div>` : ""}</td>
              <td><strong ${neg ? `style="color:var(--red)"` : ""}>${numFmt.format(i.quantity)}</strong> ${esc(i.unit)} ${low && !neg ? `<span class="badge sin_fondos" title="Por debajo del mínimo">bajo</span>` : ""} ${neg ? `<span class="badge" style="background:var(--red-soft);color:var(--red)" title="Stock negativo: falta cargar entradas">negativo</span>` : ""}</td>
              <td>${numFmt.format(i.min_stock)} ${esc(i.unit)}</td>
              <td><div class="line-actions">${editIcon(`App.editInventoryItem(${i.id})`)}<button class="btn ghost sm" onclick="App.newInventoryMovement(${i.id},'${safeName}')">Entrada / salida</button>${delIcon(`App.deleteInventoryItem(${i.id})`)}</div></td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>`;

  document.getElementById("content").innerHTML = `
    ${inventoryHeader}
    ${inventoryTabs("stock")}
    <div class="notice ok" style="margin-bottom:14px">Esto es <strong>lo que tenés ahora</strong> (existencias actuales). Para ver entradas y salidas por fecha, abrí la pestaña <strong>Historial de movimientos</strong>.</div>
    ${groups.length ? groups.map(section).join("") : `<div class="card"><div class="empty">Inventario vacío. Cargá ítems con "Nuevo ítem".</div></div>`}
  `;
}

async function renderInventoryHistory() {
  const moves = await api("/inventory-movements");
  const dirLabel = { in: "Entrada", out: "Salida", adjust: "Ajuste" };
  const sign = { in: "+", out: "−", adjust: "=" };
  document.getElementById("content").innerHTML = `
    ${inventoryHeader}
    ${inventoryTabs("history")}
    <div class="notice ok" style="margin-bottom:14px">Historial de <strong>toda la bodega</strong> por fecha: entradas y salidas de todos los ítems. No es el stock actual (ese está en "Existencias actuales").</div>
    <div class="card">
      <table class="table">
        <thead><tr><th>Fecha</th><th>Ítem</th><th>Movimiento</th><th>Cantidad</th><th>Razón</th><th>Por</th></tr></thead>
        <tbody>
          ${moves.map(m => `<tr>
            <td>${esc((m.created_at || "").slice(0, 10))}</td>
            <td><strong>${esc(m.item_name)}</strong></td>
            <td>${dirLabel[m.direction] || esc(m.direction)}</td>
            <td>${sign[m.direction] || ""}${numFmt.format(m.quantity)} ${esc(m.unit || "")}</td>
            <td>${esc(m.reason || "")}</td>
            <td>${esc(m.registered_by || "")}</td>
          </tr>`).join("")}
        </tbody>
      </table>
      ${moves.length ? "" : `<div class="empty">Todavía no hay movimientos en la bodega.</div>`}
    </div>
  `;
}

async function renderExpenses() {
  const showAll = !state.params.expMonth;
  const month = state.params.expMonth || new Date().toISOString().slice(0, 7);
  const all = await api(showAll ? "/expenses" : `/expenses?month=${month}`);
  // Solo gastos cargados a mano: compras y envíos se ven en el libro de caja.
  const rows = all.filter(e => !e.auto_generated);
  const total = rows.reduce((s, e) => s + Number(e.amount || 0), 0);
  document.getElementById("content").innerHTML = `
    <div class="row between" style="margin-bottom:12px">
      <div class="row wrap">
        <button class="btn primary" onclick="App.newExpense()">Nuevo gasto</button>
        <div class="field inline-field"><label>Mes</label><input class="input" id="expMonth" type="month" value="${esc(month)}" ${showAll ? "disabled" : ""} /></div>
        <button class="btn secondary" onclick="App.applyExpenseMonth()">Ver mes</button>
        <button class="btn ${showAll ? "primary" : "ghost"}" onclick="App.toggleAllExpenses()">${showAll ? "✓ Desde el inicio" : "Ver todo"}</button>
      </div>
      <span class="pill">${showAll ? "Desde el inicio" : month} · ${rows.length} · ${money(total)}</span>
    </div>
    <div class="notice ok" style="margin-bottom:12px">Solo gastos cargados a mano. Las compras y los envíos se ven en el <strong>Libro de caja</strong>.</div>
    <div class="card">
      <table class="table">
        <thead><tr><th>Fecha</th><th>Concepto</th><th>Categoría</th><th>Fuente</th><th>Monto</th><th></th></tr></thead>
        <tbody>
          ${rows.map(e => `
            <tr>
              <td>${esc(e.expense_date)}</td>
              <td><strong>${esc(e.description || e.category_name)}</strong><div class="tiny muted">${esc(e.supplier || "")}</div></td>
              <td>${esc(e.category_name)}</td>
              <td>${esc(e.paid_from_account || e.paid_by)}<div class="tiny muted">${esc(e.paid_by || "")}</div></td>
              <td class="money">${money(e.amount)}</td>
              <td><div class="line-actions">${e.auto_generated ? `<span class="pill" title="Generado automáticamente">auto</span>` : editIcon(`App.editExpense(${e.id})`)}${delIcon(`App.deleteExpense(${e.id})`)}</div></td>
            </tr>`).join("")}
        </tbody>
      </table>
      ${rows.length ? "" : `<div class="empty">${showAll ? "Sin gastos registrados." : "Sin gastos este mes."}</div>`}
    </div>
  `;
}

function applyExpenseMonth() { setView("expenses", { expMonth: val("expMonth") }); }
function toggleAllExpenses() { setView("expenses", state.params.expMonth ? {} : { expMonth: new Date().toISOString().slice(0, 7) }); }

async function renderConfig() {
  const master = await refreshMaster(true);
  const settings = master.settings || {};
  const loss = await api("/admin/loss").catch(() => ({ estimatedLossPct: null }));
  document.getElementById("content").innerHTML = `
    <div class="split">
      <div class="stack">
        <div class="card">
          <h3>Parámetros</h3>
          <div class="form-grid">
            <div class="field"><label>Nombre del negocio</label><input class="input" id="cfgBusiness" value="${esc(settings.business_name || "CAFETIER")}" /></div>
            <div class="field"><label>Slogan</label><input class="input" id="cfgTagline" value="${esc(settings.business_tagline || "Culto por el café")}" /></div>
            <div class="field"><label>Merma estándar %</label><input class="input" id="cfgLoss" type="number" step="0.01" value="${esc(settings.default_loss_pct || "20")}" /><small class="muted">Merma estimada actual (últimos tuestes): <strong>${loss.estimatedLossPct != null ? pct(loss.estimatedLossPct) : "—"}</strong></small></div>
            <div class="field"><label>Costo verde/kg por defecto</label><input class="input" id="cfgGreen" type="number" step="0.01" value="${esc(settings.default_green_cost_per_kg || "0")}" /></div>
            <div class="field"><label>Claude API key</label><input class="input" id="cfgClaude" value="${esc(settings.claude_api_key || "")}" placeholder="sk-ant-..." /></div>
          </div>
          <div class="footer-actions">
            <button class="btn primary" onclick="App.saveSettings()">Guardar configuración</button>
          </div>
        </div>

        <div class="card">
          <div class="row between"><h3>Operadores de tostado</h3><span class="pill">${parseListSetting("roast_operators", ["Axel"]).length}</span></div>
          <div class="list">
            ${parseListSetting("roast_operators", ["Axel"]).map(name => `<div class="item"><div class="row between"><strong>${esc(name)}</strong><button class="btn red sm" onclick="App.removeRoastOperator('${name.replace(/'/g, "\'")}')">Quitar</button></div></div>`).join("") || `<div class="empty">Sin operadores.</div>`}
          </div>
          <div class="hr"></div>
          <div class="field"><label>Nuevo operador</label><input class="input" id="cfgNewOperator" placeholder="Ej: Axel" /></div>
          <div class="footer-actions"><button class="btn secondary" onclick="App.addRoastOperator()">Agregar operador</button></div>
        </div>

      </div>

      <div class="stack">
        <div class="card">
          <h3>Datos</h3>
          <p class="small muted">Clientes, proveedores, paqueterías, ítems, productos y otros catálogos se administran en su propio apartado.</p>
          <div class="footer-actions"><button class="btn secondary" onclick="App.setView('maestros',{mdTab:'clientes'})">Ir a Datos</button></div>
        </div>

        <div class="card danger-zone">
          <h3>Zona de peligro</h3>
          <p class="small muted">Reinicia los datos del sistema. Esta acción no se puede deshacer.</p>
          <div class="footer-actions"><button class="btn red" onclick="App.openResetModal()">Reiniciar datos</button></div>
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
function supplierOptions(selected = "") {
  return `<option value="">— Proveedor —</option>${(state.master.suppliers || []).map(s => `<option value="${esc(s.name)}" ${s.name === selected ? "selected" : ""}>${esc(s.name)}</option>`).join("")}`;
}
function carrierOptions(selected = "") {
  return `<option value="">— Paquetería —</option>${(state.master.carriers || []).map(c => `<option value="${esc(c.name)}" ${c.name === selected ? "selected" : ""}>${esc(c.name)}</option>`).join("")}`;
}
// Campos editables: podés elegir de la lista o escribir uno nuevo (se agrega solo al catálogo).
function supplierField(id, selected = "") {
  return `<input class="input" id="${id}" list="${id}_dl" value="${esc(selected)}" placeholder="Elegí o escribí uno nuevo" autocomplete="off" /><datalist id="${id}_dl">${(state.master.suppliers || []).map(s => `<option value="${esc(s.name)}"></option>`).join("")}</datalist>`;
}
function carrierField(id, selected = "") {
  return `<input class="input" id="${id}" list="${id}_dl" value="${esc(selected)}" placeholder="Elegí o escribí una nueva" autocomplete="off" /><datalist id="${id}_dl">${(state.master.carriers || []).map(c => `<option value="${esc(c.name)}"></option>`).join("")}</datalist>`;
}
// Packaging picker: lets you tag which catalog supplies (boxes/bags/etc) a shipment consumed.
function packagingCatalogItems() {
  return (state.master.inventoryCatalog || []).filter(it => it.item_type === "supply");
}
function packagingItemOptions(selected = "") {
  return packagingCatalogItems().map(it => `<option value="${esc(it.name)}" ${it.name === selected ? "selected" : ""}>${esc(it.name)}${it.category ? " · " + esc(it.category) : ""}</option>`).join("");
}
function pkgRowHtml(name = "", qty = "") {
  return `<div class="pkg-row" style="display:flex;gap:8px;align-items:center;margin-bottom:6px">
    <select class="select pkg-item" style="flex:2">${packagingItemOptions(name)}</select>
    <input class="input pkg-qty" type="number" step="0.01" min="0" placeholder="Cant." value="${qty !== "" && qty != null ? esc(qty) : ""}" style="flex:1" />
    <button type="button" class="btn ghost sm" onclick="this.closest('.pkg-row').remove()">✕</button>
  </div>`;
}
function packagingPicker(containerId, lines = []) {
  if (!packagingCatalogItems().length) {
    return `<div class="field"><label>Empaques usados</label><div class="notice warn">Definí cajas/bolsas/empaques en Configuración → Items del inventario para poder descontarlas.</div></div>`;
  }
  const rows = (lines || []).map(l => pkgRowHtml(l.item_name, l.quantity)).join("");
  return `<div class="field"><label>Empaques usados (se descuentan del inventario)</label>
    <div id="${containerId}">${rows}</div>
    <button type="button" class="btn ghost sm" onclick="App.addPkgRow('${containerId}')">+ Empaque</button>
    <small class="muted" style="display:block;margin-top:4px">No bloquea: si no tenés stock, el inventario queda en negativo.</small>
  </div>`;
}
function addPkgRow(containerId) {
  document.getElementById(containerId)?.insertAdjacentHTML("beforeend", pkgRowHtml());
}
function readPkgRows(containerId) {
  const out = [];
  document.getElementById(containerId)?.querySelectorAll(".pkg-row").forEach(row => {
    const name = row.querySelector(".pkg-item")?.value;
    const qty = Number(row.querySelector(".pkg-qty")?.value || 0);
    if (name && qty > 0) out.push({ item_name: name, quantity: qty });
  });
  return out;
}
function parseListSetting(key, fallback = []) {
  const raw = (state.master.settings || {})[key] || "";
  const values = String(raw).split("|").map(x => x.trim()).filter(Boolean);
  return values.length ? values : fallback;
}
function partnerOptions(selected = "") {
  return (state.master.partners || []).map(p => `<option value="${esc(p.name)}" ${p.name === selected ? "selected" : ""}>${esc(p.name)}</option>`).join("");
}
function personOptions() {
  return parseListSetting("individual_people", ["Itza", "Axel"]).map(name => `<option value="${esc(name)}">${esc(name)}</option>`).join("");
}
function roastOperatorOptions() {
  return parseListSetting("roast_operators", ["Axel"]).map(name => `<option value="${esc(name)}">${esc(name)}</option>`).join("");
}
function accountOptions(selected = "Axel") {
  const accounts = ["Axel", "Itza", "Dinero Cafetier"];
  return accounts.map(name => `<option value="${esc(name)}" ${name === selected ? "selected" : ""}>${esc(name)}</option>`).join("");
}
function fundingSourceOptions() {
  return `<option value="business_account">Cuenta/dinero del negocio</option><option value="partner_contribution">Lo puso un socio y se le debe</option>`;
}
function expenseCategoryOptions(selected = "") {
  return (state.master.expenseCategories || []).map(c => `<option value="${c.id}" ${Number(c.id) === Number(selected) ? "selected" : ""}>${esc(c.name)}</option>`).join("");
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
// Wholesale lines: price is prefilled from the product but editable per sale (does not change the product price).
function productLineRows() {
  return (state.master.products || []).map(p => `
    <tr>
      <td><strong>${esc(p.name)}</strong><div class="tiny muted">${esc(p.presentation || "")}</div></td>
      <td>${kg(p.unit_weight_kg)}</td>
      <td><input class="input" style="max-width:120px" type="number" min="0" step="0.01" value="${esc(p.price)}" data-line-price data-product-id="${p.id}" /></td>
      <td><input class="input" style="max-width:90px" type="number" min="0" step="1" value="0" data-line-qty data-product-id="${p.id}" /></td>
    </tr>`).join("");
}
function readProductLines() {
  const lines = [];
  document.querySelectorAll("[data-line-qty]").forEach(qtyEl => {
    const qty = Number(qtyEl.value || 0);
    if (qty <= 0) return;
    const prod = (state.master.products || []).find(p => p.id === Number(qtyEl.dataset.productId));
    if (!prod) return;
    const priceEl = document.querySelector(`[data-line-price][data-product-id="${prod.id}"]`);
    const price = Number(priceEl?.value ?? prod.price);
    lines.push({ product_id: prod.id, description: prod.name, presentation: prod.presentation, quantity: qty, unit: "unit", unit_weight_kg: Number(prod.unit_weight_kg), unit_price: price });
  });
  return lines;
}
function catalogItemOptions(selected = "") {
  const items = state.master.inventoryCatalog || [];
  if (!items.length) return `<option value="">(definí ítems en Datos → Ítems)</option>`;
  return items.map(it => `<option value="${esc(it.name)}" ${it.name === selected ? "selected" : ""}>${esc(it.name)}${it.category ? " · " + esc(it.category) : ""}</option>`).join("");
}

async function newRetailSale() {
  openModal("Nueva venta de mostrador", `
    <div class="notice ok">Se descontará café tostado disponible y se registrará el pago al momento.</div>
    <div class="field"><label>Cliente opcional</label><select class="select" id="retClient"><option value="">Mostrador</option>${clientOptions()}</select></div>
    <div class="field"><label>Método de pago</label><select class="select" id="retMethod"><option>efectivo</option><option>transferencia</option><option>tarjeta</option></select></div>
    <div class="field"><label>Cuenta que recibe</label><select class="select" id="retAccount">${accountOptions("Axel")}</select></div>
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
          order_type: "mostrador",
          client_id: val("retClient") || null,
          payment_method: val("retMethod"),
          received_account: val("retAccount"),
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
  const hasProducts = (state.master.products || []).length > 0;
  openModal("Nuevo pedido mayoreo", `
    <div class="form-grid">
      <div class="field"><label>Cliente</label><select class="select" id="whClient">${clientOptions()}</select></div>
      <div class="field"><label>Entrega</label><input class="input" id="whDelivery" type="date" /></div>
    </div>
    ${hasProducts ? `
    <div class="field"><label>Productos</label>
      <div class="small muted" style="margin-bottom:6px">El precio viene del producto pero podés editarlo en esta venta (no cambia el precio del producto).</div>
      <table class="table">
        <thead><tr><th>Producto</th><th>Peso</th><th>Precio</th><th>Cant.</th></tr></thead>
        <tbody>${productLineRows()}</tbody>
      </table>
    </div>` : `<div class="notice warn">No tenés productos cargados. Definilos en Datos → Productos, o cargá la venta a granel abajo.</div>`}
    <details ${hasProducts ? "" : "open"} style="margin-top:6px"><summary class="small muted" style="cursor:pointer">O cargar a granel (sin productos)</summary>
      <div class="form-grid" style="margin-top:8px">
        <div class="field"><label>Kg a entregar</label><input class="input" id="whKg" type="number" step="0.01" /></div>
        <div class="field"><label>Precio por kg</label><input class="input" id="whPriceKg" type="number" step="0.01" /></div>
      </div>
    </details>
    <div class="field"><label>Notas</label><textarea class="textarea" id="whNotes"></textarea></div>
  `, [{
    label: "Crear pedido",
    kind: "primary",
    onClick: async modal => {
      const lines = readProductLines();
      const bulkKg = Number(val("whKg") || 0);
      const bulkPrice = Number(val("whPriceKg") || 0);
      if (!lines.length && !(bulkKg > 0)) throw new Error("Elegí productos o cargá los kg a granel.");
      const payload = {
        order_type: "mayoreo",
        client_id: Number(val("whClient")),
        delivery_date: val("whDelivery") || null,
        notes: val("whNotes") || null,
      };
      if (lines.length) {
        payload.items = lines;
      } else {
        payload.total_weight_kg = bulkKg;
        payload.price_per_kg = bulkPrice;
        payload.total_amount = bulkKg * bulkPrice;
      }
      await api("/sales-orders", { method: "POST", body: payload });
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
      <div class="field"><label>Fecha</label><input class="input" id="payDate" type="date" value="${todayStr()}" /></div>
      <div class="field"><label>Monto</label><input class="input" id="payAmount" type="number" step="0.01" /></div>
      <div class="field"><label>Método</label><select class="select" id="payMethod"><option>transferencia</option><option>efectivo</option><option>tarjeta</option></select></div>
      <div class="field"><label>Cuenta que recibió</label><select class="select" id="payAccount">${accountOptions("Axel")}</select></div>
    </div>
    <div class="field"><label>Notas</label><input class="input" id="payNotes" /></div>
  `, [{
    label: "Registrar pago",
    kind: "primary",
    onClick: async modal => {
      await api(`/sales-orders/${orderId}/payments`, {
          method: "POST",
          body: { payment_date: val("payDate"), amount: Number(val("payAmount")), method: val("payMethod"), received_account: val("payAccount"), notes: val("payNotes") || null },
      });
      modal.remove();
      toast("Pago registrado.", "ok");
      openSale(orderId);
    }
  }]);
}

async function editPayment(paymentId, orderId) {
  const { payments } = await api(`/sales-orders/${orderId}`);
  const p = payments.find(x => Number(x.id) === Number(paymentId));
  if (!p) throw new Error("No pude encontrar ese pago.");
  openModal("Editar pago", `
    <div class="form-grid">
      <div class="field"><label>Fecha</label><input class="input" id="epayDate" type="date" value="${esc((p.created_at || todayStr()).slice(0, 10))}" /></div>
      <div class="field"><label>Monto</label><input class="input" id="epayAmount" type="number" step="0.01" value="${esc(p.amount)}" /></div>
      <div class="field"><label>Método</label><select class="select" id="epayMethod"><option ${p.method === "transferencia" ? "selected" : ""}>transferencia</option><option ${p.method === "efectivo" ? "selected" : ""}>efectivo</option><option ${p.method === "tarjeta" ? "selected" : ""}>tarjeta</option></select></div>
      <div class="field"><label>Cuenta que recibió</label><select class="select" id="epayAccount">${accountOptions(p.received_account || "Axel")}</select></div>
    </div>
    <div class="field"><label>Notas</label><input class="input" id="epayNotes" value="${esc(p.notes || "")}" /></div>
  `, [{
    label: "Guardar cambios",
    kind: "primary",
    onClick: async modal => {
      await api(`/sales-payments/${paymentId}`, {
        method: "PUT",
        body: {
          payment_date: val("epayDate"),
          amount: Number(val("epayAmount")),
          method: val("epayMethod"),
          received_account: val("epayAccount"),
          notes: val("epayNotes") || null,
        },
      });
      modal.remove();
      toast("Pago actualizado.", "ok");
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

async function addShipment(orderId) {
  const { order, shipments } = await api(`/sales-orders/${orderId}`);
  const shipped = shipments.reduce((sum, s) => sum + Number(s.weight_kg || 0), 0);
  const pending = Math.max(0, Number(order.total_weight_kg || 0) - shipped);
  openModal("Registrar envío", `
    <div class="form-grid">
      <div class="field"><label>Fecha</label><input class="input" id="shipDate" type="date" value="${todayStr()}" /></div>
      <div class="field"><label>Quién pagó el envío</label><select class="select" id="shipPaidFrom"><option value="Dinero Cafetier">Dinero Cafetier</option><option value="Axel">Axel</option><option value="Itza">Itza</option></select></div>
      <div class="field"><label>Kg de este envío</label><input class="input" id="shipKg" type="number" step="0.01" value="${pending ? esc(pending) : ""}" /></div>
      <div class="field"><label>Costo de envío</label><input class="input" id="shipCost" type="number" step="0.01" value="0" /></div>
      <div class="field"><label>Paquetería</label>${carrierField("shipCarrier")}</div>
      <div class="field"><label>Guía</label><input class="input" id="shipTracking" /></div>
    </div>
    <div class="field"><label>Dirección destino</label><input class="input" id="shipAddress" /></div>
    <div class="field"><label>Registrado por</label><select class="select" id="shipBy">${personOptions()}</select></div>
    ${packagingPicker("shipPkgRows", [{}])}
  `, [{
    label: "Guardar",
    kind: "primary",
    onClick: async modal => {
      await api(`/sales-orders/${orderId}/shipments`, {
        method: "POST",
        body: {
          shipment_date: val("shipDate"),
          weight_kg: Number(val("shipKg")),
          shipping_cost: Number(val("shipCost")),
          carrier: val("shipCarrier") || null,
          tracking_number: val("shipTracking") || null,
          destination_address: val("shipAddress") || null,
          registered_by: val("shipBy"),
          funding_source: val("shipPaidFrom") === "Dinero Cafetier" ? "business_account" : "partner_contribution",
          paid_from_account: val("shipPaidFrom"),
          partner_name: val("shipPaidFrom") === "Dinero Cafetier" ? null : val("shipPaidFrom"),
          from_cashbox: val("shipPaidFrom") === "Dinero Cafetier" ? 1 : 0,
          packaging: readPkgRows("shipPkgRows"),
        },
      });
      modal.remove();
      await refreshMaster(true);
      toast("Envío registrado.", "ok");
      openSale(orderId);
    }
  }]);
}

async function editShipment(shipmentId, orderId) {
  const { shipments } = await api(`/sales-orders/${orderId}`);
  const s = shipments.find(x => Number(x.id) === Number(shipmentId));
  if (!s) throw new Error("No pude encontrar ese envío.");
  const paidFrom = s.funding_source === "partner_contribution" ? (s.paid_from_account || "Itza") : (s.paid_from_account || "Dinero Cafetier");
  openModal("Editar envío", `
    <div class="form-grid">
      <div class="field"><label>Fecha</label><input class="input" id="eshipDate" type="date" value="${esc((s.created_at || todayStr()).slice(0, 10))}" /></div>
      <div class="field"><label>Quién pagó el envío</label><select class="select" id="eshipPaidFrom"><option value="Dinero Cafetier" ${paidFrom === "Dinero Cafetier" ? "selected" : ""}>Dinero Cafetier</option><option value="Axel" ${paidFrom === "Axel" ? "selected" : ""}>Axel</option><option value="Itza" ${paidFrom === "Itza" ? "selected" : ""}>Itza</option></select></div>
      <div class="field"><label>Kg de este envío</label><input class="input" id="eshipKg" type="number" step="0.01" value="${esc(s.weight_kg || 0)}" /></div>
      <div class="field"><label>Costo de envío</label><input class="input" id="eshipCost" type="number" step="0.01" value="${esc(s.shipping_cost || 0)}" /></div>
      <div class="field"><label>Paquetería</label>${carrierField("eshipCarrier", s.carrier || "")}</div>
      <div class="field"><label>Guía</label><input class="input" id="eshipTracking" value="${esc(s.tracking_number || "")}" /></div>
    </div>
    <div class="field"><label>Dirección destino</label><input class="input" id="eshipAddress" value="${esc(s.destination_address || "")}" /></div>
    <div class="field"><label>Registrado por</label><select class="select" id="eshipBy">${personOptions()}</select></div>
    ${packagingPicker("eshipPkgRows", (s.packaging && s.packaging.length) ? s.packaging : [{}])}
  `, [{
    label: "Guardar cambios",
    kind: "primary",
    onClick: async modal => {
      await api(`/sales-shipments/${shipmentId}`, {
        method: "PUT",
        body: {
          shipment_date: val("eshipDate"),
          weight_kg: Number(val("eshipKg")),
          shipping_cost: Number(val("eshipCost")),
          carrier: val("eshipCarrier") || null,
          tracking_number: val("eshipTracking") || null,
          destination_address: val("eshipAddress") || null,
          registered_by: val("eshipBy"),
          funding_source: val("eshipPaidFrom") === "Dinero Cafetier" ? "business_account" : "partner_contribution",
          paid_from_account: val("eshipPaidFrom"),
          partner_name: val("eshipPaidFrom") === "Dinero Cafetier" ? null : val("eshipPaidFrom"),
          from_cashbox: val("eshipPaidFrom") === "Dinero Cafetier" ? 1 : 0,
          packaging: readPkgRows("eshipPkgRows"),
        },
      });
      modal.remove();
      toast("Envío actualizado.", "ok");
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

async function editSale(id) {
  const { order } = await api(`/sales-orders/${id}`);
  const wholesale = isWholesale(order.order_type);
  openModal("Editar pedido", `
    <div class="form-grid">
      <div class="field"><label>Cliente</label><select class="select" id="esClient"><option value="">Mostrador</option>${(state.master.clients || []).map(c => `<option value="${c.id}" ${Number(order.client_id) === Number(c.id) ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></div>
      <div class="field"><label>Entrega</label><input class="input" id="esDelivery" type="date" value="${esc((order.delivery_date || "").slice(0, 10))}" /></div>
      ${wholesale ? `
      <div class="field"><label>Kg a entregar</label><input class="input" id="esKg" type="number" step="0.01" value="${esc(order.total_weight_kg || 0)}" /></div>
      <div class="field"><label>Precio por kg</label><input class="input" id="esPriceKg" type="number" step="0.01" value="${esc(order.price_per_kg || 0)}" /></div>
      <div class="field"><label>Total</label><input class="input" id="esTotal" type="number" step="0.01" value="${esc(order.total_amount || 0)}" /></div>` : `<div class="notice ok">Los totales de una venta de mostrador se calculan desde sus productos.</div>`}
    </div>
    <div class="field"><label>Notas</label><textarea class="textarea" id="esNotes">${esc(order.notes || "")}</textarea></div>
  `, [{
    label: "Guardar cambios",
    kind: "primary",
    onClick: async modal => {
      await api(`/sales-orders/${id}`, {
        method: "PUT",
        body: {
          client_id: val("esClient") || null,
          delivery_date: val("esDelivery") || null,
          notes: val("esNotes") || null,
          total_weight_kg: wholesale ? Number(val("esKg")) : Number(order.total_weight_kg || 0),
          price_per_kg: wholesale ? Number(val("esPriceKg")) : Number(order.price_per_kg || 0),
          total_amount: wholesale ? Number(val("esTotal")) : Number(order.total_amount || 0),
        },
      });
      modal.remove();
      toast("Pedido actualizado.", "ok");
      openSale(id);
    }
  }]);
  if (wholesale) {
    const kgEl = document.getElementById("esKg"), priceEl = document.getElementById("esPriceKg"), totalEl = document.getElementById("esTotal");
    const sync = () => { const k = Number(kgEl?.value || 0), p = Number(priceEl?.value || 0); if (totalEl && k > 0 && p > 0) totalEl.value = String(round2(k * p)); };
    kgEl?.addEventListener("input", sync); priceEl?.addEventListener("input", sync);
  }
}

function deleteSale(id) {
  if (!confirm("¿Eliminar este pedido? Se borran sus pagos y envíos; el inventario y los gastos de envío se revierten.")) return;
  api(`/sales-orders/${id}`, { method: "DELETE" })
    .then(() => { toast("Pedido eliminado.", "ok"); setView("sales"); })
    .catch(err => toast(err.message, "error"));
}

function newManualPurchase() {
  const modal = openModal("Nueva orden de compra", `
    <div class="notice ok">Solo podés comprar ítems definidos en Datos → Ítems (café, cajas, bolsas, insumos…).</div>
    <div class="form-grid">
      <div class="field"><label>Ítem a comprar</label><select class="select" id="poDesc">${catalogItemOptions()}</select></div>
      <div class="field"><label>Fecha</label><input class="input" id="poDate" type="date" value="${todayStr()}" /></div>
      <div class="field"><label>Proveedor</label>${supplierField("poSupplier")}</div>
      <div class="field"><label>Cantidad</label><input class="input" id="poKg" type="number" step="0.01" /></div>
      <div class="field"><label>Costo unitario estimado</label><input class="input" id="poCostKg" type="number" step="0.01" /></div>
      <div class="field"><label>Mercancía estimada total</label><input class="input" id="poCost" type="number" step="0.01" /></div>
      <div class="field"><label>Envío estimado compra</label><input class="input" id="poShip" type="number" step="0.01" value="0" /></div>
    </div>
    <div class="notice warn">Si al crear o ejecutar la compra no alcanza la caja disponible, el sistema dispara una orden de ingreso de capital.</div>
    <div class="field"><label>Notas</label><textarea class="textarea" id="poNotes"></textarea></div>
  `, [{
    label: "Crear OC",
    kind: "primary",
    onClick: async modal => {
      if (!val("poDesc")) throw new Error("Elegí un ítem del catálogo.");
      await api("/purchase-orders", {
        method: "POST",
        body: {
          description: val("poDesc"),
          purchase_date: val("poDate"),
          supplier: val("poSupplier") || null,
          requested_green_kg: Number(val("poKg")),
          estimated_cost_per_kg: Number(val("poCostKg")),
          estimated_cost: Number(val("poCost")),
          estimated_shipping_cost: Number(val("poShip")),
          notes: val("poNotes") || null,
        },
      });
      modal.remove();
      await refreshMaster(true);
      toast("OC creada. Si no alcanza caja, quedó en espera de capital.", "ok");
      setView("purchases");
    }
  }]);
  const m = modal.querySelector('.modal');
  const kgEl = m?.querySelector('#poKg'), unitEl = m?.querySelector('#poCostKg'), totalEl = m?.querySelector('#poCost');
  const sync = () => { const k = Number(kgEl?.value || 0), u = Number(unitEl?.value || 0); if (totalEl && k > 0 && u > 0) totalEl.value = String(round2(k * u)); };
  kgEl?.addEventListener('input', sync);
  unitEl?.addEventListener('input', sync);
}

function openPurchase(id) { setView("purchaseDetail", { id }); }

async function receivePurchase(poId) {
  const o = state.master.origins || [];
  const v = state.master.varieties || [];
  const { purchaseOrder: po } = await api(`/purchase-orders/${poId}`);
  const reqKg = round2(Number(po.requested_green_kg || 0));
  const estCost = round2(Number(po.estimated_cost || 0));
  const unitCost = reqKg > 0 ? round2(estCost / reqKg) : 0;
  const estShip = round2(Number(po.estimated_shipping_cost || 0));
  const modal = openModal("Ejecutar compra / recibir", `
    <div class="notice ok">Recibís <strong>${esc(po.description || "ítem")}</strong> de la orden <strong>${esc(po.po_no)}</strong>. Confirmá de dónde salió el dinero, quién registra y la fecha.</div>
    <div class="form-grid">
      <div class="field"><label>Cantidad recibida</label><input class="input" id="rcvKg" type="number" step="0.01" value="${esc(reqKg)}" /></div>
      <div class="field"><label>Costo unitario</label><input class="input" id="rcvUnitCost" type="number" step="0.01" value="${esc(unitCost)}" /></div>
      <div class="field"><label>Mercancía total</label><input class="input" id="rcvCost" type="number" step="0.01" value="${esc(estCost)}" readonly /></div>
      <div class="field"><label>Gastos de envío</label><input class="input" id="rcvShipCost" type="number" step="0.01" value="${esc(estShip)}" /></div>
      <div class="field"><label>¿De dónde salió el dinero?</label><select class="select" id="rcvSource">${moneySourceOptions()}</select></div>
      <div class="field"><label>Quién registra</label><select class="select" id="rcvBy">${personOptions()}</select></div>
      <div class="field"><label>Fecha</label><input class="input" id="rcvDate" type="date" value="${todayStr()}" /></div>
      <div class="field"><label>Proveedor</label>${supplierField("rcvSupplier", po.supplier || "")}</div>
    </div>
    <details style="margin-top:10px"><summary class="small muted" style="cursor:pointer">Detalles del café (opcional)</summary>
      <div class="form-grid" style="margin-top:8px">
        <div class="field"><label>Origen</label><select class="select" id="rcvOrigin"><option value="">-</option>${o.map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join("")}</select></div>
        <div class="field"><label>Variedad</label><select class="select" id="rcvVar"><option value="">-</option>${v.map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join("")}</select></div>
      </div>
    </details>
  `, [{
    label: "Ejecutar compra",
    kind: "primary",
    onClick: async modal => {
      const src = val("rcvSource");
      const fromCafetier = src === "Dinero Cafetier";
      await api(`/purchase-orders/${poId}/receive`, {
        method: "POST",
        body: {
          quantity_kg: Number(val("rcvKg")),
          entry_date: val("rcvDate"),
          unit_cost: Number(val("rcvUnitCost")),
          total_cost: Number(val("rcvCost")),
          shipping_cost: Number(val("rcvShipCost")),
          supplier: val("rcvSupplier") || null,
          origin_id: val("rcvOrigin") || null,
          variety_id: val("rcvVar") || null,
          registered_by: val("rcvBy"),
          funding_source: fromCafetier ? "business_account" : "partner_contribution",
          paid_from_account: src,
          partner_name: fromCafetier ? null : src,
        },
      });
      modal.remove();
      await refreshMaster(true);
      toast("Compra ejecutada.", "ok");
      openPurchase(poId);
    }
  }]);
  const modalEl = modal.querySelector('.modal');
  const kgEl = modalEl?.querySelector('#rcvKg');
  const unitEl = modalEl?.querySelector('#rcvUnitCost');
  const totalEl = modalEl?.querySelector('#rcvCost');
  const syncTotal = () => {
    const kg = Number(kgEl?.value || 0);
    const unit = Number(unitEl?.value || 0);
    if (totalEl && kg > 0 && unit > 0) totalEl.value = String(round2(kg * unit));
  };
  kgEl?.addEventListener('input', syncTotal);
  unitEl?.addEventListener('input', syncTotal);
}

async function editPurchase(id) {
  const { purchaseOrder: po } = await api(`/purchase-orders/${id}`);
  const names = (state.master.inventoryCatalog || []).map(i => i.name);
  const descOptions = (po.description && !names.includes(po.description) ? `<option value="${esc(po.description)}" selected>${esc(po.description)}</option>` : "") + catalogItemOptions(po.description || "");
  openModal("Editar orden de compra", `
    <div class="form-grid">
      <div class="field"><label>Ítem a comprar</label><select class="select" id="epDesc">${descOptions}</select></div>
      <div class="field"><label>Fecha</label><input class="input" id="epDate" type="date" value="${esc((po.created_at || todayStr()).slice(0, 10))}" /></div>
      <div class="field"><label>Proveedor</label>${supplierField("epSupplier", po.supplier || "")}</div>
      <div class="field"><label>Cantidad</label><input class="input" id="epKg" type="number" step="0.01" value="${esc(po.requested_green_kg || 0)}" /></div>
      <div class="field"><label>Mercancía estimada total</label><input class="input" id="epCost" type="number" step="0.01" value="${esc(po.estimated_cost || 0)}" /></div>
      <div class="field"><label>Envío estimado compra</label><input class="input" id="epShip" type="number" step="0.01" value="${esc(po.estimated_shipping_cost || 0)}" /></div>
    </div>
    <div class="field"><label>Notas</label><textarea class="textarea" id="epNotes">${esc(po.notes || "")}</textarea></div>
  `, [{
    label: "Guardar cambios",
    kind: "primary",
    onClick: async modal => {
      await api(`/purchase-orders/${id}`, {
        method: "PUT",
        body: {
          description: val("epDesc"),
          purchase_date: val("epDate"),
          supplier: val("epSupplier") || null,
          requested_green_kg: Number(val("epKg")),
          estimated_cost: Number(val("epCost")),
          estimated_shipping_cost: Number(val("epShip")),
          notes: val("epNotes") || null,
        },
      });
      modal.remove();
      toast("Orden de compra actualizada.", "ok");
      openPurchase(id);
    }
  }]);
}

function deletePurchase(id) {
  if (!confirm("¿Eliminar esta orden de compra? Si ya recibió café se cancelará para conservar el inventario y la contabilidad.")) return;
  api(`/purchase-orders/${id}`, { method: "DELETE" })
    .then(res => { toast(res && res.cancelled ? "Orden cancelada (tenía recepciones)." : "Orden eliminada.", "ok"); setView("purchases"); })
    .catch(err => toast(err.message, "error"));
}

async function editPurchaseEntry(entryId, poId) {
  const { purchaseOrder: po, entries } = await api(`/purchase-orders/${poId}`);
  const e = entries.find(x => Number(x.id) === Number(entryId));
  if (!e) { toast("Entrada no encontrada.", "error"); return; }
  const unit = round2(Number(e.unit_cost || (e.quantity_kg ? e.total_cost / e.quantity_kg : 0)));
  const source = e.funding_source === "partner_contribution" ? (e.paid_from_account || "Axel") : "Dinero Cafetier";
  const modal = openModal("Editar entrada recibida", `
    <div class="notice ok">Editás la recepción de <strong>${esc(po.description || "")}</strong> (${esc(po.po_no)}). Se ajustan inventario, gasto y aporte.</div>
    <div class="form-grid">
      <div class="field"><label>Cantidad recibida</label><input class="input" id="peKg" type="number" step="0.01" value="${esc(round2(e.quantity_kg))}" /></div>
      <div class="field"><label>Costo unitario</label><input class="input" id="peUnit" type="number" step="0.01" value="${esc(unit)}" /></div>
      <div class="field"><label>Mercancía total</label><input class="input" id="peCost" type="number" step="0.01" value="${esc(round2(e.total_cost))}" /></div>
      <div class="field"><label>Gastos de envío</label><input class="input" id="peShip" type="number" step="0.01" value="${esc(round2(e.shipping_cost || 0))}" /></div>
      <div class="field"><label>¿De dónde salió el dinero?</label><select class="select" id="peSource">${moneySourceOptions(source)}</select></div>
      <div class="field"><label>Quién registra</label><select class="select" id="peBy">${personOptions()}</select></div>
      <div class="field"><label>Fecha</label><input class="input" id="peDate" type="date" value="${esc((e.created_at || todayStr()).slice(0, 10))}" /></div>
      <div class="field"><label>Proveedor</label>${supplierField("peSupplier", e.supplier || "")}</div>
    </div>
  `, [{
    label: "Guardar cambios",
    kind: "primary",
    onClick: async modal => {
      const src = val("peSource");
      await api(`/purchase-entries/${entryId}`, {
        method: "PUT",
        body: {
          quantity_kg: Number(val("peKg")),
          total_cost: Number(val("peCost")),
          shipping_cost: Number(val("peShip")),
          funding_source: src === "Dinero Cafetier" ? "business_account" : "partner_contribution",
          paid_from_account: src,
          partner_name: src === "Dinero Cafetier" ? null : src,
          registered_by: val("peBy"),
          entry_date: val("peDate"),
          supplier: val("peSupplier") || null,
        },
      });
      modal.remove();
      toast("Entrada actualizada.", "ok");
      openPurchase(poId);
    }
  }]);
  const m = modal.querySelector(".modal");
  const kgEl = m?.querySelector("#peKg"), unitEl = m?.querySelector("#peUnit"), totalEl = m?.querySelector("#peCost");
  const sync = () => { const k = Number(kgEl?.value || 0), u = Number(unitEl?.value || 0); if (totalEl && k > 0 && u > 0) totalEl.value = String(round2(k * u)); };
  kgEl?.addEventListener("input", sync);
  unitEl?.addEventListener("input", sync);
}

function deletePurchaseEntry(entryId, poId) {
  if (!confirm("¿Eliminar esta entrada recibida? Se revierte del inventario y de la contabilidad.")) return;
  api(`/purchase-entries/${entryId}`, { method: "DELETE" })
    .then(() => { toast("Entrada eliminada.", "ok"); openPurchase(poId); })
    .catch(err => toast(err.message, "error"));
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
      <div class="field"><label>Cuenta donde quedó</label><select class="select" id="contribAccount">${accountOptions("Axel")}</select></div>
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
          received_account: val("contribAccount"),
          description: val("contribDesc"),
        },
      });
      modal.remove();
      toast("Aporte registrado.", "ok");
      setView("capital");
    }
  }]);
}

async function editContribution(id) {
  const all = await api("/capital-contributions");
  const c = all.find(x => Number(x.id) === Number(id));
  if (!c) { toast("Aporte no encontrado.", "error"); return; }
  openModal("Editar aporte de capital", `
    <div class="form-grid">
      <div class="field"><label>Socio</label><select class="select" id="ecPartner">${partnerOptions(c.partner_name)}</select></div>
      <div class="field"><label>Monto</label><input class="input" id="ecAmount" type="number" step="0.01" value="${esc(c.amount)}" /></div>
      <div class="field"><label>Fecha</label><input class="input" id="ecDate" type="date" value="${esc((c.contribution_date || "").slice(0, 10))}" /></div>
      <div class="field"><label>Cuenta que recibió</label><select class="select" id="ecAccount">${accountOptions(c.received_account || c.partner_name)}</select></div>
    </div>
    <div class="field"><label>Descripción</label><input class="input" id="ecDesc" value="${esc(c.description || "")}" /></div>
  `, [{
    label: "Guardar cambios",
    kind: "primary",
    onClick: async modal => {
      await api(`/capital-contributions/${id}`, { method: "PUT", body: { partner_name: val("ecPartner"), amount: Number(val("ecAmount")), contribution_date: val("ecDate"), received_account: val("ecAccount"), description: val("ecDesc") || "Aporte" } });
      modal.remove(); toast("Aporte actualizado.", "ok"); setView("capital");
    }
  }]);
}

function deleteContribution(id) {
  if (!confirm("¿Eliminar este aporte de capital?")) return;
  api(`/capital-contributions/${id}`, { method: "DELETE" })
    .then(() => { toast("Aporte eliminado.", "ok"); setView("capital"); })
    .catch(err => toast(err.message, "error"));
}

async function editWithdrawal(id) {
  const all = await api("/withdrawals");
  const w = all.find(x => Number(x.id) === Number(id));
  if (!w) { toast("Retiro no encontrado.", "error"); return; }
  openModal("Editar retiro", `
    <div class="form-grid">
      <div class="field"><label>Socio (recibe)</label><select class="select" id="ewPartner">${partnerOptions(w.partner_name)}</select></div>
      <div class="field"><label>Monto</label><input class="input" id="ewAmount" type="number" step="0.01" value="${esc(w.amount)}" /></div>
      <div class="field"><label>Fecha</label><input class="input" id="ewDate" type="date" value="${esc((w.created_at || "").slice(0, 10))}" /></div>
      <div class="field"><label>Sale de</label><select class="select" id="ewAccount">${accountOptions(w.paid_from_account || "Dinero Cafetier")}</select></div>
    </div>
    <div class="field"><label>Notas</label><input class="input" id="ewNotes" value="${esc(w.notes || "")}" /></div>
  `, [{
    label: "Guardar cambios",
    kind: "primary",
    onClick: async modal => {
      await api(`/cashbook/withdrawal/${id}`, { method: "PUT", body: { person: val("ewPartner"), amount: Number(val("ewAmount")), date: val("ewDate"), account: val("ewAccount"), detail: val("ewNotes") || null } });
      modal.remove(); toast("Retiro actualizado.", "ok"); setView("capital");
    }
  }]);
}

function deleteWithdrawal(id) {
  if (!confirm("¿Eliminar este retiro?")) return;
  api(`/withdrawals/${id}`, { method: "DELETE" })
    .then(() => { toast("Retiro eliminado.", "ok"); setView("capital"); })
    .catch(err => toast(err.message, "error"));
}

function newCapitalReturn() {
  openModal("Devolver capital", `
    <div class="form-grid">
      <div class="field"><label>Socio</label><select class="select" id="capRetPartner">${partnerOptions()}</select></div>
      <div class="field"><label>Monto</label><input class="input" id="capRetAmount" type="number" step="0.01" /></div>
      <div class="field"><label>Fecha</label><input class="input" id="capRetDate" type="date" value="${todayStr()}" /></div>
      <div class="field"><label>Sale de cuenta</label><select class="select" id="capRetAccount">${accountOptions("Dinero Cafetier")}</select></div>
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
          date: val("capRetDate"),
          paid_from_account: val("capRetAccount"),
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

function newPartnerAsset() {
  openModal("Activo personal de socio", `
    <div class="notice ok">Usalo para máquina, balanza, selladora u otra cosa que queda como propiedad de un socio. No baja utilidad ni genera deuda reembolsable.</div>
    <div class="form-grid">
      <div class="field"><label>Activo</label><input class="input" id="assetName" placeholder="Ej: Selladora" /></div>
      <div class="field"><label>Dueño</label><select class="select" id="assetOwner">${partnerOptions()}</select></div>
      <div class="field"><label>Comprado por</label><select class="select" id="assetBuyer">${partnerOptions()}</select></div>
      <div class="field"><label>Fecha</label><input class="input" id="assetDate" type="date" value="${new Date().toISOString().slice(0,10)}" /></div>
      <div class="field"><label>Monto referencial</label><input class="input" id="assetAmount" type="number" step="0.01" value="0" /></div>
      <div class="field"><label>Estado</label><select class="select" id="assetStatus"><option value="active">En uso</option><option value="returned">Devuelto</option><option value="sold">Vendido</option><option value="retired">Retirado</option></select></div>
    </div>
    <div class="field"><label>Notas</label><textarea class="textarea" id="assetNotes" placeholder="Ej: si se disuelve, se lo queda Itza"></textarea></div>
  `, [{
    label: "Guardar activo",
    kind: "primary",
    onClick: async modal => {
      await api("/partner-assets", {
        method: "POST",
        body: {
          asset_name: val("assetName"),
          owner_partner: val("assetOwner"),
          purchased_by: val("assetBuyer"),
          purchase_date: val("assetDate"),
          amount: Number(val("assetAmount")),
          status: val("assetStatus"),
          notes: val("assetNotes") || null,
        },
      });
      modal.remove();
      toast("Activo registrado sin afectar utilidades.", "ok");
      setView("capital");
    }
  }]);
}

function newRoastingSession() {
  openModal("Nueva sesión de tostado", `
    <div class="form-grid">
      <div class="field"><label>Fecha</label><input class="input" id="rsDate" type="date" value="${new Date().toISOString().slice(0,10)}" /></div>
      <div class="field"><label>Operador</label><select class="select" id="rsOperator">${roastOperatorOptions()}</select></div>
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
      <div class="field"><label>Pedido ligado</label><select class="select" id="batchSale"><option value="">Sin ligar</option>${sales.filter(s => isWholesale(s.order_type) && !isClosedStatus(s.status)).map(s => `<option value="${s.id}">${esc(s.order_no)} · ${esc(s.client_name || "")}</option>`).join("")}</select></div>
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
      <div class="field"><label>Pedido ligado</label><select class="select" id="ebatchSale"><option value="">Sin ligar</option>${sales.filter(s => isWholesale(s.order_type) && !isClosedStatus(s.status)).map(s => `<option value="${s.id}" ${Number(batch.sales_order_id) === Number(s.id) ? "selected" : ""}>${esc(s.order_no)} · ${esc(s.client_name || "")}</option>`).join("")}</select></div>
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

async function editRoastingSession(id) {
  const { session } = await api(`/roasting-sessions/${id}`);
  const ops = parseListSetting("roast_operators", ["Axel"]);
  if (session.operator && !ops.includes(session.operator)) ops.unshift(session.operator);
  openModal("Editar sesión de tostado", `
    <div class="form-grid">
      <div class="field"><label>Fecha</label><input class="input" id="ersDate" type="date" value="${esc((session.session_date || "").slice(0, 10))}" /></div>
      <div class="field"><label>Operador</label><select class="select" id="ersOperator">${ops.map(n => `<option value="${esc(n)}" ${n === session.operator ? "selected" : ""}>${esc(n)}</option>`).join("")}</select></div>
    </div>
    <div class="field"><label>Notas</label><textarea class="textarea" id="ersNotes">${esc(session.notes || "")}</textarea></div>
  `, [{
    label: "Guardar cambios",
    kind: "primary",
    onClick: async modal => {
      await api(`/roasting-sessions/${id}`, {
        method: "PUT",
        body: { session_date: val("ersDate"), operator: val("ersOperator"), notes: val("ersNotes") || null },
      });
      modal.remove();
      toast("Sesión actualizada.", "ok");
      openRoasting(id);
    }
  }]);
}

function deleteRoastingSession(id) {
  if (!confirm("¿Eliminar esta sesión de tostado?")) return;
  api(`/roasting-sessions/${id}`, { method: "DELETE" })
    .then(() => { toast("Sesión eliminada.", "ok"); setView("roasting"); })
    .catch(err => toast(err.message, "error"));
}


async function uploadArtisan(batchId, sessionId, input) {
  const file = input?.files?.[0];
  if (!file) return;
  const fd = new FormData();
  fd.append('file', file);
  try {
    const res = await fetch(`/api/roasting-batches/${batchId}/artisan`, { method: 'POST', body: fd });
    const payload = await res.json().catch(() => ({ success:false, error:'Respuesta inválida' }));
    if (!res.ok || payload.success === false) throw new Error(payload.error || 'No pude procesar la curva');
    toast(payload.data?.ai_review ? 'Curva analizada con Claude.' : 'Curva cargada.', 'ok');
    openRoasting(sessionId);
  } catch (err) {
    toast(err.message || String(err), 'error');
  } finally {
    input.value = '';
  }
}

async function uploadBatchPhoto(batchId, sessionId, input) {
  const files = Array.from(input?.files || []);
  if (!files.length) return;
  try {
    for (const file of files) {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`/api/roasting-batches/${batchId}/photos`, { method: 'POST', body: fd });
      const payload = await res.json().catch(() => ({ success:false, error:'Respuesta inválida' }));
      if (!res.ok || payload.success === false) throw new Error(payload.error || 'No pude subir la foto');
    }
    toast('Fotos cargadas.', 'ok');
    openRoasting(sessionId);
  } catch (err) {
    toast(err.message || String(err), 'error');
  } finally {
    input.value = '';
  }
}

function deleteBatchPhoto(photoId, batchId, sessionId) {
  if (!confirm('¿Quitar esta foto?')) return;
  api(`/batch-photos/${photoId}`, { method:'DELETE' })
    .then(() => { toast('Foto eliminada.', 'ok'); openRoasting(sessionId); })
    .catch(err => toast(err.message, 'error'));
}

function newInventoryItem() {
  const cat = state.master.inventoryCatalog || [];
  if (!cat.length) { toast("Primero definí ítems en Datos → Ítems.", "error"); setView("maestros", { mdTab: "items" }); return; }
  openModal("Agregar al inventario", `
    <div class="notice ok">Solo se cargan ítems definidos en Datos → Ítems. Origen y variedad aplican solo a café.</div>
    <div class="form-grid">
      <div class="field"><label>Ítem</label><select class="select" id="invCatalog">${cat.map(it => `<option value="${esc(it.name)}">${esc(it.name)}${it.category ? " · " + esc(it.category) : ""}</option>`).join("")}</select></div>
      <div class="field"><label>Cantidad inicial</label><input class="input" id="invQty" type="number" step="0.01" value="0" /></div>
      <div class="field"><label>Origen (café)</label><select class="select" id="invOrigin"><option value="">-</option>${state.master.origins.map(o => `<option value="${o.id}">${esc(o.name)}</option>`).join("")}</select></div>
      <div class="field"><label>Variedad (café)</label><select class="select" id="invVar"><option value="">-</option>${state.master.varieties.map(v => `<option value="${v.id}">${esc(v.name)}</option>`).join("")}</select></div>
    </div>
  `, [{
    label: "Agregar",
    kind: "primary",
    onClick: async modal => {
      await api("/inventory", {
        method: "POST",
        body: {
          item_name: val("invCatalog"),
          quantity: Number(val("invQty")),
          origin_id: val("invOrigin") || null,
          variety_id: val("invVar") || null,
        },
      });
      modal.remove();
      toast("Ítem agregado al inventario.", "ok");
      setView("inventory");
    }
  }]);
}

function inventoryCategoryOptions(selected = "") {
  return ["Café verde", "Café tostado", "Café empaquetado", "Empaque", "Consumible", "Marketing", "Insumo"].map(c => `<option value="${c}" ${c === selected ? "selected" : ""}>${c}</option>`).join("");
}

function newInventoryCatalogItem() {
  openModal("Nuevo ítem del catálogo", `
    <div class="form-grid">
      <div class="field"><label>Nombre</label><input class="input" id="icName" placeholder="Ej: Caja chica, Bolsa kraft 250g" /></div>
      <div class="field"><label>Categoría</label><select class="select" id="icCategory">${inventoryCategoryOptions("Empaque")}</select></div>
      <div class="field"><label>Unidad</label><input class="input" id="icUnit" value="pz" /></div>
      <div class="field"><label>Proveedor</label>${supplierField("icSupplier")}</div>
      <div class="field"><label>Stock mínimo</label><input class="input" id="icMin" type="number" step="0.01" value="0" /></div>
    </div>
  `, [{
    label: "Guardar",
    kind: "primary",
    onClick: async modal => {
      await api("/inventory-catalog", { method: "POST", body: { name: val("icName"), category: val("icCategory"), unit: val("icUnit") || "pz", supplier: val("icSupplier") || null, min_stock: Number(val("icMin")) } });
      modal.remove(); await refreshMaster(true); toast("Ítem creado.", "ok"); setView("maestros", { mdTab: "items" });
    }
  }]);
}

async function editInventoryCatalogItem(id) {
  const it = (state.master.inventoryCatalog || []).find(x => Number(x.id) === Number(id));
  if (!it) return;
  openModal("Editar ítem del catálogo", `
    <div class="form-grid">
      <div class="field"><label>Nombre</label><input class="input" id="icName" value="${esc(it.name)}" /></div>
      <div class="field"><label>Categoría</label><select class="select" id="icCategory">${inventoryCategoryOptions(it.category || "")}</select></div>
      <div class="field"><label>Unidad</label><input class="input" id="icUnit" value="${esc(it.unit || "pz")}" /></div>
      <div class="field"><label>Proveedor</label>${supplierField("icSupplier", it.supplier || "")}</div>
      <div class="field"><label>Stock mínimo</label><input class="input" id="icMin" type="number" step="0.01" value="${esc(it.min_stock || 0)}" /></div>
    </div>
  `, [{
    label: "Guardar cambios",
    kind: "primary",
    onClick: async modal => {
      await api(`/inventory-catalog/${id}`, { method: "PUT", body: { name: val("icName"), category: val("icCategory"), unit: val("icUnit") || "pz", supplier: val("icSupplier") || null, min_stock: Number(val("icMin")) } });
      modal.remove(); await refreshMaster(true); toast("Ítem actualizado.", "ok"); setView("maestros", { mdTab: "items" });
    }
  }]);
}

function deleteInventoryCatalogItem(id) {
  if (!confirm("¿Eliminar este ítem del catálogo?")) return;
  api(`/inventory-catalog/${id}`, { method: "DELETE" }).then(async () => { await refreshMaster(true); toast("Ítem eliminado.", "ok"); setView("maestros", { mdTab: "items" }); }).catch(err => toast(err.message, "error"));
}

function newInventoryMovement(itemId, itemName) {
  openModal(`Entrada / salida · ${itemName}`, `
    <p class="muted" style="margin-top:0">Registrá una <strong>entrada</strong> (compra/producción) o <strong>salida</strong> (venta/uso). Queda en el historial y ajusta el stock.</p>
    <div class="form-grid">
      <div class="field"><label>Movimiento</label><select class="select" id="mvType"><option value="in">Entrada (suma)</option><option value="out">Salida (resta)</option><option value="adjust">Ajuste a cantidad exacta</option></select></div>
      <div class="field"><label>Cantidad</label><input class="input" id="mvQty" type="number" step="0.01" /></div>
    </div>
    <div class="field"><label>Razón</label><input class="input" id="mvReason" /></div>
    <div class="field"><label>Registrado por</label><select class="select" id="mvBy">${personOptions()}</select></div>
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

async function editInventoryItem(id) {
  const items = await api("/inventory");
  const item = items.find(i => Number(i.id) === Number(id));
  if (!item) { toast("Ítem no encontrado.", "error"); return; }
  openModal("Editar ítem de inventario", `
    <div class="form-grid">
      <div class="field"><label>Nombre</label><input class="input" id="eiName" value="${esc(item.item_name || "")}" /></div>
      <div class="field"><label>Cantidad</label><input class="input" id="eiQty" type="number" step="0.01" value="${esc(item.quantity || 0)}" /></div>
      <div class="field"><label>Unidad</label><input class="input" id="eiUnit" value="${esc(item.unit || "kg")}" /></div>
      <div class="field"><label>Stock mínimo</label><input class="input" id="eiMin" type="number" step="0.01" value="${esc(item.min_stock || 0)}" /></div>
      <div class="field"><label>Origen</label><select class="select" id="eiOrigin"><option value="">-</option>${state.master.origins.map(o => `<option value="${o.id}" ${Number(item.origin_id) === Number(o.id) ? "selected" : ""}>${esc(o.name)}</option>`).join("")}</select></div>
      <div class="field"><label>Variedad</label><select class="select" id="eiVar"><option value="">-</option>${state.master.varieties.map(v => `<option value="${v.id}" ${Number(item.variety_id) === Number(v.id) ? "selected" : ""}>${esc(v.name)}</option>`).join("")}</select></div>
    </div>
    <div class="notice warn">Cambiar la cantidad acá corrige el stock directo, sin dejar rastro en el historial. Para entradas/salidas trazables usá "Entrada / salida".</div>
  `, [{
    label: "Guardar cambios",
    kind: "primary",
    onClick: async modal => {
      await api(`/inventory/${id}`, {
        method: "PUT",
        body: {
          item_name: val("eiName"),
          quantity: Number(val("eiQty")),
          unit: val("eiUnit") || "kg",
          min_stock: Number(val("eiMin")),
          lot_label: item.lot_label || null,
          origin_id: val("eiOrigin") || null,
          variety_id: val("eiVar") || null,
        },
      });
      modal.remove();
      toast("Ítem actualizado.", "ok");
      setView("inventory");
    }
  }]);
}

function newExpense() {
  openModal("Nuevo gasto", `
    <div class="notice ok">El dinero sale de una cuenta: <strong>Axel</strong> o <strong>Itza</strong> (queda como aporte para devolverles) o <strong>Dinero Cafetier</strong> (son utilidades del negocio).</div>
    <div class="form-grid">
      <div class="field"><label>Fecha</label><input class="input" id="expDate" type="date" value="${new Date().toISOString().slice(0,10)}" /></div>
      <div class="field"><label>Categoría</label><select class="select" id="expCat">${expenseCategoryOptions()}</select></div>
      <div class="field"><label>Monto</label><input class="input" id="expAmount" type="number" step="0.01" /></div>
      <div class="field"><label>¿De dónde salió el dinero?</label><select class="select" id="expSource">${moneySourceOptions()}</select></div>
      <div class="field"><label>Proveedor</label><input class="input" id="expSupplier" /></div>
      <div class="field"><label>Descripción</label><input class="input" id="expDesc" /></div>
    </div>
    <div class="field"><label>Notas</label><textarea class="textarea" id="expNotes"></textarea></div>
  `, [{
    label: "Guardar gasto",
    kind: "primary",
    onClick: async modal => {
      const src = val("expSource");
      await api("/expenses", {
        method: "POST",
        body: {
          expense_date: val("expDate"),
          category_id: Number(val("expCat")),
          amount: Number(val("expAmount")),
          funding_source: src === "Dinero Cafetier" ? "business_account" : "partner_contribution",
          paid_from_account: src,
          partner_name: src === "Dinero Cafetier" ? null : src,
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

async function editExpense(id) {
  const all = await api("/expenses");
  const e = all.find(x => Number(x.id) === Number(id));
  if (!e) { toast("Gasto no encontrado.", "error"); return; }
  if (e.auto_generated) { toast("Este gasto se generó automáticamente; editá su origen (envío o compra).", "error"); return; }
  const sel = (cur, v) => String(cur) === String(v) ? "selected" : "";
  const cats = (state.master.expenseCategories || []).map(c => `<option value="${c.id}" ${sel(e.category_id, c.id)}>${esc(c.name)}</option>`).join("");
  const currentSource = e.from_cashbox ? "Dinero Cafetier" : (e.paid_from_account || "Axel");
  openModal("Editar gasto", `
    <div class="notice ok">El dinero sale de una cuenta: <strong>Axel</strong> o <strong>Itza</strong> (queda como aporte para devolverles) o <strong>Dinero Cafetier</strong> (son utilidades).</div>
    <div class="form-grid">
      <div class="field"><label>Fecha</label><input class="input" id="eeDate" type="date" value="${esc((e.expense_date || "").slice(0, 10))}" /></div>
      <div class="field"><label>Categoría</label><select class="select" id="eeCat">${cats}</select></div>
      <div class="field"><label>Monto</label><input class="input" id="eeAmount" type="number" step="0.01" value="${esc(e.amount || 0)}" /></div>
      <div class="field"><label>¿De dónde salió el dinero?</label><select class="select" id="eeSource">${moneySourceOptions(currentSource)}</select></div>
      <div class="field"><label>Proveedor</label><input class="input" id="eeSupplier" value="${esc(e.supplier || "")}" /></div>
      <div class="field"><label>Descripción</label><input class="input" id="eeDesc" value="${esc(e.description || "")}" /></div>
    </div>
    <div class="field"><label>Notas</label><textarea class="textarea" id="eeNotes">${esc(e.notes || "")}</textarea></div>
  `, [{
    label: "Guardar cambios",
    kind: "primary",
    onClick: async modal => {
      const src = val("eeSource");
      await api(`/expenses/${id}`, {
        method: "PUT",
        body: {
          expense_date: val("eeDate"),
          category_id: Number(val("eeCat")),
          amount: Number(val("eeAmount")),
          funding_source: src === "Dinero Cafetier" ? "business_account" : "partner_contribution",
          paid_from_account: src,
          partner_name: src === "Dinero Cafetier" ? null : src,
          from_utilities: 0,
          supplier: val("eeSupplier") || null,
          description: val("eeDesc") || null,
          notes: val("eeNotes") || null,
        },
      });
      modal.remove();
      toast("Gasto actualizado.", "ok");
      setView("expenses");
    }
  }]);
}


async function saveSettings() {
  await api("/settings", {
    method: "PUT",
    body: {
      business_name: val("cfgBusiness"),
      business_tagline: val("cfgTagline"),
      default_loss_pct: val("cfgLoss"),
      default_green_cost_per_kg: val("cfgGreen"),
      claude_api_key: val("cfgClaude"),
    },
  });
  await refreshMaster(true);
  toast("Configuración guardada.", "ok");
}

async function addRoastOperator() {
  const current = parseListSetting("roast_operators", ["Axel"]);
  const name = (val("cfgNewOperator") || "").trim();
  if (!name) throw new Error("Escribe un nombre de operador.");
  if (!current.includes(name)) current.push(name);
  await api("/settings", { method: "PUT", body: { roast_operators: current.join("|") } });
  await refreshMaster(true);
  toast("Operador agregado.", "ok");
  setView("config");
}

async function removeRoastOperator(name) {
  const next = parseListSetting("roast_operators", ["Axel"]).filter(x => x !== name);
  await api("/settings", { method: "PUT", body: { roast_operators: next.join("|") } });
  await refreshMaster(true);
  toast("Operador quitado.", "ok");
  setView("config");
}

function newClient() {
  openModal("Nuevo cliente", `
    <div class="form-grid">
      <div class="field"><label>Nombre</label><input class="input" id="clName" /></div>
      <div class="field"><label>Nombre de la cafetería</label><input class="input" id="clCafe" /></div>
      <div class="field"><label>Encargado</label><input class="input" id="clContact" /></div>
      <div class="field"><label>Teléfono</label><input class="input" id="clPhone" /></div>
      <div class="field"><label>Teléfono encargado</label><input class="input" id="clContactPhone" /></div>
      <div class="field"><label>Email</label><input class="input" id="clEmail" /></div>
      <div class="field"><label>Ciudad</label><input class="input" id="clCity" /></div>
      <div class="field"><label>Código postal</label><input class="input" id="clPostal" /></div>
    </div>
    <div class="field"><label>Dirección completa</label><input class="input" id="clAddress" /></div>
    <div class="field"><label>Notas</label><textarea class="textarea" id="clNotes"></textarea></div>
  `, [{
    label: "Guardar",
    kind: "primary",
    onClick: async modal => {
      await api("/clients", {
        method: "POST",
        body: {
          name: val("clName"),
          cafe_name: val("clCafe") || null,
          contact_name: val("clContact") || null,
          phone: val("clPhone") || null,
          contact_phone: val("clContactPhone") || null,
          email: val("clEmail") || null,
          city: val("clCity") || null,
          postal_code: val("clPostal") || null,
          address: val("clAddress") || null,
          notes: val("clNotes") || null,
        },
      });
      modal.remove();
      await refreshMaster(true);
      toast("Cliente guardado.", "ok");
      setView("clients");
    }
  }]);
}

function clientFormPayload() {
  return {
    name: val("clName"),
    cafe_name: val("clCafe") || null,
    contact_name: val("clContact") || null,
    phone: val("clPhone") || null,
    contact_phone: val("clContactPhone") || null,
    email: val("clEmail") || null,
    address: val("clAddress") || null,
    neighborhood: val("clNeighborhood") || null,
    municipality: val("clMunicipality") || null,
    city: val("clCity") || null,
    state: val("clState") || null,
    country: val("clCountry") || null,
    postal_code: val("clPostal") || null,
    address_reference: val("clAddressRef") || null,
    notes: val("clNotes") || null,
  };
}

function openClientModal(client = null) {
  openModal(client ? "Editar cliente" : "Nuevo cliente", `
    <div class="form-grid">
      <div class="field"><label>Nombre</label><input class="input" id="clName" value="${esc(client?.name || "")}" /></div>
      <div class="field"><label>Nombre de la cafetería</label><input class="input" id="clCafe" value="${esc(client?.cafe_name || "")}" /></div>
      <div class="field"><label>Encargado</label><input class="input" id="clContact" value="${esc(client?.contact_name || "")}" /></div>
      <div class="field"><label>Teléfono</label><input class="input" id="clPhone" value="${esc(client?.phone || "")}" /></div>
      <div class="field"><label>Teléfono encargado</label><input class="input" id="clContactPhone" value="${esc(client?.contact_phone || "")}" /></div>
      <div class="field"><label>Email</label><input class="input" id="clEmail" value="${esc(client?.email || "")}" /></div>
      <div class="field"><label>Código postal</label><input class="input" id="clPostal" value="${esc(client?.postal_code || "")}" /></div>
      <div class="field"><label>Colonia</label><input class="input" id="clNeighborhood" value="${esc(client?.neighborhood || "")}" /></div>
      <div class="field"><label>Alcaldía / municipio</label><input class="input" id="clMunicipality" value="${esc(client?.municipality || "")}" /></div>
      <div class="field"><label>Ciudad</label><input class="input" id="clCity" value="${esc(client?.city || "")}" /></div>
      <div class="field"><label>Estado</label><input class="input" id="clState" value="${esc(client?.state || "")}" /></div>
      <div class="field"><label>País</label><input class="input" id="clCountry" value="${esc(client?.country || "México")}" /></div>
    </div>
    <div class="field"><label>Dirección completa / calle y número</label><input class="input" id="clAddress" value="${esc(client?.address || "")}" /></div>
    <div class="field"><label>Referencia de dirección</label><input class="input" id="clAddressRef" value="${esc(client?.address_reference || "")}" /></div>
    <div class="field"><label>Notas</label><textarea class="textarea" id="clNotes">${esc(client?.notes || "")}</textarea></div>
  `, [{
    label: "Guardar",
    kind: "primary",
    onClick: async modal => {
      await api(client ? `/clients/${client.id}` : "/clients", {
        method: client ? "PUT" : "POST",
        body: clientFormPayload(),
      });
      modal.remove();
      await refreshMaster(true);
      toast("Cliente guardado.", "ok");
      setView("clients");
    }
  }]);
}

function newClient() {
  openClientModal(null);
}

async function editClient(id) {
  const master = await refreshMaster(true);
  const client = (master.clients || []).find(c => Number(c.id) === Number(id));
  if (!client) throw new Error("Cliente no encontrado.");
  openClientModal(client);
}

function deleteClient(id) {
  if (!confirm("¿Eliminar cliente?")) return;
  api(`/clients/${id}`, { method: "DELETE" })
    .then(async () => { await refreshMaster(true); toast("Cliente eliminado.", "ok"); setView("clients"); })
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
      setView("maestros", { mdTab: "productos" });
    }
  }]);
}

function editProduct(id) {
  const p = (state.master.products || []).find(x => Number(x.id) === Number(id));
  if (!p) { toast("Producto no encontrado.", "error"); return; }
  const opts = (list, sel) => `<option value="">-</option>${(list || []).map(o => `<option value="${o.id}" ${Number(sel) === Number(o.id) ? "selected" : ""}>${esc(o.name)}</option>`).join("")}`;
  openModal("Editar producto", `
    <div class="form-grid">
      <div class="field"><label>Nombre</label><input class="input" id="eprName" value="${esc(p.name || "")}" /></div>
      <div class="field"><label>Presentación</label><input class="input" id="eprPresentation" value="${esc(p.presentation || "")}" placeholder="250g / 500g / 1kg / granel" /></div>
      <div class="field"><label>Peso unitario kg</label><input class="input" id="eprWeight" type="number" step="0.01" value="${esc(p.unit_weight_kg || 0)}" /></div>
      <div class="field"><label>Precio</label><input class="input" id="eprPrice" type="number" step="0.01" value="${esc(p.price || 0)}" /></div>
      <div class="field"><label>Origen</label><select class="select" id="eprOrigin">${opts(state.master.origins, p.origin_id)}</select></div>
      <div class="field"><label>Variedad</label><select class="select" id="eprVar">${opts(state.master.varieties, p.variety_id)}</select></div>
      <div class="field"><label>Perfil</label><select class="select" id="eprProfile">${opts(state.master.roastProfiles, p.roast_profile_id)}</select></div>
    </div>
  `, [{
    label: "Guardar cambios",
    kind: "primary",
    onClick: async modal => {
      await api(`/products/${id}`, {
        method: "PUT",
        body: {
          name: val("eprName"),
          presentation: val("eprPresentation") || null,
          unit_weight_kg: Number(val("eprWeight")),
          price: Number(val("eprPrice")),
          origin_id: val("eprOrigin") || null,
          variety_id: val("eprVar") || null,
          roast_profile_id: val("eprProfile") || null,
        },
      });
      modal.remove();
      await refreshMaster(true);
      toast("Producto actualizado.", "ok");
      setView("maestros", { mdTab: "productos" });
    }
  }]);
}

function deleteProduct(id) {
  if (!confirm("¿Eliminar producto?")) return;
  api(`/products/${id}`, { method: "DELETE" })
    .then(async () => { await refreshMaster(true); toast("Producto eliminado.", "ok"); setView("maestros", { mdTab: "productos" }); })
    .catch(err => toast(err.message, "error"));
}

function newCatalogItem(table, label) {
  const back = state.view === "maestros" ? { ...state.params } : {};
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
      setView("maestros", back);
    }
  }]);
}
const CATALOG_ROWS = { carriers: "carriers", roast_profiles: "roastProfiles", origins: "origins", varieties: "varieties", expense_categories: "expenseCategories" };
function editCatalogItem(table, id) {
  const rows = state.master[CATALOG_ROWS[table]] || [];
  const row = rows.find(r => Number(r.id) === Number(id));
  if (!row) { toast("No encontrado.", "error"); return; }
  const back = state.view === "maestros" ? { ...state.params } : {};
  openModal("Editar", `<div class="field"><label>Nombre</label><input class="input" id="catEditName" value="${esc(row.name)}" /></div>`, [{
    label: "Guardar",
    kind: "primary",
    onClick: async modal => {
      await api(`/${table}/${id}`, { method: "PUT", body: { name: val("catEditName") } });
      modal.remove();
      await refreshMaster(true);
      toast("Actualizado.", "ok");
      setView("maestros", back);
    }
  }]);
}
function deleteCatalogItem(table, id) {
  if (!confirm("¿Eliminar este elemento del catálogo?")) return;
  const back = state.view === "maestros" ? { ...state.params } : {};
  api(`/${table}/${id}`, { method: "DELETE" })
    .then(async () => { await refreshMaster(true); toast("Eliminado.", "ok"); setView("maestros", back); })
    .catch(err => toast(err.message, "error"));
}

function supplierModal(s) {
  const isEdit = !!s;
  return openModal(isEdit ? "Editar proveedor" : "Nuevo proveedor", `
    <div class="form-grid">
      <div class="field"><label>Nombre</label><input class="input" id="supName" value="${esc(s?.name || "")}" /></div>
      <div class="field"><label>Contacto</label><input class="input" id="supContact" value="${esc(s?.contact_name || "")}" /></div>
      <div class="field"><label>Teléfono</label><input class="input" id="supPhone" value="${esc(s?.phone || "")}" /></div>
      <div class="field"><label>Email</label><input class="input" id="supEmail" value="${esc(s?.email || "")}" /></div>
    </div>
    <div class="field"><label>Dirección</label><input class="input" id="supAddress" value="${esc(s?.address || "")}" /></div>
    <div class="field"><label>Notas</label><input class="input" id="supNotes" value="${esc(s?.notes || "")}" /></div>
  `, [{
    label: isEdit ? "Guardar cambios" : "Guardar",
    kind: "primary",
    onClick: async modal => {
      const payload = { name: val("supName"), contact_name: val("supContact"), phone: val("supPhone"), email: val("supEmail"), address: val("supAddress"), notes: val("supNotes") };
      await api(isEdit ? `/suppliers/${s.id}` : "/suppliers", { method: isEdit ? "PUT" : "POST", body: payload });
      modal.remove();
      await refreshMaster(true);
      toast("Proveedor guardado.", "ok");
      setView("maestros", { mdTab: "proveedores" });
    }
  }]);
}
function newSupplier() { supplierModal(null); }
function editSupplier(id) {
  const s = (state.master.suppliers || []).find(x => Number(x.id) === Number(id));
  if (!s) { toast("Proveedor no encontrado.", "error"); return; }
  supplierModal(s);
}
function deleteSupplier(id) {
  if (!confirm("¿Eliminar este proveedor?")) return;
  api(`/suppliers/${id}`, { method: "DELETE" })
    .then(async () => { await refreshMaster(true); toast("Proveedor eliminado.", "ok"); setView("maestros", { mdTab: "proveedores" }); })
    .catch(err => toast(err.message, "error"));
}

function openResetModal() {
  openModal("Reiniciar datos", `
    <div class="notice error">Vas a borrar datos de forma permanente. Hacelo solo si estás seguro.</div>
    <div class="field"><label>Alcance</label>
      <select class="select" id="rstScope">
        <option value="operativo">Operativo — borra ventas, compras, tostado, inventario, gastos y capital (conserva clientes, productos y catálogos)</option>
        <option value="todo">Todo — además borra clientes y productos</option>
      </select>
    </div>
    <div class="field"><label>Escribí REINICIAR para confirmar</label><input class="input" id="rstConfirm" placeholder="REINICIAR" /></div>
  `, [{
    label: "Reiniciar ahora",
    kind: "red",
    onClick: async modal => {
      if ((val("rstConfirm") || "").trim().toUpperCase() !== "REINICIAR") throw new Error("Escribí REINICIAR para confirmar.");
      await api("/admin/reset", { method: "POST", body: { scope: val("rstScope"), confirm: "REINICIAR" } });
      modal.remove();
      state.master = null;
      await refreshMaster(true);
      toast("Datos reiniciados.", "ok");
      setView("dashboard");
    }
  }]);
}

const App = {
  setView,
  render,
  filterTable,
  applyDashMonth,
  dashAll,
  newRetailSale,
  newWholesaleSale,
  openSale,
  editSale,
  deleteSale,
  addPayment,
  editPayment,
  deletePayment,
  addShipment,
  editShipment,
  deleteShipment,
  addPkgRow,
  newManualPurchase,
  openPurchase,
  editPurchase,
  deletePurchase,
  editPurchaseEntry,
  deletePurchaseEntry,
  receivePurchase,
  applyCashbookFilter,
  cashbookAll,
  editCashbookMovement,
  deleteCashbookMovement,
  applyExpenseMonth,
  toggleAllExpenses,
  newCapitalRequest,
  newContribution,
  editContribution,
  deleteContribution,
  editWithdrawal,
  deleteWithdrawal,
  newCapitalReturn,
  newDividendOrder,
  payDividendOrder,
  newPartnerAsset,
  newRoastingSession,
  editRoastingSession,
  deleteRoastingSession,
  openRoasting,
  newBatch,
  editBatch,
  deleteBatch,
  uploadArtisan,
  uploadBatchPhoto,
  deleteBatchPhoto,
  newInventoryItem,
  newInventoryCatalogItem,
  editInventoryCatalogItem,
  deleteInventoryCatalogItem,
  newInventoryMovement,
  editInventoryItem,
  deleteInventoryItem,
  newExpense,
  editExpense,
  deleteExpense,
  openResetModal,
  saveSettings,
  addRoastOperator,
  removeRoastOperator,
  newClient,
  editClient,
  deleteClient,
  newProduct,
  editProduct,
  deleteProduct,
  newCatalogItem,
  editCatalogItem,
  deleteCatalogItem,
  newSupplier,
  editSupplier,
  deleteSupplier,
};
window.App = App;

document.querySelectorAll(".nav-item").forEach(node => {
  node.addEventListener("click", () => setView(node.dataset.view));
});
// Mobile drawer nav.
document.getElementById("menuBtn")?.addEventListener("click", () => document.body.classList.toggle("nav-open"));
document.getElementById("navBackdrop")?.addEventListener("click", () => document.body.classList.remove("nav-open"));
// Ordenar cualquier tabla al hacer clic en el encabezado de columna (asc/desc).
const contentEl = document.getElementById("content");
contentEl.addEventListener("click", e => {
  const th = e.target.closest("table.table thead th");
  if (th) sortTableByColumn(th);
});
// Keep table cells labelled for the mobile card layout after every render.
new MutationObserver(() => decorateTables(contentEl)).observe(contentEl, { childList: true, subtree: true });
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
