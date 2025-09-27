// src/api/risk.js
import { http } from './http';

/**
 * Returns latest risk rows. We accept either `overall_risk` or `total_risk` fields,
 * and `hostname` or `website_label` for domain naming (handles your earlier schema drift).
 */

export async function fetchRiskList(limit = 200) {
  const { data } = await http.get('/api/risk/list', { params: { limit } });
  if (!data?.ok) throw new Error('Failed to fetch risk list');
  return Array.isArray(data.data) ? data.data : [];
}
