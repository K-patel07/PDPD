// src/pages/settings.jsx
import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import "../styles/Dashboard.css";
import "../styles/Settings.css";
import Sidebar from "../components/sidebar.jsx";
import { useTheme } from "../contexts/ThemeContext"; // Add this import
import HelpModal from "../components/HelpModal";
import GlobalSearch from "../components/GlobalSearch";

/* ---------- Minimal API layer (adjust paths to your backend) ---------- */
async function apiGetMe() {
  const res = await fetch("/api/me", { credentials: "include" });
  if (!res.ok) throw new Error("Failed to load profile");
  return res.json(); // expected: { firstName, lastName, birthday, address, mobile, email, avatarUrl }
}

async function apiPatchMe(patch) {
  const res = await fetch("/api/me", {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error("Failed to save");
  return res.json(); // return updated user if your API does that
}

async function apiUploadAvatar(file) {
  const fd = new FormData();
  fd.append("avatar", file);
  const res = await fetch("/api/me/avatar", {
    method: "POST",
    credentials: "include",
    body: fd,
  });
  if (!res.ok) throw new Error("Failed to upload avatar");
  return res.json(); // expected: { avatarUrl }
}

/* --------------------- Small reusable field row ---------------------- */
function EditableField({
  label,
  name,
  value,
  type = "text",
  multiline = false,
  onSave,
  formatDisplay, // optional fn for read mode
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => setVal(value ?? ""), [value]);

  const handleSave = async () => {
    try {
      setSaving(true);
      setError("");
      await onSave(name, val);
      setEditing(false);
    } catch (e) {
      setError(e.message || "Could not save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="field-row">
      <div className="label">{label}</div>

      <div>
        {editing ? (
          multiline ? (
            <textarea
              value={val}
              onChange={(e) => setVal(e.target.value)}
              rows={3}
              placeholder={label}
              style={{ width: "100%" }}
            />
          ) : (
            <input
              type={type}
              value={val ?? ""}
              onChange={(e) => setVal(e.target.value)}
              placeholder={label}
              style={{ width: "100%" }}
            />
          )
        ) : (
          <strong>{value ? (formatDisplay ? formatDisplay(value) : value) : "—"}</strong>
        )}
        {error && <div className="muted" style={{ color: "tomato", marginTop: 6 }}>{error}</div>}
      </div>

      <div className="actions">
        {editing ? (
          <>
            <button type="button" className="btn" onClick={() => { setEditing(false); setVal(value ?? ""); }}>
              Cancel
            </button>
            <button type="button" className="btn primary" disabled={saving} onClick={handleSave}>
              {saving ? "Saving…" : "Save"}
            </button>
          </>
        ) : (
          <button type="button" className="btn" onClick={() => setEditing(true)}>
            Edit
          </button>
        )}
      </div>
    </div>
  );
}

/* ------------------------- Avatar Uploader -------------------------- */
function AvatarUploader({ src, initials = "PP", onUpload }) {
  const inputRef = useRef(null);
  const [preview, setPreview] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  const openPicker = () => inputRef.current?.click();

  const onChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    setPreview(URL.createObjectURL(file));
    try {
      setUploading(true);
      await onUpload(file);
    } catch (err) {
      setError(err.message || "Upload failed");
      setPreview(null);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="row" style={{ alignItems: "center", gap: 16 }}>
      <div
        style={{
          width: 72,
          height: 72,
          borderRadius: "50%",
          background: "var(--stroke)",
          overflow: "hidden",
          display: "grid",
          placeItems: "center",
          flex: "0 0 auto",
        }}
      >
        {preview || src ? (
          // eslint-disable-next-line jsx-a11y/img-redundant-alt
          <img alt="Profile avatar" src={preview || src} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <span style={{ fontWeight: 600 }}>{initials}</span>
        )}
      </div>

      <div className="stack" style={{ gap: 6 }}>
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn" onClick={openPicker}>Change photo</button>
          <input ref={inputRef} type="file" accept="image/*" hidden onChange={onChange} />
          {uploading && <small className="muted">Uploading…</small>}
        </div>
        {error && <small style={{ color: "tomato" }}>{error}</small>}
        <small className="muted">PNG/JPG, recommended square image.</small>
      </div>
    </div>
  );
}

/* ---------------------------- Page --------------------------------- */
export default function Settings() {
  const { darkMode, setDarkMode } = useTheme();
  
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState("");
  const avatarInputRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const data = await apiGetMe();
        setProfile(data);
      } catch (e) {
        // If backend not ready, fall back to empty object
        setProfile({
          firstName: "",
          lastName: "",
          birthday: "",
          address: "",
          mobile: "",
          email: "",
          avatarUrl: "",
        });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const saveField = async (name, value) => {
    const patch = { [name]: value };
    const updated = await apiPatchMe(patch);
    setProfile((p) => ({ ...p, ...(updated || patch) }));
    setToast("Saved");
    setTimeout(() => setToast(""), 1200);
  };

  const handleAvatarChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    try {
      const res = await apiUploadAvatar(file);
      const url = res?.avatarUrl;
      setProfile((p) => ({ ...p, avatarUrl: url || p.avatarUrl }));
      setToast("Photo updated");
      setTimeout(() => setToast(""), 1200);
    } catch (err) {
      setToast("Upload failed");
      setTimeout(() => setToast(""), 1200);
    }
  };

  const initials = ((profile?.firstName?.[0] || "") + (profile?.lastName?.[0] || "")).toUpperCase() || "PP";

  return (
    <div id="app" className={darkMode ? "dark" : ""}>
      <Sidebar />

      <main id="main" className="settings-wide">
        <header id="top">
          <div className="breadcrumbs" aria-label="Breadcrumb">
            <span>Pages</span>
            <span className="sep">/</span>
            <strong>Settings</strong>
          </div>

          <div className="top-actions">
            <GlobalSearch />
            <HelpModal />
            <button
              className="toggle"
              onClick={() => setDarkMode((v) => !v)}
              aria-pressed={darkMode}
              aria-label="Toggle dark mode"
              title="Toggle dark mode"
            >
              <span className="knob" />
            </button>
          </div>
        </header>

        <div className="page-title">
          <h1>Settings</h1>
        </div>

        {toast && (
          <div className="card panel" style={{ marginBottom: 16 }}>
            <strong>{toast}</strong>
          </div>
        )}

        {loading ? (
          <section className="settings-layout">
            <div className="card panel"><p>Loading…</p></div>
          </section>
        ) : (
          <section className="settings-layout">
            {/* 1) Personal Details (avatar + personal info) */}
            <div className="card panel" id="personal-info">
              <h2>Personal Details</h2>
              <p>Add or change your profile picture and personal information.</p>
              
              {/* Avatar Row - Clean layout */}
              <div className="field-row">
                <div className="label">Profile Picture</div>
                <div className="avatar-container">
                  <div
                    style={{
                      width: 72,
                      height: 72,
                      borderRadius: "50%",
                      background: "var(--stroke)",
                      overflow: "hidden",
                      display: "grid",
                      placeItems: "center",
                      flex: "0 0 auto",
                    }}
                  >
                    {profile?.avatarUrl ? (
                      <img alt="Profile avatar" src={profile.avatarUrl} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    ) : (
                      <span style={{ fontWeight: 600 }}>{initials}</span>
                    )}
                  </div>
                  <small className="muted">PNG/JPG, recommended square image.</small>
                </div>
                <div className="actions">
                  <input ref={avatarInputRef} type="file" accept="image/*" hidden onChange={handleAvatarChange} />
                  <button type="button" className="btn" onClick={() => avatarInputRef.current?.click()}>
                    Change photo
                  </button>
                </div>
              </div>

              {/* Personal Info Fields */}
              <div className="stack" style={{ gap: 0 }}>
                <EditableField
                  label="First name"
                  name="firstName"
                  value={profile?.firstName}
                  onSave={saveField}
                />
                <EditableField
                  label="Last name"
                  name="lastName"
                  value={profile?.lastName}
                  onSave={saveField}
                />
                <EditableField
                  label="Birthday"
                  name="birthday"
                  value={profile?.birthday}
                  type="date"
                  onSave={saveField}
                  formatDisplay={(v) => {
                    try {
                      const d = new Date(v);
                      if (Number.isNaN(+d)) return v;
                      return d.toLocaleDateString();
                    } catch {
                      return v;
                    }
                  }}
                />
              </div>
            </div>

            {/* 2) Contact Details (address, mobile, email) */}
            <div className="card panel" id="contact-details">
              <h2>Contact Details</h2>
              <p>Edit your contact information.</p>

              <div className="stack" style={{ gap: 0 }}>
                <EditableField
                  label="Address"
                  name="address"
                  value={profile?.address}
                  multiline
                  onSave={saveField}
                />
                <EditableField
                  label="Mobile number"
                  name="mobile"
                  value={profile?.mobile}
                  type="tel"
                  onSave={saveField}
                />
                {/* Read-only email row */}
                <div className="field-row">
                  <div className="label">Email</div>
                  <div>
                    <strong>{profile?.email || "—"}</strong>
                  </div>
                  <div className="actions">
                    <span className="muted">Managed in Login & Security</span>
                  </div>
                </div>
              </div>
            </div>

            {/* 3) Login & Security */}
            <div className="card panel" id="login-security">
              <h2>Login &amp; Security</h2>
              <p>Update your password and secure your account.</p>
              
              <div className="stack" style={{ gap: 0 }}>
                <div className="field-row">
                  <div className="label">Current Password</div>
                  <div>
                    <input type="password" placeholder="••••••••" />
                  </div>
                  <div className="actions"></div>
                </div>
                <div className="field-row">
                  <div className="label">New Password</div>
                  <div>
                    <input type="password" placeholder="Min 8 characters" />
                  </div>
                  <div className="actions"></div>
                </div>
                <div className="field-row">
                  <div className="label">Confirm New Password</div>
                  <div>
                    <input type="password" placeholder="Repeat new password" />
                  </div>
                  <div className="actions"></div>
                </div>
                <div className="field-row actions-row">
                  <div></div>
                  <div></div>
                  <div className="actions">
                    <button className="btn" type="button">Set up 2FA</button>
                    <button className="btn primary" type="submit">Update password</button>
                  </div>
                </div>
              </div>
            </div>

            {/* 4) Terms of Use */}
            <div className="card panel" id="terms">
              <h2>Terms of Use</h2>
              <p>Read the rules for using PrivacyPulse.</p>
              
              <div className="content-section">
                <p>By using this app you agree to the latest Terms of Use. The summary below is not a legal document.</p>
                <div className="text-list">
                  <p>Don't misuse or attempt to break the service.</p>
                  <p>Respect user privacy and applicable laws.</p>
                  <p>We may update terms; continued use implies acceptance.</p>
                </div>
                <div className="section-actions">
                  <Link className="btn" to="/terms">Open full Terms</Link>
                </div>
              </div>
            </div>

            {/* 5) Privacy Policy */}
            <div className="card panel" id="privacy">
              <h2>Privacy Policy</h2>
              <p>How we collect, use, and store your data.</p>
              
              <div className="content-section">
                <p>We collect minimal data required to operate the service and improve your experience.</p>
                <div className="text-list">
                  <p>Control analytics/telemetry in your preferences.</p>
                  <p>Export or delete your data at any time.</p>
                  <p>We never sell your personal information.</p>
                </div>
                <div className="section-actions">
                  <Link className="btn" to="/privacy">Open full Policy</Link>
                </div>
              </div>
            </div>

            {/* 6) Delete Account */}
            <div className="card panel" id="delete-account">
              <h2>Delete Account</h2>
              <p>Permanently remove your account and associated data.</p>
              
              <div className="stack" style={{ gap: 0 }}>
                <div className="field-row">
                  <div className="label">Type <strong>DELETE</strong> to confirm</div>
                  <div>
                    <input type="text" placeholder="DELETE" />
                  </div>
                  <div className="actions"></div>
                </div>
                <div className="field-row actions-row">
                  <div></div>
                  <div></div>
                  <div className="actions">
                    <button className="btn danger" type="button">
                      Delete my account
                    </button>
                  </div>
                </div>
                <div className="field-row no-border">
                  <div></div>
                  <div>
                    <small className="muted">This action is permanent. You can export your data before deleting.</small>
                  </div>
                  <div></div>
                </div>
              </div>
            </div>

            {/* 7) About */}
            <div className="card panel" id="about">
              <h2>About</h2>
              <p>App info and attributions.</p>
              
              <div className="stack" style={{ gap: 0 }}>
                <div className="field-row">
                  <div className="label">App</div>
                  <div>
                    <strong>PrivacyPulse</strong>
                  </div>
                  <div className="actions"></div>
                </div>
                <div className="field-row">
                  <div className="label">Version</div>
                  <div>
                    <strong>v1.0.0</strong>
                  </div>
                  <div className="actions"></div>
                </div>
                <div className="field-row">
                  <div className="label">Build</div>
                  <div>
                    <strong>#1001</strong>
                  </div>
                  <div className="actions"></div>
                </div>
                <div className="field-row actions-row">
                  <div></div>
                  <div></div>
                  <div className="actions">
                    <button className="btn" type="button">View licenses</button>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}