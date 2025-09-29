import React, { useState } from "react";
import "../styles/HelpModal.css";

export default function HelpModal() {
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
        className="help-icon-btn" 
        onClick={toggleModal}
        aria-label="Help"
        title="Help"
      >
        <img src="/src/assets/info.svg" alt="Help" width="20" height="20" />
      </button>

      {isOpen && (
        <div className="help-modal-overlay" onClick={closeModal}>
          <div className="help-modal">
            <div className="help-modal-header">
              <h2>Need Help? We have got your back!</h2>
              <button 
                className="close-btn" 
                onClick={() => setIsOpen(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            
            <div className="help-modal-content">
              <p>Welcome to the Privacy Pulse help page, where you can find solutions to all the common confusion and proper guidance on how to use our Personal Data Privacy Dashboard and extension smoothly.</p>
              
              <p><strong>Wait, did you install and activate the Extension?</strong> Because, without it, it's impossible for us to track your data footprint legally.</p>

              <section className="help-section">
                <h3>How Privacy Pulse works:</h3>
                <ul>
                  <li>The extension tracks personal data you enter on websites (e.g., name, email, phone, payment details) but only stores the metadata that you have provided, alongside the screentime. All this is simply to help you understand what you have shared online</li>
                  <li>The dashboard displays a risk level (Low, Medium, High) for each site, based on the type of data provided, your frequency of visits combining it with the AI-based phishing model scores for each website.</li>
                  <li>You can review your history of data sharing to make informed privacy decisions.</li>
                </ul>
              </section>

              <section className="help-section">
                <h3>Basics:</h3>
                <ul>
                  <li>The categories list your websites as per their domains. Sometimes, you might have to find a particular website you visited inside others because not all the domains are accurately identifiable.</li>
                  <li><strong>Risk Rate Inside a category:</strong> This shows you the risk of that particular website, alongside your interaction with that.</li>
                  <li><strong>Provided Data</strong> on a particular website can be checked once you click on a particular website from the category. The website is also searchable from the search bar.</li>
                  <li>You can always upgrade to upper-level plans to have insights into unlimited websites.</li>
                </ul>
              </section>

              <section className="help-section">
                <h3>Graphical Knowledge:</h3>
                <ol>
                  <li><strong>Risk Analysis</strong> – 50% AI Score x 50% of Provided data<br/>
                  If you have visited a particular website the most (regularly) and ended up giving a lot of information, the risk score is most likely high and will make it to 50%. The rest 50% will be decided by the advanced AI model.</li>
                  
                  <li><strong>Risk Level between Categories</strong><br/>
                  Provided a lot of your information to Facebook, Instagram, Twitter and all sorts of social media accounts? Then your most risky category will be social media.</li>
                  
                  <li><strong>Visit Frequency</strong><br/>
                  Select between weekly, monthly and yearly and for example, if you hover on the Monday coordinate, it will show you the most visited website on Monday.</li>
                </ol>
              </section>

              <section className="help-section">
                <h3>Common Questions</h3>
                <div className="faq-item">
                  <h4>1. Does Privacy Pulse store my actual data?</h4>
                  <p>No. We only record metadata about what type of information you've shared (e.g., "email provided" or "payment details entered"), not your actual information. So, you are safe in our hands.</p>
                </div>
                
                <div className="faq-item">
                  <h4>2. Why am I automatically logged out after a while?</h4>
                  <p>For security reasons, the dashboard automatically signs you out after 5 minutes of inactivity. This prevents unauthorised access to your account.</p>
                </div>
                
                <div className="faq-item">
                  <h4>3. Why do you use cookies?</h4>
                  <p>We use cookies to maintain your login session, remember preferences, and track the metadata you've entered. Cookies are necessary for the dashboard to function properly.</p>
                </div>
                
                <div className="faq-item">
                  <h4>4. Can Privacy Pulse stop me from sharing data on unsafe sites?</h4>
                  <p>No. Privacy Pulse is designed to inform and alert you, not block websites. You remain responsible for the data you choose to share.</p>
                </div>
                
                <div className="faq-item">
                  <h4>5. Why is my risk level marked "High"?</h4>
                  <p>If you've entered quite several sensitive information (such as financial details, ID numbers, or medical data), have visited the website most frequently, and AI believes that to be malicious, the system will categorise that website as high-risk.</p>
                </div>
              </section>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
