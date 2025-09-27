// src/components/categoryscroll.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useTheme } from "../contexts/ThemeContext";
import { Link } from "react-router-dom";
import { fetchCategoryBreakdown } from "@/api/metrics";
import { CANONICAL_CATEGORIES, canonicalCategory } from "@/utils/categories";

/* ------------------- Icons (light/dark pairs) ------------------- */
import EducationIcon from "../assets/category/light - Education.svg";
import EducationLightIcon from "../assets/category/Education.svg";
import EntertainmentIcon from "../assets/category/light - Entertainment.svg";
import EntertainmentLightIcon from "../assets/category/Entertainment.svg";
import FinanceIcon from "../assets/category/light - Finance.svg";
import FinanceLightIcon from "../assets/category/Finance.svg";
import HealthIcon from "../assets/category/light - Health.svg";
import HealthLightIcon from "../assets/category/Health.svg";
import NewsIcon from "../assets/category/light - News.svg";
import NewsLightIcon from "../assets/category/News.svg";
import ECommerceIcon from "../assets/category/light - E-commerce.svg";
import ECommerceLightIcon from "../assets/category/E-commerce.svg";
import SocialIcon from "../assets/category/light - Social.svg";
import SocialLightIcon from "../assets/category/Social.svg";
import TravelIcon from "../assets/category/light - Travel.svg";
import TravelLightIcon from "../assets/category/Travel.svg";
import SportsIcon from "../assets/category/light - Sports.svg";
import SportsLightIcon from "../assets/category/Sports.svg";
import ProductivityIcon from "../assets/category/light - Work.svg";
import ProductivityLightIcon from "../assets/category/Work.svg";
import OtherIcon from "../assets/category/light - Other.svg";
import OtherLightIcon from "../assets/category/Other.svg";

/* ------------------ Icon map (keys must be canonical) ------------------ */
const ICONS = {
  Education:        { normal: EducationIcon,     light: EducationLightIcon },
  Entertainment:    { normal: EntertainmentIcon, light: EntertainmentLightIcon },
  Finance:          { normal: FinanceIcon,       light: FinanceLightIcon },
  Health:           { normal: HealthIcon,        light: HealthLightIcon },
  News:             { normal: NewsIcon,          light: NewsLightIcon },
  "E-commerce":     { normal: ECommerceIcon,     light: ECommerceLightIcon },
  "Social Media":   { normal: SocialIcon,        light: SocialLightIcon },
  Travel:           { normal: TravelIcon,        light: TravelLightIcon },
  Sports:           { normal: SportsIcon,        light: SportsLightIcon },
  Productivity:     { normal: ProductivityIcon,  light: ProductivityLightIcon },
  Others:           { normal: OtherIcon,         light: OtherLightIcon },
};

/* ------------------ UI alias safety net (frontend only) ----------------- */
const UI_ALIASES = {
  "shopping": "E-commerce",
  "ecommerce": "E-commerce",
  "e-commerce": "E-commerce",
  "e commerece": "E-commerce",
  "e-commerece": "E-commerce",
  "social": "Social Media",
  "social media": "Social Media",
  "social-media": "Social Media",
  "other": "Others",
  "others": "Others",
  "misc": "Others",
  "uncategorized": "Others",
};

function canonUI(name) {
  if (!name) return "Others";
  const s = String(name).trim().toLowerCase();
  const alias = UI_ALIASES[s];
  const normalized = alias || name;
  const c = canonicalCategory(normalized);
  return CANONICAL_CATEGORIES.includes(c) ? c : "Others";
}

function getCategoryIcon(category, darkMode) {
  const key = canonUI(category);
  const pair = ICONS[key];
  if (!pair) return null;
  // “light - X.svg” is for dark backgrounds
  return darkMode ? pair.light : pair.normal;
}

