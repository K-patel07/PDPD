import React from 'react';
import { useTheme } from '../contexts/ThemeContext';

export default function ThemeToggle({ className = '', ...props }) {
  const { darkMode, toggleDarkMode } = useTheme();

  return (
    <button
      className={`theme-toggle ${className}`}
      onClick={toggleDarkMode}
      aria-pressed={darkMode}
      aria-label="Toggle dark mode"
      title="Toggle dark mode"
      {...props}
    >
      <span className="knob" />
    </button>
  );
}
