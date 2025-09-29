// src/components/category/WebsiteList.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { fetchSitesByCategory } from "@/api/metrics.js";
import { canonicalCategory } from "@/utils/categories";
import { formatDuration } from "@/utils/formatters"; // for tooltip
import EmptyState from "../EmptyState";

const cx = (...a) => a.filter(Boolean).join(" ");

function stripWWW(hostname = "") {
  const h = String(hostname).trim().toLowerCase();
  return h.startsWith("www.") ? h.slice(4) : h;
}

function cleanHostname(hostname) {
  const h = stripWWW(hostname);
  if (!h) return "";
  return h.charAt(0).toUpperCase() + h.slice(1);
}

export default function WebsiteList({
  className = "",
  style,                    // forward custom CSS vars (e.g., --frame-fill)
  categoryName,
  selectedSiteId,
  onSelectSite,
  autoSelectFirst = true,
  preview = false,          // false → load real backend
}) {
  const [sites, setSites] = useState([]);
  const [loading, setLoading] = useState(!preview);
  const [err, setErr] = useState("");
  const [filter, setFilter] = useState("");
  const [refreshKey, setRefreshKey] = useState(0); // bumps when storage event fires
  const listRef = useRef(null);

  // support either storage key
  const extUserId = useMemo(
    () =>
      (localStorage.getItem("ext_user_id") ||
        localStorage.getItem("extUserId") ||
        "").trim(),
    []
  );

  // Canonicalize incoming category once (handles "other"/"others", "e commerce", etc.)
  const normCategory = useMemo(
    () => canonicalCategory(categoryName),
    [categoryName]
  );

  /* ----------------------- Live refresh via storage event ---------------------- */
  useEffect(() => {
    // If your extension writes localStorage.setItem('last_visit_event', Date.now())
    // every time it logs a visit, this will bump refreshKey and reload the list.
    const onStorage = (e) => {
      if (e.key === "last_visit_event") setRefreshKey((k) => k + 1);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  /* ---------------- Load sites + keep fresh (poll + focus refresh) ------------- */
  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (preview) {
        setSites([]);
        setLoading(false);
        setErr("");
        return;
      }
      if (!extUserId || !normCategory) {
        setSites([]);
        setLoading(false);
        setErr("");
        return;
      }

      setLoading(true);
      setErr("");

      try {
        let raw = await fetchSitesByCategory({
          extUserId,
          category: normCategory,
        });

        // ---- Fallbacks for legacy labels (so nothing disappears) ----
        if ((!raw || raw.length === 0) && normCategory === "Others") {
          try {
            const legacyOther = await fetchSitesByCategory({
              extUserId,
              category: "Other",
            });
            if (Array.isArray(legacyOther) && legacyOther.length) raw = legacyOther;
          } catch {}
        }
        if ((!raw || raw.length === 0) && normCategory === "E-commerce") {
          try {
            const legacyE1 = await fetchSitesByCategory({
              extUserId,
              category: "Ecommerce",
            });
            const legacyE2 =
              !legacyE1 || legacyE1.length === 0
                ? await fetchSitesByCategory({ extUserId, category: "E commerce" })
                : [];
            const candidate = [...(legacyE1 || []), ...(legacyE2 || [])];
            if (candidate.length) raw = candidate;
          } catch {}
        }
        // -------------------------------------------------------------

        // Map → stable UI model
        const mapped = (raw ?? []).map((site, idx) => {
          const host = stripWWW(site.hostname || site.host || "");
          return {
            id: site.id ?? host ?? idx,
            displayName: cleanHostname(host),
            host,                // keep for filtering + display
            hostname: host,      // ensure parent gets .hostname too
            createdAt: site.created_at,
            screen_time_seconds: site.screen_time_seconds ?? site.screen_time ?? 0,
            last_visit: site.last_visit ?? site.last_visited ?? null,
          };
        });

        // De-dupe by host (if both canonical + legacy calls returned)
        const seen = new Set();
        const deduped = [];
        for (const s of mapped) {
          const key = s.host || s.displayName;
          if (!key || seen.has(key)) continue;
          seen.add(key);
          deduped.push(s);
        }

        // Sort alphabetically by display name
        deduped.sort((a, b) => (a.displayName || "").localeCompare(b.displayName || ""));

        if (!cancelled) {
          setSites(deduped);

          // Auto-select first if requested and none currently selected
          if (autoSelectFirst && deduped.length && !selectedSiteId) {
            onSelectSite?.(deduped[0]); // { id, hostname, host, displayName, ... }
          }
          if (deduped.length === 0) setFilter("");
        }
      } catch (e) {
        if (!cancelled) setErr(e?.message || "Failed to load websites");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    // initial load
    load();

    // 🔁 poll every 15s
    const t = setInterval(() => !cancelled && load(), 15000);

    // 🔁 refresh when tab becomes visible
    const onVisibility = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // Re-load when category changes, when preview toggles, when extUserId present, or when storage ping bumps refreshKey
  }, [normCategory, preview, extUserId, autoSelectFirst, selectedSiteId, onSelectSite, refreshKey]);

  /* -------------------------------- filtering -------------------------------- */
  const filtered = useMemo(() => {
    if (preview) return [];
    const q = filter.trim().toLowerCase();
    if (!q) return sites;
    return sites.filter(
      (s) =>
        s.displayName?.toLowerCase().includes(q) ||
        s.host?.toLowerCase().includes(q)
    );
  }, [sites, filter, preview]);

  /* --------------------------- group by first letter -------------------------- */
  const sections = useMemo(() => {
    if (preview) return [];
    const map = new Map();
    for (const s of filtered) {
      let L = (s.displayName || s.host || "?").charAt(0).toUpperCase();
      if (L < "A" || L > "Z") L = "#";
      if (!map.has(L)) map.set(L, []);
      map.get(L).push(s);
    }
    const keys = Array.from(map.keys()).sort((a, b) => {
      if (a === "#") return 1;
      if (b === "#") return -1;
      return a.localeCompare(b);
    });
    return keys.map((k) => ({ letter: k, items: map.get(k) }));
  }, [filtered, preview]);

  function handleClick(site) {
    onSelectSite?.(site);
  }

  return (
    <div className={cx("card panel left-list", className)} style={style}>
      {/* Search - only show when there are websites */}
      {!loading && !err && !preview && filtered.length > 0 && (
        <label className="list-search search" aria-label="Filter websites">
          <input
            type="text"
            placeholder="Search Here"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            disabled={preview}
            aria-controls="website-listbox"
          />
        </label>
      )}

      {/* Scrollable list */}
      <div
        id="website-listbox"
        className="list-scroll pretty"
        ref={listRef}
        role="listbox"
        aria-label="Websites"
        tabIndex={0}
      >
        {loading && (
          <div className="list-skeleton" aria-hidden="true">
            {Array.from({ length: 8 }).map((_, i) => (
              <div className="li-row" key={i}>
                <span className="li-dot skeleton" />
                <span className="li-bar skeleton" />
              </div>
            ))}
          </div>
        )}

        {!loading && err && <div className="empty-state">{err}</div>}

        {!loading && !err && sections.map((sec) => (
          <section
            key={sec.letter}
            className="alpha-section"
            id={`letter-${sec.letter}`}
          >
            <h5 className="letter" aria-label={`Letter ${sec.letter}`}>
              {sec.letter}
            </h5>
            <div className="alpha-items">
              {sec.items.map((s) => {
                const selected = s.id === selectedSiteId;
                const last = s.last_visit ? new Date(s.last_visit) : null;
                return (
                  <button
                    key={s.id}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className={cx("site-row pretty-row", selected && "is-selected")}
                    onClick={() => handleClick(s)}
                    title={`${s.displayName} • Total: ${formatDuration(Number(s.screen_time_seconds || 0))}${last ? ` • Last: ${last.toLocaleDateString()}` : ""}`}
                  >
                    <img 
                      src={`https://www.google.com/s2/favicons?domain=${s.host || s.displayName}&sz=32`}
                      alt={`${s.displayName} favicon`}
                      className="site-favicon"
                      onError={(e) => {
                        e.target.style.display = 'none';
                        e.target.nextSibling.style.display = 'inline-block';
                      }}
                    />
                    <span className="site-dot" aria-hidden="true" style={{display: 'none'}} />
                    <span className="site-name pretty-name">{s.displayName}</span>
                  </button>
                );
              })}
            </div>
          </section>
        ))}

        {!loading && !err && !preview && filtered.length === 0 && (
          <EmptyState categoryName={normCategory} />
        )}
      </div>
    </div>
  );
}
