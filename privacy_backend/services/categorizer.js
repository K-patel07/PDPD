// services/categorizer.js
const DOMAIN_MAP = require('./domainMap');

const ALIASES = { }; // tweak if needed
const KEYS = Object.keys(DOMAIN_MAP).sort((a, b) => b.length - a.length);

function normHost(input = '') {
  let h = String(input).trim().toLowerCase();
  try { if (h.includes('://')) h = new URL(h).hostname.toLowerCase(); } catch {}
  if (h.startsWith('www.')) h = h.slice(4);
  const i = h.indexOf(':'); if (i > -1) h = h.slice(0, i);
  return h;
}
const alias = c => ALIASES[c] || c;

function matchHost(host) {
  if (DOMAIN_MAP[host]) return { category: alias(DOMAIN_MAP[host]), confidence: 1.0, method: 'domainMap', matched: host };
  for (const key of KEYS) {
    if (host === key || host.endsWith('.' + key)) {
      return { category: alias(DOMAIN_MAP[key]), confidence: 0.97, method: 'domainMap', matched: key };
    }
  }
  return { category: 'Others', confidence: 0, method: 'domainMap', matched: null };
}

// keep the exact name your routes call:
async function detectCategoryForVisit({ hostname } = {}) {
  const host = normHost(hostname);
  if (!host) return { category: 'Others', confidence: 0, method: 'domainMap', matched: null };
  return matchHost(host);
}

module.exports = { detectCategoryForVisit };
