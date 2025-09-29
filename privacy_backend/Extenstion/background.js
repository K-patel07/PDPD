// background.js — MV3 Service Worker
// Visits + live screen-time + submit enrichment
// Works with content.js that sends: PAGE_VISIT and FORM_SUBMIT

const API_BASE = "https://privacypulse-9xnj.onrender.com"; // production backend

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
  // Always use the same user ID as the dashboard for consistency
  const ext_user_id = "f5ea28c1-6037-4340-a3dd-bfcbfde2e51d";
  await chrome.storage.local.set({ ext_user_id });
  return ext_user_id;
}

async function getIdentity() {
  const [ext_user_id, storage] = await Promise.all([
    getExtUserId(),
    chrome.storage.local.get(["token", "auth_token"])
  ]);
  
  const token = storage.auth_token || storage.token;
  // Only log when token is expected but missing (e.g., during form submission)
  // Don't log for normal visit tracking which works without authentication
  
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
   OFFLINE QUEUE & RETRY LOGIC
========================= */
const OFFLINE_QUEUE_KEY = "offline_queue";
const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 5000, 15000]; // 1s, 5s, 15s

async function addToOfflineQueue(payload) {
  const { [OFFLINE_QUEUE_KEY]: queue = [] } = await chrome.storage.local.get(OFFLINE_QUEUE_KEY);
  queue.push({
    ...payload,
    timestamp: Date.now(),
    retryCount: 0
  });
  await chrome.storage.local.set({ [OFFLINE_QUEUE_KEY]: queue });
}

async function processOfflineQueue() {
  const { [OFFLINE_QUEUE_KEY]: queue = [] } = await chrome.storage.local.get(OFFLINE_QUEUE_KEY);
  if (queue.length === 0) return;

  const now = Date.now();
  const toProcess = [];
  const toKeep = [];

  for (const item of queue) {
    const age = now - item.timestamp;
    const shouldRetry = item.retryCount < MAX_RETRIES && age > RETRY_DELAYS[item.retryCount];
    
    if (shouldRetry) {
      toProcess.push(item);
    } else if (item.retryCount < MAX_RETRIES) {
      toKeep.push(item);
    }
    // Items that exceed max retries are dropped
  }

  if (toProcess.length > 0) {
    for (const item of toProcess) {
      const { path, bodyObj, ...rest } = item;
      const success = await postJSON(path, bodyObj);
      
      if (success) {
        console.log(`[offline] Successfully sent queued item: ${path}`);
      } else {
        item.retryCount++;
        toKeep.push(item);
      }
    }
    
    await chrome.storage.local.set({ [OFFLINE_QUEUE_KEY]: toKeep });
  }
}

