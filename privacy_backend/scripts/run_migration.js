// scripts/run_migration.js
// Run the database migration to fix existing risk data

const db = require('../db');

async function runMigration() {
  console.log('🔧 Running database migration...');
  
  try {
    // Run the migration SQL
    const migrationSQL = `
      -- ensure columns exist
      ALTER TABLE risk_assessments ADD COLUMN IF NOT EXISTS phishing_risk NUMERIC(5,4);
      ALTER TABLE risk_assessments ADD COLUMN IF NOT EXISTS data_risk     NUMERIC(5,4);
      ALTER TABLE risk_assessments ADD COLUMN IF NOT EXISTS combined_risk NUMERIC(5,4);
      ALTER TABLE risk_assessments ADD COLUMN IF NOT EXISTS risk_score    INT;
      ALTER TABLE risk_assessments ADD COLUMN IF NOT EXISTS band          TEXT;
      ALTER TABLE risk_assessments ADD COLUMN IF NOT EXISTS created_at    TIMESTAMPTZ DEFAULT now();
      ALTER TABLE risk_assessments ADD COLUMN IF NOT EXISTS updated_at    TIMESTAMPTZ DEFAULT now();

      -- ensure unique key exists
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_indexes 
          WHERE indexname = 'ux_risk_user_site'
        ) THEN
          CREATE UNIQUE INDEX ux_risk_user_site ON risk_assessments(website_id, ext_user_id);
        END IF;
      END $$;

      -- normalize existing risk_score to 0..100 if any rows accidentally have 0..1
      UPDATE risk_assessments
      SET risk_score = LEAST(100, GREATEST(0, ROUND(risk_score * CASE WHEN risk_score BETWEEN 0 AND 1 THEN 100 ELSE 1 END)));

      -- ensure websites table has proper constraints
      ALTER TABLE websites ADD CONSTRAINT IF NOT EXISTS websites_hostname_unique UNIQUE (hostname);

      -- ensure site_visits has proper constraints  
      ALTER TABLE site_visits ADD CONSTRAINT IF NOT EXISTS site_visits_user_hostname_unique UNIQUE (ext_user_id, hostname);
    `;
    
    await db.pool.query(migrationSQL);
    console.log('✅ Database migration completed successfully!');
    
    // Check if there are any risk assessments to fix
    const { rows } = await db.pool.query(`
      SELECT COUNT(*) as count FROM risk_assessments
    `);
    
    console.log(`📊 Found ${rows[0].count} risk assessment records`);
    
    if (parseInt(rows[0].count) > 0) {
      console.log('🔄 Risk data will be recalculated on next visit/submit');
    }
    
  } catch (error) {
    console.error('💥 Migration failed:', error.message);
  } finally {
    await db.pool.end();
  }
}

// Run the migration
runMigration().catch(console.error);
