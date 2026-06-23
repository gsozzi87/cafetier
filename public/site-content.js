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
      image: "/assets/orders-clients.png",
      logos: [
        { name: "Matricaria", image: "", href: "" },
        { name: "Cafele", image: "", href: "" },
        { name: "Instituto de Física UNAM", image: "", href: "" },
        { name: "Nuupe", image: "", href: "" },
        { name: "Café Origen", image: "", href: "" },
        { name: "Senda", image: "", href: "" },
        { name: "Árbol Rojo", image: "", href: "" }
      ]
    },
    visualEdits: [],
    proof: [
      "Granos seleccionados de productores mexicanos.",
      "Tueste controlado para repetir el mismo perfil.",
      "Entregas coordinadas en todo México.",
      "Calidad comprobada antes de cada entrega."
    ]
  };

  const globalDefaults = {
    version: 1,
    brand: {
      logo: "/assets/cafetier-logo.svg",
      logoAlt: "",
      name: "CAFETIER",
      tagline: "Culto por el cafe"
    },
    clients: {
      eyebrow: "Confian en CAFETIER",
      title: "Marcas que confian en nosotros",
      logos: [
        { name: "Matricaria", image: "", href: "" },
        { name: "Cafele", image: "", href: "" },
        { name: "Instituto de Fisica UNAM", image: "", href: "" },
        { name: "Nuupe", image: "", href: "" },
        { name: "Cafe Origen", image: "", href: "" },
        { name: "Senda", image: "", href: "" },
        { name: "Arbol Rojo", image: "", href: "" }
      ]
    },
    whatsapp: {
      display: "228 169 8042",
      number: "522281698042",
      genericMessage: "Hola Cafetier, quiero informacion sobre su cafe",
      floatingMessage: "Hola Cafetier, quiero pedir cafe",
      orderMessage: "Hola Cafetier, quiero hacer un pedido. Les cuento lo que necesito:",
      quoteMessage: "Hola Cafetier, quiero una cotizacion para mi negocio",
      menudeoMessage: "Hola Cafetier, quiero pedir cafe por menudeo (menos de 9 kg)",
      medioMessage: "Hola Cafetier, quiero pedir cafe medio mayoreo (10 a 24 kg)",
      mayoreoMessage: "Hola Cafetier, quiero pedir cafe mayoreo (mas de 25 kg)",
      businessMessage: "Hola Cafetier, tengo una cafeteria o negocio y quiero una solucion a medida",
      finderMessage: "Hola CAFETIER, hice el selector de la web. Me interesa {tier} ({range}), perfil {profile}, {context}. Quiero conocer disponibilidad y entrega."
    }
  };

  const pageDefs = {
    "nuestro-cafe": {
      label: "Nuestro cafe",
      previewUrl: "/nuestro-cafe/",
      sections: [
        { id: "hero", label: "Hero", visible: true },
        { id: "origen", label: "Origen", visible: true },
        { id: "perfil", label: "Perfil de cafe", visible: true },
        { id: "proceso", label: "Proceso", visible: true },
        { id: "experiencia", label: "Experiencia", visible: true },
        { id: "valores", label: "Valores", visible: true }
      ],
      fields: [
        { id: "hero_eyebrow", group: "Hero", label: "Etiqueta", selector: ".coffee-hero .eyebrow", value: "Nuestro cafe" },
        { id: "hero_title", group: "Hero", label: "Titulo", selector: ".coffee-hero-copy h1", value: "Cafe de Chiapas," },
        { id: "hero_kicker", group: "Hero", label: "Linea dorada", selector: ".coffee-hero .hero-kicker", value: "tradicion que se siente en cada taza." },
        { id: "hero_body", group: "Hero", label: "Descripcion", selector: ".coffee-hero .hero-body", type: "textarea", value: "En las alturas de Chiapas, cada grano madura lentamente entre neblina, selva y montana. Este proceso natural permite desarrollar perfiles aromaticos complejos y una taza llena de caracter." },
        { id: "hero_image", group: "Hero", label: "Imagen de fondo", selector: ".coffee-hero-img", type: "image", value: "/assets/chiapas-hero.png", alt: "Rama de cafe de Chiapas con cerezas maduras y montanas con neblina" },
        { id: "origin_title", group: "Origen", label: "Titulo", selector: ".origin-copy-block h2", value: "Chiapas, tierra cafetalera de excelencia" },
        { id: "origin_copy", group: "Origen", label: "Texto", selector: ".origin-copy-block>p:not(.eyebrow)", type: "textarea", value: "Cultivado en las montanas de la Sierra Madre de Chiapas, nuestro cafe desarrolla notas intensas gracias a la combinacion de altitud, niebla constante y una biodiversidad excepcional." },
        { id: "origin_image", group: "Origen", label: "Foto paisaje", selector: ".origin-landscape", type: "image", value: "/assets/chiapas-farm.png", alt: "Paisaje cafetalero de Chiapas con montanas y finca" },
        { id: "origin_panel_title", group: "Origen", label: "Tarjeta titulo", selector: ".origin-panel h3", value: "Jaltenango," },
        { id: "origin_panel_strong", group: "Origen", label: "Tarjeta destacado", selector: ".origin-panel strong", value: "el corazon de nuestro cafe" },
        { id: "origin_panel_copy", group: "Origen", label: "Tarjeta texto", selector: ".origin-panel p", type: "textarea", value: "Trabajamos de la mano con productores locales que cuidan cada detalle del cultivo y la cosecha, preservando las tradiciones y elevando la calidad del cafe chiapaneco." },
        { id: "profile_aroma", group: "Perfil", label: "Aroma", selector: ".profile-grid article:nth-child(1) p", type: "textarea", value: "Intenso y envolvente, con notas a chocolate, caramelo y frutos secos." },
        { id: "profile_sabor", group: "Perfil", label: "Sabor", selector: ".profile-grid article:nth-child(2) p", type: "textarea", value: "Dulce y balanceado, con notas a cacao, miel de panela y frutos rojos." },
        { id: "profile_cuerpo", group: "Perfil", label: "Cuerpo", selector: ".profile-grid article:nth-child(3) p", type: "textarea", value: "Medio a alto, aterciopelado y de gran persistencia." },
        { id: "profile_acidez", group: "Perfil", label: "Acidez", selector: ".profile-grid article:nth-child(4) p", type: "textarea", value: "Media, citrica y agradable al paladar." },
        { id: "profile_experiencia", group: "Perfil", label: "Experiencia", selector: ".profile-grid article:nth-child(5) p", type: "textarea", value: "Taza limpia, dulce y con final prolongado que invita a repetir." },
        { id: "stats_title", group: "Experiencia", label: "Titulo", selector: ".experience-copy h2", value: "Calidad constante, taza tras taza" },
        { id: "stats_copy", group: "Experiencia", label: "Texto", selector: ".experience-copy>p:not(.eyebrow)", type: "textarea", value: "Desde 2012 perfeccionamos nuestro proceso para ofrecer un cafe con calidad constante, perfil definido y un tueste que respeta la esencia de Chiapas." },
        { id: "stats_image", group: "Experiencia", label: "Foto bolsa", selector: ".experience-band>img", type: "image", value: "/assets/hero-coffee.png", alt: "Bolsa de cafe CAFETIER con granos tostados" }
      ]
    },
    "para-negocios": {
      label: "Para negocios",
      previewUrl: "/para-negocios/",
      sections: [
        { id: "hero", label: "Hero", visible: true },
        { id: "ventajas", label: "Ventajas", visible: true },
        { id: "soluciones", label: "Soluciones", visible: true },
        { id: "planes", label: "Planes y precios", visible: true },
        { id: "cta", label: "Cotizacion", visible: true },
        { id: "proof", label: "Compromisos", visible: true }
      ],
      fields: [
        { id: "hero_eyebrow", group: "Hero", label: "Etiqueta", selector: ".business-hero .eyebrow", value: "Para negocios" },
        { id: "hero_title", group: "Hero", label: "Titulo (admite em)", selector: ".business-hero h1", type: "html", value: "Tu cafe merece un proveedor <em>tan consistente</em> como tu servicio." },
        { id: "hero_copy", group: "Hero", label: "Texto", selector: ".business-hero-copy>p:not(.eyebrow)", type: "textarea", value: "En CAFETIER somos tu aliado estrategico para ofrecer cafe mexicano de calidad constante, con respaldo, puntualidad y atencion personalizada." },
        { id: "hero_note", group: "Hero", label: "Linea destacada", selector: ".business-hero-copy strong", type: "html", value: "No vendemos solo cafe:<br>entregamos calidad, caracter y constancia en cada grano." },
        { id: "hero_image", group: "Hero", label: "Imagen hero", selector: ".business-hero-media img", type: "image", value: "/assets/business-hero.png", alt: "Barista sirviendo cafe junto a bolsa CAFETIER" },
        { id: "solutions_title", group: "Soluciones", label: "Titulo seccion", selector: "#business-solutions-title", value: "Soluciones para cada tipo de negocio" },
        { id: "plan_title", group: "Planes", label: "Titulo", selector: ".plan-image-card h2", value: "Planes pensados para tu consumo" },
        { id: "plan_copy", group: "Planes", label: "Texto", selector: ".plan-image-card p", type: "textarea", value: "Elige el plan que mejor se adapte al consumo mensual de tu negocio. Nosotros nos encargamos del resto." },
        { id: "plan_image", group: "Planes", label: "Foto planes", selector: ".plan-image-card img", type: "image", value: "/assets/business-plan-photo.png", alt: "Manos sosteniendo cafe tostado" },
        { id: "price_1", group: "Planes", label: "Precio mas de 25 kg", selector: ".price-board article:nth-of-type(1) strong", value: "$320" },
        { id: "price_2", group: "Planes", label: "Precio 10 a 24 kg", selector: ".price-board article:nth-of-type(2) strong", value: "$350" },
        { id: "price_3", group: "Planes", label: "Precio menos de 9 kg", selector: ".price-board article:nth-of-type(3) strong", value: "$400" },
        { id: "cta_title", group: "Cotizacion", label: "Titulo", selector: ".business-cta h2", value: "Construyamos juntos experiencias memorables." },
        { id: "cta_copy", group: "Cotizacion", label: "Texto", selector: ".business-cta p", type: "textarea", value: "Solicita una cotizacion personalizada y descubre como podemos ayudar a tu negocio a servir el mejor cafe, todos los dias." },
        { id: "cta_phone", group: "Cotizacion", label: "Telefono CTA", selector: ".quote-card strong", value: "228 169 8042" },
        { id: "cta_href", group: "Cotizacion", label: "Link WhatsApp CTA", selector: ".quote-card", attr: "href", value: "https://wa.me/522281698042?text=Hola%20Cafetier%2C%20quiero%20una%20cotizacion%20para%20mi%20negocio" }
      ]
    },
    proceso: {
      label: "Proceso",
      previewUrl: "/proceso/",
      sections: [
        { id: "hero", label: "Hero", visible: true },
        { id: "pasos", label: "Paso a paso", visible: true },
        { id: "editorial", label: "Bloques editoriales", visible: true },
        { id: "oficio", label: "Oficio y control", visible: true },
        { id: "cierre", label: "Cierre", visible: true }
      ],
      fields: [
        { id: "hero_title", group: "Hero", label: "Titulo (admite em)", selector: ".roast-hero h1", type: "html", value: "El arte y la ciencia <em>detras de cada lote.</em>" },
        { id: "hero_copy", group: "Hero", label: "Texto", selector: ".roast-hero .split-copy>p:not(.eyebrow)", type: "textarea", value: "En CAFETIER cada curva de tueste es monitoreada para garantizar el mismo perfil de sabor una y otra vez." },
        { id: "hero_image", group: "Hero", label: "Imagen hero", selector: ".roast-hero>img", type: "image", value: "/assets/process-hero.png", alt: "Tostadora descargando cafe recien tostado" },
        { id: "steps_title", group: "Paso a paso", label: "Titulo", selector: ".roast-steps h2", value: "Nuestro proceso, paso a paso" },
        { id: "steps_copy", group: "Paso a paso", label: "Subtitulo", selector: ".roast-steps>p", value: "Del grano verde al cafe excepcional." },
        { id: "crack_title", group: "Editorial", label: "Primer crack titulo", selector: ".process-focus article:nth-child(1) h2", value: "El primer crack" },
        { id: "crack_copy", group: "Editorial", label: "Primer crack texto", selector: ".process-focus article:nth-child(1) div p:not(.eyebrow)", type: "textarea", value: "Durante esta etapa el grano libera vapor, expande su estructura y empieza a definir el caracter final de la taza. Controlar ese punto nos permite decidir con precision cuando detener el desarrollo." },
        { id: "chart_title", group: "Editorial", label: "Curvas titulo", selector: ".chart-card h2", value: "Curvas de tueste" },
        { id: "chart_copy", group: "Editorial", label: "Curvas texto", selector: ".chart-card div p:not(.eyebrow)", type: "textarea", value: "Registramos temperatura, tiempo y ritmo de desarrollo para repetir perfiles consistentes y corregir cualquier variable antes de liberar un lote." },
        { id: "chart_image", group: "Editorial", label: "Grafica de curva", selector: ".chart-card img", type: "image", value: "/assets/process-chart.png", alt: "Curva tipica de tueste CAFETIER" },
        { id: "machine_image", group: "Oficio", label: "Foto maquina", selector: ".process-clean-cards article:nth-child(1) img", type: "image", value: "/assets/process-machine-photo.png", alt: "Tostadora tipo Probat" },
        { id: "master_image", group: "Oficio", label: "Foto maestro", selector: ".process-clean-cards article:nth-child(2) img", type: "image", value: "/assets/process-master-photo.png", alt: "Maestro tostador CAFETIER" },
        { id: "cupping_image", group: "Oficio", label: "Foto catacion", selector: ".process-clean-cards article:nth-child(3) img", type: "image", value: "/assets/process-cupping-photo.png", alt: "Catacion de cafe" },
        { id: "final_title", group: "Cierre", label: "Titulo", selector: ".process-final-band h2", value: "No tostamos cafe. Construimos consistencia." },
        { id: "final_copy", group: "Cierre", label: "Texto", selector: ".process-final-band p", type: "textarea", value: "Porque un hogar, una barra o una empresa necesitan repetir la misma experiencia taza tras taza." }
      ]
    },
    marca: {
      label: "Marca",
      previewUrl: "/marca/",
      sections: [
        { id: "hero", label: "Hero", visible: true },
        { id: "filosofia", label: "Filosofia", visible: true },
        { id: "historia", label: "Historia", visible: true },
        { id: "registro", label: "Marca registrada", visible: true },
        { id: "cta", label: "CTA final", visible: true }
      ],
      fields: [
        { id: "hero_title", group: "Hero", label: "Titulo (admite em)", selector: ".brand-hero h1", type: "html", value: "Mas que un nombre, <em>una forma de hacer cafe.</em>" },
        { id: "hero_copy", group: "Hero", label: "Texto", selector: ".brand-hero .split-copy>p", type: "textarea", value: "Cada grano que tostamos cuenta una historia de origen, trabajo y dedicacion. Nuestra marca es el reflejo de ese compromiso: honrar el cafe mexicano y llevarlo a su maxima expresion." },
        { id: "hero_image", group: "Hero", label: "Imagen hero", selector: ".brand-hero>img", type: "image", value: "/assets/brand-hero.png", alt: "Maestro tostador trabajando en una tostadora CAFETIER" },
        { id: "story_title", group: "Historia", label: "Titulo historia (admite em)", selector: ".brand-story h2", type: "html", value: "Una casa tostadora <em>mexicana.</em>" },
        { id: "story_image", group: "Historia", label: "Foto historia", selector: ".brand-story>img", type: "image", value: "/assets/brand-origin.png", alt: "Manos sosteniendo cerezas maduras de cafe" },
        { id: "registration_copy", group: "Registro", label: "Texto registro", selector: ".brand-registration p", type: "html", value: "<strong>CAFETIER&reg;</strong> es una marca registrada en Mexico con proteccion vigente hasta el ano 2035." },
        { id: "certificate_image", group: "Registro", label: "Certificado IMPI", selector: ".brand-registration>img", type: "image", value: "/assets/brand-certificate.png", alt: "Titulo de registro de marca CAFETIER" },
        { id: "cta_title", group: "CTA", label: "Titulo CTA (admite em)", selector: ".brand-bottom-cta h2", type: "html", value: "Lo que nos define <em>se siente en cada taza.</em>" },
        { id: "cta_copy", group: "CTA", label: "Texto CTA", selector: ".brand-bottom-cta p", value: "Culto por el cafe. Todos los dias." }
      ]
    },
    pedidos: {
      label: "Pedidos",
      previewUrl: "/pedidos/",
      sections: [
        { id: "hero", label: "Hero", visible: true },
        { id: "volumen", label: "Volumenes", visible: true },
        { id: "pasos", label: "Como pedir", visible: true },
        { id: "entregas", label: "Entregas", visible: true },
        { id: "contacto", label: "Contacto", visible: true },
        { id: "clientes", label: "Clientes", visible: true }
      ],
      fields: [
        { id: "hero_title", group: "Hero", label: "Titulo (admite em)", selector: ".orders-hero h1", type: "html", value: "Haz tu pedido <em>facil, rapido y directo.</em>" },
        { id: "hero_copy", group: "Hero", label: "Texto", selector: ".orders-hero .split-copy>p", type: "textarea", value: "Llevamos cafe tostado de calidad a tu hogar, negocio, oficina o cafeteria. Elige el volumen que necesitas y nosotros nos encargamos del resto." },
        { id: "hero_image", group: "Hero", label: "Imagen hero", selector: ".orders-hero>img", type: "image", value: "/assets/orders-hero.png", alt: "Bolsa CAFETIER y granos de cafe" },
        { id: "hero_button_href", group: "Hero", label: "Link boton WhatsApp", selector: ".orders-hero .btn", attr: "href", value: "https://wa.me/522281698042?text=Hola%20Cafetier%2C%20quiero%20hacer%20un%20pedido.%20Les%20cuento%20lo%20que%20necesito%3A" },
        { id: "volume_title", group: "Volumenes", label: "Titulo", selector: ".orders-volume h2", value: "Elige el volumen que necesitas" },
        { id: "volume_copy", group: "Volumenes", label: "Subtitulo", selector: ".orders-volume>p", value: "Todos nuestros pedidos son de 1 kg en adelante." },
        { id: "steps_title", group: "Pasos", label: "Titulo pasos", selector: ".order-steps h2", value: "Como hacer tu pedido?" },
        { id: "delivery_title", group: "Entregas", label: "Titulo entrega", selector: ".delivery-banner h2", value: "Entregas puntuales en todo Mexico" },
        { id: "delivery_copy", group: "Entregas", label: "Texto entrega", selector: ".delivery-banner p", type: "textarea", value: "Empaque disenado para preservar la frescura, aroma y calidad del cafe en cada envio." },
        { id: "contact_image", group: "Contacto", label: "Foto chat", selector: ".orders-contact>img", type: "image", value: "/assets/orders-chat.png", alt: "Conversacion de pedido por WhatsApp" },
        { id: "contact_title", group: "Contacto", label: "Titulo contacto (admite em)", selector: ".orders-contact h2", type: "html", value: "Listo para tu pedido? <em>Estamos para servirte.</em>" },
        { id: "clients_eyebrow", group: "Clientes", label: "Etiqueta clientes", selector: ".orders-clients .eyebrow", value: "Confian en CAFETIER" },
        { id: "clients_title", group: "Clientes", label: "Titulo clientes", selector: ".orders-clients h2", value: "Marcas que confian en nosotros" }
      ]
    }
  };

  const clone = value => JSON.parse(JSON.stringify(value));
  const pageConfigDefaults = Object.fromEntries(Object.entries(pageDefs).map(([page, def]) => [
    page,
    {
      version: 1,
      sections: clone(def.sections),
      fields: Object.fromEntries(def.fields.map(field => [field.id, { value: field.value || "", alt: field.alt || "" }])),
      visualEdits: []
    }
  ]));
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
  const cleanWhatsappNumber = value => String(value || "").replace(/[^\d]/g, "");
  const whatsappUrl = (number, message) => {
    const safeNumber = cleanWhatsappNumber(number) || cleanWhatsappNumber(globalDefaults.whatsapp.number);
    const text = String(message || "").trim();
    return `https://wa.me/${safeNumber}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
  };
  const formatMessage = (template, data = {}) => Object.entries(data).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, String(value ?? "")),
    String(template || "")
  );
  const existingWhatsappMessage = (link, fallback) => {
    try {
      return new URL(link.href, window.location.origin).searchParams.get("text") || fallback;
    } catch {
      return fallback;
    }
  };
  const buildClientLogo = logo => {
    const node = document.createElement(logo.href ? "a" : "span");
    node.className = "client-logo";
    if (logo.href) node.href = logo.href;
    if (logo.image) {
      const image = document.createElement("img");
      image.src = logo.image;
      image.alt = logo.name || "Cliente CAFETIER";
      node.appendChild(image);
    } else {
      const strong = document.createElement("strong");
      strong.textContent = logo.name || "Cliente";
      node.appendChild(strong);
    }
    return node;
  };
  const renderClientLogos = (container, logos, duplicate = false) => {
    const items = Array.isArray(logos) && logos.length ? logos : globalDefaults.clients.logos;
    const nodes = duplicate ? [...items.map(buildClientLogo), ...items.map(buildClientLogo)] : items.map(buildClientLogo);
    container.replaceChildren(...nodes);
  };
  const applyGlobal = input => {
    const config = merge(globalDefaults, input || {});
    const brand = config.brand || globalDefaults.brand;
    const whatsapp = config.whatsapp || globalDefaults.whatsapp;
    const setWhatsappLink = (selector, message) => {
      document.querySelectorAll(selector).forEach(link => {
        link.href = whatsappUrl(whatsapp.number, message);
      });
    };

    document.querySelectorAll(".brand-mark").forEach(image => {
      if (brand.logo) image.src = brand.logo;
      image.alt = brand.logoAlt || "";
    });
    document.querySelectorAll(".brand-text strong").forEach(node => { node.textContent = brand.name || ""; });
    document.querySelectorAll(".brand-text small").forEach(node => { node.textContent = brand.tagline || ""; });
    document.querySelectorAll(".phone-link span,.quote-card strong,.contact-methods a[href*='wa.me'] strong").forEach(node => {
      node.textContent = whatsapp.display || "";
    });
    setText(document, ".clients-heading .eyebrow", config.clients?.eyebrow);
    setText(document, ".clients-heading h2", config.clients?.title);
    setText(document, ".orders-clients .eyebrow", config.clients?.eyebrow);
    setText(document, ".orders-clients h2", config.clients?.title);
    document.querySelectorAll(".clients-track").forEach(track => renderClientLogos(track, config.clients?.logos, false));
    document.querySelectorAll(".orders-client-grid").forEach(grid => renderClientLogos(grid, config.clients?.logos, false));
    document.querySelectorAll("a[href*='wa.me/']").forEach(link => {
      link.href = whatsappUrl(whatsapp.number, existingWhatsappMessage(link, whatsapp.genericMessage));
    });

    setWhatsappLink(".phone-link", whatsapp.genericMessage);
    setWhatsappLink(".floating-whatsapp", whatsapp.floatingMessage);
    setWhatsappLink(".orders-hero .btn", whatsapp.orderMessage);
    setWhatsappLink(".quote-card", whatsapp.quoteMessage);
    setWhatsappLink(".business-cta .quote-card", whatsapp.quoteMessage);
    setWhatsappLink(".brand-bottom-cta .btn:first-of-type", whatsapp.orderMessage);

    window.CAFETIER_GLOBAL_CONFIG = config;
    return config;
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
    const track = root.querySelector(".clients-track");
    if (track) {
      const logos = Array.isArray(config.clients.logos) && config.clients.logos.length
        ? config.clients.logos
        : [{ name: "Clientes CAFETIER", image: config.clients.image, href: "" }];
      renderClientLogos(track, logos, false);
    }
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
    applyVisualEdits(config.visualEdits);
    return config;
  };

  const setNodes = (selector, callback) => {
    document.querySelectorAll(selector).forEach(callback);
  };

  const applyVisualEdits = edits => {
    if (!Array.isArray(edits)) return;
    edits.forEach(edit => {
      if (!edit?.selector) return;
      const node = document.querySelector(edit.selector);
      if (!node) return;
      if (edit.type === "image") {
        if (edit.value) node.src = edit.value;
        if (edit.alt !== undefined) node.alt = edit.alt || "";
        return;
      }
      if (edit.type === "link") {
        node.setAttribute("href", edit.value || "#");
        return;
      }
      node.textContent = edit.value ?? "";
    });
  };

  const applyEditablePage = (pageId, input) => {
    const def = pageDefs[pageId];
    if (!def) return null;
    const config = merge(pageConfigDefaults[pageId], input || {});
    def.fields.forEach(field => {
      const saved = config.fields?.[field.id] || {};
      const value = saved.value ?? "";
      setNodes(field.selector, node => {
        if (field.type === "image") {
          node.src = value;
          if (saved.alt !== undefined) node.alt = saved.alt || "";
          return;
        }
        if (field.attr) {
          node.setAttribute(field.attr, value);
          return;
        }
        if (field.type === "html") node.innerHTML = value;
        else node.textContent = value;
      });
    });

    const main = document.querySelector("main");
    if (main) {
      const sectionMap = new Map([...main.querySelectorAll(":scope>[data-edit-section]")].map(node => [node.dataset.editSection, node]));
      config.sections.forEach(section => {
        const node = sectionMap.get(section.id);
        if (!node) return;
        node.hidden = section.visible === false;
        main.appendChild(node);
      });
    }

    window.CAFETIER_ACTIVE_PAGE_CONFIG = config;
    applyVisualEdits(config.visualEdits);
    return config;
  };

  window.CAFETIER_SITE_DEFAULTS = defaults;
  window.CAFETIER_GLOBAL_DEFAULTS = globalDefaults;
  window.CAFETIER_SITE_MERGE = merge;
  window.CAFETIER_WHATSAPP_URL = whatsappUrl;
  window.CAFETIER_FORMAT_MESSAGE = formatMessage;
  window.applyCafetierGlobalContent = applyGlobal;
  window.applyCafetierSiteContent = apply;
  window.CAFETIER_PAGE_DEFS = pageDefs;
  window.CAFETIER_PAGE_DEFAULTS = pageConfigDefaults;
  window.applyCafetierEditablePage = applyEditablePage;
})();
