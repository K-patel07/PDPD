// routes/classify.js
const express = require('express');
const router = express.Router();
const { detectCategoryForVisit } = require('../services/categorizer'); // dictionary-based

router.post('/', async (req, res) => {
  try {
    const { hostname, url, path, title, text } = req.body || {};
    const target = hostname || url || text || title;
    if (!target) {
      return res.status(400).json({ ok: false, error: 'Provide hostname/url or text/title' });
    }

    // categorize by host using domainMap (no HF)
    const result = await detectCategoryForVisit({ hostname: hostname || url, path, title });
    return res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[classify] ERROR:', err);
    return res.status(500).json({ ok: false, error: 'classification_failed' });
  }
});

module.exports = router;
