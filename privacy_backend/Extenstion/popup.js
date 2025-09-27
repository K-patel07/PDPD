// ---------- KEEP: your existing toggle logic ----------
async function getEnabled() {
  const { enabled } = await chrome.storage.local.get("enabled");
  return enabled === true; // explicit true = ON
}
async function setEnabled(val) {
  await chrome.storage.local.set({ enabled: !!val });
}

function render(isOn) {
  const s = document.getElementById("status");
  const b = document.getElementById("toggle");
  if (isOn) {
    s.textContent = "ON"; s.className = "on";
    b.textContent = "Turn OFF";
  } else {
    s.textContent = "OFF"; s.className = "off";
    b.textContent = "Turn ON";
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  const isOn = await getEnabled();
  render(isOn);
  const t = document.getElementById("toggle");
  if (t) {
    t.addEventListener("click", async () => {
      const cur = await getEnabled();
      await setEnabled(!cur);
      render(!cur);
    });
  }
});

// ---------- NEW: dashboard-style data display (popup-only) ----------
const API_BASE = (typeof window !== 'undefined' && window.API_BASE) || "http://localhost:3000";

function ok(res){
  if(!res.ok) throw new Error(`HTTP ${res.status}`);
  const ct = res.headers.get('content-type') || '';
  if(!ct.includes('application/json')) return res.json().catch(()=>({}));
  return res.json();
}

function fmtDur(mins){
  if(mins == null) return '—';
  const m = Math.max(0, Math.round(mins));
  const h = Math.floor(m/60);
  const mm = m%60;
  return `${h} h ${mm.toString().padStart(2,'0')} mins`;
}

function setNeedle(pct){
  const clamped = Math.max(0, Math.min(100, Number(pct)||0));
  const deg = -90 + (clamped * 1.8); // 0..100 -> -90..+90
  const needle = document.getElementById('needle');
  if (needle) needle.style.transform = `rotate(${deg}deg)`;
  const rp = document.getElementById('riskPct');
  if (rp) rp.textContent = `${Math.round(clamped)}%`;
}

function setFieldsGrid(fields){
  const grid = document.getElementById('fieldsGrid');
  if (!grid) return;
  grid.innerHTML = '';
  const labels = [
    ['name','Name'],
    ['email','Email'],
    ['phone','Phone Number'],
    ['address','Address'],
    ['gender','Gender'],
    ['bank','Bank Details'],
    ['country','Country'],
    ['other','XXXXXX']
  ];
  const f = fields || {};
  labels.forEach(([key,label])=>{
    const div = document.createElement('div');
    div.className = 'fld';
    const dot = document.createElement('span');
    dot.className = 'dot' + (f[key] ? ' on':'');
    const txt = document.createElement('span');
    txt.textContent = label;
    div.appendChild(dot); div.appendChild(txt);
    grid.appendChild(div);
  });
}

async function getIdentity(){
  const { ext_user_id, token } = await chrome.storage.local.get(['ext_user_id','token']);
  return { ext_user_id, token };
}

async function getActiveUrl(){
  const [tab] = await chrome.tabs.query({ active:true, currentWindow:true });
  try{
    const u = new URL(tab.url);
    return { hostname: u.hostname, path: u.pathname || '/', url: u.href };
  }catch{ return { hostname:'', path:'/', url:'' }; }
}

