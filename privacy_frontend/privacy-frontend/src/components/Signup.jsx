// Signup.jsx - Updated with authentication

import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuthTransition } from "../hooks/useAuthTransition";
import AuthService from "../services/authService"; // ADD THIS LINE
import "../styles/Auth.css";

export default function Signup() {
  const navigate = useNavigate();
  const { triggerTransition } = useAuthTransition();

  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    mobile: "",
    password: "",
    confirm: "",
    accept: false,
  });

  // ADD THESE STATE VARIABLES
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });

  const onChange = (e) => {
    const { name, value, type, checked } = e.target;
    setForm((f) => ({ ...f, [name]: type === "checkbox" ? checked : value }));
    
    // Clear message when user starts typing
    if (message.text) {
      setMessage({ type: '', text: '' });
    }
  };

  const next = (e) => {
    e.preventDefault();
    setStep((s) => Math.min(3, s + 1));
  };

  const back = (e) => {
    e.preventDefault();
    setStep((s) => Math.max(1, s - 1));
    // Clear any messages when going back
    setMessage({ type: '', text: '' });
  };

  const handleLoginClick = (e) => {
    e.preventDefault();
    triggerTransition('/login');
  };

  // ✅ helper: store token/ext_user_id locally and share with extension
  const persistIdentity = async ({ token, ext_user_id }) => {
    try {
      if (token) localStorage.setItem('token', token);
      if (ext_user_id) localStorage.setItem('ext_user_id', ext_user_id);

      if (window.chrome?.storage?.local) {
        await chrome.storage.local.set({ token, ext_user_id });
      } else {
        // if a content script bridge is used
        window.postMessage({ type: 'PP_AUTH_UPDATE', token, ext_user_id }, '*');
      }
    } catch (e) {
      console.warn('[Signup] persistIdentity failed:', e);
    }
  };

  // UPDATED SUBMIT HANDLER WITH AUTHENTICATION
  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage({ type: '', text: '' });

    // Validation
    if (form.password !== form.confirm) {
      setMessage({ type: 'error', text: 'Passwords do not match' });
      setLoading(false);
      return;
    }

    // Match backend strong policy: 8+ chars, upper, lower, number, symbol
    const strongPassword = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^\w\s]).{8,}$/;
    if (!strongPassword.test(form.password)) {
      setMessage({
        type: 'error',
        text:
          'Password must be 8+ chars and include upper, lower, number, and symbol',
      });
      setLoading(false);
      return;
    }

    if (!form.accept) {
      setMessage({ type: 'error', text: 'You must accept the Terms & Privacy Policy' });
      setLoading(false);
      return;
    }

