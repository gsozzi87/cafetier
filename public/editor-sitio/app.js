const Editor = (() => {
  const state = {
    page: "homepage",
    config: null,
    active: "hero",
    dirty: false,
    visualReady: false,
  };

  const homeTabs = [
    { id: "hero", label: "Hero y slides" },
    { id: "pricing", label: "Precios" },
    { id: "origins", label: "Origenes" },
    { id: "logos", label: "Logos" },
    { id: "visual", label: "Todo editable" },
    { id: "content", label: "Contenido general" },
    { id: "structure", label: "Estructura" },
  ];
  const pageTabs = [
    { id: "content", label: "Textos" },
    { id: "media", label: "Fotos y links" },
    { id: "visual", label: "Todo editable" },
    { id: "structure", label: "Estructura" },
  ];
  const globalTabs = [
    { id: "brand", label: "Logo y marca" },
    { id: "logos", label: "Marcas" },
    { id: "whatsapp", label: "WhatsApp" },
  ];
  const pageOptions = () => [
    { id: "homepage", label: "Inicio", previewUrl: "/" },
    { id: "global", label: "Global: logo, marcas y WhatsApp", previewUrl: "/" },
    ...Object.entries(window.CAFETIER_PAGE_DEFS || {}).map(([id, def]) => ({ id, label: def.label, previewUrl: def.previewUrl }))
  ];

  const $ = selector => document.querySelector(selector);
  const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const clone = value => JSON.parse(JSON.stringify(value));
  const isHome = () => state.page === "homepage";
  const isGlobal = () => state.page === "global";
  const currentDef = () => window.CAFETIER_PAGE_DEFS?.[state.page];
  const currentPreviewUrl = () => isGlobal() || isHome() ? "/" : currentDef()?.previewUrl || "/";
  const currentLabel = () => isGlobal() ? "Global" : isHome() ? "Inicio" : currentDef()?.label || state.page;
  const defaultConfig = () => isGlobal()
    ? clone(window.CAFETIER_GLOBAL_DEFAULTS)
    : isHome()
    ? clone(window.CAFETIER_SITE_DEFAULTS)
    : clone(window.CAFETIER_PAGE_DEFAULTS[state.page]);

  const getPath = path => path.split(".").reduce((value, key) => value?.[key], state.config);
  const setPath = (path, value) => {
    const keys = path.split(".");
    let target = state.config;
    keys.slice(0, -1).forEach((key, index) => {
      if (target[key] === undefined) target[key] = /^\d+$/.test(keys[index + 1]) ? [] : {};
      target = target[key];
    });
    target[keys.at(-1)] = value;
  };

  async function api(path, options = {}) {
    const response = await fetch(`/api${path}`, options);
    const payload = await response.json();
    if (!response.ok || !payload.success) throw new Error(payload.error || "No se pudo completar la operacion");
    return payload.data;
  }

  function toast(message, kind = "ok") {
    const node = $("#editorToast");
    node.textContent = message;
    node.classList.toggle("is-error", kind === "error");
    node.classList.add("is-visible");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => node.classList.remove("is-visible"), 3200);
  }

  function setDirty(dirty = true) {
    state.dirty = dirty;
    $("#saveStatus").textContent = dirty ? "Cambios sin guardar" : "Todo guardado";
  }

  function field(label, path, options = {}) {
    const value = getPath(path) ?? "";
    const full = options.full ? " full" : "";
    const note = options.note ? `<small>${esc(options.note)}</small>` : "";
    if (options.textarea) {
      return `<label class="field${full}"><span>${esc(label)}</span><textarea data-path="${esc(path)}"${options.lines ? " data-lines=\"true\"" : ""}>${esc(options.lines && Array.isArray(value) ? value.join("\n") : value)}</textarea>${note}</label>`;
    }
    return `<label class="field${full}"><span>${esc(label)}</span><input type="${options.type || "text"}" data-path="${esc(path)}" value="${esc(value)}"${options.min !== undefined ? ` min="${options.min}"` : ""}${options.max !== undefined ? ` max="${options.max}"` : ""}>${note}</label>`;
  }

  function imageField(label, path, altPath) {
    const value = getPath(path) || "";
    return `
      <div class="field full">
        <span>${esc(label)}</span>
        <div class="image-field">
          <img class="image-preview" src="${esc(value)}" alt="">
          <div class="image-controls">
            <input type="text" data-path="${esc(path)}" value="${esc(value)}" aria-label="URL de ${esc(label)}">
            <label class="upload-button">Subir imagen<input type="file" accept="image/*" data-upload-path="${esc(path)}"></label>
            ${altPath ? `<input type="text" data-path="${esc(altPath)}" value="${esc(getPath(altPath) || "")}" placeholder="Texto alternativo">` : ""}
          </div>
        </div>
      </div>`;
  }

  function card(title, subtitle, content) {
    return `<section class="edit-card"><div class="edit-card-header"><h2>${esc(title)}</h2><span>${esc(subtitle || "")}</span></div>${content}</section>`;
  }

  function normalizeUrl(value) {
    if (!value) return "";
    try {
      const url = new URL(value, window.location.origin);
      return url.origin === window.location.origin ? `${url.pathname}${url.search}` : value;
    } catch {
      return value;
    }
  }

  function selectorForElement(element) {
    const doc = element.ownerDocument;
    const scopedRoot = element.closest("[data-edit-section],[data-site-section]") || doc.querySelector("main") || doc.body;
    const rootSelector = scopedRoot.dataset?.editSection
      ? `[data-edit-section="${scopedRoot.dataset.editSection}"]`
      : scopedRoot.dataset?.siteSection
        ? `[data-site-section="${scopedRoot.dataset.siteSection}"]`
        : scopedRoot.id
          ? `#${scopedRoot.id}`
          : "body";
    if (element === scopedRoot) return rootSelector;
    const parts = [];
    let node = element;
    while (node && node !== scopedRoot && node.parentElement) {
      const tag = node.tagName.toLowerCase();
      const siblings = [...node.parentElement.children].filter(child => child.tagName === node.tagName);
      parts.unshift(`${tag}:nth-of-type(${siblings.indexOf(node) + 1})`);
      node = node.parentElement;
    }
    return `${rootSelector} ${parts.join(" > ")}`;
  }

  function isVisibleElement(element) {
    const rect = element.getBoundingClientRect();
    const style = element.ownerDocument.defaultView.getComputedStyle(element);
    return rect.width > 1 && rect.height > 1 && style.display !== "none" && style.visibility !== "hidden";
  }

  function scanPreview() {
    const frame = $("#sitePreview");
    const doc = frame.contentDocument;
    if (!doc?.body) throw new Error("La vista previa todavia no esta lista.");
    const items = [];
    const seen = new Set();
    const add = item => {
      const key = `${item.type}|${item.selector}|${item.attr || ""}`;
      if (seen.has(key)) return;
      seen.add(key);
      items.push(item);
    };

    doc.querySelectorAll("main h1,main h2,main h3,main p,main li,main a,main button,main strong,main small,footer h2,footer a,footer span").forEach(node => {
      const text = node.textContent.trim().replace(/\s+/g, " ");
      if (!text || text.length < 2 || text.length > 260 || !isVisibleElement(node)) return;
      add({
        type: "text",
        group: node.closest("[data-edit-section],[data-site-section]")?.dataset.editSection || node.closest("[data-site-section]")?.dataset.siteSection || "General",
        label: `${node.tagName.toLowerCase()} · ${text.slice(0, 42)}`,
        selector: selectorForElement(node),
        value: text
      });
    });

    doc.querySelectorAll("main a[href],footer a[href]").forEach(node => {
      if (!isVisibleElement(node)) return;
      const text = node.textContent.trim().replace(/\s+/g, " ") || node.getAttribute("href");
      add({
        type: "link",
        group: node.closest("[data-edit-section],[data-site-section]")?.dataset.editSection || node.closest("[data-site-section]")?.dataset.siteSection || "Links",
        label: `Link · ${text.slice(0, 46)}`,
        selector: selectorForElement(node),
        value: normalizeUrl(node.href)
      });
    });

    doc.querySelectorAll("main img,footer img").forEach(node => {
      if (!isVisibleElement(node) || node.classList.contains("brand-mark")) return;
      add({
        type: "image",
        group: node.closest("[data-edit-section],[data-site-section]")?.dataset.editSection || node.closest("[data-site-section]")?.dataset.siteSection || "Imagenes",
        label: `Imagen · ${(node.alt || node.src.split("/").pop() || "sin titulo").slice(0, 46)}`,
        selector: selectorForElement(node),
        value: normalizeUrl(node.src),
        alt: node.alt || ""
      });
    });

    const existing = new Map((state.config.visualEdits || []).map(item => [`${item.type}|${item.selector}|${item.attr || ""}`, item]));
    state.config.visualEdits = items.map(item => ({ ...item, ...(existing.get(`${item.type}|${item.selector}|${item.attr || ""}`) || {}) }));
    state.visualReady = true;
  }

  function fieldForDef(def) {
    const valuePath = `fields.${def.id}.value`;
    if (def.type === "image") return imageField(def.label, valuePath, `fields.${def.id}.alt`);
    return field(def.label, valuePath, {
      textarea: def.type === "textarea" || def.type === "html",
      full: def.type === "textarea" || def.type === "html",
      note: def.type === "html" ? "Puedes usar <em>texto</em> para la linea dorada." : def.attr ? `Atributo: ${def.attr}` : ""
    });
  }

  function renderGenericContent() {
    const def = currentDef();
    const groups = new Map();
    def.fields
      .filter(item => item.type !== "image" && !item.attr)
      .forEach(item => {
        if (!groups.has(item.group)) groups.set(item.group, []);
        groups.get(item.group).push(item);
      });
    return [...groups.entries()].map(([group, fields]) => card(group, "Textos editables", `<div class="field-grid">${fields.map(fieldForDef).join("")}</div>`)).join("");
  }

  function renderGenericMedia() {
    const def = currentDef();
    const fields = def.fields.filter(item => item.type === "image" || item.attr);
    if (!fields.length) return `<div class="notice">Esta pagina no tiene medios o enlaces configurados.</div>`;
    const groups = new Map();
    fields.forEach(item => {
      if (!groups.has(item.group)) groups.set(item.group, []);
      groups.get(item.group).push(item);
    });
    return [...groups.entries()].map(([group, items]) => card(group, "Imagenes, videos o destinos", `<div class="field-grid">${items.map(fieldForDef).join("")}</div>`)).join("");
  }

  function renderHero() {
    return state.config.hero.slides.map((slide, index) => card(
      `Slide ${index + 1}`,
      index === 0 ? "Hogar" : index === 1 ? "Negocios" : "Proceso",
      `<div class="field-grid">
        ${field("Etiqueta", `hero.slides.${index}.eyebrow`)}
        ${field("Titulo principal", `hero.slides.${index}.title`)}
        ${field("Linea destacada", `hero.slides.${index}.emphasis`, { full: true })}
        ${field("Descripcion", `hero.slides.${index}.description`, { textarea: true, full: true })}
        ${imageField("Imagen de fondo", `hero.slides.${index}.image`, `hero.slides.${index}.imageAlt`)}
        ${field("Boton principal", `hero.slides.${index}.primaryLabel`)}
        ${field("Enlace principal", `hero.slides.${index}.primaryHref`)}
        ${field("Enlace secundario", `hero.slides.${index}.secondaryLabel`)}
        ${field("Destino secundario", `hero.slides.${index}.secondaryHref`)}
      </div>`
    )).join("");
  }

  function renderPricing() {
    const header = card("Encabezado de precios", "Texto de la seccion", `<div class="field-grid">
      ${field("Etiqueta", "pricing.eyebrow")}
      ${field("Titulo", "pricing.title")}
      ${field("Descripcion", "pricing.description", { textarea: true, full: true })}
      ${field("Nota legal", "pricing.note", { full: true })}
    </div>`);
    const tiers = state.config.pricing.tiers.map((tier, index) => card(
      tier.name,
      `Tier ${index + 1}`,
      `<div class="field-grid">
        ${field("Audiencia", `pricing.tiers.${index}.audience`)}
        ${field("Nombre", `pricing.tiers.${index}.name`)}
        ${field("Rango", `pricing.tiers.${index}.range`)}
        ${field("Precio", `pricing.tiers.${index}.price`)}
        ${field("Beneficios, uno por linea", `pricing.tiers.${index}.features`, { textarea: true, lines: true, full: true })}
        ${field("Texto del enlace", `pricing.tiers.${index}.cta`)}
        ${index === 1 ? field("Etiqueta destacada", `pricing.tiers.${index}.popular`) : ""}
      </div>`
    )).join("");
    return header + tiers;
  }

  function renderOrigins() {
    const header = card("Encabezado de origenes", "Carrusel", `<div class="field-grid">
      ${field("Etiqueta", "origins.eyebrow")}
      ${field("Titulo", "origins.title")}
      ${field("Descripcion", "origins.description", { textarea: true, full: true })}
    </div>`);
    const origins = state.config.origins.items.map((origin, index) => {
      const notes = origin.notes.map((note, noteIndex) => `<div class="note-box"><strong>Nota ${noteIndex + 1}</strong>${field("Nombre", `origins.items.${index}.notes.${noteIndex}.label`)}${field("Intensidad", `origins.items.${index}.notes.${noteIndex}.value`, { type: "number", min: 0, max: 100 })}</div>`).join("");
      return card(origin.name, `Origen ${index + 1}`, `<div class="field-grid">
        ${field("Nombre", `origins.items.${index}.name`)}
        ${field("Region", `origins.items.${index}.place`)}
        ${field("Descripcion", `origins.items.${index}.description`, { textarea: true, full: true })}
        ${imageField("Fotografia", `origins.items.${index}.image`, `origins.items.${index}.imageAlt`)}
        <div class="nested-grid full">${notes}</div>
        ${field("Texto del enlace", `origins.items.${index}.linkLabel`)}
        ${field("Destino", `origins.items.${index}.linkHref`)}
      </div>`);
    }).join("");
    return header + origins;
  }

  function renderContent() {
    const features = state.config.features.map((item, index) => `<div class="note-box"><strong>Diferencial ${index + 1}</strong>${field("Titulo", `features.${index}.title`)}${field("Texto", `features.${index}.copy`, { textarea: true })}</div>`).join("");
    const proof = state.config.proof.map((item, index) => field(`Compromiso ${index + 1}`, `proof.${index}`, { textarea: true })).join("");
    return card("Diferenciales", "Cuatro mensajes bajo el hero", `<div class="nested-grid">${features}</div>`) +
      card("Selector de cafe", "Introduccion", `<div class="field-grid">${field("Etiqueta", "finder.eyebrow")}${field("Titulo", "finder.title")}${field("Descripcion", "finder.description", { textarea: true, full: true })}</div>`) +
      card("Clientes", "Prueba social", `<div class="field-grid">${field("Etiqueta", "clients.eyebrow")}${field("Titulo", "clients.title")}${imageField("Imagen de logos", "clients.image")}</div>`) +
      card("Compromisos", "Franja final", `<div class="field-grid">${proof}</div>`);
  }

  function renderLogos() {
    const logos = state.config.clients.logos || [];
    const header = card("Marcas que confian en nosotros", "Logos individuales", `<div class="field-grid">
      ${field("Etiqueta", "clients.eyebrow")}
      ${field("Titulo", "clients.title")}
    </div>`);
    const list = logos.map((logo, index) => card(
      logo.name || `Logo ${index + 1}`,
      `Marca ${index + 1}`,
      `<div class="field-grid">
        ${field("Nombre", `clients.logos.${index}.name`)}
        ${field("Link opcional", `clients.logos.${index}.href`)}
        ${imageField("Logo", `clients.logos.${index}.image`)}
        <div class="collection-actions full">
          <button type="button" data-logo-move="up" data-logo-index="${index}" ${index === 0 ? "disabled" : ""}>Subir</button>
          <button type="button" data-logo-move="down" data-logo-index="${index}" ${index === logos.length - 1 ? "disabled" : ""}>Bajar</button>
          <button type="button" data-logo-remove="${index}">Quitar</button>
        </div>
      </div>`
    )).join("");
    return header + `<div class="notice">Cada logo puede ser texto o imagen. Si subes imagen, se muestra la imagen; si lo dejas vacio, se muestra el nombre.</div>` + list +
      `<button class="add-button" type="button" data-logo-add>Agregar marca</button>`;
  }

  function renderGlobalBrand() {
    return card("Identidad CAFETIER", "Header, footer y marca global", `<div class="field-grid">
      ${imageField("Logo principal", "brand.logo", "brand.logoAlt")}
    </div>`) +
      `<div class="notice">El logo debe ser una sola imagen completa. No se agrega texto aparte al lado del logo.</div>`;
  }

  function renderGlobalWhatsapp() {
    return card("Datos de WhatsApp", "Numero visible y enlace tecnico", `<div class="field-grid">
      ${field("Numero visible", "whatsapp.display")}
      ${field("Numero para wa.me", "whatsapp.number", { note: "Usa codigo de pais y solo numeros. Ejemplo: 522281698042." })}
    </div>`) +
      card("Mensajes predeterminados", "Textos que salen al abrir WhatsApp", `<div class="field-grid">
        ${field("Boton general del header", "whatsapp.genericMessage", { textarea: true, full: true })}
        ${field("Boton flotante movil", "whatsapp.floatingMessage", { textarea: true, full: true })}
        ${field("Pedido directo", "whatsapp.orderMessage", { textarea: true, full: true })}
        ${field("Cotizacion para negocio", "whatsapp.quoteMessage", { textarea: true, full: true })}
        ${field("Menudeo", "whatsapp.menudeoMessage", { textarea: true, full: true })}
        ${field("Medio mayoreo", "whatsapp.medioMessage", { textarea: true, full: true })}
        ${field("Mayoreo", "whatsapp.mayoreoMessage", { textarea: true, full: true })}
        ${field("Negocio a medida", "whatsapp.businessMessage", { textarea: true, full: true })}
        ${field("Resultado del selector", "whatsapp.finderMessage", { textarea: true, full: true, note: "Variables disponibles: {tier}, {range}, {price}, {profile}, {context}." })}
      </div>`);
  }

  function renderVisualEditor() {
    if (!state.visualReady) {
      return `<div class="notice">Escanea la vista previa para editar textos, links e imagenes visibles de esta pagina. Usa esto para tocar contenido que no aparezca en las pestañas principales.</div>
        <button class="add-button" type="button" data-scan-visual>Escanear pagina editable</button>`;
    }
    const edits = state.config.visualEdits || [];
    if (!edits.length) {
      return `<div class="notice">No encontre campos editables visibles. Prueba recargar la vista previa y escanear otra vez.</div>
        <button class="add-button" type="button" data-scan-visual>Volver a escanear</button>`;
    }
    const groups = new Map();
    edits.forEach((item, index) => {
      const group = item.group || "General";
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push({ item, index });
    });
    const cards = [...groups.entries()].map(([group, items]) => card(group, `${items.length} campos`, `<div class="field-grid">
      ${items.map(({ item, index }) => {
        if (item.type === "image") return imageField(item.label, `visualEdits.${index}.value`, `visualEdits.${index}.alt`);
        return field(item.label, `visualEdits.${index}.value`, {
          textarea: item.type === "text" && String(item.value || "").length > 80,
          full: item.type === "text" && String(item.value || "").length > 80,
          note: item.type === "link" ? item.selector : ""
        });
      }).join("")}
    </div>`)).join("");
    return `<button class="add-button" type="button" data-scan-visual>Actualizar escaneo</button>${cards}`;
  }

  function renderStructure() {
    const rows = state.config.sections.map((section, index) => `
      <div class="section-row">
        <span class="drag-index">${String(index + 1).padStart(2, "0")}</span>
        <span class="section-copy"><strong>${esc(section.label)}</strong><span>${esc(section.id)}</span></span>
        <label class="visibility-toggle"><input type="checkbox" data-section-visible="${esc(section.id)}" ${section.visible !== false ? "checked" : ""}> Visible</label>
        <span class="move-actions"><button type="button" data-move="up" data-section-id="${esc(section.id)}" ${index === 0 ? "disabled" : ""} aria-label="Subir seccion">&uarr;</button><button type="button" data-move="down" data-section-id="${esc(section.id)}" ${index === state.config.sections.length - 1 ? "disabled" : ""} aria-label="Bajar seccion">&darr;</button></span>
      </div>`).join("");
    return `<div class="notice">El orden se aplica de arriba hacia abajo. Puedes ocultar una seccion sin borrar su contenido.</div>${card("Orden y visibilidad", `Estructura de ${currentLabel()}`, rows)}`;
  }

  const homeRenderers = { hero: renderHero, pricing: renderPricing, origins: renderOrigins, logos: renderLogos, visual: renderVisualEditor, content: renderContent, structure: renderStructure };
  const genericRenderers = { content: renderGenericContent, media: renderGenericMedia, visual: renderVisualEditor, structure: renderStructure };
  const globalRenderers = { brand: renderGlobalBrand, logos: renderLogos, whatsapp: renderGlobalWhatsapp };
  const homeTitles = { hero: "Hero y slides", pricing: "Precios", origins: "Origenes", logos: "Logos de clientes", visual: "Todo editable", content: "Contenido general", structure: "Estructura de Inicio" };
  const genericTitles = { content: "Textos editables", media: "Fotos y enlaces", visual: "Todo editable", structure: "Estructura" };
  const globalTitles = { brand: "Logo global", logos: "Marcas editables", whatsapp: "WhatsApp y mensajes" };

  function renderNav() {
    const tabs = isGlobal() ? globalTabs : isHome() ? homeTabs : pageTabs;
    $("#editorNav").innerHTML = tabs.map(tab => `<button type="button" data-tab="${tab.id}" class="${tab.id === state.active ? "is-active" : ""}">${esc(tab.label)}</button>`).join("");
  }

  function render() {
    renderNav();
    const titles = isGlobal() ? globalTitles : isHome() ? homeTitles : genericTitles;
    const renderers = isGlobal() ? globalRenderers : isHome() ? homeRenderers : genericRenderers;
    $("#panelEyebrow").textContent = currentLabel();
    $("#panelTitle").textContent = titles[state.active];
    $("#editorContent").innerHTML = renderers[state.active]();
  }

  async function uploadImage(file, path) {
    $("#saveStatus").textContent = "Subiendo imagen...";
    const data = new FormData();
    data.append("file", file);
    const uploaded = await api("/site-media", { method: "POST", body: data });
    setPath(path, uploaded.url);
    setDirty(true);
    render();
    toast("Imagen subida. Guarda para publicarla.");
  }

  async function save() {
    const button = $("#saveButton");
    button.disabled = true;
    $("#saveStatus").textContent = "Guardando...";
    try {
      await api(`/site-content/${state.page}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: state.config }),
      });
      setDirty(false);
      $("#sitePreview").src = `${currentPreviewUrl()}?editor-preview=${Date.now()}`;
      toast(`Cambios publicados en ${currentLabel()}.`);
    } catch (error) {
      $("#saveStatus").textContent = "Error al guardar";
      toast(error.message, "error");
    } finally {
      button.disabled = false;
    }
  }

  function moveSection(id, direction) {
    const index = state.config.sections.findIndex(section => section.id === id);
    const target = direction === "up" ? index - 1 : index + 1;
    if (index < 0 || target < 0 || target >= state.config.sections.length) return;
    const [item] = state.config.sections.splice(index, 1);
    state.config.sections.splice(target, 0, item);
    setDirty(true);
    render();
  }

  function bindEvents() {
    $("#editorNav").addEventListener("click", event => {
      const button = event.target.closest("[data-tab]");
      if (!button) return;
      state.active = button.dataset.tab;
      render();
    });

    $("#editorContent").addEventListener("input", event => {
      const input = event.target.closest("[data-path]");
      if (!input) return;
      let value = input.value;
      if (input.dataset.lines === "true") value = value.split("\n").map(line => line.trim()).filter(Boolean);
      if (input.type === "number") value = Number(value);
      setPath(input.dataset.path, value);
      setDirty(true);
    });

    $("#editorContent").addEventListener("change", async event => {
      const upload = event.target.closest("[data-upload-path]");
      if (upload?.files?.[0]) {
        try { await uploadImage(upload.files[0], upload.dataset.uploadPath); }
        catch (error) { toast(error.message, "error"); setDirty(true); }
        return;
      }
      const visibility = event.target.closest("[data-section-visible]");
      if (visibility) {
        const section = state.config.sections.find(item => item.id === visibility.dataset.sectionVisible);
        if (section) section.visible = visibility.checked;
        setDirty(true);
      }
    });

    $("#editorContent").addEventListener("click", event => {
      const scan = event.target.closest("[data-scan-visual]");
      if (scan) {
        try {
          scanPreview();
          render();
          toast("Pagina escaneada. Edita y guarda para publicar.");
        } catch (error) {
          toast(error.message, "error");
        }
        return;
      }
      const addLogo = event.target.closest("[data-logo-add]");
      if (addLogo) {
        if (!state.config.clients.logos) state.config.clients.logos = [];
        state.config.clients.logos.push({ name: "Nueva marca", image: "", href: "" });
        setDirty(true);
        render();
        return;
      }
      const removeLogo = event.target.closest("[data-logo-remove]");
      if (removeLogo) {
        state.config.clients.logos.splice(Number(removeLogo.dataset.logoRemove), 1);
        setDirty(true);
        render();
        return;
      }
      const moveLogo = event.target.closest("[data-logo-move]");
      if (moveLogo) {
        const index = Number(moveLogo.dataset.logoIndex);
        const target = moveLogo.dataset.logoMove === "up" ? index - 1 : index + 1;
        if (target >= 0 && target < state.config.clients.logos.length) {
          const [item] = state.config.clients.logos.splice(index, 1);
          state.config.clients.logos.splice(target, 0, item);
          setDirty(true);
          render();
        }
        return;
      }
      const move = event.target.closest("[data-move]");
      if (move) moveSection(move.dataset.sectionId, move.dataset.move);
    });

    $("#saveButton").addEventListener("click", save);
    $("#resetButton").addEventListener("click", () => {
      state.config = defaultConfig();
      setDirty(true);
      render();
      toast("Valores restaurados en el editor. Guarda para publicarlos.");
    });
    $("#pageSelect").addEventListener("change", async event => {
      if (state.dirty && !confirm("Tienes cambios sin guardar. Cambiar de pagina los descarta en esta sesion.")) {
        event.target.value = state.page;
        return;
      }
      await loadPage(event.target.value);
    });
    document.querySelectorAll("[data-preview-size]").forEach(button => button.addEventListener("click", () => {
      document.querySelectorAll("[data-preview-size]").forEach(item => item.classList.toggle("is-active", item === button));
      $("#previewWrap").classList.toggle("is-mobile", button.dataset.previewSize === "mobile");
    }));
  }

  async function loadPage(pageId) {
    state.page = pageId;
    state.active = pageId === "global" ? "brand" : pageId === "homepage" ? "hero" : "content";
    state.visualReady = false;
    $("#pageSelect").value = pageId;
    $("#sitePreview").src = currentPreviewUrl();
    $("#saveStatus").textContent = "Cargando...";
    try {
      const stored = await api(`/site-content/${pageId}`);
      const base = pageId === "global"
        ? window.CAFETIER_GLOBAL_DEFAULTS
        : pageId === "homepage"
          ? window.CAFETIER_SITE_DEFAULTS
          : window.CAFETIER_PAGE_DEFAULTS[pageId];
      state.config = window.CAFETIER_SITE_MERGE(base, stored?.content || {});
      setDirty(false);
      render();
    } catch (error) {
      state.config = defaultConfig();
      $("#saveStatus").textContent = "Usando valores locales";
      render();
      toast(error.message, "error");
    }
  }

  async function init() {
    $("#pageSelect").innerHTML = pageOptions().map(page => `<option value="${esc(page.id)}">${esc(page.label)}</option>`).join("");
    bindEvents();
    await loadPage(state.page);
  }

  return { init };
})();

Editor.init();
