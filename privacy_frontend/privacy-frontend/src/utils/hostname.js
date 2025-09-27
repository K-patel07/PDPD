// src/utils/hostname.js
export function normalizeHost(input = '') {
  try {
    let h = String(input || '').toLowerCase().trim();
    if (!h) return '';
    if (!/^[a-z0-9.-]+$/.test(h)) {
      const u = new URL(h);
      h = u.hostname || h;
    }
    if (h.startsWith('www.')) h = h.slice(4);
    h = h.replace(/\.+/g, '.').replace(/^\.+|\.+$/g, '');
    return h;
  } catch {
    return String(input || '').toLowerCase().replace(/^www\./, '');
  }
}

