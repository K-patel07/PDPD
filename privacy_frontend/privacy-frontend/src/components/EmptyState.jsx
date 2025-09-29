import React from "react";
import { Link } from "react-router-dom";
import emptyLookImage from "../assets/empty-look.png";
import "../styles/EmptyState.css";

export default function EmptyState({ categoryName }) {
  return (
    <div className="empty-state-container">
      <div className="empty-state-content">
        {/* Image */}
        <div className="empty-state-image">
          <img 
            src={emptyLookImage} 
            alt="No websites found" 
            className="empty-illustration"
          />
        </div>

        {/* Main message */}
        <h2 className="empty-state-title">We couldn't find any website</h2>

        {/* Secondary message */}
        <p className="empty-state-subtitle">May be check others</p>

        {/* Action buttons */}
        <div className="empty-state-actions">
          <Link 
            to="/category/Others" 
            className="empty-state-button"
          >
            Check Others
          </Link>
        </div>

        {/* Return link */}
        <div className="empty-state-footer">
          <Link 
            to="/dashboard" 
            className="empty-state-link"
          >
            Return to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
