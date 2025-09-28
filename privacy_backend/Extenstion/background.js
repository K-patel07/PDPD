// background.js — MV3 Service Worker
// Visits + live screen-time + submit enrichment
// Works with content.js that sends: PAGE_VISIT and FORM_SUBMIT

const API_BASE = "http://localhost:3000"; // must match popup

/* =========================
   CONFIG
========================= */
const DEDUPE_MINUTES   = 30; // For PAGE_VISIT seed per (ext_user_id|host)
const IDLE_SECONDS     = 600; // 10 minutes idle cutoff
const MIN_SEND_DELTA   = 3; // Ignore tiny deltas (<3s)
const FLUSH_EVERY_MIN  = 1; // Alarm period (min 1m in MV3)
const SUBMIT_DEDUPE_MS = 5000; // Debounce for commit per tab/host

/* =========================
   INTERNAL STATE
========================= */
const lastSeededVisit = new Map();           // `${ext_user_id}|${hostname}` -> ts
const lastCommitByTabHost = new Map();       // `${tabId}|${host}` -> ts
let current = {
  state: "PAUSED_BACKGROUND",  // COUNTING | PAUSED_BACKGROUND | PAUSED_IDLE
  tabId: null,
  windowId: null,
  hostname: null,
  startedAt: null,             // ms for current counting segment
  lastIdleState: "active",     // 'active' | 'idle' | 'locked'
};

/* =========================
   SMALL HELPERS
========================= */
async function isEnabled() {
  const { enabled } = await chrome.storage.local.get("enabled");
  return enabled !== false; // default ON
}

async function getExtUserId() {
  let { ext_user_id } = await chrome.storage.local.get("ext_user_id");
  if (!ext_user_id) {
    ext_user_id = "ext-" + crypto.randomUUID();
    await chrome.storage.local.set({ ext_user_id });
  }
  return ext_user_id;
}

async function getIdentity() {
  const [ext_user_id, { token }] = await Promise.all([
    getExtUserId(),
    chrome.storage.local.get("token")
  ]);
  return { ext_user_id, token };
}

function isHttpUrl(url = "") {
  try { const u = new URL(url); return u.protocol === "http:" || u.protocol === "https:"; }
  catch { return false; }
}

function getHostname(url = "") {
  try {
    const u = new URL(url);
    let h = (u.hostname || "").toLowerCase();
    return h.replace(/^www\./, "");
  } catch { return ""; }
}

function ymd(ts) {
  const d = new Date(ts);
  return d.toISOString().slice(0, 10);
}

async function addSecondsToStorage(hostname, dateKey, seconds) {
  if (!hostname || !dateKey || seconds <= 0) return;
  const key = "totals";
  const store = await chrome.storage.local.get(key);
  const totals = store[key] || {};
  totals[dateKey] = totals[dateKey] || {};
  totals[dateKey][hostname] = (totals[dateKey][hostname] || 0) + seconds;
  await chrome.storage.local.set({ [key]: totals });
}

async function getTodayTotals() {
  const store = await chrome.storage.local.get("totals");
  return store["totals"] || {};
}

function splitAcrossMidnight(startMs, endMs) {
  const out = [];
  let t0 = startMs;
  while (t0 < endMs) {
    const startDate = new Date(t0);
    const dayEnd = new Date(startDate);
    dayEnd.setHours(23, 59, 59, 999);
    const segmentEnd = Math.min(endMs, dayEnd.getTime() + 1);
    const secs = Math.floor((segmentEnd - t0) / 1000);
    out.push({ dateKey: ymd(t0), seconds: secs });
    t0 = segmentEnd;
  }
  return out;
}

async function estimateScreenTimeFor(hostname) {
  const totals = await getTodayTotals();
  const today = ymd(Date.now());
  const stored = totals?.[today]?.[hostname] || 0;
  let running = 0;
  if (current.state === "COUNTING" && current.hostname === hostname && current.startedAt) {
    running = Math.max(0, Math.floor((Date.now() - current.startedAt) / 1000));
  }
  return stored + running;
}

/* =========================
   NETWORK HELPERS
========================= */
async function postJSON(path, bodyObj) {
  const { token } = await getIdentity();
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(bodyObj),
  }).catch((err) => {
    console.warn(`[postJSON ${path}] error:`, err);
    return null;
  });
  return !!(res && res.ok);
}

async function sendVisit(payload) {
  const { ext_user_id } = await getIdentity();
  return postJSON("/api/track/visit", { ...payload, ext_user_id });
}

