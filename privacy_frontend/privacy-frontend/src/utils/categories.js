// src/utils/categories.js
export function canonicalCategory(name) {
  const lower = String(name || "").trim().toLowerCase();

  // Normalizations
  if (lower === "other" || lower === "others") return "Others";
  if (lower === "e-commerce" || lower === "e commerce" || lower === "ecommerce") return "E-commerce";

  // Title-case fallback
  return lower
    .split(/\s+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// Use this list everywhere the UI needs the full set
export const CANONICAL_CATEGORIES = [
  "Education",
  "Entertainment",
  "Finance",
  "Health",
  "News",
  "E-commerce",
  "Social Media",
  "Travel",
  "Sports",
  "Productivity",
  "Others",
];
