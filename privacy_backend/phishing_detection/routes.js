const express = require("express"); 
const router = express.Router();
const { classifyPhishing } = require("../services/phishingModel");

router.post("/check", async (req, res) => {
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ ok: false, error: "URL is required" });
  }

  try {
    const result = await classifyPhishing(url);  // ✅ FIXED
    res.json({ ok: true, url, result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
