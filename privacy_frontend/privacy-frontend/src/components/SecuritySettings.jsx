// src/components/SecuritySettings.jsx
import React, { useState, useEffect } from "react";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:3000";

export default function SecuritySettings({ user = {} }) {
  /* --------------------- Email OTP state --------------------- */
  const [emailOtp, setEmailOtp] = useState("");
  const [emailOtpStatus, setEmailOtpStatus] = useState("");
  const [emailOtpSent, setEmailOtpSent] = useState(false);
  const [emailOtpLoading, setEmailOtpLoading] = useState(false);

  /* --------------------- TOTP state -------------------------- */
  const [totpSecret, setTotpSecret] = useState("");
  const [totpQrUrl, setTotpQrUrl] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [totpStatus, setTotpStatus] = useState("");
  const [totpEnabled, setTotpEnabled] = useState(false);
  const [totpLoading, setTotpLoading] = useState(false);

  /* --------------------- Init status ------------------------- */
  useEffect(() => {
    // Dev-friendly persisted state (no backend change required)
    const has2FA = localStorage.getItem("totp_enabled") === "true";
    setTotpEnabled(has2FA);
  }, []);

  /* --------------------- Helpers (security) ------------------ */
  const sanitizeOTP = (input) => String(input || "").replace(/\D/g, "").slice(0, 6);

  const handleEmailOtpChange = (e) => setEmailOtp(sanitizeOTP(e.target.value));
  const handleTotpCodeChange = (e) => setTotpCode(sanitizeOTP(e.target.value));

  // Prefer sessionStorage; fall back to localStorage for older flows
  const getAuthToken = () =>
    sessionStorage.getItem("privacy_token") ||
    localStorage.getItem("jwt") ||
    localStorage.getItem("token");

  // Centralised authenticated fetch
  const authenticatedFetch = async (endpoint, { headers = {}, ...rest } = {}) => {
    const token = getAuthToken();
    const finalHeaders = {
      "Content-Type": "application/json",
      ...headers,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
    return fetch(`${API_BASE}${endpoint}`, { ...rest, headers: finalHeaders });
  };

  // Persist freshly issued tokens in session first (compat fallback to local)
  const persistToken = (token) => {
    if (!token) return;
    try {
      sessionStorage.setItem("privacy_token", token);
      localStorage.setItem("jwt", token); // keep legacy readers working
    } catch (e) {
      // ignore storage errors
    }
  };

  /* --------------------- Email OTP actions ------------------- */
  const sendEmailOtp = async () => {
    if (!user?.email) {
      setEmailOtpStatus("Email address is required");
      return;
    }
    setEmailOtpLoading(true);
    setEmailOtpStatus("");
    try {
      const res = await authenticatedFetch("/api/auth/email-otp/request", {
        method: "POST",
        body: JSON.stringify({ email: user.email }),
      });
      const data = await res.json();
      if (data?.ok) {
        setEmailOtpSent(true);
        setEmailOtp("");
        setEmailOtpStatus("OTP sent to your email! Check your inbox.");
      } else {
        setEmailOtpStatus(`Error: ${data?.error || "Failed to request OTP"}`);
      }
    } catch (e) {
      setEmailOtpStatus("Network error occurred");
    } finally {
      setEmailOtpLoading(false);
    }
  };

  const verifyEmailOtp = async () => {
    if (emailOtp.length !== 6) {
      setEmailOtpStatus("Please enter a 6-digit code");
      return;
    }
    setEmailOtpLoading(true);
    setEmailOtpStatus("");
    try {
      const res = await authenticatedFetch("/api/auth/email-otp/verify", {
        method: "POST",
        body: JSON.stringify({ email: user?.email, code: emailOtp }),
      });
      const data = await res.json();
      if (data?.ok) {
        persistToken(data.token);
        setEmailOtp("");
        setEmailOtpSent(false);
        setEmailOtpStatus("✅ Email verified successfully!");
      } else {
        setEmailOtpStatus(`Error: ${data?.error || "Verification failed"}`);
      }
    } catch (e) {
      setEmailOtpStatus("Verification failed (network)");
    } finally {
      setEmailOtpLoading(false);
    }
  };

  /* --------------------- TOTP actions ------------------------ */
  const setupTotp = async () => {
    if (!user?.email) {
      setTotpStatus("Email address is required");
      return;
    }
    setTotpLoading(true);
    setTotpStatus("");
    try {
      const res = await authenticatedFetch("/api/auth/totp/setup", {
        method: "POST",
        body: JSON.stringify({ email: user.email }),
      });
      const data = await res.json();
      if (data?.ok) {
        setTotpSecret(data.secret);
        setTotpQrUrl(
          `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(
            data.otpauth
          )}&size=200x200`
        );
        setTotpStatus("Scan the QR code with Google Authenticator or Authy");
        setTotpCode("");
      } else {
        setTotpStatus(`Setup failed: ${data?.error || "Unable to setup TOTP"}`);
      }
    } catch (e) {
      setTotpStatus("Setup failed due to network error");
    } finally {
      setTotpLoading(false);
    }
  };

  const verifyTotp = async () => {
    if (totpCode.length !== 6) {
      setTotpStatus("Please enter a 6-digit code");
      return;
    }
    if (!totpSecret) {
      setTotpStatus("Please set up TOTP first");
      return;
    }
    setTotpLoading(true);
    setTotpStatus("");
    try {
      const res = await authenticatedFetch("/api/auth/totp/verify", {
        method: "POST",
        body: JSON.stringify({ email: user?.email, token: totpCode, secret: totpSecret }),
      });
      const data = await res.json();
      if (data?.ok) {
        persistToken(data.token);
        setTotpEnabled(true);
        localStorage.setItem("totp_enabled", "true");
        setTotpStatus("✅ Two-Factor Authentication enabled successfully!");
        setTotpCode("");
        // clear setup data after a short delay
        setTimeout(() => {
          setTotpSecret("");
          setTotpQrUrl("");
        }, 3000);
      } else {
        setTotpStatus(`Verification failed: ${data?.error || "Invalid code"}`);
      }
    } catch (e) {
      setTotpStatus("Verification failed due to network error");
    } finally {
      setTotpLoading(false);
    }
  };

  const disableTotp = () => {
    // If/when you add a backend disable endpoint, call it here via authenticatedFetch.
    setTotpEnabled(false);
    localStorage.removeItem("totp_enabled");
    setTotpSecret("");
    setTotpQrUrl("");
    setTotpCode("");
    setTotpStatus("Two-Factor Authentication disabled");
  };

  /* --------------------- UI ------------------------ */
  return (
    <div className="security-settings">
      {/* Email OTP Section */}
      <div className="security-section">
        <h3>Email Verification (OTP)</h3>
        <p className="muted">Verify your identity using codes sent to your email.</p>

        <div className="form-group">
          <div className="field-row">
            <div className="label">Email Address</div>
            <div>
              <strong>{user?.email || "No email provided"}</strong>
            </div>
            <div className="actions">
              <button
                className="btn"
                onClick={sendEmailOtp}
                disabled={emailOtpLoading || !user?.email}
              >
                {emailOtpLoading ? "Sending..." : "Send OTP"}
              </button>
            </div>
          </div>

          {emailOtpSent && (
            <div className="field-row">
              <div className="label">Enter Code</div>
              <div>
                <input
                  type="text"
                  placeholder="000000"
                  maxLength={6}
                  value={emailOtp}
                  onChange={handleEmailOtpChange}
                  style={{
                    fontFamily: "monospace",
                    fontSize: "16px",
                    textAlign: "center",
                    letterSpacing: "2px",
                  }}
                  disabled={emailOtpLoading}
                />
              </div>
              <div className="actions">
                <button
                  className="btn primary"
                  onClick={verifyEmailOtp}
                  disabled={emailOtpLoading || emailOtp.length !== 6}
                >
                  {emailOtpLoading ? "Verifying..." : "Verify"}
                </button>
              </div>
            </div>
          )}

          {emailOtpStatus && (
            <div className="field-row">
              <div className="label"></div>
              <div>
                <small className={emailOtpStatus.includes("✅") ? "success" : "error"}>
                  {emailOtpStatus}
                </small>
              </div>
              <div className="actions"></div>
            </div>
          )}
        </div>
      </div>

      {/* TOTP Section */}
      <div className="security-section">
        <h3>Authenticator App (TOTP)</h3>
        <p className="muted">
          Enhanced security using Google Authenticator, Authy, or similar apps.
        </p>

        {totpEnabled ? (
          <div className="form-group">
            <div className="field-row">
              <div className="label">Status</div>
              <div>
                <strong style={{ color: "green" }}>✅ Two-Factor Authentication Enabled</strong>
              </div>
              <div className="actions">
                <button className="btn danger" onClick={disableTotp}>
                  Disable 2FA
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="form-group">
            <div className="field-row">
              <div className="label">Setup</div>
              <div>
                <p>Set up two-factor authentication for enhanced security</p>
              </div>
              <div className="actions">
                <button
                  className="btn"
                  onClick={setupTotp}
                  disabled={totpLoading || !user?.email}
                >
                  {totpLoading ? "Setting up..." : "Setup TOTP"}
                </button>
              </div>
            </div>

            {totpSecret && totpQrUrl && (
              <>
                <div className="field-row">
                  <div className="label">QR Code</div>
                  <div style={{ textAlign: "center" }}>
                    <img
                      src={totpQrUrl}
                      alt="TOTP QR Code"
                      style={{
                        border: "1px solid #ddd",
                        borderRadius: "8px",
                        maxWidth: "200px",
                      }}
                    />
                    <br />
                    <small className="muted">
                      Scan with Google Authenticator, Authy, or similar app
                    </small>
                  </div>
                  <div className="actions"></div>
                </div>

                <div className="field-row">
                  <div className="label">Manual Setup</div>
                  <div>
                    <small>
                      Secret key:{" "}
                      <code
                        style={{
                          background: "#f5f5f5",
                          padding: "2px 4px",
                          borderRadius: "4px",
                          fontSize: "12px",
                        }}
                      >
                        {totpSecret}
                      </code>
                    </small>
                  </div>
                  <div className="actions"></div>
                </div>

                <div className="field-row">
                  <div className="label">Verify Setup</div>
                  <div>
                    <input
                      type="text"
                      placeholder="Enter 6-digit code"
                      maxLength={6}
                      value={totpCode}
                      onChange={handleTotpCodeChange}
                      style={{
                        fontFamily: "monospace",
                        fontSize: "16px",
                        textAlign: "center",
                        letterSpacing: "2px",
                      }}
                      disabled={totpLoading}
                    />
                  </div>
                  <div className="actions">
                    <button
                      className="btn primary"
                      onClick={verifyTotp}
                      disabled={totpLoading || totpCode.length !== 6}
                    >
                      {totpLoading ? "Verifying..." : "Enable 2FA"}
                    </button>
                  </div>
                </div>
              </>
            )}

            {totpStatus && (
              <div className="field-row">
                <div className="label"></div>
                <div>
                  <small className={totpStatus.includes("✅") ? "success" : "error"}>
                    {totpStatus}
                  </small>
                </div>
                <div className="actions"></div>
              </div>
            )}
          </div>
        )}
      </div>

      <style jsx>{`
        .security-settings {
          max-width: 600px;
        }
        .security-section {
          margin-bottom: 30px;
          padding-bottom: 20px;
          border-bottom: 1px solid #eee;
        }
        .security-section:last-child {
          border-bottom: none;
        }
        .form-group {
          margin-top: 15px;
        }
        .success {
          color: #155724;
        }
        .error {
          color: #721c24;
        }
        code {
          word-break: break-all;
        }
      `}</style>
    </div>
  );
}
