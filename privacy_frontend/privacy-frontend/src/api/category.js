import axios from "axios";

const API_BASE = "http://localhost:3000/api";

/**
 * Get site summary by siteId
 * Used in category.jsx → fetchSiteSummary(selectedSite.id)
 */
export async function fetchSiteSummary(siteId) {
  try {
    const res = await axios.get(`${API_BASE}/track/visits/${siteId}`);
    return res.data;
  } catch (err) {
    console.error("[fetchSiteSummary] error:", err);
    throw err;
  }
}

/**
 * Get all websites visited for a given category
 * Used in WebsiteList.jsx → fetchWebsitesByCategory(categoryName)
 */
export async function fetchWebsitesByCategory(categoryName) {
  try {
    const res = await axios.get(
      `${API_BASE}/track/category/${encodeURIComponent(categoryName)}`
    );
    return res.data; // expects: [{ id, hostname, created_at }]
  } catch (err) {
    console.error("[fetchWebsitesByCategory] error:", err);
    throw err;
  }
}
