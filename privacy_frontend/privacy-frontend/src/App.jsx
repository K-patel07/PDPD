import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ThemeProvider } from "./contexts/ThemeContext";

import Landing from "./pages/Landing.jsx";
import Login from "./components/Login.jsx";
import Signup from "./components/Signup.jsx";
import Verify from "./components/Verify.jsx";
import Otp from "./components/otp.jsx";
import Dashboard from "./pages/dashboard.jsx";
import CategoriesOverview from "./pages/CategoriesOverview";
import CategoryPage from "./pages/category.jsx";
import Settings from "./pages/settings";
import Notifications from "./pages/notifications.jsx";
import Subs from "./pages/subs.jsx";

// near the top of your app entry
import "./styles/base.css";
import "./styles/theme.light.css";
import "./styles/theme.dark.css";

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/verify" element={<Verify />} />
          <Route path="/otp" element={<Otp />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/categories" element={<CategoriesOverview />} />
          <Route path="/category/:name" element={<CategoryPage />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/notifications" element={<Notifications />} />
          <Route path="/subscription" element={<Subs />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  );
}