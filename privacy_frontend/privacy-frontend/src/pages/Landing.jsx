import { Link } from "react-router-dom";
import "../styles/LandingPage.css";

export default function LandingPage() {
  return (
    <div className="landing">
      {/* Top Navbar */}
      <header className="landing-header">
        <div className="logo-section">
          <div className="logo-placeholder"></div>
          <h2 className="logo">PrivacyPulse</h2>
        </div>
        <nav className="nav-links">
          <Link to="/login" className="nav-btn">Login</Link>
          <Link to="/signup" className="nav-btn primary">Sign Up</Link>
        </nav>
      </header>

      {/* Hero Section */}
      <section className="hero">
        <div className="hero-content">
          <div className="hero-text">
            <h1 className="hero-title">Take Control of Your Privacy</h1>
            <p className="hero-subtitle">
              Track websites you visit, analyze risk levels, and protect your personal
              data with ease.
            </p>
            <div className="cta-buttons">
              <Link to="/login" className="btn primary">Get Started</Link>
              <Link to="/login" className="btn secondary">Download Extension</Link>
            </div>
          </div>
          <div className="hero-dashboard">
            <div className="laptop-container">
              <div className="laptop-mockup">
                <div className="laptop-screen">
                  <div className="screen-bezel">
                    <div className="screen-content">
                      <img
                         src="/src/assets/dashboard-ss.png"
                         alt="PrivacyPulse Dashboard Preview"
                        className="dashboard-image"
                      />
                    </div>
                  </div>
                </div>
                <div className="laptop-base">
                  <div className="laptop-hinge"></div>
                  <div className="laptop-bottom">
                    <div className="laptop-brand">PrivacyPulse</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="features">
        <div className="features-container">
          <div className="feature-card">
            <div className="feature-icon">
              <img src="/src/assets/gauge.svg" alt="Privacy Insights" />
            </div>
            <h3 className="feature-title">Privacy Insights</h3>
            <p className="feature-description">Know what data each website collects and stay aware.</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">
              <img src="/src/assets/graphs.svg" alt="Risk Analysis" />
            </div>
            <h3 className="feature-title">Risk Analysis</h3>
            <p className="feature-description">Get instant risk ratings for the sites you use the most.</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">
              <img src="/src/assets/dashboard.svg" alt="Easy Dashboard" />
            </div>
            <h3 className="feature-title">Easy Dashboard</h3>
            <p className="feature-description">View everything at a glance with our interactive dashboard.</p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="landing-footer">
        <p>© 2025 PrivacyPulse. All rights reserved.</p>
      </footer>
    </div>
  );
}