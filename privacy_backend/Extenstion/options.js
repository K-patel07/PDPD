// options.js — PrivacyPulse Options Page

const API_BASE = "https://privacypulse-9xnj.onrender.com";

// DOM elements
const authStatus = document.getElementById('auth-status');
const authForm = document.getElementById('auth-form');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');

const trackingToggle = document.getElementById('tracking-toggle');
const formsToggle = document.getElementById('forms-toggle');
const screentimeToggle = document.getElementById('screentime-toggle');

const clearDataBtn = document.getElementById('clear-data-btn');
const exportDataBtn = document.getElementById('export-data-btn');

// State
let currentUser = null;

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  await checkAuthStatus();
  setupEventListeners();
});

// Load settings from storage
async function loadSettings() {
  const settings = await chrome.storage.local.get([
    'enabled',
    'forms_enabled', 
    'screentime_enabled',
    'auth_token',
    'ext_user_id'
  ]);
  
  // Set toggle states
  trackingToggle.classList.toggle('active', settings.enabled !== false);
  formsToggle.classList.toggle('active', settings.forms_enabled !== false);
  screentimeToggle.classList.toggle('active', settings.screentime_enabled !== false);
  
  // Set auth state
  if (settings.auth_token) {
    currentUser = { token: settings.auth_token, ext_user_id: settings.ext_user_id };
  }
}

// Check authentication status
async function checkAuthStatus() {
  if (currentUser?.token) {
    try {
      const response = await fetch(`${API_BASE}/api/auth/verify`, {
        headers: {
          'Authorization': `Bearer ${currentUser.token}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (response.ok) {
        const userData = await response.json();
        showAuthStatus('success', `Authenticated as ${userData.email || 'User'}`);
        authForm.classList.add('hidden');
        logoutBtn.classList.remove('hidden');
        return;
      }
    } catch (error) {
      console.warn('Auth verification failed:', error);
    }
  }
  
  // Not authenticated
  showAuthStatus('warning', 'Not authenticated. Please log in to sync your data.');
  authForm.classList.remove('hidden');
  logoutBtn.classList.add('hidden');
}

// Show authentication status
function showAuthStatus(type, message) {
  authStatus.className = `status status-${type}`;
  authStatus.textContent = message;
}

// Setup event listeners
function setupEventListeners() {
  // Login
  loginBtn.addEventListener('click', handleLogin);
  
  // Logout
  logoutBtn.addEventListener('click', handleLogout);
  
  // Toggles
  trackingToggle.addEventListener('click', () => toggleSetting('enabled', trackingToggle));
  formsToggle.addEventListener('click', () => toggleSetting('forms_enabled', formsToggle));
  screentimeToggle.addEventListener('click', () => toggleSetting('screentime_enabled', screentimeToggle));
  
  // Data management
  clearDataBtn.addEventListener('click', handleClearData);
  exportDataBtn.addEventListener('click', handleExportData);
  
  // Enter key for login
  passwordInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      handleLogin();
    }
  });
}

// Handle login
async function handleLogin() {
  const email = emailInput.value.trim();
  const password = passwordInput.value;
  
  if (!email || !password) {
    showAuthStatus('error', 'Please enter both email and password');
    return;
  }
  
  loginBtn.textContent = 'Logging in...';
  loginBtn.disabled = true;
  
  try {
    const response = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email, password })
    });
    
    const data = await response.json();
    
    if (response.ok && data.ok) {
      // Store auth data
      await chrome.storage.local.set({
        auth_token: data.token,
        ext_user_id: data.ext_user_id || data.user?.ext_user_id
      });
      
      currentUser = {
        token: data.token,
        ext_user_id: data.ext_user_id || data.user?.ext_user_id
      };
      
      showAuthStatus('success', `Successfully logged in as ${email}`);
      authForm.classList.add('hidden');
      logoutBtn.classList.remove('hidden');
      
      // Clear form
      emailInput.value = '';
      passwordInput.value = '';
    } else {
      showAuthStatus('error', data.message || 'Login failed');
    }
  } catch (error) {
    console.error('Login error:', error);
    showAuthStatus('error', 'Network error. Please try again.');
  } finally {
    loginBtn.textContent = 'Log In';
    loginBtn.disabled = false;
  }
}

// Handle logout
async function handleLogout() {
  await chrome.storage.local.remove(['auth_token', 'ext_user_id']);
  currentUser = null;
  
  showAuthStatus('warning', 'Logged out successfully');
  authForm.classList.remove('hidden');
  logoutBtn.classList.add('hidden');
}

// Toggle setting
async function toggleSetting(key, toggleElement) {
  const isActive = toggleElement.classList.contains('active');
  const newValue = !isActive;
  
  toggleElement.classList.toggle('active', newValue);
  await chrome.storage.local.set({ [key]: newValue });
  
  // Show feedback
  const settingName = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  showAuthStatus('success', `${settingName} ${newValue ? 'enabled' : 'disabled'}`);
  
  // Clear status after 2 seconds
  setTimeout(() => {
    if (authStatus.textContent.includes(settingName)) {
      checkAuthStatus();
    }
  }, 2000);
}

// Handle clear data
async function handleClearData() {
  if (!confirm('Are you sure you want to clear all local data? This cannot be undone.')) {
    return;
  }
  
  clearDataBtn.textContent = 'Clearing...';
  clearDataBtn.disabled = true;
  
  try {
    // Clear all local storage except auth
    const keysToKeep = ['auth_token', 'ext_user_id'];
    const allData = await chrome.storage.local.get();
    const keysToRemove = Object.keys(allData).filter(key => !keysToKeep.includes(key));
    
    await chrome.storage.local.remove(keysToRemove);
    
    showAuthStatus('success', 'Local data cleared successfully');
    
    // Reset toggles
    trackingToggle.classList.remove('active');
    formsToggle.classList.remove('active');
    screentimeToggle.classList.remove('active');
    
  } catch (error) {
    console.error('Clear data error:', error);
    showAuthStatus('error', 'Failed to clear data');
  } finally {
    clearDataBtn.textContent = 'Clear All Data';
    clearDataBtn.disabled = false;
  }
}

// Handle export data
async function handleExportData() {
  exportDataBtn.textContent = 'Exporting...';
  exportDataBtn.disabled = true;
  
  try {
    const allData = await chrome.storage.local.get();
    
    // Remove sensitive data
    const exportData = {
      ...allData,
      auth_token: undefined,
      password: undefined
    };
    
    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: 'application/json'
    });
    
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `privacypulse-data-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    showAuthStatus('success', 'Data exported successfully');
    
  } catch (error) {
    console.error('Export error:', error);
    showAuthStatus('error', 'Failed to export data');
  } finally {
    exportDataBtn.textContent = 'Export Data';
    exportDataBtn.disabled = false;
  }
}
