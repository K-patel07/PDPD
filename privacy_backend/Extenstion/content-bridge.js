// Runs on your dashboard domain (as declared in manifest "content_scripts")

// 1) Keep: receive auth updates from your app and persist to extension storage
window.addEventListener('message', (event) => {
  if (!event?.data || event.origin !== window.origin) return;
  const { type, token, ext_user_id } = event.data;
  if (type === 'PP_AUTH_UPDATE' && ext_user_id) {
    chrome.storage.local.set({ token, ext_user_id });
  }
});

// 2) New: allow the popup to navigate this already-logged-in tab to a route
//    Popup sends: chrome.tabs.sendMessage(tabId, { type: 'PP_NAV', path: '/site?...' })
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'PP_NAV') return; // ignore other messages

  const next = msg.path || '/';
  try {
    // Prefer SPA navigation (React Router): updates URL without full reload
    if (window.history && typeof window.history.pushState === 'function') {
      window.history.pushState({}, '', next);
      // Let your router react (React Router listens to popstate)
      window.dispatchEvent(new Event('popstate'));
    } else {
      // Fallback to hard navigation
      window.location.assign(next);
    }
    sendResponse?.({ ok: true });
  } catch (e) {
    // Ultimate fallback: hard navigate
    try { window.location.assign(next); } catch {}
    sendResponse?.({ ok: false, error: String(e) });
  }

  // Not using async sendResponse; return false
});

