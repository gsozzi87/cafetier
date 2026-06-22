(async () => {
  try {
    const response = await fetch("/api/site-content/homepage");
    const payload = await response.json();
    if (response.ok && payload.success && payload.data?.content) {
      window.applyCafetierSiteContent?.(payload.data.content);
    }
  } catch (error) {
    console.warn("No se pudo cargar la configuracion editable del sitio.", error);
  }

  const header = document.querySelector(".site-header");
  const updateHeader = () => header?.classList.toggle("is-scrolled", window.scrollY > 24);

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
