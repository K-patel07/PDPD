import React, { useState } from "react";
import "../styles/UserManual.css";

export default function UserManual() {
  const [isOpen, setIsOpen] = useState(false);

  const toggleModal = () => {
    setIsOpen(!isOpen);
  };

  const closeModal = (e) => {
    if (e.target === e.currentTarget) {
      setIsOpen(false);
    }
  };

  return (
    <>
      <button 
        className="icon-btn user-manual-btn" 
        onClick={toggleModal}
        aria-label="User Manual"
        title="User Manual"
      >
        <img src="/src/assets/info.svg" alt="Info" width="40" height="40" />
      </button>

      {isOpen && (
        <div className="user-manual-overlay" onClick={closeModal}>
          <div className="user-manual-modal">
            <div className="user-manual-header">
              <h2>User Manual</h2>
              <button 
                className="close-btn" 
                onClick={() => setIsOpen(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            
            <div className="user-manual-content">
              <section className="manual-section">
                <h3>Getting Started</h3>
                <ul>
                  <li>Welcome to your PrivacyPulse Dashboard! This is your central hub for monitoring your digital privacy.</li>
                  <li>The dashboard automatically updates with your browsing data from the browser extension.</li>
                </ul>
              </section>

              <section className="manual-section">
                <h3>Dashboard Overview</h3>
                <ul>
                  <li><strong>Category Tabs:</strong> Click on Education, Entertainment, Finance, Health, News, or Shopping to filter your data by category.</li>
                  <li><strong>Welcome Card:</strong> Shows your personalized greeting and quick overview.</li>
                  <li><strong>Risk Analysis:</strong> Displays the 5 most visited websites with color-coded risk levels:
                    <ul>
                      <li>🔴 Red: High risk - websites that collect significant personal data</li>
                      <li>🟡 Yellow: Medium risk - moderate data collection</li>
                      <li>🟢 Green: Low risk - minimal data collection</li>
                    </ul>
                  </li>
                </ul>
              </section>

              <section className="manual-section">
                <h3>Understanding Your Data</h3>
                <ul>
                  <li><strong>Visit Percentage Chart:</strong> Shows how your browsing time is distributed across different categories.</li>
                  <li><strong>Login Frequency Chart:</strong> Tracks how often you visit sites over time - helps identify browsing patterns.</li>
                  <li><strong>Search Function:</strong> Use the search bar to quickly find specific websites or data.</li>
                </ul>
              </section>

              <section className="manual-section">
                <h3>Privacy Tips</h3>
                <ul>
                  <li>Regular review of high-risk sites can help you make informed decisions about your online privacy.</li>
                  <li>Consider using privacy-focused browsers or extensions for high-risk websites.</li>
                  <li>Check privacy settings on frequently visited social media and entertainment platforms.</li>
                  <li>Be cautious about the personal information you share on finance and health websites.</li>
                </ul>
              </section>

              <section className="manual-section">
                <h3>Troubleshooting</h3>
                <ul>
                  <li><strong>No data showing?</strong> Make sure the PrivacyPulse browser extension is installed and enabled.</li>
                  <li><strong>Incorrect categories?</strong> Our AI categorizes sites automatically, but you can manually adjust if needed.</li>
                  <li><strong>Theme toggle:</strong> Use the toggle in the top right to switch between light and dark modes.</li>
                </ul>
              </section>

              <section className="manual-section">
                <h3>Need Help?</h3>
                <p>If you need additional support, please contact our team at <strong>support@privacypulse.com</strong></p>
              </section>
            </div>
          </div>
        </div>
      )}
    </>
  );
}