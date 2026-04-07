require('dotenv').config();

const pool = require('../db');
const {
  buildGuardianEmail,
  isSeedStyleGuardianEmail,
  isSeedStyleGuardianUsername,
  normalizeGuardianEmail,
  resolveGuardianEmailDomain,
  resolveUniqueGuardianAccountIdentity,
} = require('../utils/guardianAccountNaming');

const DEFAULT_LIMIT = null;

const parseArgs = (argv) => {
  const options = {
    apply: false,
    json: false,
    limit: DEFAULT_LIMIT,
  };

  argv.forEach((arg) => {
    if (arg === '--apply') {
      options.apply = true;
      return;
    }

    if (arg === '--json') {
      options.json = true;
      return;
    }

    if (arg.startsWith('--limit=')) {
      const parsed = Number.parseInt(arg.split('=')[1], 10);
      if (Number.isInteger(parsed) && parsed > 0) {
        options.limit = parsed;
      }
    }
  });

  return options;
};

const quoteIdentifier = (value) => `"${String(value || '').replace(/"/g, '""')}"`;

const tableExistsInSchema = (tableRows, schemaName, tableName) =>
  tableRows.some(
    (row) => row.table_schema === schemaName && row.table_name === tableName,
  );

const columnExistsInSchema = async (client, schemaName, tableName, columnName) => {
  const result = await client.query(
    `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = $1
          AND table_name = $2
          AND column_name = $3
      ) AS exists
    `,
    [schemaName, tableName, columnName],
  );

  return result.rows[0]?.exists === true;
};

const resolveGuardianProfileSource = async (client) => {
  const schemaResult = await client.query(
    `
      SELECT
        table_schema,
        table_name,
        CASE WHEN table_schema = current_schema() THEN 0 ELSE 1 END AS schema_priority
      FROM information_schema.tables
      WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
        AND table_name IN ('users', 'roles', 'guardians', 'parent_guardian')
      ORDER BY schema_priority ASC, table_schema ASC, table_name ASC
    `,
  );

  const tableRows = schemaResult.rows || [];
  const schemaCandidates = Array.from(
    new Set(
      tableRows
        .filter((row) => row.table_name === 'users')
        .map((row) => row.table_schema),
    ),
  );

  for (const schemaName of schemaCandidates) {
    const hasRoles = tableExistsInSchema(tableRows, schemaName, 'roles');
    if (!hasRoles) {
      continue;
    }

    if (tableExistsInSchema(tableRows, schemaName, 'guardians')) {
      const qualifiedSchema = quoteIdentifier(schemaName);
      return {
        schemaName,
        usersTable: `${qualifiedSchema}.${quoteIdentifier('users')}`,
        rolesTable: `${qualifiedSchema}.${quoteIdentifier('roles')}`,
        tableName: 'guardians',
        qualifiedTable: `${qualifiedSchema}.${quoteIdentifier('guardians')}`,
        idColumn: 'id',
        nameColumn: 'name',
        emailColumn: 'email',
        joinCondition: 'u.guardian_id = g.id',
      };
    }

    if (tableExistsInSchema(tableRows, schemaName, 'parent_guardian')) {
      const usersHasGuardianId = await columnExistsInSchema(
        client,
        schemaName,
        'users',
        'guardian_id',
      );
      const parentGuardianHasUserId = await columnExistsInSchema(
        client,
        schemaName,
        'parent_guardian',
        'user_id',
      );
      const qualifiedSchema = quoteIdentifier(schemaName);

      if (usersHasGuardianId) {
        return {
          schemaName,
          usersTable: `${qualifiedSchema}.${quoteIdentifier('users')}`,
          rolesTable: `${qualifiedSchema}.${quoteIdentifier('roles')}`,
          tableName: 'parent_guardian',
          qualifiedTable: `${qualifiedSchema}.${quoteIdentifier('parent_guardian')}`,
          idColumn: 'id',
          nameColumn: 'full_name',
          emailColumn: 'email',
          joinCondition: 'u.guardian_id = g.id',
        };
      }

      if (parentGuardianHasUserId) {
        return {
          schemaName,
          usersTable: `${qualifiedSchema}.${quoteIdentifier('users')}`,
          rolesTable: `${qualifiedSchema}.${quoteIdentifier('roles')}`,
          tableName: 'parent_guardian',
          qualifiedTable: `${qualifiedSchema}.${quoteIdentifier('parent_guardian')}`,
          idColumn: 'id',
          nameColumn: 'full_name',
          emailColumn: 'email',
          joinCondition: 'u.id = g.user_id',
        };
      }
    }
  }

  throw new Error(
    'No supported guardian profile table was found in the active database schema.',
  );
};