function authHeaders(token){
  const h = { 'Content-Type':'application/json' };
  if(token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

// ---- Try aggregated endpoint first, else stitch from others
async function fetchSiteCard(base, id, token, hostname, path){
  const url = `${base}/api/metrics/site-card?ext_user_id=${encodeURIComponent(id)}&hostname=${encodeURIComponent(hostname)}&path=${encodeURIComponent(path)}`;
  const r = await fetch(url, { headers: authHeaders(token) });
  if(!r.ok) throw new Error('no site-card');
  const j = await r.json();
  return {
    title: j?.data?.title || hostname,
    minutes: j?.data?.minutes ?? j?.data?.screen_minutes ?? j?.data?.screenTimeMins,
    fields: j?.data?.fields || j?.data?.fields_detected || {},
    riskPct: j?.data?.riskPct ?? j?.data?.risk_percent ?? j?.data?.risk,
    riskText: j?.data?.riskText || j?.data?.risk_label || 'Unknown Risk Level'
  };
}

async function fetchStitched(base, id, token, hostname, path){
  const headers = authHeaders(token);
  const safeGet = async (u, pick) => {
    try { const j = await fetch(u, { headers }).then(ok); return pick(j) }
    catch { return undefined }
  };

  const minutes = await safeGet(
    `${base}/api/metrics/screen-time?ext_user_id=${encodeURIComponent(id)}&hostname=${encodeURIComponent(hostname)}`,
    j => j?.data?.minutes ?? j?.minutes
  );

  const fields = await safeGet(
    `${base}/api/metrics/fields?ext_user_id=${encodeURIComponent(id)}&hostname=${encodeURIComponent(hostname)}&path=${encodeURIComponent(path)}`,
    j => j?.data?.fields || j?.fields
  );

  const risk = await safeGet(
    `${base}/api/risk/site?ext_user_id=${encodeURIComponent(id)}&hostname=${encodeURIComponent(hostname)}`,
    j => ({ pct: j?.data?.riskPct ?? j?.riskPct ?? j?.risk, label: j?.data?.label || j?.label })
  );

  return {
    title: hostname,
    minutes,
    fields,
    riskPct: risk?.pct,
    riskText: risk?.label || 'Unknown Risk Level'
  };
}

(async function main(){
  if (document.readyState === 'loading') {
    await new Promise(r => document.addEventListener('DOMContentLoaded', r, { once:true }));
  }

  const els = {
    title: document.getElementById('siteTitle'),
    time:  document.getElementById('screenTime'),
    riskT: document.getElementById('riskText')
  };

  const [{ ext_user_id, token }, { hostname, path }] = await Promise.all([getIdentity(), getActiveUrl()]);
  if (els.title) els.title.textContent = hostname || 'Unknown site';

  if(!ext_user_id || !hostname){
    setFieldsGrid({});
    setNeedle(0);
    if (els.time)  els.time.textContent = '—';
    if (els.riskT) els.riskT.textContent = 'Unknown Risk Level';
    return;
  }

  let card;
  try { card = await fetchSiteCard(API_BASE, ext_user_id, token, hostname, path); }
  catch { card = await fetchStitched(API_BASE, ext_user_id, token, hostname, path); }

  if (els.title) els.title.textContent = card.title || hostname;
  if (els.time)  els.time.textContent = fmtDur(card.minutes);
  setFieldsGrid(card.fields);
  setNeedle(card.riskPct ?? 0);
  if (els.riskT) els.riskT.textContent = card.riskText || 'Unknown Risk Level';
})();

// ----- Go to Dashboard button (reuse existing logged-in tab if present) -----
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('dashboardLink');
  if (!btn) return;

  btn.addEventListener('click', async (e) => {
    e.preventDefault();

    const [{ ext_user_id }, { hostname }] = await Promise.all([getIdentity(), getActiveUrl()]);
    const dashBase = 'http://localhost:5173';                // change if your dev base differs
    const targetPath = `/site?host=${encodeURIComponent(hostname)}&uid=${encodeURIComponent(ext_user_id || '')}`;
    const targetUrl  = `${dashBase}${targetPath}`;

    // Find an existing dashboard tab first (already logged in)
    chrome.tabs.query({ url: `${dashBase}/*` }, async (tabs) => {
      if (tabs && tabs.length > 0) {
        const t = tabs[0];
        await chrome.tabs.update(t.id, { active: true });
        // Ask the content script in that tab to navigate internally
        chrome.tabs.sendMessage(t.id, { type: 'PP_NAV', path: targetPath }, () => {
          // If no content script or messaging failed, hard-navigate
          if (chrome.runtime.lastError) chrome.tabs.update(t.id, { url: targetUrl });
        });
      } else {
        // No existing tab → open directly
        chrome.tabs.create({ url: targetUrl });
      }
    });
  });
});
