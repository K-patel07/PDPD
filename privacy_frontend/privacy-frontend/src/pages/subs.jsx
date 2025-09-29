// src/pages/notifications.jsx
import React, { useState } from "react";
import "../styles/Dashboard.css";
import Sidebar from "../components/sidebar.jsx";
import HelpModal from "../components/HelpModal";
import GlobalSearch from "../components/GlobalSearch";

export default function Subscription() {
  const [darkMode, setDarkMode] = useState(false);

  return (
    <div id="app" className={darkMode ? "dark" : ""}>
      <Sidebar />
      <main id="main">
        <header id="top">
          <div className="breadcrumbs" aria-label="Breadcrumb">
            <span>Pages</span>
            <span className="sep">/</span>
            <strong>Subscription</strong>
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
          <h1>Subscription</h1>
        </div>
        <div className="page-content">
          <p>Subscription content coming soon...</p>
        </div>
      </main>
    </div>
  );
}
