// Login.jsx - Updated with authentication
import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useAuthTransition } from "../hooks/useAuthTransition";
import AuthService from "../services/authService"; // ADD THIS LINE
import "../styles/Auth.css";

export default function Login() {
  const { triggerTransition } = useAuthTransition();
  
  // ADD THESE STATE VARIABLES
  const [formData, setFormData] = useState({
    email: '',
    password: ''
  });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });

  // ADD THIS HANDLER
  const handleSignUpClick = (e) => {
    e.preventDefault();
    triggerTransition('/signup');
  };

  // ADD THIS HANDLER FOR INPUT CHANGES
  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
  };

  // helper: share token/ext_user_id with extension
  const persistIdentity = async ({ token, ext_user_id }) => {
    try {
      if (token) localStorage.setItem('token', token);
      if (ext_user_id) localStorage.setItem('ext_user_id', ext_user_id);

      // If extension is injected on this page, write directly
      if (window.chrome?.storage?.local) {
        await chrome.storage.local.set({ token, ext_user_id });
      } else {
        // Otherwise let a content script on this origin catch and store
        window.postMessage({ type: 'PP_AUTH_UPDATE', token, ext_user_id }, '*');
      }
    } catch (e) {
      console.warn('[Login] persistIdentity failed:', e);
    }
  };

  // ADD THIS HANDLER FOR FORM SUBMISSION
  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage({ type: '', text: '' });

    // Basic validation
    if (!formData.email || !formData.password) {
      setMessage({ type: 'error', text: 'Email and password are required' });
      setLoading(false);
      return;
    }

    const result = await AuthService.login(formData);
    
    if (result.ok) {
      // Pull from top-level first; fall back to nested user if needed
      const token = result.token || result.data?.token;
      const ext_user_id =
        result.ext_user_id ||
        result.data?.ext_user_id ||
        result.user?.ext_user_id;

      // ✅ Persist to app + extension
      await persistIdentity({ token, ext_user_id });

      setMessage({ type: 'success', text: 'Login successful!' });
      // Redirect to dashboard after successful login
      setTimeout(() => {
        triggerTransition('/dashboard'); // Use your transition hook
      }, 800);
    } else {
      setMessage({ type: 'error', text: result.error || 'Login failed' });
    }
    
    setLoading(false);
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        {/* Right side message (sits on the dark angled side) */}
        <div className="auth-hero">
          <h2>WELCOME<br/>BACK!</h2>
          <p>
            Log in to uncover the patterns <br/>behind your clicks
          </p>
        </div>
        
        {/* Left side form */}
        <form className="auth-form" onSubmit={handleSubmit}>
          <h3 className="auth-title">Login</h3>
          
          {/* ADD MESSAGE DISPLAY */}
          {message.text && (
            <div className={`auth-message ${message.type}`} style={{
              padding: '10px',
              borderRadius: '4px',
              marginBottom: '20px',
              textAlign: 'center',
              fontSize: '14px',
              backgroundColor: message.type === 'error' ? '#f8d7da' : '#d4edda',
              color: message.type === 'error' ? '#721c24' : '#155724',
              border: `1px solid ${message.type === 'error' ? '#f5c6cb' : '#c3e6cb'}`
            }}>
              {message.text}
            </div>
          )}
          
          <div className="input-box">
            <input 
              type="email" 
              name="email"
              value={formData.email}
              onChange={handleChange}
              disabled={loading}
              required 
            />
            <label>Email</label>
            <i className="bx bxs-user" aria-hidden="true" />
            <span className="bar" />
          </div>
          
          <div className="input-box">
            <input 
              type="password" 
              name="password"
              value={formData.password}
              onChange={handleChange}
              disabled={loading}
              required 
            />
            <label>Password</label>
            <i className="bx bxs-lock-alt" aria-hidden="true" />
            <span className="bar" />
          </div>
          
          <button className="btn-primary" type="submit" disabled={loading}>
            {loading ? 'Logging in...' : 'Login'}
          </button>
          
          <p className="auth-meta">
            Don't have an account? <a href="#" onClick={handleSignUpClick}>Sign Up</a>
          </p>
        </form>
      </div>
    </div>
  );
}