async function sendSubmit(payload) {
  const { ext_user_id } = await getIdentity();

  // Guard: ensure at least one meaningful flag
  const fd = payload.fields_detected || {};
  const hasFD = fd && typeof fd === "object" && Object.values(fd).some(Boolean);
  const submittedKeys = [
    "submitted_name","submitted_email","submitted_phone","submitted_card",
    "submitted_address","submitted_age","submitted_gender","submitted_country"
  ];
  const hasSubmitted = submittedKeys.some(k => !!payload[k]);
  if (!hasFD && !hasSubmitted) return false;

  return postJSON("/api/track/submit", { ...payload, ext_user_id });
}

async function flushDelta(hostname, seconds) {
  if (!hostname || seconds < MIN_SEND_DELTA) return;
  await sendVisit({
    hostname,
    screen_time_seconds: seconds,
    event_type: "visit_end",
  });
}

/* =========================
   SEED VISIT
========================= */
async function seedVisitIfNeeded(tab) {
  if (!tab || !isHttpUrl(tab.url)) return;
  const host = getHostname(tab.url);
  if (!host) return;

  const { ext_user_id } = await getIdentity();
  const key = `${ext_user_id}|${host}`;
  const now = Date.now();
  const last = lastSeededVisit.get(key) || 0;
  if (now - last < DEDUPE_MINUTES * 60 * 1000) return;

  const url = new URL(tab.url);
  const ok = await sendVisit({
    hostname: host,
    path: url.pathname + url.search,
    title: tab.title || "",
    event_type: "visit",
  });

  if (ok) lastSeededVisit.set(key, now);
}

/* =========================
   STATE MACHINE
========================= */
async function stopCounting(reason = "background") {
  if (current.state === "COUNTING" && current.hostname && current.startedAt) {
    const now = Date.now();
    const elapsedSec = Math.floor((now - current.startedAt) / 1000);
    if (elapsedSec > 0) {
      const segments = splitAcrossMidnight(current.startedAt, now);
      for (const seg of segments) {
        await addSecondsToStorage(current.hostname, seg.dateKey, seg.seconds);
      }
      await flushDelta(current.hostname, elapsedSec);
    }
  }
  current.state = (reason === "idle") ? "PAUSED_IDLE" : "PAUSED_BACKGROUND";
  current.startedAt = null;
  await cancelFlushAlarm().catch(() => {});
}

async function startCounting(tab) {
  if (!(await isEnabled())) { await stopCounting("background"); return; }
  if (!tab || !isHttpUrl(tab.url)) { await stopCounting("background"); return; }

  const host = getHostname(tab.url);
  if (!host) { await stopCounting("background"); return; }

  if (current.state === "COUNTING") {
    if (current.hostname !== host || current.tabId !== tab.id || current.windowId !== tab.windowId) {
      await stopCounting("background");
    }
  }

  let winFocused = false;
  try { const win = await chrome.windows.get(tab.windowId); winFocused = !!win.focused; } catch {}

  const canCount = (current.lastIdleState === "active") && winFocused && !!tab.active;
  if (!canCount) { await stopCounting("background"); return; }

  await seedVisitIfNeeded(tab);

  current.hostname = host;
  current.tabId    = tab.id;
  current.windowId = tab.windowId;
  current.startedAt = Date.now();
  current.state = "COUNTING";

  await ensureFlushAlarm();
}

/* =========================
   PERIODIC FLUSH (alarms)
========================= */
const ALARM_NAME = "ppd-flush";

async function ensureFlushAlarm() {
  const existing = await chrome.alarms.get(ALARM_NAME);
  if (!existing) await chrome.alarms.create(ALARM_NAME, { periodInMinutes: FLUSH_EVERY_MIN });
}
async function cancelFlushAlarm() {
  await chrome.alarms.clear(ALARM_NAME);
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  if (current.state !== "COUNTING" || !current.hostname || !current.startedAt) return;

  const now = Date.now();
  const delta = Math.floor((now - current.startedAt) / 1000);
  if (delta >= MIN_SEND_DELTA) {
    const segments = splitAcrossMidnight(current.startedAt, now);
    for (const seg of segments) {
      await addSecondsToStorage(current.hostname, seg.dateKey, seg.seconds);
    }
    await flushDelta(current.hostname, delta);
    current.startedAt = now; // continue counting
  }
});

