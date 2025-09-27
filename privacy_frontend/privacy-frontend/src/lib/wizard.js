// src/lib/wizard.js

// Temporary signup storage (until you connect to backend/db)
let signupData = {};

export function loadSignup() {
  return signupData;
}

export function saveSignup(data) {
  signupData = { ...signupData, ...data };
}

export function clearSignup() {
  signupData = {};
}
