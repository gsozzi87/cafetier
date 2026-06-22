(function () {
  const defaults = {
    version: 1,
    sections: [
      { id: "hero", label: "Hero", visible: true },
      { id: "features", label: "Diferenciales", visible: true },
      { id: "pricing", label: "Precios", visible: true },
      { id: "origins", label: "Orígenes", visible: true },
      { id: "finder", label: "Encuentra tu café", visible: true },
      { id: "clients", label: "Clientes", visible: true },
      { id: "proof", label: "Compromisos", visible: true }
    ],
    hero: {
      slides: [
        {
          eyebrow: "Café para el hogar",
          title: "Café mexicano",
          emphasis: "para volver a tu taza.",
          description: "Tostado fresco, perfil balanceado y la misma calidad lote tras lote.",
          image: "/assets/hero-coffee.png",
          imageAlt: "Bolsa CAFETIER entre granos de café tostado",
          primaryLabel: "Ver presentaciones",
          primaryHref: "#precios",
          secondaryLabel: "Encuentra tu café",
          secondaryHref: "#encuentra-tu-cafe"
        },
        {
          eyebrow: "Para negocios",
          title: "Consistencia",
          emphasis: "en cada servicio.",
          description: "Abasto confiable, tueste estable y acompañamiento para cafeterías, oficinas y restaurantes.",
          image: "/assets/business-hero.png",
          imageAlt: "Barista sirviendo café CAFETIER en una barra",
          primaryLabel: "Soluciones para negocios",
          primaryHref: "/para-negocios/",
          secondaryLabel: "Cotizar",
          secondaryHref: "https://wa.me/522281698042?text=Hola%20Cafetier%2C%20quiero%20cotizar%20cafe%20para%20mi%20negocio"
        },
        {
          eyebrow: "Nuestro proceso",
          title: "Precisión",
          emphasis: "detrás de cada lote.",
          description: "Medimos tiempo, temperatura y desarrollo para repetir el perfil que hace reconocible a CAFETIER.",
          image: "/assets/process-hero.png",
          imageAlt: "Tostadora CAFETIER descargando café recién tostado",
          primaryLabel: "Conoce el proceso",
          primaryHref: "/proceso/",
          secondaryLabel: "Origen y perfil",
          secondaryHref: "/nuestro-cafe/"
        }
      ]
    },
    features: [
      { title: "Tostado fresco", copy: "Lotes pequeños para conservar frescura en cada entrega." },
      { title: "Tueste de precisión", copy: "Perfiles diseñados para resaltar el origen del grano." },
      { title: "Calidad constante", copy: "Estandarización para un sabor reconocible lote tras lote." },
      { title: "De origen a tu taza", copy: "Productores mexicanos, selección cuidadosa y entrega puntual." }
    ],
    pricing: {
      eyebrow: "Compra por volumen",
      title: "Tres formas de llevar CAFETIER.",
      description: "Compara de un vistazo y elige el volumen que mejor acompaña tu consumo.",
      note: "Precios por kilogramo, IVA incluido. Sujetos a cambios sin previo aviso.",
      tiers: [
        { audience: "Para casa", name: "Menudeo", range: "Menos de 9 kg", price: "$400", features: ["Compra flexible", "Tostado fresco", "Ideal para consumo diario"], cta: "Elegir menudeo" },
        { audience: "Para equipos", name: "Medio mayoreo", range: "10 - 24 kg", price: "$350", features: ["Mejor precio por volumen", "Abasto para oficina o equipo", "Entrega coordinada"], cta: "Elegir medio mayoreo", popular: "Más popular" },
        { audience: "Para negocios", name: "Mayoreo", range: "Más de 25 kg", price: "$320", features: ["Precio preferencial", "Planeación de inventario", "Atención para negocios"], cta: "Elegir mayoreo" }
      ]
    },
    origins: {
      eyebrow: "Origen mexicano",
      title: "Dos regiones. Dos perfiles.",
      description: "Explora el carácter de cada origen y encuentra las notas que más disfrutas.",
      items: [
        {
          name: "Chiapas",
          place: "Jaltenango - Sierra Madre",
          description: "Cuerpo sedoso, dulzor prolongado y una taza limpia que funciona tanto sola como con leche.",
          image: "/assets/chiapas-hero.png",
          imageAlt: "Cafetales de Chiapas con cerezas maduras",
          notes: [{ label: "Chocolate", value: 88 }, { label: "Caramelo", value: 82 }, { label: "Cítrico", value: 46 }],
          linkLabel: "Conocer Chiapas",
          linkHref: "/nuestro-cafe/"
        },
        {
          name: "Veracruz",
          place: "Altas Montañas - Veracruz",
          description: "Aromático y balanceado, con acidez amable, textura redonda y final de nuez.",
          image: "/assets/origin-coffee.png",
          imageAlt: "Cerezas de café mexicano recién cosechadas",
          notes: [{ label: "Cacao", value: 78 }, { label: "Nuez", value: 72 }, { label: "Cítrico", value: 64 }],
          linkLabel: "Preguntar por Veracruz",
          linkHref: "https://wa.me/522281698042?text=Hola%20Cafetier%2C%20quiero%20conocer%20el%20cafe%20de%20Veracruz"
        }
      ]
    },
    finder: {
      eyebrow: "Encuentra tu café",
      title: "Tres preguntas. Una recomendación hecha para ti.",
      description: "Elige cómo consumes café, cuánto necesitas y el perfil que prefieres. Al final te preparamos el mensaje para WhatsApp."
    },
    clients: {
      eyebrow: "Confían en CAFETIER",
      title: "Del café de barrio a grandes equipos.",
      image: "/assets/orders-clients.png"
    },
    proof: [
      "Granos seleccionados de productores mexicanos.",
      "Tueste controlado para repetir el mismo perfil.",
      "Entregas coordinadas en todo México.",
      "Calidad comprobada antes de cada entrega."
    ]
  };

  const clone = value => JSON.parse(JSON.stringify(value));
  const merge = (base, incoming) => {
    if (Array.isArray(incoming)) return clone(incoming);
    if (!incoming || typeof incoming !== "object") return incoming === undefined ? clone(base) : incoming;
    const result = { ...(base && typeof base === "object" ? clone(base) : {}) };
    Object.keys(incoming).forEach(key => {
      result[key] = merge(base?.[key], incoming[key]);
    });
    return result;
  };

  const setText = (root, selector, value) => {
    const node = root.querySelector(selector);
    if (node && value !== undefined) node.textContent = String(value);
  };
  const setLeadText = (node, value) => {
    if (!node || value === undefined) return;
    const textNode = [...node.childNodes].find(child => child.nodeType === 3);
    if (textNode) textNode.nodeValue = `${value} `;
    else node.prepend(document.createTextNode(`${value} `));
  };

  const apply = input => {
    const config = merge(defaults, input || {});
    const root = document;

    config.hero.slides.forEach((item, index) => {
      const slide = root.querySelector(`.home-slide[data-slide="${index}"]`);
      if (!slide) return;
      setText(slide, ".eyebrow", item.eyebrow);
      setText(slide, ".title-main", item.title);
      setText(slide, ".showcase-copy h1 em, .showcase-copy h2 em", item.emphasis);
      setText(slide, ".showcase-copy>p:not(.eyebrow)", item.description);
      const image = slide.querySelector(":scope>img");
      if (image) { image.src = item.image; image.alt = item.imageAlt || ""; }
      const links = slide.querySelectorAll(".showcase-actions a");
      if (links[0]) { links[0].textContent = item.primaryLabel; links[0].href = item.primaryHref; }
      if (links[1]) { setLeadText(links[1], item.secondaryLabel); links[1].href = item.secondaryHref; }
    });

    config.features.forEach((item, index) => {
      const card = root.querySelectorAll(".home-features article")[index];
      if (!card) return;
      setText(card, "h3", item.title);
      setText(card, "p", item.copy);
    });

    setText(root, ".home-pricing .home-section-heading .eyebrow", config.pricing.eyebrow);
    setText(root, ".home-pricing .home-section-heading h2", config.pricing.title);
    setText(root, ".home-pricing .home-section-heading>p", config.pricing.description);
    setText(root, ".pricing-note", config.pricing.note);
    config.pricing.tiers.forEach((item, index) => {
      const card = root.querySelectorAll(".price-tier")[index];
      if (!card) return;
      setText(card, ".tier-top p", item.audience);
      setText(card, "h3", item.name);
      setText(card, ".tier-range", item.range);
      setText(card, ".tier-price strong", item.price);
      setText(card, ".popular-label", item.popular || "Más popular");
      const list = card.querySelector("ul");
      if (list) {
        list.replaceChildren(...item.features.map(feature => {
          const li = document.createElement("li");
          li.textContent = feature;
          return li;
        }));
      }
      setLeadText(card.querySelector(":scope>a"), item.cta);
    });

    setText(root, ".home-origins .home-section-heading .eyebrow", config.origins.eyebrow);
    setText(root, ".home-origins .home-section-heading h2", config.origins.title);
    setText(root, ".home-origins .home-section-heading>p", config.origins.description);
    config.origins.items.forEach((item, index) => {
      const slide = root.querySelector(`.origin-slide[data-origin-slide="${index}"]`);
      if (!slide) return;
      setText(slide, "h3", item.name);
      setText(slide, ".origin-place", item.place);
      setText(slide, ".origin-details>p:not(.origin-number):not(.origin-place)", item.description);
      const image = slide.querySelector("figure img");
      if (image) { image.src = item.image; image.alt = item.imageAlt || ""; }
      const notes = slide.querySelectorAll(".tasting-profile>div");
      item.notes.forEach((note, noteIndex) => {
        const noteRow = notes[noteIndex];
        if (!noteRow) return;
        setText(noteRow, "span", note.label);
        const bar = noteRow.querySelector("b");
        if (bar) bar.style.setProperty("--taste", `${Math.max(0, Math.min(100, Number(note.value) || 0))}%`);
      });
      const link = slide.querySelector(".origin-details>a");
      if (link) { setLeadText(link, item.linkLabel); link.href = item.linkHref; }
    });

    setText(root, ".finder-intro .eyebrow", config.finder.eyebrow);
    setText(root, ".finder-intro h2", config.finder.title);
    setText(root, ".finder-intro>p:not(.eyebrow)", config.finder.description);
    setText(root, ".clients-heading .eyebrow", config.clients.eyebrow);
    setText(root, ".clients-heading h2", config.clients.title);
    root.querySelectorAll(".clients-track img").forEach(image => { image.src = config.clients.image; });
    config.proof.forEach((copy, index) => setText(root.querySelectorAll(".home-proof article")[index] || root, "p", copy));

    const main = root.querySelector("main#inicio");
    if (main) {
      const sectionMap = new Map([...main.querySelectorAll(":scope>[data-site-section]")].map(node => [node.dataset.siteSection, node]));
      config.sections.forEach(section => {
        const node = sectionMap.get(section.id);
        if (!node) return;
        node.hidden = section.visible === false;
        main.appendChild(node);
      });
    }

    window.CAFETIER_SITE_CONFIG = config;
    return config;
  };

  window.CAFETIER_SITE_DEFAULTS = defaults;
  window.CAFETIER_SITE_MERGE = merge;
  window.applyCafetierSiteContent = apply;
})();