async function onAuthSuccess(data) {
  // data should contain { token, ext_user_id, dashboard_url? }
  await chrome.storage.local.set({
    auth_token: data.token,
    ext_user_id: data.ext_user_id,
    dashboard_url: "https://your-dashboard.example", // optional
    popup_status: "ON"
  });
}
/* =========================
   MESSAGE HANDLERS
========================= */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.type === "PAGE_VISIT") {
        const payload  = msg.data || msg.payload || msg.body || {};
        const hostname = payload.hostname;
        if (!hostname) { sendResponse({ ok: false, error: "hostname missing" }); return; }

        const { ext_user_id } = await getIdentity();
        const key = `${ext_user_id}|${hostname}`;
        const now = Date.now();
        const last = lastSeededVisit.get(key) || 0;
        if (now - last < DEDUPE_MINUTES * 60 * 1000) {
          sendResponse({ ok: true, deduped: true });
          return;
        }

        const ok = await sendVisit({
          hostname,
          main_domain: payload.main_domain, // pass-through if present
          path: payload.path || "",
          title: payload.title || "",
          event_type: "visit",
        });
        if (ok) lastSeededVisit.set(key, now);
        sendResponse({ ok });
        return;
      }

      if (msg?.type === "FORM_SUBMIT") {
        const data = msg.data || msg.payload || {};
        if (!data?.hostname) { sendResponse({ ok: false, error: "hostname missing" }); return; }

        const screen_time_seconds = await estimateScreenTimeFor(data.hostname);
        const ok = await sendSubmit({ ...data, screen_time_seconds });
        sendResponse({ ok });
        return;
      }

      // Optional accuracy boosters
      if (msg?.type === "PAGE_VISIBLE") {
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        if (tab) await startCounting(tab);
        sendResponse({ ok: true }); return;
      }
      if (msg?.type === "PAGE_HIDDEN") {
        await stopCounting("background");
        sendResponse({ ok: true }); return;
      }
      if (msg?.type === "USER_ACTIVITY") {
        current.lastIdleState = "active";
        sendResponse({ ok: true }); return;
      }
    } catch (e) {
      console.warn("[bg] message error:", e);
      sendResponse({ ok: false, error: String(e?.message || e) });
    }
  })();
  return true;
});

/* =========================
   EVENT WIRING
========================= */
chrome.runtime.onInstalled.addListener(() => {
  chrome.idle.setDetectionInterval(IDLE_SECONDS);
  chrome.storage.local.get("enabled").then(({ enabled }) => {
    if (enabled === undefined) chrome.storage.local.set({ enabled: true }); // default ON
  });
});
chrome.runtime.onStartup.addListener(() => {
  chrome.idle.setDetectionInterval(IDLE_SECONDS);
});

chrome.idle.onStateChanged.addListener(async (newState) => {
  current.lastIdleState = newState;
  if (newState === "active") {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab && tab.id != null) await startCounting(tab);
  } else {
    await stopCounting("idle");
  }
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try { const tab = await chrome.tabs.get(tabId); await startCounting(tab); }
  catch { await stopCounting("background"); }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (tab.active !== true) return;
  if (changeInfo.status === "complete") await seedVisitIfNeeded(tab);
  if (changeInfo.url) await startCounting(tab);
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) { await stopCounting("background"); return; }
  try {
    const [tab] = await chrome.tabs.query({ active: true, windowId });
    if (tab && tab.id != null) await startCounting(tab);
    else await stopCounting("background");
  } catch { await stopCounting("background"); }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  if (current.tabId === tabId) {
    await stopCounting("background");
    current.tabId = null; current.windowId = null; current.hostname = null;
  }
});

/* =========================
   FORM POST DETECTION (HTML forms only)
========================= */
// Requires permissions in manifest: "webRequest", "webRequestBlocking" (optional), "<all_urls>"
chrome.webRequest.onBeforeRequest.addListener(
  async (details) => {
    if (!(await isEnabled())) return;
    if (details.method !== "POST" || details.tabId < 0) return;

    // Only real HTML form posts (not fetch/XHR)
    if (!details.requestBody || !details.requestBody.formData) return;

    // Top frame only
    if (details.frameId !== 0) return;

    // First-party only (request host == active tab host)
    let reqHost = "";
    try { reqHost = new URL(details.url).hostname.replace(/^www\./, ""); } catch {}
    let tabHost = "";
    try {
      const tab = await chrome.tabs.get(details.tabId);
      tabHost = new URL(tab.url).hostname.replace(/^www\./, "");
    } catch {}
    if (!reqHost || !tabHost || reqHost !== tabHost) return;

    // De-dupe per tab/host
    const now = Date.now();
    const key = `${details.tabId}|${reqHost}`;
    const last = lastCommitByTabHost.get(key) || 0;
    if (now - last < SUBMIT_DEDUPE_MS) return;
    lastCommitByTabHost.set(key, now);

    try { chrome.tabs.sendMessage(details.tabId, { type: "PDPD_REQUEST_COMMIT" }).catch(() => {}); }
    catch (err) { console.warn("[bg] onBeforeRequest error:", err); }
  },
  { urls: ["<all_urls>"] },
  ["requestBody"]
);
