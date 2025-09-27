// src/components/category/CenterTitle.jsx
import React from "react";

export default function CenterTitle({ siteName = "Website Name" }) {
  return <h2 className="center-title-text">{siteName}</h2>;
}
