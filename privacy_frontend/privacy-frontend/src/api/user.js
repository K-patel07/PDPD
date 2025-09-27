// src/api/users.js
export async function resolveUserId(extUserId) {
  const r = await fetch(`/api/users/resolve?ext_user_id=${encodeURIComponent(extUserId)}`);
  const j = await r.json();
  return j.userId;
}
