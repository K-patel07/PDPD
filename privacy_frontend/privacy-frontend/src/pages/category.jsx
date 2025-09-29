// src/pages/category.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useTheme } from "../contexts/ThemeContext";
import "../styles/Dashboard.css";
import "../styles/Category.css";

import Sidebar from "../components/sidebar.jsx";
import WebsiteList from "../components/category/WebsiteList.jsx";
import CenterTitle from "../components/category/CenterTitle.jsx";
import ProvidedDataCard from "../components/category/ProvidedDataCard.jsx";
import RiskCard from "../components/category/RiskCard.jsx";
import ThemeToggle from "../components/ThemeToggle";
import EmptyState from "../components/EmptyState";

import {
  fetchProvidedDataForSite,
  fetchSiteRisk,
  fetchSitesByCategory,
  fetchCategoryInsights,
} from "../api/metrics.js";
import { canonicalCategory } from "../utils/categories.js";
import { formatDuration, formatDate } from "../utils/formatters.js";

/* helpers */
const cx = (...list) => list.filter(Boolean).join(" ");
const stripWWW = (h) => (h || "").toLowerCase().replace(/^www\./, "");

const EMPTY_PROVIDED = Object.freeze({
  name: false,
  address: false,
  phone: false,
  country: false,
  email: false,
  card: false,
  gender: false,
  age: false,
});

