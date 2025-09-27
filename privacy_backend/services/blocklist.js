// services/blocklist.js
const https = require("https");

let trackerDomains = new Set();

// Fetch blocklist dynamically from GitHub
function fetchBlocklist() {
  return new Promise((resolve, reject) => {
    const url = "https://raw.githubusercontent.com/smed79/easylist-hosts/master/hosts";

    https.get(url, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        const lines = data.split("\n");
        trackerDomains.clear();
        for (const line of lines) {
          const domain = line.trim().replace(/^0\.0\.0\.0\s+/, "");
          if (domain && !domain.startsWith("#")) {
            trackerDomains.add(domain);
          }
        }
        console.log(`[blocklist] Loaded ${trackerDomains.size} tracker domains`);
        resolve();
      });
    }).on("error", (err) => {
      console.error("[blocklist] Failed to fetch remote list:", err);
      reject(err);
    });
  });
}

// ✅ Initialize at server startup
async function initBlocklist() {
  try {
    await fetchBlocklist();
    // Auto-refresh every 24h
    setInterval(fetchBlocklist, 24 * 60 * 60 * 1000);
  } catch (err) {
    console.error("[blocklist] Init failed", err);
  }
}

// ✅ Export both functions
function isTracker(hostname) {
  return trackerDomains.has(hostname);
}

module.exports = { initBlocklist, isTracker };