const queryGuardianAccounts = async (
  client,
  profileSource,
  { apply = false, limit = null } = {},
) => {
  const params = [];
  let limitClause = '';

  if (Number.isInteger(limit) && limit > 0) {
    params.push(limit);
    limitClause = `LIMIT $${params.length}`;
  }

  const lockClause = apply ? 'FOR UPDATE OF g, u' : '';

  const result = await client.query(
    `
      SELECT DISTINCT ON (g.id)
        g.${profileSource.idColumn} AS guardian_id,
        g.${profileSource.nameColumn} AS guardian_name,
        g.${profileSource.emailColumn} AS guardian_email,
        u.id AS user_id,
        u.username AS user_username,
        u.email AS user_email
      FROM ${profileSource.qualifiedTable} g
      JOIN ${profileSource.usersTable} u
        ON ${profileSource.joinCondition}
      JOIN ${profileSource.rolesTable} r
        ON r.id = u.role_id
       AND LOWER(r.name) = 'guardian'
      ORDER BY g.id ASC, u.id DESC
      ${limitClause}
      ${lockClause}
    `,
    params,
  );

  return result.rows;
};

const isUserEmailAvailable = async (client, email, excludeUserId) => {
  const normalizedEmail = normalizeGuardianEmail(email);
  if (!normalizedEmail) {
    return false;
  }

  const result = await client.query(
    `SELECT id
     FROM users
     WHERE lower(email) = lower($1)
       AND id <> $2
     LIMIT 1`,
    [normalizedEmail, excludeUserId],
  );

  return result.rows.length === 0;
};

const buildRepairPlan = async (client, row, emailDomain) => {
  const currentUsername = String(row.user_username || '').trim();
  const currentUserEmail = normalizeGuardianEmail(row.user_email);
  const currentGuardianEmail = normalizeGuardianEmail(row.guardian_email);

  const usernameNeedsRepair =
    !currentUsername || isSeedStyleGuardianUsername(currentUsername);
  const userEmailNeedsRepair =
    !currentUserEmail || isSeedStyleGuardianEmail(currentUserEmail);
  const guardianEmailNeedsRepair =
    !currentGuardianEmail || isSeedStyleGuardianEmail(currentGuardianEmail);

  if (!usernameNeedsRepair && !userEmailNeedsRepair && !guardianEmailNeedsRepair) {
    return null;
  }

  const generatedIdentity = await resolveUniqueGuardianAccountIdentity(client, {
    fullName: row.guardian_name,
    excludeUserId: row.user_id,
    emailDomain,
  });

  const nextUsername = usernameNeedsRepair ? generatedIdentity.username : currentUsername;
  const preferredCustomEmail = !userEmailNeedsRepair
    ? currentUserEmail
    : !guardianEmailNeedsRepair
      ? currentGuardianEmail
      : null;

  let generatedEmailForUsername =
    buildGuardianEmail(nextUsername, generatedIdentity.emailDomain) || generatedIdentity.email;

  if (generatedEmailForUsername !== generatedIdentity.email) {
    const generatedEmailAvailable = await isUserEmailAvailable(
      client,
      generatedEmailForUsername,
      row.user_id,
    );

    if (!generatedEmailAvailable) {
      generatedEmailForUsername = generatedIdentity.email;
    }
  }

  let nextUserEmail = userEmailNeedsRepair
    ? preferredCustomEmail || generatedEmailForUsername
    : currentUserEmail;

  if (
    userEmailNeedsRepair &&
    nextUserEmail &&
    nextUserEmail !== currentUserEmail
  ) {
    const nextUserEmailAvailable = await isUserEmailAvailable(
      client,
      nextUserEmail,
      row.user_id,
    );

    if (!nextUserEmailAvailable) {
      nextUserEmail = generatedIdentity.email;
    }
  }

  const nextGuardianEmail = guardianEmailNeedsRepair
    ? nextUserEmail || preferredCustomEmail || generatedEmailForUsername
    : currentGuardianEmail;

  const changes = [];

  if ((currentUsername || null) !== (nextUsername || null)) {
    changes.push('username');
  }

  if ((currentUserEmail || null) !== (nextUserEmail || null)) {
    changes.push('user_email');
  }

  if ((currentGuardianEmail || null) !== (nextGuardianEmail || null)) {
    changes.push('guardian_email');
  }

  if (changes.length === 0) {
    return null;
  }

  return {
    guardianId: Number.parseInt(row.guardian_id, 10),
    userId: Number.parseInt(row.user_id, 10),
    guardianName: row.guardian_name,
    current: {
      username: currentUsername || null,
      userEmail: currentUserEmail,
      guardianEmail: currentGuardianEmail,
    },
    next: {
      username: nextUsername || null,
      userEmail: nextUserEmail || null,
      guardianEmail: nextGuardianEmail || null,
    },
    repairReasons: {
      usernameNeedsRepair,
      userEmailNeedsRepair,
      guardianEmailNeedsRepair,
    },
    changes,
  };
};

