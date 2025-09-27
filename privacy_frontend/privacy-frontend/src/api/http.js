// src/api/http.js
import axios from "axios";

const baseURL = (import.meta.env.VITE_API_URL || "http://localhost:3000")
  .toString()
  .replace(/\/+$/, ""); // remove trailing slash just in case

export const http = axios.create({
  baseURL,
  timeout: 10000,
  headers: { "Content-Type": "application/json" },
});

// (optional) auth header if you add JWT later
// http.interceptors.request.use((cfg) => {
//   const token = localStorage.getItem("token");
//   if (token) cfg.headers.Authorization = `Bearer ${token}`;
//   return cfg;
// });

// ✅ provide both named and default exports so either import style works
export default http;
