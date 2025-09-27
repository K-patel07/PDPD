// src/components/ExtensionDownloadPrompt.jsx
import React, { useState, useEffect } from 'react';
import '../styles/ExtensionDownloadPrompt.css';

export default function ExtensionDownloadPrompt({ show, onDismiss }) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (show) {
      // Small delay to trigger animation
      setTimeout(() => setIsVisible(true), 100);
    } else {
      setIsVisible(false);
    }
  }, [show]);

  if (!show) return null;

  const handleDismiss = () => {
    setIsVisible(false);
    setTimeout(() => onDismiss(), 300); // Wait for animation to complete
  };

  return (
    <>
      {/* Backdrop */}
      <div className="extension-prompt-backdrop" onClick={handleDismiss} />
      
      {/* Popup */}
      <div className={`extension-prompt ${isVisible ? 'visible' : ''}`}>
        {/* Arrow pointing to sidebar */}
        <div className="prompt-arrow" />
        
        {/* Content */}
        <div className="prompt-content">
          <div className="prompt-header">
            <h3>🎉 Almost there!</h3>
            <button 
              className="prompt-close" 
              onClick={handleDismiss}
              aria-label="Close"
            >
              ×
            </button>
          </div>
          
          <p>
            To get the most out of PrivacyPulse, download our browser extension!
          </p>
          
          <div className="prompt-actions">
            <button 
              className="btn-primary"
              onClick={() => {
                // Navigate to extensions page or trigger download
                window.location.href = '/extensions';
              }}
            >
              Download Extension
            </button>
            <button 
              className="btn-secondary"
              onClick={handleDismiss}
            >
              Maybe later
            </button>
          </div>
        </div>
      </div>
    </>
  );
}