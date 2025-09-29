// scripts/fix_existing_risk_data.js
// Fix existing risk data to match the new calculation formula

const db = require('../db');
const computeRisk = require('../services/riskScorer');
const { classifyPhishing } = require('../services/phishingModel');

async function fixExistingRiskData() {
  console.log('🔧 Starting to fix existing risk data...');
  
  try {
    // 1. First, let's see what we have
    const { rows: existing } = await db.pool.query(`
      SELECT 
        ra.id,
        ra.website_id,
        w.hostname,
        ra.ext_user_id,
        ra.phishing_risk,
        ra.data_risk,
        ra.combined_risk,
        ra.risk_score,
        ra.band,
        ra.updated_at
      FROM risk_assessments ra
      JOIN websites w ON w.id = ra.website_id
      ORDER BY ra.updated_at DESC
      LIMIT 10
    `);
    
    console.log(`📊 Found ${existing.length} existing risk records to check`);
    
    if (existing.length === 0) {
      console.log('✅ No existing risk data to fix');
      return;
    }
    
    // 2. Get all risk assessments that need fixing
    const { rows: allRisk } = await db.pool.query(`
      SELECT 
        ra.id,
        ra.website_id,
        w.hostname,
        ra.ext_user_id,
        ra.phishing_risk,
        ra.data_risk,
        ra.combined_risk,
        ra.risk_score,
        ra.band
      FROM risk_assessments ra
      JOIN websites w ON w.id = ra.website_id
    `);
    
    console.log(`🔄 Processing ${allRisk.length} risk assessments...`);
    
    let fixed = 0;
    let errors = 0;
    
    for (const risk of allRisk) {
      try {
        // Get fresh phishing score
        const phishingResult = await classifyPhishing(risk.hostname);
        const phishingRisk = Number(phishingResult?.phishingScore || 0);
        
        // Get the fields_detected from site_visits for this user/hostname
        const { rows: visitData } = await db.pool.query(`
          SELECT fields_detected
          FROM site_visits
          WHERE ext_user_id = $1 AND hostname = $2
          ORDER BY last_visited DESC
          LIMIT 1
        `, [risk.ext_user_id, risk.hostname]);
        
        const fields_detected = visitData[0]?.fields_detected || {};
        
        // Recalculate risk using the new formula
        const newRisk = computeRisk(fields_detected, phishingRisk, risk.hostname);
        
        // Update the record
        await db.pool.query(`
          UPDATE risk_assessments
          SET 
            phishing_risk = $1,
            data_risk = $2,
            combined_risk = $3,
            risk_score = $4,
            band = $5,
            updated_at = NOW()
          WHERE id = $6
        `, [
          newRisk.phishing_risk,
          newRisk.data_risk,
          newRisk.combined_risk,
          newRisk.risk_score,
          newRisk.band,
          risk.id
        ]);
        
        fixed++;
        
        if (fixed % 10 === 0) {
          console.log(`✅ Fixed ${fixed}/${allRisk.length} records...`);
        }
        
      } catch (error) {
        console.error(`❌ Error fixing risk record ${risk.id}:`, error.message);
        errors++;
      }
    }
    
    console.log(`\n🎉 Risk data fix completed!`);
    console.log(`✅ Fixed: ${fixed} records`);
    console.log(`❌ Errors: ${errors} records`);
    
    // 3. Show some examples of the fixed data
    const { rows: examples } = await db.pool.query(`
      SELECT 
        w.hostname,
        ra.phishing_risk,
        ra.data_risk,
        ra.combined_risk,
        ra.risk_score,
        ra.band,
        ra.updated_at
      FROM risk_assessments ra
      JOIN websites w ON w.id = ra.website_id
      ORDER BY ra.updated_at DESC
      LIMIT 5
    `);
    
    console.log('\n📋 Examples of fixed risk data:');
    examples.forEach(example => {
      console.log(`  ${example.hostname}: ${example.risk_score}% (${example.band}) - phishing:${(example.phishing_risk*100).toFixed(1)}% data:${(example.data_risk*100).toFixed(1)}%`);
    });
    
  } catch (error) {
    console.error('💥 Error during risk data fix:', error);
  } finally {
    await db.pool.end();
  }
}

// Run the fix
fixExistingRiskData().catch(console.error);
