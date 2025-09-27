import React from "react";
import "../../styles/ProvidedDataCard.scoped.css";

export default function ProvidedDataCard({ data = {}, className = "", style }) {
  const left = [
    { key: "name",    label: "Name" },
    { key: "address", label: "Address" },
    { key: "phone",   label: "Phone" },
    { key: "country", label: "Country" },
  ];
  const right = [
    { key: "email",   label: "Email" },
    { key: "card",    label: "Card Details" },
    { key: "gender",  label: "Gender" },
    { key: "age",     label: "Age" },
  ];

  return (
    <section
      data-pp-provided
      className={`pp-provided-card ${className}`}
      aria-labelledby="pp-provided-title"
      style={style}
    >
      <h3 id="pp-provided-title" className="pp-title">Provided Data</h3>

      <div className="pp-grid">
        <div className="pp-col">
          {left.map((i) => (
            <ReadOnlyPill key={i.key} label={i.label} checked={!!data[i.key]} />
          ))}
        </div>
        <div className="pp-col">
          {right.map((i) => (
            <ReadOnlyPill key={i.key} label={i.label} checked={!!data[i.key]} />
          ))}
        </div>
      </div>
    </section>
  );
}

function ReadOnlyPill({ label, checked }) {
  return (
    <label className={`pp-pill ${checked ? "pp-on" : ""}`} aria-label={label}>
      <input type="checkbox" checked={checked} disabled readOnly aria-checked={checked} />
      <span className="pp-dot" aria-hidden />
      <span className="pp-pill-label">{label}</span>
    </label>
  );
}
