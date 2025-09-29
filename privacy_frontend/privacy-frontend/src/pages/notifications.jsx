import React from "react";
import "../styles/Dashboard.css";
import "../styles/Notifications.css";
import Sidebar from "../components/sidebar.jsx";
import { useTheme } from "../contexts/ThemeContext";
import HelpModal from "../components/HelpModal";
import GlobalSearch from "../components/GlobalSearch";

/* ==== NOTIFICATION ICONS ==== */
const svgBase = { width: 28, height: 28, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", className: "notif-svg" };

function PreferencesIcon() { 
  return (
    <svg {...svgBase} className="notif-svg notif-svg-preferences" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1 1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>
  );
}

function ChannelsIcon() { 
  return (
    <svg {...svgBase} className="notif-svg notif-svg-channels" aria-hidden="true">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
      <polyline points="22,6 12,13 2,6"/>
    </svg>
  );
}

function DNDIcon() { 
  return (
    <svg {...svgBase} className="notif-svg notif-svg-dnd" aria-hidden="true">
      <circle cx="12" cy="12" r="10"/>
      <path d="M8 14s1.5 2 4 2 4-2 4-2"/>
      <line x1="9" y1="9" x2="15" y2="15"/>
      <line x1="15" y1="9" x2="9" y2="15"/>
    </svg>
  );
}

function SecurityIcon() { 
  return (
    <svg {...svgBase} className="notif-svg notif-svg-security" aria-hidden="true">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
      <path d="M9 12l2 2 4-4"/>
    </svg>
  );
}

function NotificationsSection() {
  return (
    <section className="notifications-notif">
      <div className="notif-wrap">
        <h2 className="notif-title">
          <span className="notif-white">Notification</span><span className="notif-grad">Settings</span>
        </h2>
        
        <div className="notif-grid">
          <ul className="notif-list">
            <li>
              <PreferencesIcon />
              <div>
                <strong>Preferences</strong>
                <p>Choose which events trigger notifications and set default urgency.</p>
              </div>
            </li>
            <li>
              <ChannelsIcon />
              <div>
                <strong>Channels</strong>
                <p>Manage email, SMS, and in-app alerts. Enable/disable per channel.</p>
              </div>
            </li>
            <li>
              <DNDIcon />
              <div>
                <strong>Do Not Disturb</strong>
                <p>Set quiet hours to pause non-critical notifications.</p>
              </div>
            </li>
            <li>
              <SecurityIcon />
              <div>
                <strong>Security Alerts</strong>
                <p>High-risk activity alerts and login notifications.</p>
              </div>
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
}

export default function Notifications() {
  const { darkMode, toggleDarkMode } = useTheme();

  return (
    <div id="app" className={darkMode ? "dark" : ""}>
      {/* Reusable Sidebar */}
      <Sidebar />

      {/* Main */}
      <main id="main">
        <header id="top">
          <div className="breadcrumbs" aria-label="Breadcrumb">
            <span>Pages</span>
            <span className="sep">/</span>
            <strong>Notifications</strong>
          </div>

          <div className="top-actions">
            <GlobalSearch />
            <HelpModal />
            <button
              className="toggle"
              onClick={toggleDarkMode}
              aria-pressed={darkMode}
              aria-label="Toggle dark mode"
              title="Toggle dark mode"
            >
              <span className="knob" />
            </button>
          </div>
        </header>

        {/* Structured Notification Settings */}
        <NotificationsSection />
      </main>
    </div>
  );
}
