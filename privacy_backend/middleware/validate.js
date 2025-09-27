// middleware/validate.js
const { validationResult } = require('express-validator');

function validate(req, res, next) {
  const errors = validationResult(req);
  if (errors.isEmpty()) return next();
  return res.status(400).json({
    ok: false,
    error: 'Validation failed',
    details: errors.array().map(e => ({ field: e.path, msg: e.msg })),
  });
}

module.exports = { validate };