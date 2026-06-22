const Editor = (() => {
  const state = {
    config: null,
    active: "hero",
    dirty: false,
  };

  const tabs = [
    { id: "hero", label: "Hero y slides" },
    { id: "pricing", label: "Precios" },
    { id: "origins", label: "Origenes" },
    { id: "content", label: "Contenido general" },
    { id: "structure", label: "Estructura" },
  ];

  const $ = selector => document.querySelector(selector);
  const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const clone = value => JSON.parse(JSON.stringify(value));

  const getPath = path => path.split(".").reduce((value, key) => value?.[key], state.config);
  const setPath = (path, value) => {
    const keys = path.split(".");
    let target = state.config;
    keys.slice(0, -1).forEach(key => { target = target[key]; });
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

  function renderStructure() {
    const rows = state.config.sections.map((section, index) => `
      <div class="section-row">
        <span class="drag-index">${String(index + 1).padStart(2, "0")}</span>
        <span class="section-copy"><strong>${esc(section.label)}</strong><span>${esc(section.id)}</span></span>
        <label class="visibility-toggle"><input type="checkbox" data-section-visible="${esc(section.id)}" ${section.visible !== false ? "checked" : ""}> Visible</label>
        <span class="move-actions"><button type="button" data-move="up" data-section-id="${esc(section.id)}" ${index === 0 ? "disabled" : ""} aria-label="Subir seccion">&uarr;</button><button type="button" data-move="down" data-section-id="${esc(section.id)}" ${index === state.config.sections.length - 1 ? "disabled" : ""} aria-label="Bajar seccion">&darr;</button></span>
      </div>`).join("");
    return `<div class="notice">El orden se aplica de arriba hacia abajo. Puedes ocultar una seccion sin borrar su contenido.</div>${card("Orden y visibilidad", "Estructura de Inicio", rows)}`;
  }

  const renderers = { hero: renderHero, pricing: renderPricing, origins: renderOrigins, content: renderContent, structure: renderStructure };
  const titles = { hero: "Hero y slides", pricing: "Precios", origins: "Origenes", content: "Contenido general", structure: "Estructura de Inicio" };

  function renderNav() {
    $("#editorNav").innerHTML = tabs.map(tab => `<button type="button" data-tab="${tab.id}" class="${tab.id === state.active ? "is-active" : ""}">${esc(tab.label)}</button>`).join("");
  }

  function render() {
    renderNav();
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
      await api("/site-content/homepage", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: state.config }),
      });
      setDirty(false);
      $("#sitePreview").src = `/?editor-preview=${Date.now()}`;
      toast("Cambios publicados en Inicio.");
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
      const move = event.target.closest("[data-move]");
      if (move) moveSection(move.dataset.sectionId, move.dataset.move);
    });

    $("#saveButton").addEventListener("click", save);
    $("#resetButton").addEventListener("click", () => {
      state.config = clone(window.CAFETIER_SITE_DEFAULTS);
      setDirty(true);
      render();
      toast("Valores restaurados en el editor. Guarda para publicarlos.");
    });
    document.querySelectorAll("[data-preview-size]").forEach(button => button.addEventListener("click", () => {
      document.querySelectorAll("[data-preview-size]").forEach(item => item.classList.toggle("is-active", item === button));
      $("#previewWrap").classList.toggle("is-mobile", button.dataset.previewSize === "mobile");
    }));
  }

  async function init() {
    bindEvents();
    try {
      const stored = await api("/site-content/homepage");
      state.config = window.CAFETIER_SITE_MERGE(window.CAFETIER_SITE_DEFAULTS, stored?.content || {});
      setDirty(false);
      render();
    } catch (error) {
      state.config = clone(window.CAFETIER_SITE_DEFAULTS);
      $("#saveStatus").textContent = "Usando valores locales";
      render();
      toast(error.message, "error");
    }
  }

  return { init };
})();

Editor.init();
