import React from "react";
import { Link } from "react-router-dom";
import { useTheme } from "../contexts/ThemeContext";

/* Icons */
import home from "../assets/sidebar-icons/home.svg";
import homeLight from "../assets/sidebar-icons/light - home.svg";

import dashboard from "../assets/sidebar-icons/dashboard.svg";
import dashboardLight from "../assets/sidebar-icons/light - dashboard.svg";

import settings from "../assets/sidebar-icons/settings.svg";
import settingsLight from "../assets/sidebar-icons/light - settings.svg";

import notifications from "../assets/sidebar-icons/notification.svg";
import notificationsLight from "../assets/sidebar-icons/light - notification.svg";

import extension from "../assets/sidebar-icons/extension.svg";
import extensionLight from "../assets/sidebar-icons/light - extension.svg";

import subscription from "../assets/sidebar-icons/click.svg";
import subscriptionLight from "../assets/sidebar-icons/light - click.svg";

import logout from "../assets/sidebar-icons/logout.svg";
import logoutLight from "../assets/sidebar-icons/light - logout.svg";

/**
 * Sidebar
 * - Updated with new branding (two-line PrivacyPulse with logo space)
 * - Clean navigation without dashed borders
 * - Hover effects with shadows
 */
export default function Sidebar() {
  const { darkMode } = useTheme();
  const pick = (normal, light) => (darkMode ? light : normal);

  const Icon = ({ src }) => (
    <span className="icon-container" aria-hidden="true">
      <img
        src={src}
        alt=""
        style={{ 
          width: "20px", 
          height: "20px", 
          objectFit: "contain", 
          display: "block" 
        }}
      />
    </span>
  );

  return (
    <aside id="sidebar" aria-label="Primary">
      {/* Updated Brand with logo space and two-line text */}
      <Link to="/" className="brand" aria-label="PrivacyPulse">
        <div className="logo">PP</div>
        <div className="brand-text">
          <div className="line1">Privacy</div>
          <div className="line2">Pulse</div>
        </div>
      </Link>

      {/* Main nav */}
      <nav>
        <ul>
          <li>
            <Link to="/" className="nav-row" aria-label="Home">
              <Icon src={pick(home, homeLight)} />
              <span className="label">Home</span>
            </Link>
          </li>

          <li>
            <Link to="/dashboard" className="nav-row" aria-label="Dashboard">
              <Icon src={pick(dashboard, dashboardLight)} />
              <span className="label">Dashboard</span>
            </Link>
          </li>

          <li>
            <Link to="/settings" className="nav-row" aria-label="Settings">
              <Icon src={pick(settings, settingsLight)} />
              <span className="label">Settings</span>
            </Link>
          </li>

          <li>
            <Link to="/notifications" className="nav-row" aria-label="Notifications">
              <Icon src={pick(notifications, notificationsLight)} />
              <span className="label">Notifications</span>
            </Link>
          </li>

          <li>
            <Link to="/extensions" className="nav-row" aria-label="Extensions">
              <Icon src={pick(extension, extensionLight)} />
              <span className="label">Get Extension</span>
            </Link>
          </li>

          <li>
            <Link to="/subs" className="nav-row" aria-label="Subscription">
              <Icon src={pick(subscription, subscriptionLight)} />
              <span className="label">Subscription</span>
            </Link>
          </li>
        </ul>
      </nav>

      {/* Footer */}
      <div className="sidebar-footer">
        <Link to="/login" className="nav-row" aria-label="Log out">
          <Icon src={pick(logout, logoutLight)} />
          <span className="label">Log out</span>
        </Link>
      </div>
    </aside>
  );
}