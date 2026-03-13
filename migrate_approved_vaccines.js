/**
 * Migration: Add Approved Vaccines Schema
 *
 * This migration adds is_approved and display_order columns to the vaccines table
 * and seeds the official government vaccine list.
 */

const pool = require('./db');

const APPROVED_VACCINES = [
  { name: 'BCG', code: 'BCG', display_order: 1 },
  { name: 'Diluent', code: 'DIL', display_order: 2 },
  { name: 'Hepa B', code: 'HEPB', display_order: 3 },
  { name: 'Penta Valent', code: 'PENTA', display_order: 4 },
  { name: 'OPV 20-doses', code: 'OPV', display_order: 5 },
  { name: 'PCV 13', code: 'PCV13', display_order: 6 },
  { name: 'PCV 10', code: 'PCV10', display_order: 7 },
  { name: 'Measles & Rubella (MR)', code: 'MR', display_order: 8 },
  { name: 'MMR', code: 'MMR', display_order: 9 },
  { name: 'Diluent 5ml', code: 'DIL5', display_order: 10 },
  { name: 'IPV multi dose', code: 'IPV', display_order: 11 },
];

const normalizeName = (name) => name.toLowerCase().trim()
  .replace(/\s+/g, ' ')
  .replace(/&/g, 'and')
  .replace(/[-–—]/g, ' ')
  .replace(/[\(\)]/g, '')
  .trim();

const APPROVED_NAMES_SET = new Set(APPROVED_VACCINES.map(v => normalizeName(v.name)));

async function migrate() {
  const client = await pool.connect();

  try {
    console.log('Starting approved vaccines migration...');

    await client.query('BEGIN');

    // 1. Add is_approved column if not exists
    const checkColumn = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'vaccines' AND column_name = 'is_approved'
    `);

    if (checkColumn.rows.length === 0) {
      console.log('Adding is_approved column...');
      await client.query(`
        ALTER TABLE vaccines
        ADD COLUMN is_approved BOOLEAN DEFAULT false
      `);
    } else {
      console.log('is_approved column already exists');
    }

    // 2. Add display_order column if not exists
    const checkOrderColumn = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'vaccines' AND column_name = 'display_order'
    `);

    if (checkOrderColumn.rows.length === 0) {
      console.log('Adding display_order column...');
      await client.query(`
        ALTER TABLE vaccines
        ADD COLUMN display_order INTEGER
      `);
    } else {
      console.log('display_order column already exists');
    }

    // 3. Update existing vaccines to mark approved ones
    console.log('Updating approved vaccines...');

    for (const approved of APPROVED_VACCINES) {
      const normalizedName = normalizeName(approved.name);

      // Check if vaccine exists (fuzzy match)
      const existing = await client.query(`
        SELECT id, name, is_approved
        FROM vaccines
        WHERE LOWER(REPLACE(REPLACE(REPLACE(name, '-', ' '), '–', ' '), '—', ' ')) LIKE $1
           OR LOWER(name) LIKE $1
           OR LOWER(REPLACE(name, '&', 'and')) LIKE $1
        LIMIT 1
      `, [`%${normalizedName.split(' ')[0]}%`]);

      if (existing.rows.length > 0) {
        // Update existing record
        await client.query(`
          UPDATE vaccines
          SET is_approved = true,
              display_order = $1,
              code = COALESCE(code, $2)
          WHERE id = $3
        `, [approved.display_order, approved.code, existing.rows[0].id]);
        console.log(`  Approved: ${existing.rows[0].name} (ID: ${existing.rows[0].id})`);
      } else {
        // Insert new approved vaccine
        await client.query(`
          INSERT INTO vaccines (name, code, is_active, is_approved, display_order)
          VALUES ($1, $2, true, true, $3)
        `, [approved.name, approved.code, approved.display_order]);
        console.log(`  Created: ${approved.name}`);
      }
    }

    // 4. Auto-approve vaccines with similar names (fuzzy matching)
    console.log('Checking for additional vaccines to approve...');

    const unapprovedVaccines = await client.query(`
      SELECT id, name
      FROM vaccines
      WHERE COALESCE(is_approved, false) = false
    `);

    for (const vaccine of unapprovedVaccines.rows) {
      const normalizedVaccineName = normalizeName(vaccine.name);

      // Check if any approved name is contained in this name or vice versa
      for (const approvedName of APPROVED_NAMES_SET) {
        if (normalizedVaccineName.includes(approvedName) || approvedName.includes(normalizedVaccineName)) {
          await client.query(`
            UPDATE vaccines
            SET is_approved = true
            WHERE id = $1
          `, [vaccine.id]);
          console.log(`  Auto-approved: ${vaccine.name}`);
          break;
        }
      }
    }

    await client.query('COMMIT');
    console.log('Migration completed successfully!');

    // Show summary
    const summary = await client.query(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN COALESCE(is_approved, false) = true THEN 1 ELSE 0 END) as approved,
        SUM(CASE WHEN COALESCE(is_approved, false) = false THEN 1 ELSE 0 END) as unapproved
      FROM vaccines
    `);

    console.log('\nVaccine Summary:');
    console.log(`  Total: ${summary.rows[0].total}`);
    console.log(`  Approved: ${summary.rows[0].approved}`);
    console.log(`  Unapproved: ${summary.rows[0].unapproved}`);

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run if called directly
if (require.main === module) {
  migrate().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}

module.exports = migrate;
