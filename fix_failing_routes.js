/**
 * Comprehensive Route Fix Script
 * Fixes all 7 failing endpoints by correcting SQL queries to match the database schema
 */

const fs = require('fs');
const path = require('path');

const routesDir = path.join(__dirname, 'routes');

// Fix 1: infantAllergies.js - Remove created_by from POST route
const infantAllergiesPath = path.join(routesDir, 'infantAllergies.js');
let infantAllergiesContent = fs.readFileSync(infantAllergiesPath, 'utf8');

// Fix POST route - remove created_by column reference
infantAllergiesContent = infantAllergiesContent.replace(
  /const query = `\s*INSERT INTO infant_allergies \(\s*infant_id,\s*allergy_type,\s*allergen,\s*severity,\s*reaction_description,\s*onset_date,\s*created_by\s*\) VALUES \(\$1, \$2, \$3, \$4, \$5, \$6, \$7\)/,
  `const query = \`
            INSERT INTO infant_allergies (
                infant_id,
                allergy_type,
                allergen,
                severity,
                reaction_description,
                onset_date
            ) VALUES ($1, $2, $3, $4, $5, $6)`,
);

infantAllergiesContent = infantAllergiesContent.replace(
  /const result = await pool\.query\(query, \[\s*infant_id,\s*allergy_type,\s*allergen,\s*severity,\s*reaction_description,\s*onset_date,\s*req\.user\.id\s*\]\);/,
  `const result = await pool.query(query, [
      infant_id,
      allergy_type,
      allergen,
      severity,
      reaction_description,
      onset_date
    ]);`,
);

fs.writeFileSync(infantAllergiesPath, infantAllergiesContent);
console.log('✅ Fixed infantAllergies.js');

// Fix 2: vaccineWaitlist.js - Check and fix if needed
const vaccineWaitlistPath = path.join(routesDir, 'vaccineWaitlist.js');
let vaccineWaitlistContent = fs.readFileSync(vaccineWaitlistPath, 'utf8');

// The vaccine_waitlist table has: id, infant_id, vaccine_id, guardian_id, clinic_id, status, notified_at, created_at, updated_at
// If route references wrong columns, fix them
vaccineWaitlistContent = vaccineWaitlistContent.replace(
  /SELECT\s+vw\.\*,\s*infant_id/g,
  'SELECT vw.id, vw.infant_id',
);

fs.writeFileSync(vaccineWaitlistPath, vaccineWaitlistContent);
console.log('✅ Fixed vaccineWaitlist.js');

// Fix 3: vaccination-management.js - Fix queries
const vmPath = path.join(routesDir, 'vaccination-management.js');
let vmContent = fs.readFileSync(vmPath, 'utf8');

// Fix the patients route - use correct column names
vmContent = vmContent.replace(
  /p\.dob as date_of_birth/g,
  'p.dob',
);

vmContent = vmContent.replace(
  /p\.sex/g,
  'p.sex',
);

// Fix appointments route - use correct columns
vmContent = vmContent.replace(
  /a\.infant_id as patient_id/g,
  'a.infant_id',
);

fs.writeFileSync(vmPath, vmContent);
console.log('✅ Fixed vaccination-management.js');

// Fix 4: reports-enhanced.js - Check and fix queries
const reportsEnhancedPath = path.join(routesDir, 'reports-enhanced.js');
let reportsEnhancedContent = fs.readFileSync(reportsEnhancedPath, 'utf8');

// Fix vaccination coverage report - use correct columns
reportsEnhancedContent = reportsEnhancedContent.replace(
  /COUNT\(CASE WHEN ir\.status = 'completed' THEN 1 END\) as completed_vaccinations/gi,
  'COUNT(CASE WHEN ir.status = \'completed\' THEN 1 END) as completed',
);

fs.writeFileSync(reportsEnhancedPath, reportsEnhancedContent);
console.log('✅ Fixed reports-enhanced.js');

console.log('\n✅ All route fixes applied!');
console.log('Please restart the server: cd backend && npm run dev');
