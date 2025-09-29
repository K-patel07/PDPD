import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { fetchSitesByCategory } from "../api/metrics.js";
import { CANONICAL_CATEGORIES } from "../utils/categories.js";
import "../styles/GlobalSearch.css";

function stripWWW(hostname = "") {
  const h = String(hostname).trim().toLowerCase();
  return h.startsWith("www.") ? h.slice(4) : h;
}

function cleanHostname(hostname) {
  const h = stripWWW(hostname);
  if (!h) return "";
  return h.charAt(0).toUpperCase() + h.slice(1);
}

export default function GlobalSearch() {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [allWebsites, setAllWebsites] = useState([]);
  const navigate = useNavigate();
  const searchRef = useRef(null);
  const dropdownRef = useRef(null);

  // Get extUserId
  const extUserId = (localStorage.getItem("ext_user_id") || localStorage.getItem("extUserId") || "").trim();

  // Load all websites from all categories on component mount
  useEffect(() => {
    if (!extUserId) return;

    const loadAllWebsites = async () => {
      setIsLoading(true);
      const websites = [];

      try {
        // Fetch websites from all categories
        const promises = CANONICAL_CATEGORIES.map(async (category) => {
          try {
            const sites = await fetchSitesByCategory({ extUserId, category });
            return sites.map(site => ({
              ...site,
              category,
              displayName: cleanHostname(site.hostname),
              searchKey: `${cleanHostname(site.hostname)} ${site.hostname}`.toLowerCase()
            }));
          } catch (error) {
            console.error(`Error fetching sites for category ${category}:`, error);
            return [];
          }
        });

        const results = await Promise.all(promises);
        results.forEach(categorySites => {
          websites.push(...categorySites);
        });

        // Remove duplicates based on hostname
        const uniqueWebsites = websites.reduce((acc, site) => {
          const key = stripWWW(site.hostname);
          if (!acc.find(s => stripWWW(s.hostname) === key)) {
            acc.push(site);
          }
          return acc;
        }, []);

        setAllWebsites(uniqueWebsites);
      } catch (error) {
        console.error("Error loading all websites:", error);
      } finally {
        setIsLoading(false);
      }
    };

    loadAllWebsites();
  }, [extUserId]);

  // Filter websites based on search query
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      setShowDropdown(false);
      return;
    }

    const query = searchQuery.toLowerCase().trim();
    const filtered = allWebsites.filter(site => 
      site.searchKey.includes(query) ||
      site.displayName.toLowerCase().includes(query) ||
      site.hostname.toLowerCase().includes(query)
    );

    // Sort by relevance (exact matches first, then partial matches)
    const sorted = filtered.sort((a, b) => {
      const aExact = a.displayName.toLowerCase().startsWith(query);
      const bExact = b.displayName.toLowerCase().startsWith(query);
      
      if (aExact && !bExact) return -1;
      if (!aExact && bExact) return 1;
      
      return a.displayName.localeCompare(b.displayName);
    });

    setSearchResults(sorted.slice(0, 8)); // Limit to 8 results
    setShowDropdown(sorted.length > 0);
  }, [searchQuery, allWebsites]);

  // Handle click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        searchRef.current && 
        !searchRef.current.contains(event.target) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target)
      ) {
        setShowDropdown(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSearch = (e) => {
    e?.preventDefault();
    if (searchQuery.trim() && searchResults.length > 0) {
      // Navigate to the first result
      const firstResult = searchResults[0];
      navigate(`/category/${encodeURIComponent(firstResult.category)}?site=${encodeURIComponent(firstResult.hostname)}`);
      setSearchQuery("");
      setShowDropdown(false);
    }
  };

  const handleWebsiteClick = (website) => {
    navigate(`/category/${encodeURIComponent(website.category)}?site=${encodeURIComponent(website.hostname)}`);
    setSearchQuery("");
    setShowDropdown(false);
  };

  const handleInputChange = (e) => {
    setSearchQuery(e.target.value);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      handleSearch(e);
    } else if (e.key === "Escape") {
      setShowDropdown(false);
      setSearchQuery("");
    }
  };

  return (
    <div className="global-search-container" ref={searchRef}>
      <label className="search">
        <input
          ref={searchRef}
          type="text"
          placeholder="Search websites..."
          value={searchQuery}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => searchQuery.trim() && setShowDropdown(true)}
          aria-label="Search websites"
        />
        <button 
          className="icon-btn" 
          aria-label="Search" 
          onClick={handleSearch}
        />
      </label>

      {showDropdown && (
        <div className="search-dropdown" ref={dropdownRef}>
          {isLoading ? (
            <div className="search-loading">Loading websites...</div>
          ) : searchResults.length > 0 ? (
            <div className="search-results">
              {searchResults.map((website, index) => (
                <div
                  key={`${website.hostname}-${website.category}`}
                  className="search-result-item"
                  onClick={() => handleWebsiteClick(website)}
                >
                  <div className="website-info">
                    <div className="website-name">{website.displayName}</div>
                    <div className="website-category">{website.category}</div>
                  </div>
                  <div className="website-favicon">
                    <img
                      src={`https://www.google.com/s2/favicons?domain=${website.hostname}&sz=16`}
                      alt={`${website.displayName} favicon`}
                      onError={(e) => {
                        e.target.style.display = 'none';
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : searchQuery.trim() ? (
            <div className="search-no-results">No websites found</div>
          ) : null}
        </div>
      )}
    </div>
  );
}