/* keep categories with data first, then append the rest of canonicals */
function mergeOrder(primary, fallback) {
  const seen = new Set();
  const out = [];
  (primary || []).forEach(c => { if (c && !seen.has(c)) { seen.add(c); out.push(c); }});
  (fallback || []).forEach(c => { if (!seen.has(c)) out.push(c); });
  return out;
}

export default function CategoryScroll({ visibleCount = 6, useDynamic = true }) {
  const { darkMode } = useTheme();

  const extUserId = useMemo(
    () =>
      (localStorage.getItem("ext_user_id") ||
        localStorage.getItem("extUserId") ||
        "").trim(),
    []
  );

  const [cats, setCats] = useState(CANONICAL_CATEGORIES);
  const [startIndex, setStartIndex] = useState(0);

  /* ---------------------- Load & shape categories ---------------------- */
  useEffect(() => {
    if (!useDynamic) {
      setCats(CANONICAL_CATEGORIES);
      return;
    }

    let cancelled = false;

    async function load() {
      try {
        if (!extUserId) {
          if (!cancelled) setCats(CANONICAL_CATEGORIES);
          return;
        }
        const res = await fetchCategoryBreakdown({ extUserId });
        if (cancelled) return;

        const rows = Array.isArray(res) ? res : (res?.items || []);
        // dynamic set = what the API returned (normalized & deduped, order preserved)
        const dynamic = Array.from(
          new Set(
            (rows || [])
              .map(r => canonUI(r?.category))
              .filter(Boolean)
          )
        );

        const merged = mergeOrder(dynamic, CANONICAL_CATEGORIES);
        setCats(merged);
      } catch {
        if (!cancelled) setCats(CANONICAL_CATEGORIES);
      }
    }

    load();

    // (optional) refresh triggers
    const t = setInterval(load, 30000);
    const onVis = () => { if (document.visibilityState === "visible") load(); };
    const onStorage = (e) => { if (e.key === "last_visit_event") load(); };

    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("storage", onStorage);

    return () => {
      cancelled = true;
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("storage", onStorage);
    };
  }, [extUserId, useDynamic]);

  /* ------------------------ Scroller calculations ------------------------ */
  const total = cats.length;
  const showCount = Math.min(visibleCount, total);

  const visibleCategories = useMemo(() => {
    if (total === 0) return [];
    const out = [];
    for (let i = 0; i < showCount; i++) {
      const idx = (startIndex + i) % total;
      out.push(cats[idx]);
    }
    return out;
  }, [cats, total, startIndex, showCount]);

  const arrowsDisabled = total <= showCount;
  const scrollLeft = () =>
    !arrowsDisabled && setStartIndex((prev) => (prev - 1 + total) % total);
  const scrollRight = () =>
    !arrowsDisabled && setStartIndex((prev) => (prev + 1) % total);

  /* ---------------------------------- UI -------------------------------- */
  return (
    <div className="category-scroll">
      <button
        className="scroll-left"
        onClick={scrollLeft}
        disabled={arrowsDisabled}
        aria-label="Scroll categories left"
        title="Previous"
      >
        ◀
      </button>

      <div className="categories">
        {visibleCategories.map((c, i) => {
          const iconSrc = getCategoryIcon(c, darkMode);
          return (
            <Link
              key={`${startIndex}-${i}-${c}`}
              className="category"
              // IMPORTANT: keep canonical casing in URL (no .toLowerCase())
              to={`/category/${encodeURIComponent(c)}`}
            >
              <span className="category-icon">
                {iconSrc && (
                  <img
                    src={iconSrc}
                    alt=""
                    style={{ width: 28, height: 28, objectFit: "contain" }}
                  />
                )}
              </span>
              <span className="category-label">{canonUI(c)}</span>
            </Link>
          );
        })}
      </div>

      <button
        className="scroll-right"
        onClick={scrollRight}
        disabled={arrowsDisabled}
        aria-label="Scroll categories right"
        title="Next"
      >
        ▶
      </button>
    </div>
  );
}
