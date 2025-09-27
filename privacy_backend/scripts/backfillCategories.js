// scripts/backfillCategories.js

require("dotenv").config();
const db = require("../db"); // your existing db connection
const { detectCategoryForVisit } = require("../services/categorizer");

async function backfillSiteVisits() {
  console.log("🔄 Backfilling categories in site_visits...");

  const { rows } = await db.query(`
    SELECT id, hostname
    FROM site_visits
    WHERE category IS NULL
    LIMIT 1000
  `);

  for (const row of rows) {
    try {
      const det = await detectCategoryForVisit({ hostname: row.hostname });
      const category = det?.category || "Unknown";
      const confidence = det?.confidence ?? 0;
      const method = det?.method || "backfill";

      await db.query(
        `UPDATE site_visits
         SET category=$1, category_confidence=$2, category_method=$3
         WHERE id=$4`,
        [category, confidence, method, row.id]
      );

      console.log(`✅ Updated ${row.hostname} → ${category}`);
    } catch (err) {
      console.warn(`⚠️ Failed for ${row.hostname}:`, err.message);
    }
  }
}

async function backfillFieldSubmissions() {
  console.log("🔄 Backfilling categories in field_submissions...");

  const { rows } = await db.query(`
    SELECT id, hostname
    FROM field_submissions
    WHERE category IS NULL
    LIMIT 1000
  `);

  for (const row of rows) {
    try {
      const det = await detectCategoryForVisit({ hostname: row.hostname });
      const category = det?.category || "Unknown";
      const confidence = det?.confidence ?? 0;
      const method = det?.method || "backfill";

      await db.query(
        `UPDATE field_submissions
         SET category=$1, category_confidence=$2, category_method=$3
         WHERE id=$4`,
        [category, confidence, method, row.id]
      );

      console.log(`✅ Updated ${row.hostname} → ${category}`);
    } catch (err) {
      console.warn(`⚠️ Failed for ${row.hostname}:`, err.message);
    }
  }
}

async function run() {
  await backfillSiteVisits();
  await backfillFieldSubmissions();
  console.log("🎉 Backfill complete");
  process.exit(0);
}

run().catch(err => {
  console.error("❌ Script failed:", err);
  process.exit(1);
});
