// scripts/run_sql.js
require("dotenv").config();
const { ensureBaseline, pool } = require("../db");

(async () => {
  try {
    console.log("[schema] ensureBaseline starting…");
    await ensureBaseline();
    console.log("[schema] ensureBaseline: OK");

    // Optional: run "node scripts/run_sql.js --check" to verify key tables exist
    if (process.argv.includes("--check")) {
      const { rows } = await pool.query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN ('websites','site_visits','audit_logs','risk_assessments','field_submissions')
        ORDER BY table_name;
      `);
      console.log("[schema] found tables:", rows.map(r => r.table_name).join(", ") || "(none)");
    }

    process.exit(0);
  } catch (e) {
    console.error("[schema] ERROR:", e?.message || e);
    process.exit(1);
  } finally {
    try { await pool.end(); } catch {}
  }
})();