const applyRepairPlan = async (client, plan, profileSource) => {
  if (!plan.changes.includes('username') && !plan.changes.includes('user_email')) {
    // No linked user account update needed.
  } else {
    const userAssignments = [];
    const userParams = [];

    if (plan.changes.includes('username')) {
      userAssignments.push(`username = $${userParams.length + 1}`);
      userParams.push(plan.next.username);
    }

    if (plan.changes.includes('user_email')) {
      userAssignments.push(`email = $${userParams.length + 1}`);
      userParams.push(plan.next.userEmail);
    }

    if (userAssignments.length > 0) {
      userParams.push(plan.userId);
      await client.query(
        `UPDATE users
         SET ${userAssignments.join(', ')},
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $${userParams.length}`,
        userParams,
      );
    }
  }

  if (plan.changes.includes('guardian_email')) {
    await client.query(
      `UPDATE ${profileSource.qualifiedTable}
       SET ${profileSource.emailColumn} = $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE ${profileSource.idColumn} = $2`,
      [plan.next.guardianEmail, plan.guardianId],
    );
  }
};

const summarizePlans = (plans) => ({
  totalMatched: plans.length,
  usernameUpdates: plans.filter((plan) => plan.changes.includes('username')).length,
  userEmailUpdates: plans.filter((plan) => plan.changes.includes('user_email')).length,
  guardianEmailUpdates: plans.filter((plan) => plan.changes.includes('guardian_email')).length,
});

const printHumanSummary = (summary, plans, { apply, emailDomain, profileTable }) => {
  console.log(
    `[guardian-account-repair] mode=${apply ? 'apply' : 'dry-run'} domain=${emailDomain} profile_table=${profileTable}`,
  );
  console.log(
    `[guardian-account-repair] matched=${summary.totalMatched} username_updates=${summary.usernameUpdates} user_email_updates=${summary.userEmailUpdates} guardian_email_updates=${summary.guardianEmailUpdates}`,
  );

  const preview = plans.slice(0, 10);
  if (preview.length === 0) {
    console.log('[guardian-account-repair] no guardian accounts require repair');
    return;
  }

  console.log('[guardian-account-repair] preview');
  preview.forEach((plan) => {
    console.log(
      `  guardian#${plan.guardianId} ${plan.guardianName}: ${plan.current.username || '(blank)'} -> ${plan.next.username}; ${plan.current.userEmail || '(blank)'} -> ${plan.next.userEmail || '(blank)'}`,
    );
  });
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  const emailDomain = resolveGuardianEmailDomain();
  let client = null;

  try {
    client = await pool.connect();
    const profileSource = await resolveGuardianProfileSource(client);

    if (options.apply) {
      await client.query('BEGIN');
    }

    const rows = await queryGuardianAccounts(client, profileSource, options);
    const plans = [];

    for (const row of rows) {
      const plan = await buildRepairPlan(client, row, emailDomain);
      if (plan) {
        plans.push(plan);
      }
    }

    if (options.apply) {
      for (const plan of plans) {
        await applyRepairPlan(client, plan, profileSource);
      }

      await client.query('COMMIT');
    }

    const summary = summarizePlans(plans);

    if (options.json) {
      console.log(
        JSON.stringify(
          {
            mode: options.apply ? 'apply' : 'dry-run',
            emailDomain,
            profileTable: profileSource.tableName,
            summary,
            plans,
          },
          null,
          2,
        ),
      );
    } else {
      printHumanSummary(summary, plans, {
        apply: options.apply,
        emailDomain,
        profileTable: profileSource.tableName,
      });
    }
  } catch (error) {
    if (options.apply && client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('[guardian-account-repair] rollback failed:', rollbackError);
      }
    }

    console.error('[guardian-account-repair] failed:', error);
    process.exitCode = 1;
  } finally {
    if (client) {
      client.release();
    }
    await pool.end();
  }
};

void main();
