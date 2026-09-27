/* TargetPanel — progressive enhancements. Everything works without JS. */
(function () {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  /* ---------------- Theme ---------------- */
  function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem("tp-theme", theme); } catch (_) { /* storage blocked */ }
  }
  $$("[data-theme-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => {
      setTheme(document.documentElement.dataset.theme === "light" ? "dark" : "light");
    });
  });

  /* ---------------- Mobile nav ---------------- */
  $$("[data-nav-toggle]").forEach((el) => {
    el.addEventListener("click", () => document.body.classList.toggle("nav-open"));
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") document.body.classList.remove("nav-open");
  });

  /* ---------------- Toasts ---------------- */
  function dismiss(toast) {
    if (!toast || toast.classList.contains("out")) return;
    toast.classList.add("out");
    toast.addEventListener("animationend", () => toast.remove(), { once: true });
  }
  $$(".toast").forEach((toast, i) => {
    $(".toast-x", toast)?.addEventListener("click", () => dismiss(toast));
    setTimeout(() => dismiss(toast), 5200 + i * 400);
  });

  /* ---------------- Count-up numbers + meters ---------------- */
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  $$("[data-count]").forEach((el) => {
    const target = parseInt(el.dataset.count, 10) || 0;
    if (reduced || target === 0) { el.textContent = target; return; }
    const start = performance.now();
    const dur = 900;
    el.textContent = "0";
    (function tick(now) {
      const t = Math.min(1, (now - start) / dur);
      el.textContent = Math.round(target * (1 - Math.pow(1 - t, 3)));
      if (t < 1) requestAnimationFrame(tick);
    })(start);
  });
  requestAnimationFrame(() => {
    $$(".meter > span[data-w]").forEach((bar) => { bar.style.width = bar.dataset.w + "%"; });
  });

  /* ---------------- Auto-submitting selects ---------------- */
  $$("[data-autosubmit]").forEach((sel) => {
    sel.addEventListener("change", () => {
      sel.className = sel.className.replace(/\b(admin|user)\b/, sel.value);
      sel.form.submit();
    });
  });

  /* ---------------- Dialogs ---------------- */
  $$("[data-open]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const dlg = document.getElementById(btn.dataset.open);
      if (dlg) { dlg.showModal(); $("[autofocus]", dlg)?.focus(); }
    });
  });
  $$("[data-close]").forEach((btn) => {
    btn.addEventListener("click", () => btn.closest("dialog").close());
  });
  $$("dialog").forEach((dlg) => {
    // click on backdrop closes
    dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
  });
  if (location.hash === "#new") {
    const dlg = document.getElementById("create-user");
    if (dlg) dlg.showModal();
  }

  /* Confirm before destructive submits */
  const confirmDlg = document.getElementById("confirm");
  let pendingForm = null;
  $$("form[data-confirm]").forEach((form) => {
    form.addEventListener("submit", (e) => {
      if (!confirmDlg || form.dataset.confirmed) return;
      e.preventDefault();
      pendingForm = form;
      $("[data-confirm-name]", confirmDlg).textContent = form.dataset.confirm;
      confirmDlg.showModal();
    });
  });
  $("[data-confirm-yes]")?.addEventListener("click", () => {
    if (!pendingForm) return;
    pendingForm.dataset.confirmed = "1";
    confirmDlg.close();
    pendingForm.submit();
  });

  /* ---------------- Password helpers ---------------- */
  $$("[data-reveal]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const input = document.getElementById(btn.dataset.reveal);
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      btn.setAttribute("aria-pressed", String(show));
      btn.querySelector("use").setAttribute("href", show ? "#i-eye-off" : "#i-eye");
    });
  });

  function generatePassword(len = 16) {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*?";
    const buf = new Uint32Array(len);
    crypto.getRandomValues(buf);
    return Array.from(buf, (n) => chars[n % chars.length]).join("");
  }
  $$("[data-generate]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const input = document.getElementById(btn.dataset.generate);
      input.value = generatePassword();
      input.type = "text";
      input.dispatchEvent(new Event("input"));
      input.focus();
    });
  });

  $$("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const input = document.getElementById(btn.dataset.copy);
      if (!input.value) return;
      try {
        await navigator.clipboard.writeText(input.value);
        const use = btn.querySelector("use");
        use.setAttribute("href", "#i-check");
        setTimeout(() => use.setAttribute("href", "#i-copy"), 1400);
      } catch (_) { input.select(); }
    });
  });

  function score(pw) {
    if (!pw) return 0;
    let s = 0;
    if (pw.length >= 8) s++;
    if (pw.length >= 12) s++;
    if (/[a-zа-я]/.test(pw) && /[A-ZА-Я]/.test(pw)) s++;
    if (/\d/.test(pw) && /[^\w\s]/.test(pw)) s++;
    return Math.max(1, Math.min(4, s));
  }
  const LABELS = ["", "Слабый пароль", "Так себе", "Хороший пароль", "Отличный пароль"];
  $$("[data-strength]").forEach((meter) => {
    const input = document.getElementById(meter.dataset.strength);
    const hint = document.getElementById(meter.dataset.strength + "-hint");
    input.addEventListener("input", () => {
      const s = score(input.value);
      meter.dataset.score = s;
      if (!hint) return;
      if (!input.value) { hint.textContent = "Минимум 8 символов"; hint.className = "hint"; return; }
      if (input.value.length < 8) { hint.textContent = `Ещё ${8 - input.value.length} симв.`; hint.className = "hint bad"; return; }
      hint.textContent = LABELS[s];
      hint.className = "hint " + (s <= 1 ? "bad" : s === 2 ? "warn" : "good");
    });
  });

  $$("[data-match]").forEach((input) => {
    const other = document.getElementById(input.dataset.match);
    const hint = document.getElementById(input.id + "-hint");
    const check = () => {
      if (!input.value) { hint.textContent = ""; hint.className = "hint"; return; }
      const ok = input.value === other.value;
      hint.textContent = ok ? "Пароли совпадают" : "Пароли не совпадают";
      hint.className = "hint " + (ok ? "good" : "bad");
    };
    input.addEventListener("input", check);
    other.addEventListener("input", check);
  });

  /* Caps Lock warning */
  $$("[data-caps]").forEach((input) => {
    const hint = document.getElementById(input.dataset.caps);
    const upd = (e) => {
      if (!e.getModifierState) return;
      hint.textContent = e.getModifierState("CapsLock") ? "Включён Caps Lock" : "";
    };
    input.addEventListener("keyup", upd);
    input.addEventListener("keydown", upd);
  });

  /* ---------------- Users table: search + filters ---------------- */
  const table = document.getElementById("users-table");
  if (table) {
    const rows = $$("tbody tr", table);
    const search = document.getElementById("user-search");
    const empty = document.getElementById("users-empty");
    const chips = $$("[data-filter]");
    let filter = "all";

    const apply = () => {
      const q = (search.value || "").trim().toLowerCase();
      let shown = 0;
      rows.forEach((row) => {
        const matchQ = !q || row.dataset.name.includes(q);
        const matchF = filter === "all"
          || (filter === "admin" && row.dataset.role === "admin")
          || (filter === "off" && row.dataset.active === "0");
        const visible = matchQ && matchF;
        row.hidden = !visible;
        if (visible) shown++;
      });
      empty.classList.toggle("show", shown === 0);
    };
    search.addEventListener("input", apply);
    chips.forEach((chip) => chip.addEventListener("click", () => {
      filter = chip.dataset.filter;
      chips.forEach((c) => c.setAttribute("aria-pressed", String(c === chip)));
      apply();
    }));
    document.addEventListener("keydown", (e) => {
      if (e.key === "/" && document.activeElement.tagName !== "INPUT" && !$("dialog[open]")) {
        e.preventDefault();
        search.focus();
      }
    });
  }
})();