// Prepare data for API (combine names; strip non-letters/digits)
const signupData = {
  username: `${form.firstName}${form.lastName}`.replace(/\W/g, ""),
  email: form.email,
  password: form.password,
};


    try {
      const result = await AuthService.signup(signupData);
      
      if (result.ok) {
        // pull token/ext_user_id from expected/top-level fields (with safe fallbacks)
        const token = result.token || result.data?.token;
        const ext_user_id =
          result.ext_user_id ||
          result.data?.ext_user_id ||
          result.user?.ext_user_id;

        // ✅ persist identity for app + extension
        await persistIdentity({ token, ext_user_id });

        setMessage({ type: 'success', text: 'Account created successfully!' });
        // Navigate to verify screen or dashboard after short delay
        setTimeout(() => {
          navigate("/verify", { state: { email: form.email, mobile: form.mobile } });
          // OR redirect to dashboard: triggerTransition('/dashboard');
        }, 1200);
      } else {
        setMessage({ type: 'error', text: result.error || 'Account creation failed' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Network error occurred' });
    }
    
    setLoading(false);
  };

  return (
    <div className="auth-page">
      <div className="auth-card mirror">
        {/* Left black hero */}
        <div className="auth-hero mirror">
          <h2>CREATE<br />ACCOUNT</h2>
          <p>Join PrivacyPulse to see your digital world unfold</p>
        </div>

        {/* Right form */}
        <form className="auth-form mirror" onSubmit={step === 3 ? submit : next}>
          <div className="top-row">
            <h3 className="auth-title">Sign Up</h3>
            <div className="step-dots" aria-label={`Step ${step} of 3`}>
              <span className={step === 1 ? "dot active" : "dot"} />
              <span className={step === 2 ? "dot active" : "dot"} />
              <span className={step === 3 ? "dot active" : "dot"} />
            </div>
          </div>

          {/* ADD MESSAGE DISPLAY - ONLY SHOW ON STEP 3 OR IF ERROR ON OTHER STEPS */}
          {message.text && (step === 3 || message.type === 'error') && (
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

          {/* STEP 1: First & Last name */}
          {step === 1 && (
            <>
              <div className="input-box">
                <input
                  type="text"
                  name="firstName"
                  required
                  value={form.firstName}
                  onChange={onChange}
                  disabled={loading}
                />
                <label>First Name</label>
                <i className="bx bxs-user" aria-hidden="true" />
                <span className="bar" />
              </div>

              <div className="input-box">
                <input
                  type="text"
                  name="lastName"
                  required
                  value={form.lastName}
                  onChange={onChange}
                  disabled={loading}
                />
                <label>Last Name</label>
                <i className="bx bxs-user-detail" aria-hidden="true" />
                <span className="bar" />
              </div>

              <div className="row gap8">
                <button className="btn-half btn-text" onClick={back} disabled>
                  Back
                </button>
                <button className="btn-half btn-primary" type="submit" disabled={loading}>
                  Next
                </button>
              </div>

              <p className="auth-meta">
                Already have an account? <a href="#" onClick={handleLoginClick}>Login</a>
              </p>
            </>
          )}

          {/* STEP 2: Email & Mobile */}
          {step === 2 && (
            <>
              <div className="input-box">
                <input
                  type="email"
                  name="email"
                  required
                  value={form.email}
                  onChange={onChange}
                  disabled={loading}
                />
                <label>Email</label>
                <i className="bx bxs-envelope" aria-hidden="true" />
                <span className="bar" />
              </div>

              <div className="input-box">
                <input
                  type="tel"
                  name="mobile"
                  required
                  value={form.mobile}
                  onChange={onChange}
                  disabled={loading}
                />
                <label>Mobile Number</label>
                <i className="bx bxs-phone" aria-hidden="true" />
                <span className="bar" />
              </div>

              <div className="row gap8">
                <button className="btn-half btn-text" onClick={back} disabled={loading}>
                  Back
                </button>
                <button className="btn-half btn-primary" type="submit" disabled={loading}>
                  Next
                </button>
              </div>

              <p className="auth-meta">
                Already have an account? <a href="#" onClick={handleLoginClick}>Login</a>
              </p>
            </>
          )}

          {/* STEP 3: Passwords + Terms */}
          {step === 3 && (
            <>
              <div className="input-box">
                <input
                  type="password"
                  name="password"
                  required
                  value={form.password}
                  onChange={onChange}
                  disabled={loading}
                />
                <label>Create Password</label>
                <i className="bx bxs-lock-alt" aria-hidden="true" />
                <span className="bar" />
              </div>

              <div className="input-box">
                <input
                  type="password"
                  name="confirm"
                  required
                  value={form.confirm}
                  onChange={onChange}
                  disabled={loading}
                />
                <label>Confirm Password</label>
                <i className="bx bxs-lock" aria-hidden="true" />
                <span className="bar" />
              </div>

              <label className="checkbox-row">
                <input
                  type="checkbox"
                  name="accept"
                  checked={form.accept}
                  onChange={onChange}
                  required
                  disabled={loading}
                />
                <span>I agree to the Terms &amp; Privacy Policy</span>
              </label>

              <div className="row gap8">
                <button className="btn-half btn-text" onClick={back} disabled={loading}>
                  Back
                </button>
                <button className="btn-half btn-primary" type="submit" disabled={loading}>
                  {loading ? 'Creating...' : 'Create Account'}
                </button>
              </div>

              <p className="auth-meta">
                Already have an account? <a href="#" onClick={handleLoginClick}>Login</a>
              </p>
            </>
          )}
        </form>
      </div>
    </div>
  );
}
