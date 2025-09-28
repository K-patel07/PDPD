// services/trackerDetector.js
// Simple tracker detection based on known tracker domains

/**
 * Known tracker domains that indicate 3rd-party tracking
 */
const TRACKER_DOMAINS = new Set([
  // Google Analytics & Ads
  "google-analytics.com",
  "googletagmanager.com", 
  "doubleclick.net",
  "googlesyndication.com",
  "googleadservices.com",
  
  // Facebook/Meta
  "facebook.com",
  "connect.facebook.net",
  "fbcdn.net",
  
  // Other major trackers
  "amazon-adsystem.com",
  "adsystem.amazon.com",
  "amazon.com",
  "linkedin.com",
  "twitter.com",
  "x.com",
  "t.co",
  
  // Ad networks
  "adsystem.amazon.com",
  "amazon-adsystem.com",
  "googlesyndication.com",
  "doubleclick.net",
  "googletagmanager.com",
  "google-analytics.com",
  "googletagservices.com",
  "googleadservices.com",
  "googlesyndication.com",
  "googletagmanager.com",
  "google-analytics.com",
  "googletagservices.com",
  "googleadservices.com",
  
  // Social media trackers
  "instagram.com",
  "pinterest.com",
  "snapchat.com",
  "tiktok.com",
  
  // Analytics services
  "mixpanel.com",
  "segment.com",
  "hotjar.com",
  "fullstory.com",
  "logrocket.com",
  "sentry.io",
  
  // CDNs that often serve tracking scripts
  "cloudflare.com",
  "jsdelivr.net",
  "unpkg.com",
  "cdnjs.cloudflare.com",
]);

/**
 * Check if a hostname is a known tracker
 * @param {string} hostname - The hostname to check
 * @returns {boolean} - True if it's a tracker domain
 */
function isTrackerDomain(hostname) {
  if (!hostname || typeof hostname !== 'string') return false;
  
  // Normalize hostname
  const normalized = hostname.toLowerCase().replace(/^www\./, '');
  
  // Check exact match
  if (TRACKER_DOMAINS.has(normalized)) return true;
  
  // Check subdomain matches (e.g., subdomain.google-analytics.com)
  for (const tracker of TRACKER_DOMAINS) {
    if (normalized.endsWith('.' + tracker)) return true;
  }
  
  return false;
}

/**
 * Calculate tracker risk based on hostname
 * @param {string} hostname - The hostname to analyze
 * @returns {number} - Tracker risk score (0-1)
 */
function calculateTrackerRisk(hostname) {
  if (!hostname) return 0;
  
  // If it's a known tracker domain, return high risk
  if (isTrackerDomain(hostname)) {
    return 0.8; // High tracker risk
  }
  
  // Check for suspicious patterns
  const normalized = hostname.toLowerCase();
  
  // Ad-related subdomains
  if (normalized.includes('ads') || normalized.includes('ad-')) {
    return 0.6;
  }
  
  // Analytics subdomains
  if (normalized.includes('analytics') || normalized.includes('track')) {
    return 0.5;
  }
  
  // CDN subdomains (often used for tracking)
  if (normalized.includes('cdn') || normalized.includes('static')) {
    return 0.3;
  }
  
  // Default: no tracker risk
  return 0;
}

/**
 * Get tracker information for a hostname
 * @param {string} hostname - The hostname to analyze
 * @returns {object} - Tracker information
 */
function getTrackerInfo(hostname) {
  const risk = calculateTrackerRisk(hostname);
  const isTracker = isTrackerDomain(hostname);
  
  return {
    isTracker,
    risk,
    category: isTracker ? 'known_tracker' : (risk > 0 ? 'suspicious' : 'clean')
  };
}

module.exports = {
  isTrackerDomain,
  calculateTrackerRisk,
  getTrackerInfo
};
