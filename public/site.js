(async () => {
  const pageFromPath = () => {
    const path = window.location.pathname.replace(/\/+$/, "") || "/";
    const map = {
      "/": "homepage",
      "/nuestro-cafe": "nuestro-cafe",
      "/para-negocios": "para-negocios",
      "/proceso": "proceso",
      "/marca": "marca",
      "/pedidos": "pedidos"
    };
    return document.body.dataset.sitePage || map[path] || "homepage";
  };

  try {
    const pageId = pageFromPath();
    const response = await fetch(`/api/site-content/${pageId}`);
    const payload = await response.json();
    if (response.ok && payload.success && payload.data?.content) {
      if (pageId === "homepage") {
        window.applyCafetierSiteContent?.(payload.data.content);
      } else {
        window.applyCafetierEditablePage?.(pageId, payload.data.content);
      }
    }
  } catch (error) {
    console.warn("No se pudo cargar la configuracion editable del sitio.", error);
  }

  const header = document.querySelector(".site-header");
  const updateHeader = () => header?.classList.toggle("is-scrolled", window.scrollY > 24);
  const nav = document.querySelector(".main-nav");
  const phone = document.querySelector(".phone-link");

  if (nav && !nav.querySelector(".products-nav")) {
    const coffeeLink = nav.querySelector('a[href="/nuestro-cafe/"]');
    const products = document.createElement("span");
    products.className = "nav-dropdown products-nav";
    products.innerHTML = `
      <a href="/#precios">Productos</a>
      <span class="dropdown-menu">
        <a href="/nuestro-cafe/">Cafe de Chiapas</a>
        <a href="/para-negocios/#planes">Mezcla de la casa</a>
        <a href="/#precios">Por volumen</a>
      </span>`;
    coffeeLink?.insertAdjacentElement("afterend", products);
  }

  document.querySelectorAll(".nav-dropdown").forEach(dropdown => {
    const link = dropdown.querySelector(":scope>a");
    if (link?.getAttribute("href") !== "/marca/") return;
    const menu = dropdown.querySelector(".dropdown-menu");
    if (!menu || menu.dataset.enhanced === "true") return;
    menu.dataset.enhanced = "true";
    menu.innerHTML = `
      <a href="/marca/#historia">Nuestra historia</a>
      <a href="/marca/#registro">Marca registrada</a>
      <a href="/marca/#filosofia">Filosofia</a>
      <a class="internal-link" href="/admin/">Acceso interno</a>`;
  });

  if (!document.querySelector(".floating-whatsapp")) {
    const floating = document.createElement("a");
    floating.className = "floating-whatsapp";
    floating.href = "https://wa.me/522281698042?text=Hola%20Cafetier%2C%20quiero%20pedir%20cafe";
    floating.setAttribute("aria-label", "Escribir a CAFETIER por WhatsApp");
    floating.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.1 4.9A9.8 9.8 0 0 0 3.8 16.7L2.5 21.5l4.9-1.3A9.8 9.8 0 0 0 21.8 12a9.7 9.7 0 0 0-2.7-7.1Zm-7 15.1a8 8 0 0 1-4.1-1.1l-.3-.2-2.9.8.8-2.8-.2-.3a8 8 0 1 1 6.7 3.6Z"/></svg>';
    document.body.appendChild(floating);
  }

  if (header && nav && !header.querySelector(".nav-toggle")) {
    const toggle = document.createElement("button");
    toggle.className = "nav-toggle";
    toggle.type = "button";
    toggle.setAttribute("aria-label", "Abrir menu");
    toggle.setAttribute("aria-expanded", "false");
    toggle.innerHTML = "<span></span><span></span><span></span>";
    header.insertBefore(toggle, phone || nav);

    const setMenuOpen = open => {
      document.body.classList.toggle("nav-open", open);
      toggle.setAttribute("aria-expanded", String(open));
      if (open) {
        const width = Math.min(Math.round(window.innerWidth * 0.88), 370);
        const hostOffset = parseFloat(getComputedStyle(header).paddingLeft) || 0;
        nav.style.setProperty("transition", "none", "important");
        nav.style.setProperty("width", `${width}px`, "important");
        nav.style.setProperty("left", `${Math.max(0, window.innerWidth - width - hostOffset)}px`, "important");
        nav.style.setProperty("right", "auto", "important");
        nav.style.setProperty("transform", "translateX(0)", "important");
      } else {
        nav.style.removeProperty("transition");
        nav.style.removeProperty("width");
        nav.style.removeProperty("left");
        nav.style.removeProperty("right");
        nav.style.removeProperty("transform");
      }
    };
    const close = () => setMenuOpen(false);
    toggle.addEventListener("click", () => {
      const open = !document.body.classList.contains("nav-open");
      setMenuOpen(open);
    });
    nav.addEventListener("click", event => {
      if (event.target.closest("a")) close();
    });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape") close();
    });
  }

  updateHeader();
  window.addEventListener("scroll", updateHeader, { passive: true });

  const initCarousel = ({
    root,
    slideSelector,
    dotSelector,
    prevSelector,
    nextSelector,
    activeClass = "is-active",
    onChange
  }) => {
    const carousel = document.querySelector(root);
    if (!carousel) return;

    const slides = [...carousel.querySelectorAll(slideSelector)];
    const dots = [...carousel.querySelectorAll(dotSelector)];
    const prev = carousel.querySelector(prevSelector);
    const next = carousel.querySelector(nextSelector);
    let index = 0;
    let pointerStart = null;

    const show = nextIndex => {
      index = (nextIndex + slides.length) % slides.length;
      slides.forEach((slide, slideIndex) => {
        const active = slideIndex === index;
        slide.classList.toggle(activeClass, active);
        slide.setAttribute("aria-hidden", String(!active));
      });
      dots.forEach((dot, dotIndex) => {
        const active = dotIndex === index;
        dot.classList.toggle(activeClass, active);
        dot.setAttribute("aria-selected", String(active));
      });
      onChange?.(index, carousel);
    };

    prev?.addEventListener("click", () => show(index - 1));
    next?.addEventListener("click", () => show(index + 1));
    dots.forEach((dot, dotIndex) => dot.addEventListener("click", () => show(dotIndex)));

    carousel.addEventListener("keydown", event => {
      if (event.key === "ArrowLeft") show(index - 1);
      if (event.key === "ArrowRight") show(index + 1);
    });

    carousel.addEventListener("pointerdown", event => {
      pointerStart = event.clientX;
    });
    carousel.addEventListener("pointerup", event => {
      if (pointerStart === null) return;
      const distance = event.clientX - pointerStart;
      pointerStart = null;
      if (Math.abs(distance) < 48) return;
      show(index + (distance < 0 ? 1 : -1));
    });

    show(0);
  };

  initCarousel({
    root: ".home-showcase",
    slideSelector: "[data-slide]",
    dotSelector: "[data-showcase-dot]",
    prevSelector: "[data-showcase-prev]",
    nextSelector: "[data-showcase-next]",
    onChange: (index, carousel) => {
      const count = carousel.querySelector(".showcase-count strong");
      if (count) count.textContent = String(index + 1).padStart(2, "0");
    }
  });

  initCarousel({
    root: ".origin-carousel",
    slideSelector: "[data-origin-slide]",
    dotSelector: "[data-origin-dot]",
    prevSelector: "[data-origin-prev]",
    nextSelector: "[data-origin-next]"
  });

  const revealItems = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.12 });
    revealItems.forEach(item => observer.observe(item));
  } else {
    revealItems.forEach(item => item.classList.add("is-visible"));
  }

  const form = document.querySelector("#coffee-finder-form");
  if (!form) return;

  const steps = [...form.querySelectorAll("[data-finder-step]")];
  const progress = [...document.querySelectorAll(".finder-progress span")];
  const nextButton = form.querySelector("[data-finder-next]");
  const backButton = form.querySelector("[data-finder-back]");
  const resetButton = form.querySelector("[data-finder-reset]");
  const result = form.querySelector("[data-finder-result]");
  const error = form.querySelector(".finder-error");
  let currentStep = 0;

  const names = ["use", "volume", "profile"];
  const selectedValue = name => form.querySelector(`input[name="${name}"]:checked`)?.value;

  const renderStep = () => {
    steps.forEach((step, index) => {
      const active = index === currentStep;
      step.classList.toggle("is-active", active);
      step.hidden = !active;
    });
    progress.forEach((item, index) => item.classList.toggle("is-active", index <= currentStep));
    backButton.hidden = currentStep === 0;
    nextButton.innerHTML = currentStep === steps.length - 1
      ? "Ver recomendaci&oacute;n <span aria-hidden=\"true\">&rarr;</span>"
      : "Siguiente <span aria-hidden=\"true\">&rarr;</span>";
    error.textContent = "";
  };

  const tierData = {
    menudeo: { title: "Menudeo", range: "menos de 9 kg", price: "$400 / kg" },
    medio: { title: "Medio mayoreo", range: "10 a 24 kg", price: "$350 / kg" },
    mayoreo: { title: "Mayoreo", range: "25 kg o m&aacute;s", price: "$320 / kg" }
  };
  const profileData = {
    balanceado: { label: "balanceado", description: "notas de chocolate y caramelo, cuerpo medio y final limpio" },
    intenso: { label: "intenso", description: "cuerpo alto, dulzor profundo y un final prolongado" },
    brillante: { label: "brillante", description: "aroma expresivo, acidez amable y notas c&iacute;tricas" }
  };
  const useData = {
    hogar: "para disfrutar en casa",
    oficina: "para compartir con tu equipo",
    negocio: "para servir con consistencia en tu negocio"
  };

  const showResult = () => {
    const use = selectedValue("use");
    const volume = selectedValue("volume");
    const profile = selectedValue("profile");
    const tier = tierData[volume];
    const taste = profileData[profile];
    const context = useData[use];

    form.querySelector("[data-result-title]").textContent = `${tier.title} + perfil ${taste.label}`;
    form.querySelector("[data-result-price]").textContent = tier.price;
    form.querySelector("[data-result-copy]").textContent = `Te recomendamos ${tier.range}, con ${taste.description}, ${context}.`;

    const message = `Hola CAFETIER, hice el selector de la web. Me interesa ${tier.title} (${tier.range}), perfil ${taste.label}, ${context}. Quiero conocer disponibilidad y entrega.`;
    form.querySelector("[data-result-whatsapp]").href = `https://wa.me/522281698042?text=${encodeURIComponent(message)}`;

    steps.forEach(step => { step.hidden = true; });
    form.querySelector(".finder-actions").hidden = true;
    error.textContent = "";
    result.hidden = false;
    result.focus?.();
  };

  nextButton.addEventListener("click", () => {
    if (!selectedValue(names[currentStep])) {
      error.textContent = "Elige una opci&oacute;n para continuar.";
      return;
    }
    if (currentStep < steps.length - 1) {
      currentStep += 1;
      renderStep();
      return;
    }
    showResult();
  });

  backButton.addEventListener("click", () => {
    currentStep = Math.max(0, currentStep - 1);
    renderStep();
  });

  resetButton.addEventListener("click", () => {
    form.reset();
    currentStep = 0;
    result.hidden = true;
    form.querySelector(".finder-actions").hidden = false;
    renderStep();
  });

  document.querySelectorAll("[data-select-tier]").forEach(link => {
    link.addEventListener("click", () => {
      const input = form.querySelector(`input[name="volume"][value="${link.dataset.selectTier}"]`);
      if (input) input.checked = true;
    });
  });

  renderStep();
})();
