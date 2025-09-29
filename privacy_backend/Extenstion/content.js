// content.js — MV3 CONTENT SCRIPT (drop-in)
// Only collects booleans; no PII values are read or sent.

(() => {
  "use strict";

  /* =============================
   * Guards
   * ============================= */
  const IS_HTTP = /^https?:$/.test(location.protocol);
  if (!IS_HTTP) return; // skip chrome://, file://, about:blank
  const IS_TOP = window.top === window.self;

  /* =============================
   * Constants
   * ============================= */
  const KEYS = ["name","email","phone","card","address","age","gender","country"];
  const SUBMIT_TEXT_RE = /(log\s*in|sign\s*in|sign\s*up|register|continue|next|submit|create\s*account)/i;

  /* =============================
   * State
   * ============================= */
  let lastInputTs = null; // ms
  let lastSubmitTick = 0; // de-dupe submit bursts

  /* =============================
   * Utils
   * ============================= */
  const sendBg = (type, data = {}) => {
    try { chrome.runtime.sendMessage({ type, data }); } catch {}
  };

  const toMainDomain = (hostname) => {
    try {
      const h = String(hostname || "").toLowerCase();
      const parts = h.startsWith("www.") ? h.slice(4).split(".") : h.split(".");
      if (parts.length <= 2) return parts.join(".");
      const tld = parts.at(-1);
      const sld = parts.at(-2);
      const commonSLD = new Set(["com","co","org","net","gov","ac","edu"]);
      if (tld.length === 2 && commonSLD.has(sld)) return parts.slice(-3).join(".");
      return parts.slice(-2).join(".");
    } catch { return hostname || ""; }
  };

  const closestForm = (el) => el?.closest?.("form") || null;

  const pickVisibleForm = () => {
    const forms = [...document.querySelectorAll("form")];
    const visible = forms.filter(f => {
      const rect = f.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
    return visible[0] || forms[0] || null;
  };

  /* =============================
   * Flag detection (booleans only)
   * ============================= */
  function getFlagsFromForm(form) {
    const flags = Object.fromEntries(KEYS.map(k => [k, false]));
    if (!form) return flags;

    // name - only if field has value
    const nameField = form.querySelector('input[name*="name" i], input[id*="name" i], input[placeholder*="name" i]');
    flags.name = !!(nameField?.value?.trim());

    // email - only if field has value with @
    const emailFields = form.querySelectorAll('input[type="email"], input[name*="email" i], input[placeholder*="email" i]');
    flags.email = [...emailFields].some(i => (i.value || "").includes("@"));

    // phone - only if field has value with 6+ digits
    const phoneFields = form.querySelectorAll('input[type="tel"], input[name*="phone" i], input[name*="mobile" i], input[placeholder*="phone" i]');
    flags.phone = [...phoneFields].some(i => /\d{6,}/.test((i.value || "").replace(/\D/g, "")));

    // card - only if field has value with 12-19 digits
    const cardFields = form.querySelectorAll('input[name*="card" i], input[autocomplete="cc-number"], input[placeholder*="card" i]');
    flags.card = [...cardFields].some(i => /\d{12,19}/.test((i.value || "").replace(/\D/g, "")));

    // address - only if field has value with 5+ characters
    const addressFields = form.querySelectorAll('input[name*="address" i], textarea[name*="address" i], input[placeholder*="address" i]');
    flags.address = [...addressFields].some(i => (i.value || "").trim().length > 5);

    // age - only if field has value
    const ageFields = form.querySelectorAll('input[name*="age" i], input[name*="dob" i], input[type="date"], input[placeholder*="age" i]');
    flags.age = [...ageFields].some(i => (i.value || "").trim() !== "");

    // gender - only if field has value
    const genderFields = form.querySelectorAll('[name*="gender" i], select[name*="gender" i]');
    flags.gender = [...genderFields].some(el =>
      (el.matches('input[type="radio"],input[type="checkbox"]') && el.checked) ||
      (el.matches('select') && (el.value || "").trim() !== "")
    );

    // country - only if field has value
    const countryFields = form.querySelectorAll('select[name*="country" i], input[name*="country" i], input[placeholder*="country" i]');
    flags.country = [...countryFields].some(el => (el.value || "").trim() !== "");

    return flags;
  }

  function toSubmittedFlags(flags) {
    return {
      submitted_name:    !!flags.name,
      submitted_email:   !!flags.email,
      submitted_phone:   !!flags.phone,
      submitted_card:    !!flags.card,
      submitted_address: !!flags.address,
      submitted_age:     !!flags.age,
      submitted_gender:  !!flags.gender,
      submitted_country: !!flags.country,
    };
  }

  /* =============================
   * Track typing time
   * ============================= */
  if (IS_TOP) {
    document.addEventListener("input", (e) => {
      if (e.isTrusted && (e.target.matches("input, textarea") || e.target.isContentEditable)) {
        lastInputTs = Date.now();
      }
    }, { capture: true, passive: true });
  }

  /* =============================
   * Build & send submit payload
   * ============================= */
  function sendSubmitFromForm(form, trigger) {
    const now = Date.now();
    if (now - lastSubmitTick < 2000) return; // 2s de-dupe
    lastSubmitTick = now;

    const flags = getFlagsFromForm(form);
    const anyTrue = Object.values(flags).some(Boolean);
    
    console.log("[content] Form submission detected:", {
      trigger,
      hostname: location.hostname,
      flags,
      anyTrue,
      form: form ? "found" : "not found"
    });
    
    if (!anyTrue) {
      console.log("[content] No form fields with values detected, skipping submission");
      return; // only if at least one flag is true
    }

    const submitted = toSubmittedFlags(flags);
    const payload = {
      hostname: location.hostname,
      path: location.pathname + location.search,
      title: (document.title || "").slice(0, 200),
      last_input_time: lastInputTs ? new Date(lastInputTs).toISOString() : null,
      fields_detected: { ...flags }, // JSONB-friendly for backend
      ...submitted,                  // compatibility for servers expecting submitted_*
      trigger
    };

    console.log("[content] Sending FORM_SUBMIT to background:", payload);
    sendBg("FORM_SUBMIT", payload);
  }

  /* =============================
   * Case 1: Real <form> submissions (top frame only)
   * ============================= */
  if (IS_TOP) {
    window.addEventListener("submit", (e) => {
      try {
        const form = e?.target;
        if (!form || form.tagName !== "FORM") return;
        sendSubmitFromForm(form, "form_submit");
      } catch {}
    }, { capture: true });
  }

  /* =============================
   * Case 2: SPA buttons (no <form> submit)
   * ============================= */
  if (IS_TOP) {
    window.addEventListener("click", (e) => {
      try {
        const el = e.target;
        if (!el) return;

        const tag  = (el.tagName || "").toLowerCase();
        const type = (el.getAttribute?.("type") || "").toLowerCase();
        const text = (el.innerText || el.textContent || "").toLowerCase();

        const looksLikeSubmit =
          (tag === "button" && (type === "submit" || SUBMIT_TEXT_RE.test(text))) ||
          (tag === "input"  && (type === "submit" || SUBMIT_TEXT_RE.test(text))) ||
          SUBMIT_TEXT_RE.test(text);

        if (!looksLikeSubmit) return;

        const form = closestForm(el) || pickVisibleForm();
        if (!form) return;

        sendSubmitFromForm(form, "button_click");
      } catch {}
    }, { capture: true });
  }

  /* =============================
   * Commit hint from background (top frame only)
   * ============================= */
  chrome.runtime.onMessage.addListener((msg) => {
    if (!IS_TOP) return;
    if (msg?.type === "PDPD_REQUEST_COMMIT") {
      const form = pickVisibleForm();
      if (form) sendSubmitFromForm(form, "webRequest_form_detected");
    }
  });

  /* =============================
   * One-time PAGE_VISIT (top frame)
   * ============================= */
  if (IS_TOP) {
    const url = new URL(location.href);
    sendBg("PAGE_VISIT", {
      hostname: url.hostname,
      main_domain: toMainDomain(url.hostname),
      path: url.pathname + url.search,
      title: document.title || "",
      event_type: "visit",
      last_input_time: null,
      screen_time_seconds: 0
    });
  }

  /* =============================
   * Optional visibility/activity pings
   * ============================= */
  if (IS_TOP) {
    document.addEventListener("visibilitychange", () => {
      sendBg(document.visibilityState === "visible" ? "PAGE_VISIBLE" : "PAGE_HIDDEN");
    });

    let lastAct = 0;
    const ACT_MS = 4000;
    const ping = () => {
      const t = Date.now();
      if (t - lastAct >= ACT_MS) {
        lastAct = t;
        sendBg("USER_ACTIVITY");
      }
    };
    ["mousemove","keydown","click","scroll","touchstart"].forEach(evt =>
      window.addEventListener(evt, ping, { capture: true, passive: true })
    );
  }
})();
