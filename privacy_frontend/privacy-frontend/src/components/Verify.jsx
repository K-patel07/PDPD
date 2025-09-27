import React, { useState } from "react";
import { useLocation, useNavigate, Link } from "react-router-dom";
import "../styles/Auth.css";

export default function Verify() {
  const navigate = useNavigate();
  const { state } = useLocation(); // { email, mobile } from signup (optional)
  const [method, setMethod] = useState("sms"); // sms | email | totp

  const labelText = {
    sms: state?.mobile ? `SMS to ${state.mobile}` : "SMS to your mobile",
    email: state?.email ? `Email to ${state.email}` : "Email to your address",
    totp: "Google Authenticator (TOTP)",
  };

  const goNext = (e) => {
    e.preventDefault();
    navigate("/otp", { state: { method } });
  };

  return (
    <div className="auth-page">
      <div className="auth-card mirror">
        {/* left dark hero */}
        <div className="auth-hero mirror">
          <h2>
            VERIFY
            <br />
            ACCOUNT
          </h2>
          <p>Choose how you want to receive your one-time code.</p>
        </div>

        {/* right content */}
        <form className="auth-form mirror" onSubmit={goNext}>
          <div className="top-row">
            <h3 className="auth-title">Pick a method</h3>
          </div>

          <div className="radio-group">
            <label className={`radio-row ${method === "sms" ? "active" : ""}`}>
              <input
                type="radio"
                name="method"
                value="sms"
                checked={method === "sms"}
                onChange={() => setMethod("sms")}
              />
              <span className="radio-label">
                <i className="bx bxs-phone" aria-hidden="true" />
                {labelText.sms}
              </span>
            </label>

            <label className={`radio-row ${method === "email" ? "active" : ""}`}>
              <input
                type="radio"
                name="method"
                value="email"
                checked={method === "email"}
                onChange={() => setMethod("email")}
              />
              <span className="radio-label">
                <i className="bx bxs-envelope" aria-hidden="true" />
                {labelText.email}
              </span>
            </label>

            <label className={`radio-row ${method === "totp" ? "active" : ""}`}>
              <input
                type="radio"
                name="method"
                value="totp"
                checked={method === "totp"}
                onChange={() => setMethod("totp")}
              />
              <span className="radio-label">
                <i className="bx bxs-shield" aria-hidden="true" />
                Google Authenticator (TOTP)
              </span>
            </label>
          </div>

          <div className="row gap8">
            <Link to="/signup" className="btn-half btn-text center">
              Back
            </Link>
            <button className="btn-half btn-primary" type="submit">
              Confirm
            </button>
          </div>

          <p className="auth-meta">
            Already verified? <Link to="/login">Login</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