/* =========================
   NETWORK HELPERS
========================= */
async function postJSON(path, bodyObj, retryCount = 0, useAuth = true) {
  const { token } = await getIdentity();
  const headers = { "Content-Type": "application/json" };
  if (useAuth && token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout for Render

    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(bodyObj),
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    if (res.ok) {
      return true;
    } else if (res.status === 502 && retryCount < 2) {
      // Retry 502 errors up to 2 times with exponential backoff
      const delay = Math.min(10000, 2000 * Math.pow(2, retryCount)); // 2s, 4s, 8s max
      console.log(`[postJSON ${path}] HTTP 502, retrying in ${delay}ms (attempt ${retryCount + 1})`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return postJSON(path, bodyObj, retryCount + 1, useAuth);
    } else if (res.status === 204) {
      // 204 No Content is actually a success response
      return true;
    } else {
      console.warn(`[postJSON ${path}] HTTP ${res.status}: ${res.statusText}`);
      return false;
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      console.warn(`[postJSON ${path}] Request timeout`);
    } else if (retryCount < 1) {
      // Retry network errors only once
      const delay = 5000;
      console.log(`[postJSON ${path}] Network error, retrying in ${delay}ms (attempt ${retryCount + 1}):`, err.message);
      await new Promise(resolve => setTimeout(resolve, delay));
      return postJSON(path, bodyObj, retryCount + 1, useAuth);
    } else {
      console.warn(`[postJSON ${path}] Network error after retries:`, err.message);
    }
    return false;
  }
}

async function sendVisit(payload) {
  const { ext_user_id, token } = await getIdentity();
  
  console.log(`[sendVisit] Tracking visit to ${payload.hostname} for user ${ext_user_id}`);
  
  // Try without authentication first (visit tracking should work without auth)
  let success = await postJSON("/api/track/visit", { ...payload, ext_user_id }, 0, false);
  
  if (!success && token) {
    // If unauthenticated fails and we have a token, try with auth
    success = await postJSON("/api/track/visit", { ...payload, ext_user_id }, 0, true);
  }
  
  if (success) {
    console.log(`[sendVisit] Successfully tracked visit to ${payload.hostname}`);
  } else {
    console.warn(`[sendVisit] Failed to track visit to ${payload.hostname}, queuing for retry`);
    // Queue for retry when offline
    await addToOfflineQueue({
      path: "/api/track/visit",
      bodyObj: { ...payload, ext_user_id }
    });
  }
  
  return success;
}

async function sendSubmit(payload) {
  const { ext_user_id, token } = await getIdentity();

  // Reduced logging for form submissions
  console.log("[sendSubmit] Processing form submission for:", payload.hostname);

  // Guard: ensure at least one meaningful flag
  const fd = payload.fields_detected || {};
  const hasFD = fd && typeof fd === "object" && Object.values(fd).some(Boolean);
  const submittedKeys = [
    "submitted_name","submitted_email","submitted_phone","submitted_card",
    "submitted_address","submitted_age","submitted_gender","submitted_country"
  ];
  const hasSubmitted = submittedKeys.some(k => !!payload[k]);
  
  // Reduced logging for form validation
  
  if (!hasFD && !hasSubmitted) {
    console.log("[sendSubmit] No form fields detected, skipping");
    return false;
  }

  // Skip if no authentication token
  if (!token) {
    // Only log once per session to avoid spam
    const lastLogKey = "last_token_warning";
    const { [lastLogKey]: lastLog } = await chrome.storage.local.get(lastLogKey);
    const now = Date.now();
    
    if (!lastLog || now - lastLog > 300000) { // 5 minutes
      console.log("[sendSubmit] Form tracking requires authentication. Please log in via the extension options page");
      await chrome.storage.local.set({ [lastLogKey]: now });
    }
    return false;
  }

  // postJSON now handles retries internally
  const success = await postJSON("/api/track/submit", { ...payload, ext_user_id }, 0, true);
  
  if (success) {
    console.log(`[sendSubmit] Successfully sent form submission for ${payload.hostname}`);
  } else {
    console.warn(`[sendSubmit] Failed to send form submission for ${payload.hostname}, queuing for offline retry`);
    // Queue for retry when offline
    await addToOfflineQueue({
      path: "/api/track/submit",
      bodyObj: { ...payload, ext_user_id }
    });
  }
  
  return success;
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
  if (alarm.name === "keepAlive") {
    await keepAlive();
    return;
  }
  
  if (alarm.name !== ALARM_NAME) return;
  
  // Process offline queue first
  await processOfflineQueue();
  
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
    dashboard_url: "https://privacy.pulse-pr5m.onrender.com", // production frontend
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
        if (!data?.hostname) { 
          sendResponse({ ok: false, error: "hostname missing" }); 
          return; 
        }

        const { token } = await getIdentity();
        if (!token) {
          sendResponse({ ok: false, error: "Authentication required. Please log in via the extension options page." });
          return;
        }

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
// Keep backend warm to prevent cold starts
async function keepAlive() {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 second timeout
    
    const res = await fetch(`${API_BASE}/ping`, { 
      method: "GET",
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (res.ok) {
      console.log("[keepAlive] Backend is warm");
    } else {
      console.warn("[keepAlive] Backend ping failed:", res.status);
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      console.warn("[keepAlive] Ping timeout");
    } else {
      console.warn("[keepAlive] Failed to ping backend:", err.message);
    }
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  chrome.idle.setDetectionInterval(IDLE_SECONDS);
  const { enabled } = await chrome.storage.local.get("enabled");
  if (enabled === undefined) await chrome.storage.local.set({ enabled: true }); // default ON
  
  // Process any queued items on startup
  await processOfflineQueue();
  await keepAlive();
  
  // Set up keep-alive alarm (every 2 minutes)
  chrome.alarms.create("keepAlive", { periodInMinutes: 2 });
});
chrome.runtime.onStartup.addListener(async () => {
  chrome.idle.setDetectionInterval(IDLE_SECONDS);
  // Process any queued items on startup
  await processOfflineQueue();
  await keepAlive();
  
  // Set up keep-alive alarm (every 2 minutes)
  chrome.alarms.create("keepAlive", { periodInMinutes: 2 });
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
