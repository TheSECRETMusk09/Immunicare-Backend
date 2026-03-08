require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const pool = require('./db');

async function checkDuplicates() {
  const client = await pool.connect();

  try {
    console.log('Database connection established');
    console.log(`Database: ${process.env.DB_NAME}`);
    console.log(`User: ${process.env.DB_USER}`);

    // Get list of all tables
    const tablesResult = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);

    console.log('\n=== DATABASE DUPLICATE CHECK ===\n');
    console.log(`Found ${tablesResult.rows.length} tables in database\n`);

    const duplicates = [];
    const tablesChecked = [];

    for (const row of tablesResult.rows) {
      const tableName = row.table_name;

      // Skip system tables and Sequelize meta table
      if (
        tableName.includes('pg_') ||
        tableName.includes('sqlite_') ||
        tableName === 'SequelizeMeta'
      ) {
        continue;
      }

      tablesChecked.push(tableName);
      console.log(`Checking table: ${tableName}`);

      // Verify table exists
      const tableCheck = await client.query(
        `
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = $1
        )
      `,
        [tableName]
      );

      if (!tableCheck.rows[0].exists) {
        console.log('  ⚠️  Table doesn\'t exist (phantom table)');
        continue;
      }

      // Get column names for the table
      const columnsResult = await client.query(
        `
        SELECT column_name, data_type
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = $1
        ORDER BY ordinal_position
      `,
        [tableName]
      );

      const columns = columnsResult.rows.map((r) => r.column_name);

      // Check for potential duplicate columns (name, email, etc.)
      const candidateColumns = columns.filter((c) =>
        ['name', 'email', 'username', 'title', 'code'].includes(c.toLowerCase())
      );

      for (const col of candidateColumns) {
        // Skip if column type is not text
        const colInfo = columnsResult.rows.find((r) => r.column_name === col);
        if (colInfo && !colInfo.data_type.includes('character')) {
          continue;
        }

        // Check for duplicates in this column
        const dupResult = await client.query(`
          SELECT "${col}", COUNT(*) as cnt
          FROM ${tableName}
          WHERE "${col}" IS NOT NULL AND "${col}" != ''
          GROUP BY "${col}"
          HAVING COUNT(*) > 1
          ORDER BY cnt DESC
          LIMIT 10
        `);

        if (dupResult.rows.length > 0) {
          console.log(`  ⚠️  Found duplicates in column '${col}':`);
          dupResult.rows.forEach((d) => {
            console.log(`      Value: "${d[col]}" - Count: ${d.cnt}`);
          });

          duplicates.push({
            table: tableName,
            column: col,
            duplicates: dupResult.rows
          });
        }
      }
    }

    console.log('\n=== SUMMARY ===');
    console.log(`Checked ${tablesChecked.length} tables`);

    if (duplicates.length === 0) {
      console.log('No duplicates found in the database.');
    } else {
      console.log(`Found duplicates in ${duplicates.length} table(s):`);
      duplicates.forEach((d) => {
        console.log(`  - ${d.table}.${d.column} (${d.duplicates.length} duplicate groups)`);
      });
    }

    // Check for redundant/duplicate tables
    console.log('\n=== TABLE REDUNDANCY CHECK ===');
    const tablePatterns = {
      notifications: tablesChecked.filter((t) => t.includes('notification')).length,
      reports: tablesChecked.filter((t) => t.includes('report')).length,
      inventory: tablesChecked.filter((t) => t.includes('inventory')).length,
      vaccine: tablesChecked.filter((t) => t.includes('vaccine')).length
    };

    Object.entries(tablePatterns).forEach(([pattern, count]) => {
      if (count > 3) {
        console.log(`  ⚠️  Found ${count} tables with '${pattern}' pattern - possible redundancy`);
      }
    });

    // List all tables by category
    console.log('\n=== TABLE INVENTORY ===');
    const categories = {
      users: tablesChecked.filter((t) => t.includes('user')),
      vaccines: tablesChecked.filter((t) => t.includes('vaccine')),
      inventory: tablesChecked.filter((t) => t.includes('inventory')),
      records: tablesChecked.filter((t) => t.includes('record')),
      notifications: tablesChecked.filter((t) => t.includes('notification')),
      reports: tablesChecked.filter((t) => t.includes('report'))
    };

    Object.entries(categories).forEach(([category, tables]) => {
      if (tables.length > 0) {
        console.log(`${category}:`);
        tables.forEach((t) => console.log(`  - ${t}`));
      }
    });

    return duplicates;
  } catch (error) {
    console.error('Error checking duplicates:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run the check
checkDuplicates()
  .then(() => {
    console.log('\nDuplicate check completed.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Duplicate check failed:', err);
    process.exit(1);
  });
