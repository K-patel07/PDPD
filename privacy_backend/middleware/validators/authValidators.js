// middleware/validators/authValidators.js
const { body } = require("express-validator");

const strongPassword = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^\w\s]).{8,}$/;

const registerValidator = [
  body("username")
    .trim()
    .isLength({ min: 3, max: 30 })
    .withMessage("username must be 3–30 characters")
    .matches(/^[a-zA-Z0-9._-]+$/)
    .withMessage("username may contain letters, numbers, . _ - only"),
  body("email")
    .trim()
    .isEmail()
    .withMessage("valid email required")
    .normalizeEmail(),
  body("password")
    .isString()
    .withMessage("password required")
    .matches(strongPassword)
    .withMessage(
      "password must be 8+ chars and include upper, lower, number, and symbol"
    ),
];

const loginValidator = [
  body("email")
    .trim()
    .isEmail()
    .withMessage("valid email required")
    .normalizeEmail(),
  body("password").isString().withMessage("password required"),
];

const otpSendValidator = [
  body("email")
    .trim()
    .isEmail()
    .withMessage("valid email required")
    .normalizeEmail(),
];

const otpVerifyValidator = [
  body("email")
    .trim()
    .isEmail()
    .withMessage("valid email required")
    .normalizeEmail(),
  body("code")
    .isLength({ min: 6, max: 6 })
    .withMessage("6-digit code required"),
];

const totpSetupValidator = [
  body("email")
    .trim()
    .isEmail()
    .withMessage("valid email required")
    .normalizeEmail(),
  body("label")
    .optional()
    .isString()
    .isLength({ min: 1, max: 64 })
    .withMessage("label must be a short string"),
  body("issuer")
    .optional()
    .isString()
    .isLength({ min: 1, max: 64 })
    .withMessage("issuer must be a short string"),
];

const totpVerifyValidator = [
  body("email")
    .trim()
    .isEmail()
    .withMessage("valid email required")
    .normalizeEmail(),
  body("token")
    .isLength({ min: 6, max: 6 })
    .withMessage("6-digit token required"),
];

module.exports = {
  registerValidator,
  loginValidator,
  otpSendValidator,
  otpVerifyValidator,
  totpSetupValidator,
  totpVerifyValidator,
};
