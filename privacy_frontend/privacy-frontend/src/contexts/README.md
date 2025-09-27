# Theme Context Usage

The `ThemeContext` provides global dark mode state management across the entire application.

## How to use in components:

### 1. Using the useTheme hook:
```jsx
import { useTheme } from '../contexts/ThemeContext';

function MyComponent() {
  const { darkMode, setDarkMode, toggleDarkMode } = useTheme();
  
  return (
    <div className={darkMode ? 'dark' : 'light'}>
      <button onClick={toggleDarkMode}>
        Toggle {darkMode ? 'Light' : 'Dark'} Mode
      </button>
    </div>
  );
}
```

### 2. Using the ThemeToggle component:
```jsx
import ThemeToggle from '../components/ThemeToggle';

function MyComponent() {
  return (
    <div>
      <ThemeToggle className="my-custom-toggle" />
    </div>
  );
}
```

## Available values from useTheme:

- `darkMode`: Boolean - Current dark mode state
- `setDarkMode`: Function - Set dark mode to a specific value
- `toggleDarkMode`: Function - Toggle between light and dark mode

## Features:

- Automatically persists theme preference in localStorage
- Provides consistent theme state across all components
- Includes accessibility attributes (aria-pressed, aria-label)
- Type-safe with error handling for improper usage
