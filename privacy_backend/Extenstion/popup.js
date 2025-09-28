// popup.js — PrivacyPulse (MV3) — production

const API_BASE = "https://privacypulse-9xnj.onrender.com"; // production backend

// ----- toggle -----
async function getEnabled() {
  const { enabled } = await chrome.storage.local.get("enabled");
  return enabled === true;
}
async function setEnabled(val) { await chrome.storage.local.set({ enabled: !!val }); }
function renderToggle(isOn) {
  const s = document.getElementById("status-text");
  const b = document.getElementById("toggle-btn");
  if (!s || !b) return;
  if (isOn) { s.textContent = "ON"; s.className = "on"; b.textContent = "Turn OFF"; }
  else { s.textContent = "OFF"; s.className = "off"; b.textContent = "Turn ON"; }
}
function attachToggle() {
  const btn = document.getElementById("toggle-btn");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    const cur = await getEnabled(); await setEnabled(!cur); renderToggle(!cur);
  });
}

// ----- helpers -----
const stripWWW = (h="") => h.toLowerCase().replace(/^www\./, "");
function secondsToPretty(seconds=0){
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), r = s%60;
  if (h>0) return `${h}h ${m}m`; if (m>0) return `${m}m ${r}s`; return `${r}s`;
}
function authHeaders(token){ const h={"Content-Type":"application/json"}; if(token) h.Authorization=`Bearer ${token}`; return h; }
async function fetchJSON(url, token){ const res=await fetch(url,{headers:authHeaders(token)}); if(!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); }

// risk render
function applyRisk(score=0){
  const n = Math.max(0, Math.min(100, Number(score)||0));
  let band = "Unknown";
  if (n>=80) band="Critical"; else if (n>=60) band="High"; else if (n>=40) band="Moderate"; else if (n>=20) band="Low"; else if (n>=1) band="Safe";
  const pctEl=document.getElementById("risk-percent");
  const lblEl=document.getElementById("risk-label");
  const gauge=document.getElementById("risk-gauge");
  if (pctEl) pctEl.textContent = `${Math.round(n)}%`;
  if (lblEl) lblEl.textContent = `${band} Risk Level`;
  if (gauge) {
    gauge.setAttribute("data-risk", band.toLowerCase());
    const deg=(n/100)*180;
    gauge.style.background=`conic-gradient(currentColor 0deg ${deg}deg, #f0f0f0 ${deg}deg 180deg)`;
  }
}

// provided-data pills
const PROVIDED_KEYS = {
  name:["submitted_name"], email:["submitted_email"],
  phone:["submitted_phone","submitted_phone_number"],
  address:["submitted_address"], gender:["submitted_gender"],
  bank:["submitted_bank","submitted_card","submitted_card_details","submitted_bank_details"],
  country:["submitted_country"], other:["submitted_other","submitted_age"]
};
function paintProvidedPills(flags={}){
  const grid=document.getElementById("provided-pill-grid"); if(!grid) return;
  for(const pill of Array.from(grid.querySelectorAll(".pill"))){
    const key=pill.getAttribute("data-field");
    const keys=PROVIDED_KEYS[key]||[];
    pill.classList.toggle("on", keys.some(k=>Boolean(flags[k])));
  }
}

// map your API responses
function pickRiskScore(a){
  if (!a || typeof a!=="object") return 0;
  if (Number.isFinite(a.score)) return Number(a.score);                 // /metrics/site-risk
  if (a.risk && Number.isFinite(a.risk.risk_score)) return Number(a.risk.risk_score); // from provided-data/site
  if (Number.isFinite(a.risk_score)) return Number(a.risk_score);
  if (Number.isFinite(a.combined_risk)) return Number(a.combined_risk);
  return 0;
}
function pickScreenSeconds(a){
  if (!a || typeof a!=="object") return null;
  if (a.screen_time_sum!=null) return Number(a.screen_time_sum);        // provided-data/site
  if (a.screen_time_seconds!=null) return Number(a.screen_time_seconds); // if you add it to site-risk later
  if (a.data?.screen_time_seconds!=null) return Number(a.data.screen_time_seconds);
  return null;
}
function extractFlags(obj){
  if (!obj || typeof obj!=="object") return {};
  const u = obj.fields_union || obj.data?.fields_union || {};
  return {
    submitted_name: !!u.name,
    submitted_email: !!u.email,
    submitted_phone: !!u.phone,
    submitted_address: !!u.address,
    submitted_bank: !!u.card,     // Card Details pill
    submitted_gender: !!u.gender,
    submitted_country: !!u.country,
    submitted_other: !!u.age      // Age pill uses "other"
  };
}

