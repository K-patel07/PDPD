import React, { useState } from "react";
import "../styles/Dashboard.css";
import Sidebar from "../components/sidebar.jsx";

export default function Notifications() {
  const [darkMode, setDarkMode] = useState(false);

  return (
    <div id="app" className={darkMode ? "dark" : ""}>
      {/* Reusable Sidebar */}
      <Sidebar darkMode={darkMode}/>

      {/* Main */}
      <main id="main">
        <header id="top">
          <div className="breadcrumbs" aria-label="Breadcrumb">
            <span>Pages</span>
            <span className="sep">/</span>
            <strong>Notifications</strong>
          </div>

          <div className="top-actions">
            <button
              className="toggle"
              onClick={() => setDarkMode(v => !v)}
              aria-pressed={darkMode}
              aria-label="Toggle dark mode"
              title="Toggle dark mode"
            >
              <span className="knob" />
            </button>
          </div>
        </header>

        <div className="page-title">
          <h1>Notifications</h1>
        </div>

        {/* Panels */}
        <section className="settings-layout">
          <div className="card panel">
            <h2>Preferences</h2>
            <p>Choose which events trigger notifications and set default urgency.</p>
          </div>

          <div className="card panel">
            <h2>Channels</h2>
            <p>Manage email, SMS, and in-app alerts. Enable/disable per channel.</p>
          </div>

          <div className="card panel">
            <h2>Do Not Disturb</h2>
            <p>Set quiet hours to pause non-critical notifications.</p>
          </div>

          <div className="card panel">
            <h2>Security Alerts</h2>
            <p>High-risk activity alerts and login notifications.</p>
          </div>
        </section>
      </main>
    </div>
  );
}