export default function Category() {
  const { name: rawName } = useParams();
  const categoryName = canonicalCategory(
    decodeURIComponent(rawName || "").replace(/-/g, " ")
  );
  const { darkMode } = useTheme();

  const extUserId =
    (localStorage.getItem("ext_user_id") ||
      localStorage.getItem("extUserId") ||
      "").trim();

  const [query, setQuery] = useState("");

  // list from API (already normalized by metrics.js)
  const [sites, setSites] = useState([]);

  // selection (WebsiteList usually passes the whole row; we accept row or {hostname})
  const [selectedSite, setSelectedSite] = useState(null);
  const selectedHostname = useMemo(
    () => stripWWW(selectedSite?.hostname || selectedSite?.host || ""),
    [selectedSite]
  );

  // find the matching row to show stats
  const selectedRow = useMemo(
    () => sites.find((r) => stripWWW(r.hostname) === selectedHostname) || null,
    [sites, selectedHostname]
  );

  // risk + provided data
  const [riskScore, setRiskScore] = useState(0);
  const [riskBand, setRiskBand] = useState("unknown");
  const [provided, setProvided] = useState(null);
  const [providedErr, setProvidedErr] = useState("");

  // set theme class on <html>
  useEffect(() => {
    const html = document.documentElement;
    html.classList.toggle("theme-dark", !!darkMode);
    html.classList.toggle("theme-light", !darkMode);
  }, [darkMode]);

  // fetch sites for category (NEW: uses combined endpoint with risk + fields)
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  
  useEffect(() => {
    let cancelled = false;

    async function load(silent = false) {
      if (!extUserId || !categoryName) {
        setSites([]);
        return;
      }
      try {
        // Try new combined endpoint first (includes risk + fields_detected)
        let list = await fetchCategoryInsights({ extUserId, category: categoryName });
        
        // Fallback to old endpoint if new one fails or returns empty
        if (!list || list.length === 0) {
          list = await fetchSitesByCategory({ extUserId, category: categoryName });
        }
        
        if (cancelled) return;
        const sorted = [...(list || [])].sort((a, b) =>
          a.hostname.localeCompare(b.hostname)
        );
        setSites(sorted);

        if (!selectedSite && sorted.length) {
          setSelectedSite(sorted[0]); // pick first by default
        }
        
        if (!silent) {
          setIsInitialLoad(false);
        }
      } catch (e) {
        console.error("[Category] fetchCategoryInsights failed:", e);
        if (!cancelled) setSites([]);
      }
    }

    // Initial load
    load(false);
    
    // Auto-refresh every 20 seconds (silent - no visible changes to UI)
    const pollInterval = setInterval(() => {
      if (!cancelled && !isInitialLoad) load(true);
    }, 20000);
    
    // Refresh when page becomes visible (silent)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && !cancelled && !isInitialLoad) {
        load(true);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      cancelled = true;
      clearInterval(pollInterval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [extUserId, categoryName]); // reload when user or category changes

  // fetch latest risk snapshot for the selected host (or use cached from combined endpoint)
  useEffect(() => {
    let cancelled = false;

    async function loadRisk() {
      if (!selectedHostname || !extUserId) {
        setRiskScore(0);
        setRiskBand("unknown");
        return;
      }
      
      // Check if we already have risk data from the combined endpoint
      if (selectedRow?.riskScore !== undefined && selectedRow?.band) {
        setRiskScore(Number(selectedRow.riskScore || 0));
        setRiskBand(selectedRow.band || "unknown");
        return;
      }
      
      // Fallback: fetch separately if not in combined data
      try {
        const data = await fetchSiteRisk({ extUserId, hostname: selectedHostname });
        const score =
          typeof data?.score === "number" ? data.score : Number(data?.risk || 0);
        const band = data?.band || data?.level || "unknown";
        if (!cancelled) {
          setRiskScore(Number.isFinite(score) ? score : 0);
          setRiskBand(band);
        }
      } catch (e) {
        console.error("[Category] risk fetch:", e);
        if (!cancelled) {
          setRiskScore(0);
          setRiskBand("unknown");
        }
      }
    }

    loadRisk();
    return () => {
      cancelled = true;
    };
  }, [selectedHostname, extUserId, selectedRow]);

  // fetch provided-data flags for selected host (or use cached from combined endpoint)
  useEffect(() => {
    let cancelled = false;

    async function loadProvided() {
      setProvidedErr("");
      if (!extUserId || !selectedHostname) {
        setProvided(null);
        return;
      }
      
      // Check if we already have fields data from the combined endpoint
      // Only use it if it has actual field data (not just an empty object)
      const fd = selectedRow?.fieldsDetected;
      const hasFieldData = fd && Object.keys(fd).length > 0 && Object.values(fd).some(v => v === true);
      
      if (hasFieldData) {
        console.log("[Category] Using cached fields from category insights:", fd);
        setProvided({
          name: !!fd.name,
          address: !!fd.address,
          phone: !!fd.phone,
          country: !!fd.country,
          email: !!fd.email,
          card: !!fd.card,
          gender: !!fd.gender,
          age: !!fd.age,
        });
        return;
      }
      
      // Fallback: fetch separately if not in combined data
      console.log("[Category] Fetching provided data separately for:", selectedHostname);
      try {
        const detail = await fetchProvidedDataForSite({
          extUserId,
          hostname: selectedHostname,
        });
        if (cancelled) return;

        const fu = detail?.fields_union || {};
        console.log("[Category] Provided data detail:", { detail, fields_union: fu });
        setProvided({
          name: !!fu.name,
          address: !!fu.address,
          phone: !!fu.phone,
          country: !!fu.country,
          email: !!fu.email,
          card: !!fu.card,
          gender: !!fu.gender,
          age: !!fu.age,
        });
      } catch (e) {
        console.error("[Category] provided-data error:", e);
        if (!cancelled) {
          setProvided(null);
          setProvidedErr(e?.message || "Failed to load provided data");
        }
      }
    }

    loadProvided();
    return () => {
      cancelled = true;
    };
  }, [extUserId, selectedHostname, selectedRow]);

  // values for the two mini-cards — metrics.js guarantees these fields
  const lastVisitText = useMemo(() => {
    const iso = selectedRow?.lastVisitISO || null;
    return iso ? formatDate(iso) : "—";
  }, [selectedRow?.lastVisitISO]);

  const screenTimeText = useMemo(() => {
    const secs = Number(selectedRow?.screenTimeSeconds || 0);
    return formatDuration(Number.isFinite(secs) ? secs : 0);
  }, [selectedRow?.screenTimeSeconds]);

  function onSearch(e) {
    e?.preventDefault();
    // if your WebsiteList filters internally, nothing to do here
  }

  return (
    <div id="app" className={darkMode ? "dark" : ""}>
      <Sidebar />

      <main id="main">
        <header id="top">
          <div className="breadcrumbs" aria-label="Breadcrumb">
            <span>Pages</span>
            <span className="sep">/</span>
            <span>Dashboard</span>
            <span className="sep">/</span>
            <strong>{categoryName}</strong>
          </div>

          <div className="top-actions">
            {selectedHostname && (
              <label className="search hover-lift">
                <input
                  type="text"
                  placeholder=""
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && onSearch(e)}
                  aria-label="Search here"
                />
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Search"
                  onClick={onSearch}
                />
              </label>
            )}
            <ThemeToggle className="toggle" />
          </div>
        </header>

        <div className="page-title">
          <h1>{categoryName}</h1>
        </div>

        <section className="cat-layout ">
          {/* LEFT: Website list */}
          <WebsiteList
            className={cx("card panel left-list", "frame-gradient")}
            style={
              darkMode
                ? { "--frame-fill": "#000000ff", "--card-fg": "#e6e9ef" }
                : undefined
            }
            categoryName={categoryName}
            selectedSiteId={selectedSite?.id}
            onSelectSite={setSelectedSite}
            autoSelectFirst
            preview={false}
          />

          {selectedHostname ? (
            <>
              <div className="center-title">
                <CenterTitle
                  siteName={
                    selectedSite?.displayName ||
                    selectedHostname ||
                    "Website Name"
                  }
                />
              </div>

              <div className="center-top">
                <div className="frame-gradient hover-lift">
                  <div className="mini-card">
                    <div className="mini-label">Last Visit</div>
                    <div className="mini-value">{lastVisitText}</div>
                  </div>
                </div>
                <div className="frame-gradient hover-lift">
                  <div className="mini-card">
                    <div className="mini-label">Screen Time</div>
                    <div className="mini-value">{screenTimeText}</div>
                  </div>
                </div>
              </div>

              <div
                className={cx(
                  "provided-slot provided-lift",
                  "frame-gradient hover-lift"
                )}
                style={{
                  gridArea: "2 / 2 / 3 / 3",
                  alignSelf: "start",
                  width: "100%",
                }}
              >
                <ProvidedDataCard
                  style={{
                    "--frame-fill": "#000000ff",
                    "--card-fg": "#000000ff",
                  }}
                  data={provided || EMPTY_PROVIDED}
                />
                {!provided && selectedHostname && providedErr && (
                  <div className="text-sm text-red-500 mt-2">
                    Couldn’t load provided data: {providedErr}
                  </div>
                )}
              </div>

              <div
                className="frame-gradient hover-lift use-dark-in-dark"
                style={{ "--frame-border": "12px" }}
              >
                <RiskCard
                  className="risk-card"
                  extUserId={extUserId}
                  hostname={selectedHostname}
                  score={riskScore}
                  band={riskBand}
                />
              </div>
            </>
          ) : (
            <EmptyState categoryName={categoryName} />
          )}
        </section>
      </main>
    </div>
  );
}
