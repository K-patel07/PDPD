import React, { useEffect, useState } from "react";
import axios from "axios";
import { Link } from "react-router-dom";
import "../styles/Category.css";

export default function CategoriesOverview() {
  const [visits, setVisits] = useState([]);

  useEffect(() => {
    async function fetchVisits() {
      try {
        const res = await axios.get("http://localhost:3000/api/track/visits");
        setVisits(res.data);
      } catch (err) {
        console.error("Error fetching visits:", err);
      }
    }
    fetchVisits();
  }, []);

  // Group by category
  const grouped = visits.reduce((acc, visit) => {
    const cat = visit.category || "Uncategorized";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(visit);
    return acc;
  }, {});

  return (
    <div className="categories-overview">
      <h1>All Categories</h1>

      {Object.keys(grouped).length === 0 ? (
        <p>No data available</p>
      ) : (
        <div className="category-list">
          {Object.keys(grouped).map((cat) => (
            <div key={cat} className="category-card">
              <h2>{cat}</h2>
              <p>{grouped[cat].length} websites</p>
              {/* Link to existing detail page */}
              <Link to={`/category/${encodeURIComponent(cat)}`}>
                View {cat}
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
