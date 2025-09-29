// src/api/http.js — single Axios client for all API calls
import axios from "axios";

/* -------------------- Resolve base URL consistently -------------------- *
 * Prefer VITE_API_BASE. Fall back to VITE_API_URL for backward-compat.
 * In dev, if neither is set, default to http://localhost:3000.
 */
function pickBase() {
  const raw =
    (import.meta.env.VITE_API_BASE && String(import.meta.env.VITE_API_BASE)) ||
    (import.meta.env.VITE_API_URL && String(import.meta.env.VITE_API_URL)) ||
    (import.meta.env.DEV ? "https://privacypulse-9xnj.onrender.com" : "https://privacypulse-9xnj.onrender.com");

  // strip trailing slashes
  return raw.replace(/\/+$/, "");
}

const BASE = pickBase();

if (!BASE && import.meta.env.PROD) {
  // eslint-disable-next-line no-console
  console.warn(
    "[http] VITE_API_BASE (or VITE_API_URL) is empty in production. " +
      "Set it to your Render backend URL, e.g. https://<backend>.onrender.com"
  );
}

export const http = axios.create({
  baseURL: BASE,
  timeout: 20000,
  withCredentials: false,
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json",
    "X-Requested-With": "XMLHttpRequest",
  },
});

/* ---------------- Attach JWT automatically (if present) ---------------- */
http.interceptors.request.use((config) => {
  const token =
    sessionStorage.getItem("privacy_token") ||
    localStorage.getItem("jwt") ||
    localStorage.getItem("token");

  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

/* -------------------------- Error normalization ------------------------- */
http.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response) {
      const { status, data, config } = err.response;
      // eslint-disable-next-line no-console
      console.error(`[http] ${config?.method?.toUpperCase()} ${config?.url} → ${status}`, data);
    } else if (err.request) {
      // eslint-disable-next-line no-console
      console.error(
        "[http] Network/CORS error. " +
          "Ensure VITE_API_BASE uses HTTPS and backend CORS ALLOWED_ORIGINS includes your frontend origin."
      );
    } else {
      // eslint-disable-next-line no-console
      console.error("[http] Request setup error:", err.message);
    }
    return Promise.reject(err);
  }
);

/* ------------------------- Default & named export ----------------------- */
export default http;
