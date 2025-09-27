// middleware/validators/authValidators.js
const { body } = require('express-validator');

const strongPassword =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^\w\s]).{8,}$/;

const registerValidator = [
  body('username')
    .trim()
    .isLength({ min: 3, max: 30 }).withMessage('username must be 3–30 chars')
    .matches(/^[a-zA-Z0-9._-]+$/).withMessage('username has invalid chars'),
  body('email')
    .trim()
    .isEmail().withMessage('valid email required')
    .normalizeEmail(),
  body('password')
    .isString().withMessage('password required')
    .matches(strongPassword)
    .withMessage('password must be 8+ chars with upper, lower, number, symbol'),
];

const loginValidator = [
  body('email').trim().isEmail().withMessage('valid email required').normalizeEmail(),
  body('password').isString().isLength({ min: 1 }).withMessage('password required'),
];

// (Placeholders if you add OTP/TOTP later)
const otpValidator = [ body('code').isLength({ min: 6, max: 6 }).withMessage('6-digit code required') ];
const totpValidator = [ body('token').isLength({ min: 6, max: 6 }).withMessage('6-digit token required') ];

module.exports = { registerValidator, loginValidator, otpValidator, totpValidator };