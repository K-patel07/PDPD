// src/services/authService.js
const API_BASE =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_API_BASE) ||
  "http://localhost:3000";

function persistIdentity({ token, ext_user_id, user }) {
  if (token) {
    // sessionStorage clears on tab close (safer); keep localStorage for legacy code
    sessionStorage.setItem("privacy_token", token);
    localStorage.setItem("token", token);
    localStorage.setItem("jwt", token);
  }
  if (ext_user_id) localStorage.setItem("ext_user_id", ext_user_id);
  if (user?.email) localStorage.setItem("userEmail", user.email);
  if (user?.username) localStorage.setItem("username", user.username);
}

async function jsonFetch(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  return { okHttp: res.ok, ...data };
}

class AuthService {
  static async signup({ username, email, password }) {
    const r = await jsonFetch(`${API_BASE}/api/auth/register`, {
      method: "POST",
      body: JSON.stringify({ username, email, password }),
    });
    if (r.ok) persistIdentity(r);
    return r; // shape: { ok, token, ext_user_id, user, ... } or { ok:false, error }
  }

  static async login({ email, password }) {
    const r = await jsonFetch(`${API_BASE}/api/auth/login`, {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    if (r.ok) persistIdentity(r);
    return r;
  }

  // Email OTP
  static async requestEmailOtp(email) {
    return jsonFetch(`${API_BASE}/api/auth/otp/send`, {
      method: "POST",
      body: JSON.stringify({ email }),
    });
  }
  static async verifyEmailOtp({ email, code }) {
    const r = await jsonFetch(`${API_BASE}/api/auth/otp/verify`, {
      method: "POST",
      body: JSON.stringify({ email, code }),
    });
    if (r.ok) persistIdentity(r);
    return r;
  }

  // TOTP
  static async totpSetup(email) {
    return jsonFetch(`${API_BASE}/api/auth/totp/setup`, {
      method: "POST",
      body: JSON.stringify({ email }),
    }); // { ok, secret, otpauth }
  }
  static async totpVerify({ email, token, secret }) {
    const r = await jsonFetch(`${API_BASE}/api/auth/totp/verify`, {
      method: "POST",
      body: JSON.stringify({ email, token, secret }),
    });
    if (r.ok) {
      persistIdentity(r);
      localStorage.setItem("totp_enabled", "true");
    }
    return r;
  }

  static logout() {
    sessionStorage.removeItem("privacy_token");
    localStorage.removeItem("token");
    localStorage.removeItem("jwt");
    localStorage.removeItem("ext_user_id");
  }

  static getToken() {
    return (
      sessionStorage.getItem("privacy_token") ||
      localStorage.getItem("jwt") ||
      localStorage.getItem("token")
    );
  }

  static isLoggedIn() {
    return !!this.getToken();
  }
}

export default AuthService;
