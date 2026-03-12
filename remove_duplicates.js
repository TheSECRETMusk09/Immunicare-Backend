/**
 * Database Duplicate Removal Script
 * Removes duplicate records identified in the cleanup analysis
 */

const pool = require('./db');
require('dotenv').config();

async function removeDuplicates() {
  const client = await pool.connect();

  try {
    console.log('=== Removing Duplicate Records ===\n');

    // Start transaction
    await client.query('BEGIN');

    // 1. Remove duplicate infant names (keep oldest record per name)
    await removeDuplicateInfants(client);

    // 2. Check for duplicate clinics (multiple "Main Health Center" entries)
    await removeDuplicateClinics(client);

    // 3. Clean up cache entries
    await cleanupCache(client);

    await client.query('COMMIT');
    console.log('\n=== Duplicate Removal Complete ===');

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error during duplicate removal:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

async function removeDuplicateInfants(client) {
  console.log('--- Removing Duplicate Infants ---\n');

  try {
    // Check infant counts first
    const countQuery = 'SELECT COUNT(*) as cnt FROM infants';
    const countResult = await client.query(countQuery);
    console.log(`Total infants before cleanup: ${countResult.rows[0].cnt}`);

    // For each duplicate name, keep the oldest record (lowest ID)
    const duplicateNames = ['Gabriel', 'Camila', 'Isabella', 'Sofia', 'Mateo'];

    for (const name of duplicateNames) {
      // Get IDs to keep (oldest/lowest ID for each name)
      const keepQuery = `
        SELECT MIN(id) as keep_id
        FROM infants
        WHERE first_name = $1
        GROUP BY first_name
      `;
      const keepResult = await client.query(keepQuery, [name]);

      if (keepResult.rows.length > 0) {
        const keepId = keepResult.rows[0].keep_id;

        // Delete duplicates (keep oldest)
        const deleteQuery = `
          DELETE FROM infants
          WHERE first_name = $1 AND id != $2
        `;
        const deleteResult = await client.query(deleteQuery, [name, keepId]);

        if (deleteResult.rowCount > 0) {
          console.log(`   Removed ${deleteResult.rowCount} duplicate infant(s) with name '${name}' (kept ID: ${keepId})`);
        }
      }
    }

    // Verify cleanup
    const finalCount = await client.query(countQuery);
    console.log(`Total infants after cleanup: ${finalCount.rows[0].cnt}`);

  } catch (error) {
    console.error('Error removing duplicate infants:', error.message);
    throw error;
  }
}

async function removeDuplicateClinics(client) {
  console.log('\n--- Checking for Duplicate Clinics ---\n');

  try {
    // Get clinic counts
    const countQuery = 'SELECT COUNT(*) as cnt FROM clinics';
    const countResult = await client.query(countQuery);
    console.log(`Total clinics: ${countResult.rows[0].cnt}`);

    // Find duplicate names
    const dupQuery = `
      SELECT name, COUNT(*) as cnt, MIN(id) as keep_id
      FROM clinics
      GROUP BY name
      HAVING COUNT(*) > 1
    `;
    const dupResult = await client.query(dupQuery);

    if (dupResult.rows.length > 0) {
      console.log('Duplicate clinic names found:');
      for (const row of dupResult.rows) {
        console.log(`   Name: '${row.name}' - Count: ${row.cnt} (keeping ID: ${row.keep_id})`);

        // Check if any records reference these clinics before deleting
        const checkRefs = `
          SELECT COUNT(*) as cnt FROM (
            SELECT infant_id FROM infants WHERE clinic_id IN (
              SELECT id FROM clinics WHERE name = $1 AND id != $2
            )
            UNION ALL
            SELECT user_id FROM users WHERE clinic_id IN (
              SELECT id FROM clinics WHERE name = $1 AND id != $2
            )
          ) as refs
        `;
        const refResult = await client.query(checkRefs, [row.name, row.keep_id]);

        if (parseInt(refResult.rows[0].cnt) === 0) {
          // No references, safe to delete
          const deleteQuery = `
            DELETE FROM clinics
            WHERE name = $1 AND id != $2
          `;
          const deleteResult = await client.query(deleteQuery, [row.name, row.keep_id]);
          console.log(`   ✓ Removed ${deleteResult.rowCount} duplicate clinic(s)`);
        } else {
          console.log(`   ⚠ Cannot remove - ${refResult.rows[0].cnt} records reference these clinics`);
          console.log('   ℹ️ Consider consolidating references or keeping as-is');
        }
      }
    } else {
      console.log('   No duplicate clinic names found.');
    }

  } catch (error) {
    console.error('Error checking duplicate clinics:', error.message);
  }
}

async function cleanupCache(client) {
  console.log('\n--- Cleaning Cache Entries ---\n');

  try {
    // Clean expired cache entries
    const deleteExpired = `
      DELETE FROM cache
      WHERE expires_at IS NOT NULL
      AND expires_at < CURRENT_TIMESTAMP
    `;
    const expiredResult = await client.query(deleteExpired);

    if (expiredResult.rowCount > 0) {
      console.log(`🗑️  Cleaned ${expiredResult.rowCount} expired cache entries`);
    } else {
      console.log('   No expired cache entries found.');
    }

    // Check cache_entries table too
    const deleteExpiredEntries = `
      DELETE FROM cache_entries
      WHERE expires_at IS NOT NULL
      AND expires_at < CURRENT_TIMESTAMP
    `;
    const expiredEntriesResult = await client.query(deleteExpiredEntries);

    if (expiredEntriesResult.rowCount > 0) {
      console.log(`🗑️  Cleaned ${expiredEntriesResult.rowCount} expired cache_entries`);
    }

  } catch (err) {
    console.log(`   Cache cleanup skipped: ${err.message}`);
  }
}

// Run the cleanup
removeDuplicates().catch(console.error);
