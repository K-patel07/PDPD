/**
 * Clean hostname into a root domain.
 * Avoids `.com.com` or `.com.au.com.au`.
 */
function cleanHostname(hostname) {
  if (!hostname) return "";

  // Lowercase + trim
  let h = hostname.toLowerCase().trim();

  // Remove leading "www."
  if (h.startsWith("www.")) {
    h = h.slice(4);
  }

  // Split by dot
  const parts = h.split(".");
  if (parts.length <= 2) {
    return h; // e.g. google.com, localhost
  }

  // Handle common 2-level TLDs
  const specialTLDs = new Set([
    "com.au","co.uk","co.nz","com.br","co.za","co.jp","com.cn","co.in"
  ]);

  const lastTwo = parts.slice(-2).join(".");
  const lastThree = parts.slice(-3).join(".");

  if (specialTLDs.has(lastTwo)) {
    return lastThree;   // e.g. kmart.com.au
  }
  return lastTwo;       // e.g. google.com
}

module.exports = { cleanHostname };
