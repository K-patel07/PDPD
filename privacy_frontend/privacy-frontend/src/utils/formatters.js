export function formatDuration(sec = 0) {
  const s = Number(sec || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h} h ${m} mins`;
  if (m > 0) return `${m} mins`;
  return `${s % 60}s`;
}
export function formatDate(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  // e.g., "19 Aug 2025"
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}