// identity + active tab
async function getIdentity(){
  const { ext_user_id, auth_token, token, dashboard_url } =
    await chrome.storage.local.get(["ext_user_id","auth_token","token","dashboard_url"]);
  return { ext_user_id, token: auth_token || token, dashboard_url };
}
async function getActiveTabInfo(){
  const wins = await chrome.windows.getAll({ populate:true, windowTypes:["normal"] });
  let tab=null;
  const focused=wins.find(w=>w.focused);
  if (focused) tab=focused.tabs.find(t=>t.active)||null;
  if (!tab) for (const w of wins){ const a=w.tabs.find(t=>t.active); if (a){ tab=a; break; } }
  if (!tab) { const all=await chrome.tabs.query({ windowType:"normal" }); all.sort((a,b)=>(b.lastAccessed??0)-(a.lastAccessed??0)); tab=all[0]||null; }
  const raw=tab?.url||tab?.pendingUrl||"";
  try{
    const u=new URL(raw);
    if (!u.hostname || u.protocol.startsWith("chrome")) return { hostname:"", path:"/", full:raw };
    return { hostname: stripWWW(u.hostname), path: u.pathname||"/", full: raw };
  }catch{ return { hostname:"", path:"/", full: raw }; }
}

// ----- main -----
async function init(){
  renderToggle(await getEnabled());

  const hostLabel=document.getElementById("host-label");
  const timeEl   =document.getElementById("screen-time");
  const goBtn    =document.getElementById("go-dashboard");

  const [{ ext_user_id, token, dashboard_url }, { hostname }] =
    await Promise.all([getIdentity(), getActiveTabInfo()]);

  if (hostLabel) hostLabel.textContent = hostname || "Unknown site";
  if (goBtn && dashboard_url) goBtn.href = dashboard_url;

  if (!ext_user_id || !hostname){
    if (timeEl) timeEl.textContent="—";
    applyRisk(0); paintProvidedPills({});
    return;
  }

  const params=new URLSearchParams({ hostname, extUserId: ext_user_id, ext_user_id: ext_user_id });
  const siteRiskURL = `${API_BASE}/api/metrics/site-risk?${params}`;
  const providedURL = `${API_BASE}/api/metrics/provided-data/site?${params}`;

  let riskScore=0, screenSec=null, flags={};

  try{
    const riskJson = await fetchJSON(siteRiskURL, token).catch(()=>null);
    if (riskJson) {
      riskScore = pickRiskScore(riskJson);
      // some builds only return band/score; screen time may not be here
      screenSec = pickScreenSeconds(riskJson);
    }

    const provJson = await fetchJSON(providedURL, token).catch(()=>null);
    if (provJson) {
      // prefer risk from site-risk; else use nested risk here
      if (!riskScore) riskScore = pickRiskScore(provJson);
      if (screenSec==null) screenSec = pickScreenSeconds(provJson);
      flags = extractFlags(provJson);
    }
  }catch(e){
    // soft fail — leave defaults
  }

  if (timeEl) timeEl.textContent = screenSec!=null ? secondsToPretty(screenSec) : "—";
  applyRisk(riskScore);
  paintProvidedPills(flags);
}

document.addEventListener("DOMContentLoaded", () => {
  attachToggle();
  init();
});
