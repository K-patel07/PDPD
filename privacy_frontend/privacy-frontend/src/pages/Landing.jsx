import React, { useRef, useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import AuthService from "../services/authService";
import "../styles/LandingPage.css";

/* ====== socials (fill if you like) ====== */
const SOCIALS = {
  twitter: "https://x.com/your_handle",
  github: "https://github.com/your_username",
  linkedin: "https://www.linkedin.com/in/your_username/",
};

/* Use the public file logo (Option A) */
const LOGO_SRC = "/logo.png"; // or "/logo.svg"

/* --- Inline SVG icons (unchanged) --- */
const KfGrad = ({ id }) => (
  <defs>
    <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stopColor="var(--cta-start)" />
      <stop offset="100%" stopColor="var(--cta-end)" />
    </linearGradient>
  </defs>
);

const IconExtension = () => (
  <svg className="kf-icon" viewBox="0 0 24 24" fill="none">
    <KfGrad id="g-ext" />
    <path
      d="M8 7a2 2 0 1 1 4 0h3a2 2 0 0 1 2 2v3a2 2 0 1 1 0 4h-3a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2v-3a2 2 0 1 1 0-4V9a2 2 0 0 1 1-2z"
      stroke="url(#g-ext)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
    />
  </svg>
);

const IconInsights = () => (
  <svg className="kf-icon" viewBox="0 0 24 24" fill="none">
    <KfGrad id="g-ins" />
    <path d="M4 18V9M9 18v-6M14 18v-9M19 18V6" stroke="url(#g-ins)" strokeWidth="1.8" strokeLinecap="round" />
    <path d="M3 18h18" stroke="url(#g-ins)" strokeWidth="1.8" strokeLinecap="round" opacity=".6" />
  </svg>
);

const IconEngine = () => (
  <svg className="kf-icon" viewBox="0 0 24 24" fill="none">
    <KfGrad id="g-eng" />
    <rect x="7" y="7" width="10" height="10" rx="2" stroke="url(#g-eng)" strokeWidth="1.8" />
    <path
      d="M4 10h2M4 14h2M18 10h2M18 14h2M10 4v2M14 4v2M10 18v2M14 18v2"
      stroke="url(#g-eng)" strokeWidth="1.8" strokeLinecap="round"
    />
  </svg>
);

const IconRealtime = () => (
  <svg className="kf-icon" viewBox="0 0 24 24" fill="none">
    <KfGrad id="g-rt" />
    <circle cx="12" cy="12" r="8" stroke="url(#g-rt)" strokeWidth="1.8" />
    <path d="M12 7v5l3 2" stroke="url(#g-rt)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const IconSecurity = () => (
  <svg className="kf-icon" viewBox="0 0 24 24" fill="none">
    <KfGrad id="g-sec" />
    <path
      d="M12 3l7 3v6c0 5-3.5 7.5-7 9-3.5-1.5-7-4-7-9V6l7-3z"
      stroke="url(#g-sec)" strokeWidth="1.8" strokeLinejoin="round"
    />
    <path d="M9.5 12.5l2 2 3.5-4" stroke="url(#g-sec)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const IconDashboard = () => (
  <svg className="kf-icon" viewBox="0 0 24 24" fill="none">
    <KfGrad id="g-dash" />
    <rect x="3" y="3" width="7" height="7" rx="1" stroke="url(#g-dash)" strokeWidth="1.8" />
    <rect x="14" y="3" width="7" height="7" rx="1" stroke="url(#g-dash)" strokeWidth="1.8" />
    <rect x="3" y="14" width="7" height="7" rx="1" stroke="url(#g-dash)" strokeWidth="1.8" />
    <rect x="14" y="14" width="7" height="7" rx="1" stroke="url(#g-dash)" strokeWidth="1.8" />
  </svg>
);

/** TriangleOrbit (unchanged) */
function TriangleOrbit({
  children, radius = 320, tilt = 18, friction = 0.93, sensitivity = 0.35,
  autoDelay = 2500, autoSpeed = 0.25, baseAngles = [0, 120, 240],
  minScale = 0.5, maxScale = 1.0, ...rest
}) {
  const wrapRef = useRef(null);
  const [drag, setDrag] = useState({ active: false, x: 0 });
  const angle = useRef(0);
  const vel = useRef(0);
  const lastUserTs = useRef(Date.now());
  const autoFactor = useRef(0);
  const normDeg = (d) => ((d % 360) + 360) % 360;

  useEffect(() => {
    let raf;
    const step = () => {
      const idleFor = Date.now() - lastUserTs.current;
      const isIdle = idleFor > autoDelay && Math.abs(vel.current) < 0.02;
      const target = isIdle ? 1 : 0;
      autoFactor.current += (target - autoFactor.current) * 0.05;

      angle.current += vel.current;
      vel.current *= friction;
      angle.current += autoSpeed * autoFactor.current;

      const el = wrapRef.current;
      if (el) {
        el.style.setProperty("--orbit-angle", `${angle.current}deg`);
        baseAngles.forEach((base, i) => {
          const a = normDeg(base + angle.current);
          const rad = (a * Math.PI) / 180;
          const t = (Math.cos(rad) + 1) / 2;
          const s = minScale + t * (maxScale - minScale);
          el.style.setProperty(`--scale-${i}`, s.toFixed(3));
          el.style.setProperty(`--z-${i}`, Math.round(10 + t * 90));
        });
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [friction, autoDelay, autoSpeed, baseAngles, minScale, maxScale]);

  const onDown = (e) => {
    setDrag({ active: true, x: e.clientX });
    lastUserTs.current = Date.now();
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e) => {
    if (!drag.active) return;
    const dx = e.clientX - drag.x;
    setDrag({ active: true, x: e.clientX });
    vel.current = dx * sensitivity * 0.2;
    lastUserTs.current = Date.now();
  };
  const onUp = (e) => {
    setDrag((d) => ({ ...d, active: false }));
    lastUserTs.current = Date.now();
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  return (
    <div
      {...rest}
      className={`tri-orbit ${rest.className ?? ""}`.trim()}
      ref={wrapRef}
      style={{ "--orbit-radius": `${radius}px`, "--orbit-tilt": `${tilt}deg`, ...(rest.style || {}) }}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}
      aria-label="Interactive triangle orbit"
    >
      {children}
    </div>
  );
}

/** Laptop mockup */
function LaptopMockup({ imgSrc = "/Screen-1.png" }) {
  return (
    <div className="laptop-container">
      <div className="laptop-mockup">
        <div className="laptop-screen">
          <div className="screen-bezel">
            <div className="screen-content">
              <img src={imgSrc} alt="PrivacyPulse Dashboard Preview" className="dashboard-image" />
            </div>
          </div>
        </div>
        <div className="laptop-base">
          <div className="laptop-hinge" />
          <div className="laptop-bottom">
            <div className="laptop-brand">PrivacyPulse</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ==== SECURITY ICONS (unchanged) ==== */
const svgBase = { width: 28, height: 28, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", className: "sec-svg" };
function CheckBadgeIcon() { return (<svg {...svgBase} className="sec-svg sec-svg-check" aria-hidden="true"><circle cx="12" cy="12" r="10" className="sec-svg-badge" /><path d="M7 12.5l3 3 7-7" /></svg>); }

function SecuritySection() {
  return (
    <section id="security" className="security">
      <div className="container sec-wrap">
        <h2 className="sec-title"><span className="sec-white">Build-In </span><span className="sec-grad">Security</span></h2>
        <p className="kf-eyebrow">Your Data. Your Privacy. Our Priority</p>
        <div className="sec-grid">
          <ul className="sec-list">
            <li><CheckBadgeIcon /><div><strong>Encrypted Authentication</strong><p>User credentials are secured with <b>bcrypt</b> and <b>JWT</b>.</p></div></li>
            <li><CheckBadgeIcon /><div><strong>Two-Factor Protection</strong><p>Built-in <b>2FA</b> adds an extra layer against unauthorized access.</p></div></li>
            <li><CheckBadgeIcon /><div><strong>Secure Database Practices</strong><p>Metadata stored in <b>PostgreSQL</b> with roles & validation.</p></div></li>
            <li><CheckBadgeIcon /><div><strong>Regular Risk Monitoring</strong><p>AI risk engine alerts users about threats in near real time.</p></div></li>
          </ul>
        </div>
      </div>
    </section>
  );
}

export default function LandingPage() {
  const navigate = useNavigate();
  
  const goTo = (id) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const scrollTop = () => window.scrollTo({ top: 0, behavior: "smooth" });

  // Demo login function
  const handleDemoLogin = async () => {
    try {
      const result = await AuthService.demoLogin();
      
      if (result.ok) {
        // Navigate to dashboard
        navigate('/dashboard');
      } else {
        console.error('Demo login failed:', result.error);
        // Fallback to regular login
        navigate('/login');
      }
    } catch (error) {
      console.error('Demo login failed:', error);
      // Fallback to regular login
      navigate('/login');
    }
  };

  return (
    <div className="landing">
      {/* ===== NAVBAR ===== */}
      <header className="cg-navbar">
        <div className="cg-left">
          {/* logo image from /public */}
          <img src={LOGO_SRC} alt="PrivacyPulse logo" className="cg-logo-img" />
          <span className="cg-brand">PrivacyPulse</span>
        </div>

        <nav className="cg-center">
          <button className="cg-link" onClick={() => goTo("features")}>Features</button>
          <button className="cg-link" onClick={() => goTo("how-it-works")}>How It Works</button>
          <button className="cg-link" onClick={() => goTo("security")}>Security</button>
        </nav>

        <div className="cg-right">
          <button className="cg-contact" onClick={() => goTo("contact")}>Contact</button>
          <a href="/login" className="cg-cta">Login</a>
        </div>
      </header>

      {/* ===== HERO ===== */}
      <section id="hero" className="hero">
        <div className="hero-content">
          <div className="hero-text">
            <h1 className="hero-title">
              <span className="hero-line">Take Control</span><br />
              <span className="hero-line">Of Your</span><br />
              <span className="hero-line gradient-text">Privacy</span>
            </h1>
            <p className="hero-subtitle">
              Track websites you visit, analyze risk levels,<br />and protect your personal data with ease.
            </p>

            <div className="cta-buttons cta-inline">
              <Link to="/login" className="btn primary">Get Started</Link>
              <a href="#features" className="btn outline">Download Extension</a>
              <button onClick={handleDemoLogin} className="btn demo">View Demo</button>
            </div>
          </div>

          <div className="hero-dashboard">
            <TriangleOrbit id="demo" radius={320} tilt={18} sensitivity={0.35} autoDelay={2500} autoSpeed={0.25}
              baseAngles={[0, 120, 240]} minScale={0.5} maxScale={1}>
              <div className="tri-item" style={{ "--base-angle": "0deg" }}><LaptopMockup imgSrc="/Screen-1.png" /></div>
              <div className="tri-item" style={{ "--base-angle": "120deg" }}><LaptopMockup imgSrc="/Screen-2.png" /></div>
              <div className="tri-item" style={{ "--base-angle": "240deg" }}><LaptopMockup imgSrc="/Screen-3.png" /></div>
            </TriangleOrbit>
          </div>
        </div>
      </section>

      {/* ===== KEY FEATURES ===== */}
      <section id="features" className="section kf" aria-labelledby="kf-title">
        <div className="kf-head">
          <h2 id="kf-title" className="kf-title">
            <span className="kf-key">Key</span>
            <span className="kf-accent">Features</span> <br />
            <p className="kf-eyebrow">Everything you need for private, safer browsing</p>
          </h2>
        </div>

        <div className="kf-grid">
          <article className="kf-card"><IconExtension /><h3 className="kf-card-title">Built-in Extension</h3><p className="kf-text">Captures metadata—never sensitive values.</p></article>
          <article className="kf-card"><IconInsights /><h3 className="kf-card-title">Enhanced Insights</h3><p className="kf-text">Turns raw signals into meaningful analytics.</p></article>
          <article className="kf-card"><IconEngine /><h3 className="kf-card-title">Smart Risk Engine</h3><p className="kf-text">AI logic assigns accurate risk levels.</p></article>
          <article className="kf-card"><IconRealtime /><h3 className="kf-card-title">Real-Time Monitoring</h3><p className="kf-text">Continuous tracking with instant updates.</p></article>
          <article className="kf-card"><IconSecurity /><h3 className="kf-card-title">Built-In Security</h3><p className="kf-text">Strong auth, encryption, and DB safeguards.</p></article>
          <article className="kf-card"><IconDashboard /><h3 className="kf-card-title">Interactive Dashboard</h3><p className="kf-text">User-friendly interface that lets you browse through PrivacyPulse easily.</p></article>
        </div>
      </section>

      {/* ===== HOW IT WORKS ===== */}
      <section id="how-it-works" className="section hiw" aria-labelledby="hiw-title">
        <div className="hiw-head">
          <h2 id="hiw-title" className="hiw-title">
            <span className="hiw-key">How It</span>
            <span className="hiw-accent">Works</span><br />
            <p className="hiw-eyebrow">PROCESS</p>
          </h2>
        </div>

        <ol className="hiw-grid">
          <li className="hiw-card"><div className="hiw-badge">1</div><h3 className="hiw-card-title">Tracking &amp; Collection</h3><p className="hiw-text">Extension tracks metadata like visits & time—no sensitive data.</p></li>
          <li className="hiw-card"><div className="hiw-badge">2</div><h3 className="hiw-card-title">Risk Analysis &amp; Insights</h3><p className="hiw-text">Backend + AI combine frequency & data-type to score risk.</p></li>
          <li className="hiw-card"><div className="hiw-badge">3</div><h3 className="hiw-card-title">Dashboard &amp; Control</h3><p className="hiw-text">See your footprint clearly and act on risky sites.</p></li>
        </ol>
      </section>

      {/* ===== SECURITY ===== */}
      <SecuritySection />

      {/* ===== FOOTER ===== */}
      <footer className="landing-footer">
        <div className="footer-top">
          <div className="brand">
            <img src={LOGO_SRC} alt="PrivacyPulse logo" className="cg-logo-img cg-logo-img--footer" />
            <div className="brand-sub">
              <h4>PrivacyPulse</h4>
              <p className="brand-sub">Your Data, Your Dashboard, Your Control!</p>
            </div>
          </div>

          <div className="footer-columns">
            <div className="footer-col">
              <h5 role="button" tabIndex={0} onClick={scrollTop} onKeyDown={(e)=>e.key==='Enter'&&scrollTop()}>Product</h5>
              <button className="footer-link-btn" onClick={scrollTop}>Features</button>
              <button className="footer-link-btn" onClick={scrollTop}>Security</button>
              <button className="footer-link-btn" onClick={scrollTop}>Documentation</button>
            </div>

            <div className="footer-col">
              <h5 role="button" tabIndex={0} onClick={scrollTop} onKeyDown={(e)=>e.key==='Enter'&&scrollTop()}>Company</h5>
              <button className="footer-link-btn" onClick={scrollTop}>About</button>
              <button className="footer-link-btn" onClick={scrollTop}>Blog</button>
              <button className="footer-link-btn" onClick={scrollTop}>Contact</button>
            </div>

            <div className="footer-col">
              <h5 role="button" tabIndex={0} onClick={scrollTop} onKeyDown={(e)=>e.key==='Enter'&&scrollTop()}>Legal</h5>
              <button className="footer-link-btn" onClick={scrollTop}>Terms</button>
              <button className="footer-link-btn" onClick={scrollTop}>Privacy</button>
              <button className="footer-link-btn" onClick={scrollTop}>Cookies</button>
            </div>
          </div>
        </div>

        <div className="footer-bottom">
          <p>© {new Date().getFullYear()} PrivacyPulse. All rights reserved.</p>
          <div className="socials">
            <a aria-label="Twitter / X" className="icon-link" href={SOCIALS.twitter} target="_blank" rel="noreferrer">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
                <path d="M18.9 3H21l-6.6 7.5L22 21h-6.2l-4.3-5.4L6.4 21H3l7.1-8L3 3h6.2l4 5.1L18.9 3zM8 5H5.7l10.6 14H19L8 5z"/>
              </svg>
            </a>
            <a aria-label="GitHub" className="icon-link" href={SOCIALS.github} target="_blank" rel="noreferrer">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
                <path d="M12 .5a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.4.7-4.1-1.6-4.1-1.6-.5-1.2-1.1-1.6-1.1-1.6-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.6 2.5 1.1 3 .9.1-.7.3-1.1.6-1.4-2.7-.3-5.6-1.3-5.6-6A4.7 4.7 0 0 1 5 9.3a4.3 4.3 0 0 1 .1-3.2s1-.3 3.3 1.2a11.4 11.4 0 0 1 6 0C16.6 5.8 17.6 6 17.6 6a4.3 4.3 0 0 1 .1 3.2 4.7 4.7 0 0 1 1.2 3.3c0 4.7-2.9 5.7-5.6 6 .3.3.7.9.7 1.9v2.8c0 .3.2.7.8.6A12 12 0 0 0 12 .5z"/>
              </svg>
            </a>
            <a aria-label="LinkedIn" className="icon-link" href={SOCIALS.linkedin} target="_blank" rel="noreferrer">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
                <path d="M4.98 3.5C4.98 4.88 3.86 6 2.5 6S0 4.88 0 3.5 1.12 1 2.5 1s2.48 1.12 2.48 2.5zM.5 8h4V24h-4V8zm7.5 0h3.8v2.2h.1c.5-1 1.8-2.2 3.8-2.2 4.1 0 4.9 2.7 4.9 6.3V24h-4v-6.9c0-1.6 0-3.7-2.3-3.7s-2.7 1.8-2.7 3.6V24h-4V8z"/>
              </svg>
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
