/* Ритуальная служба «Максим» — interactions. The page works without JS
   (phones, links, FAQ); this adds modals, the menu and the lead form. */
(function () {
  "use strict";

  /* Where lead forms are sent: send.php next to this file forwards them to
     Telegram (or the URL of telegram-worker when hosting has no PHP).
     It accepts POST application/json {name, phone, topic, page, website}.
     Set to "" to switch online requests off — the form then asks the visitor
     to call instead of pretending the request went through. See README.md. */
  const LEAD_ENDPOINT = "send.php";

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.documentElement.classList.add("js");

  /* ---------- header ---------- */
  const header = $(".header");
  const onScroll = () => header.classList.toggle("scrolled", scrollY > 8);
  addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  const burger = $(".burger");
  const setMenu = (open) => {
    document.body.classList.toggle("nav-open", open);
    burger.setAttribute("aria-expanded", String(open));
    burger.setAttribute("aria-label", open ? "Закрыть меню" : "Открыть меню");
    burger.querySelector("use").setAttribute("href", open ? "#i-x" : "#i-menu");
  };
  burger.addEventListener("click", () => setMenu(!document.body.classList.contains("nav-open")));
  $$("#nav a").forEach((a) => a.addEventListener("click", () => setMenu(false)));
  addEventListener("keydown", (e) => { if (e.key === "Escape") setMenu(false); });

  /* ---------- reveal on scroll ---------- */
  const reveals = $$(".reveal");
  if ("IntersectionObserver" in window && !reduced) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        const el = en.target;
        const siblings = Array.from(el.parentElement.children).filter((c) => c.classList.contains("reveal"));
        el.style.transitionDelay = Math.min(siblings.indexOf(el), 6) * 70 + "ms";
        el.classList.add("in");
        io.unobserve(el);
      });
    }, { rootMargin: "0px 0px -8% 0px" });
    reveals.forEach((el) => io.observe(el));
  } else {
    reveals.forEach((el) => el.classList.add("in"));
  }

  /* ---------- hero particles (rising embers) ---------- */
  const particles = $(".particles");
  if (particles && !reduced) {
    for (let i = 0; i < 18; i++) {
      const p = document.createElement("i");
      p.style.left = 45 + Math.random() * 55 + "%";
      p.style.animationDuration = 9 + Math.random() * 10 + "s";
      p.style.animationDelay = -Math.random() * 18 + "s";
      p.style.setProperty("--dx", (Math.random() * 80 - 40).toFixed(0) + "px");
      const s = (1.5 + Math.random() * 2.5).toFixed(1) + "px";
      p.style.width = p.style.height = s;
      particles.appendChild(p);
    }
  }

  /* ---------- tabs ---------- */
  const tabs = $$(".tab");
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => select(tab));
    tab.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      const next = tabs[(tabs.indexOf(tab) + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
      select(next); next.focus();
    });
  });
  function select(tab) {
    tabs.forEach((t) => {
      const on = t === tab;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute("aria-controls")).hidden = !on;
    });
  }

  /* ---------- modals ---------- */
  const openModal = (dlg) => {
    $$("dialog[open]").forEach((d) => d !== dlg && d.close());
    if (!dlg.open) dlg.showModal();
  };
  $$("dialog").forEach((dlg) => {
    dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
    $$("[data-close]", dlg).forEach((b) => b.addEventListener("click", () => dlg.close()));
  });

  const callback = $("#callback");
  $$("[data-modal=callback]").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (!callback.showModal) return; // very old browser: follow the #zayavka link
      e.preventDefault();
      const topic = el.dataset.topic || (el.closest("#service") ? $("#service h3").textContent : "Вызов агента");
      $("input[name=topic]", callback).value = topic;
      resetForm($("form", callback));
      openModal(callback);
      setTimeout(() => $("input[name=phone]", callback).focus(), 60);
    });
  });

  const service = $("#service");
  $$("[data-service]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tpl = document.getElementById("svc-" + btn.dataset.service);
      if (!tpl) return;
      const box = $(".service-content", service);
      box.replaceChildren(tpl.content.cloneNode(true));
      openModal(service);
    });
  });

  /* ---------- phone mask (+375 XX XXX-XX-XX) ---------- */
  function formatBY(raw) {
    // National part (operator code + number). The "+375" prefix may sit
    // anywhere if the caret was misplaced, so remove it as a literal first.
    let p;
    if (raw.includes("+375")) p = raw.replace("+375", "").replace(/\D/g, "");
    else {
      p = raw.replace(/\D/g, "");
      if (p.startsWith("80")) p = p.slice(2);
      else if (p.startsWith("375")) p = p.slice(3);
    }
    p = p.slice(0, 9);
    let out = "+375";
    if (p.length) out += " (" + p.slice(0, 2);
    if (p.length > 2) out += ") " + p.slice(2, 5);
    if (p.length > 5) out += "-" + p.slice(5, 7);
    if (p.length > 7) out += "-" + p.slice(7, 9);
    return out;
  }
  const caretToEnd = (inp) => {
    const n = inp.value.length;
    try { inp.setSelectionRange(n, n); } catch (_) { /* unsupported type */ }
  };
  $$("input[type=tel]").forEach((inp) => {
    inp.addEventListener("focus", () => {
      if (!inp.value) inp.value = "+375 (";
      requestAnimationFrame(() => caretToEnd(inp));
    });
    inp.addEventListener("blur", () => { if (inp.value.replace(/\D/g, "").length <= 3) inp.value = ""; });
    inp.addEventListener("input", () => {
      const atEnd = inp.selectionStart === inp.value.length;
      inp.value = formatBY(inp.value);
      if (atEnd || inp.value.length <= 6) caretToEnd(inp);
      inp.removeAttribute("aria-invalid");
    });
  });

  /* ---------- lead forms ---------- */
  function resetForm(form) {
    const st = $(".form-status", form);
    st.textContent = ""; st.className = "form-status";
    $$("input[aria-invalid]", form).forEach((i) => i.removeAttribute("aria-invalid"));
  }
  $$("[data-lead-form]").forEach((form) => {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const status = $(".form-status", form);
      const phone = $("input[name=phone]", form);
      const digits = phone.value.replace(/\D/g, "");
      if (digits.length !== 12) {
        phone.setAttribute("aria-invalid", "true");
        status.className = "form-status err";
        status.textContent = "Укажите номер полностью: +375 (XX) XXX-XX-XX";
        phone.focus();
        return;
      }
      const fallback = 'Позвоните нам: <a href="tel:+375298008858">+375 29 800-88-58</a> — ответим сразу.';
      if (!LEAD_ENDPOINT) {
        status.className = "form-status err";
        status.innerHTML = "Онлайн-заявки временно не принимаются. " + fallback;
        return;
      }
      const btn = $("button[type=submit]", form);
      btn.disabled = true;
      const label = btn.textContent;
      btn.textContent = "Отправляем…";
      try {
        const res = await fetch(LEAD_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: $("input[name=name]", form).value.trim(),
            phone: "+" + digits,
            topic: $("input[name=topic]", form).value,
            page: location.href,
            website: $("input[name=website]", form).value,
          }),
        });
        if (res.status === 429) {
          status.className = "form-status err";
          status.innerHTML = "Заявка уже отправлена, мы скоро перезвоним. Если срочно — " + fallback;
          return;
        }
        if (!res.ok) throw new Error(res.status);
        form.reset();
        status.className = "form-status ok";
        status.textContent = "Спасибо. Мы перезвоним вам в течение 10 минут.";
      } catch (_) {
        status.className = "form-status err";
        status.innerHTML = "Не удалось отправить заявку. " + fallback;
      } finally {
        btn.disabled = false;
        btn.textContent = label;
      }
    });
  });

  /* ---------- reviews slider ---------- */
  const reviews = $(".reviews");
  $$("[data-slide]").forEach((b) => {
    b.addEventListener("click", () => {
      const card = reviews.firstElementChild;
      const step = card.getBoundingClientRect().width + 20;
      reviews.scrollBy({ left: step * Number(b.dataset.slide), behavior: reduced ? "auto" : "smooth" });
    });
  });

  /* ---------- count-up stats ---------- */
  const counters = $$("[data-count]");
  if ("IntersectionObserver" in window && !reduced) {
    const co = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        const el = en.target, target = +el.dataset.count, t0 = performance.now();
        (function tick(now) {
          const k = Math.min(1, (now - t0) / 1200);
          el.textContent = Math.round(target * (1 - Math.pow(1 - k, 3)));
          if (k < 1) requestAnimationFrame(tick);
        })(t0);
        co.unobserve(el);
      });
    }, { threshold: .6 });
    counters.forEach((c) => co.observe(c));
  }

  $$("[data-year]").forEach((el) => { el.textContent = new Date().getFullYear(); });
})();
