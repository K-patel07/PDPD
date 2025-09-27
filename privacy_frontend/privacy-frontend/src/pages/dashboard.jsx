// src/pages/dashboard.jsx
import React, { useEffect, useState } from "react";
import { useTheme } from "../contexts/ThemeContext";

import "../styles/Dashboard.css";
import "../styles/categoryCarosel.css";
import "../styles/userWelcomeCard.css";

import Sidebar from "../components/sidebar.jsx";
import TopSitesRiskCard from "../components/TopSitesRiskCard";
import CategoryVisitPieCard from "../components/CategoryVisitPieCard";
import TrendLineCard from "../components/TrendLineCard";
import ThemeToggle from "../components/ThemeToggle";
import CategoryScroll from "../components/categoryscroll";
import UserManual from "../components/UserManual";
import ExtensionDownloadPrompt from "../components/ExtensionDownloadPrompt";

import { CANONICAL_CATEGORIES } from "../utils/categories.js";
import { CATEGORY_COLORS } from "../utils/categoryColors.js";

/* -------------------------- small helpers/components -------------------------- */

function GreetingCard({ user }) {
  return (
    <section className="card greet-card" aria-label="Welcome">
      <div className="greet-content">
        <div className="greet-copy">
          <h3>Welcome back, {user?.firstName || "User"}!</h3>
          <p>Let's audit your digital exposure.</p>
        </div>
        <div className="greet-art">
          <div className="greet-obj">
            <img src="/img/welcome-shield.gif" alt="" className="greet-gif motion-ok" />
            <img src="/img/welcome-shield.png" alt="" className="greet-gif motion-reduce" />
          </div>
        </div>
      </div>
    </section>
  );
}

function ChartsRow({ extUserId }) {
  return (
    <section className="outer-box" aria-label="Charts">
      <div className="chart-grid">
        <TopSitesRiskCard extUserId={extUserId} />
        <CategoryVisitPieCard
          extUserId={extUserId}
          categories={CANONICAL_CATEGORIES}
          categoryColors={CATEGORY_COLORS}
        />
      </div>
    </section>
  );
}

/* ----------------------------------- page ----------------------------------- */

export default function Dashboard() {
  const { darkMode } = useTheme();
  const [extUserId, setExtUserId] = useState(null);

  // Extension prompt
  const [showExtensionPrompt, setShowExtensionPrompt] = useState(false);

  /* Theme class on <html> */
  useEffect(() => {
    const html = document.documentElement;
    if (darkMode) {
      html.classList.remove("theme-light");
      html.classList.add("theme-dark");
    } else {
      html.classList.remove("theme-dark");
      html.classList.add("theme-light");
    }
  }, [darkMode]);

  /* Load extUserId (once) */
  useEffect(() => {
    const stored =
      localStorage.getItem("ext_user_id") || localStorage.getItem("extUserId");
    if (stored && stored.trim()) {
      setExtUserId(stored.trim());
    } else {
      // optional fallback for dev/demo
      setExtUserId("ext-th4ah76hzej");
    }
  }, []);

  /* Extension prompt logic */
  useEffect(() => {
    if (!extUserId) return;

    const hasExtension = localStorage.getItem("hasExtension") === "true";
    const hasSeenPrompt = localStorage.getItem("hasSeenExtensionPrompt") === "true";
    const isLoggedIn = localStorage.getItem("isLoggedIn") === "true" || !!extUserId;
    const lastPromptTime = Number(localStorage.getItem("lastExtensionPromptTime") || 0);

    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const tooSoon = lastPromptTime && now - lastPromptTime < dayMs;

    if (isLoggedIn && !hasExtension && !hasSeenPrompt && !tooSoon) {
      const t = setTimeout(() => setShowExtensionPrompt(true), 3000);
      return () => clearTimeout(t);
    }
  }, [extUserId]);

  const handleDismissPrompt = () => {
    setShowExtensionPrompt(false);
    localStorage.setItem("hasSeenExtensionPrompt", "true");
    localStorage.setItem("lastExtensionPromptTime", String(Date.now()));
  };

  const handleExtensionInstalled = () => {
    setShowExtensionPrompt(false);
    localStorage.setItem("hasExtension", "true");
    localStorage.setItem("hasSeenExtensionPrompt", "true");
  };

  // quick helper for manual testing in console
  useEffect(() => {
    const reset = () => {
      localStorage.removeItem("hasExtension");
      localStorage.removeItem("hasSeenExtensionPrompt");
      localStorage.removeItem("lastExtensionPromptTime");
      console.log("Extension prompt reset");
    };
    window.resetExtensionPrompt = reset;
    return () => {
      delete window.resetExtensionPrompt;
    };
  }, []);

  if (!extUserId) return <div>Loading user…</div>;

  return (
    <div id="app" className={darkMode ? "dark" : ""}>
      <Sidebar />

      <main id="main">
        <header id="top">
          <div className="breadcrumbs" aria-label="Breadcrumb">
            <span>Pages</span>
            <span className="sep">/</span>
            <strong>Dashboard</strong>
          </div>

          <div className="top-actions">
            <label className="search">
              <input type="text" placeholder="Search here" />
              <button className="icon-btn" aria-label="Search" />
            </label>

            <UserManual />
            <ThemeToggle className="toggle" />
          </div>
        </header>

        {/* Category scroller */}
        <CategoryScroll />

        {/* Welcome */}
        <GreetingCard user={{ firstName: "User" }} />

        {/* Charts */}
        <ChartsRow extUserId={extUserId} />

        {/* Trend line (top site per bucket) */}
        <div className="trend-container">
          <TrendLineCard extUserId={extUserId} defaultRange="weekly" />
        </div>
      </main>

      {/* Extension prompt */}
      <ExtensionDownloadPrompt
        show={showExtensionPrompt}
        onDismiss={handleDismissPrompt}
        onExtensionInstalled={handleExtensionInstalled}
      />
    </div>
  );
}
