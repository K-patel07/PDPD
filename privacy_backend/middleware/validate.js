// middleware/validate.js
const { validationResult } = require("express-validator");

/**
 * Middleware that checks express-validator results and returns 400 on errors.
 * Use it directly after your validators array:
 *   router.post("/route", validatorsArray, validate, handler)
 */
function validate(req, res, next) {
  const errors = validationResult(req);
  if (errors.isEmpty()) return next();

  const details = errors.array().map((e) => ({
    field: e.param || e.path || "unknown",
    msg: e.msg || "invalid value",
    value: e.value,
  }));

  return res.status(400).json({
    ok: false,
    error: "Validation failed",
    details,
  });
}

/**
 * Convenience helper that returns `[...validators, validate]`
 * so you can also do:
 *   router.post("/route", withValidators(validatorsArray), handler)
 */
function withValidators(validators = []) {
  return Array.isArray(validators) ? [...validators, validate] : [validate];
}

module.exports = { validate, withValidators };
