import React, { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, Link } from "react-router-dom";
import "../styles/Auth.css";

export default function Otp() {
  const navigate = useNavigate();
  const { state } = useLocation(); // { method }
  const [values, setValues] = useState(Array(6).fill(""));
  const inputsRef = useRef([]);

  useEffect(() => {
    inputsRef.current[0]?.focus();
  }, []);

  const onChange = (i, v) => {
    if (!/^\d?$/.test(v)) return;       // only digits
    const next = [...values];
    next[i] = v;
    setValues(next);
    if (v && i < 5) inputsRef.current[i + 1]?.focus();
  };

  const onKeyDown = (i, e) => {
    if (e.key === "Backspace" && !values[i] && i > 0) {
      inputsRef.current[i - 1]?.focus();
    }
  };

  const code = values.join("");
  const ready = code.length === 6;

  const submit = (e) => {
    e.preventDefault();
    if (!ready) return;
    // TODO: verify OTP with backend here
    navigate("/dashboard");
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        {/* right dark side for OTP like login layout (black on right) */}
        <div className="auth-hero">
          <h2>ENTER<br/>THE CODE</h2>
          <p>
            We sent a 6-digit code via{" "}
            {state?.method === "totp" ? "Authenticator app" :
             state?.method === "email" ? "Email" : "SMS"}.
          </p>
        </div>

        <form className="auth-form" onSubmit={submit}>
          <div className="top-row">
            <h3 className="auth-title">Verification Code</h3>
          </div>

          <div className="otp-row">
            {values.map((v, i) => (
              <input
                key={i}
                type="text"
                inputMode="numeric"
                maxLength={1}
                value={v}
                onChange={(e) => onChange(i, e.target.value)}
                onKeyDown={(e) => onKeyDown(i, e)}
                ref={(el) => (inputsRef.current[i] = el)}
                className="otp-box"
                required
              />
            ))}
          </div>

          <button className="btn-primary" type="submit" disabled={!ready}>
            Continue
          </button>

          <p className="auth-meta">
            Didn’t receive a code? <button type="button" className="link-btn">Resend</button>
          </p>

          <p className="auth-meta">
            Wrong method? <Link to="/verify">Change</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
