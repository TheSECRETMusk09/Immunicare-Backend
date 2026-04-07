const MAX_GUARDIAN_USERNAME_SUFFIX = 10000;
const GUARDIAN_USERNAME_FORMAT_REGEX = /^[a-z0-9]+(?:\.[a-z0-9]+)+$/;

const LEGACY_GUARDIAN_USERNAME_PATTERNS = [
  /^[a-z][a-z0-9]*\.guardian\.\d+$/i,
  /^guardian_\d{6,}$/i,
  /^guardian\.verify\.\d+$/i,
  /^syn_guard_[a-z0-9._-]+$/i,
];

const EMAIL_ADDRESS_REGEX = /<?([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})>?/i;

const normalizeGuardianUsernamePart = (value) => {
  if (value === undefined || value === null) {
    return '';
  }

  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/\.{2,}/g, '.')
    .replace(/^\.+|\.+$/g, '');
};

const normalizeGuardianEmail = (value) => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();

  return normalized || null;
};

const extractConfiguredEmailAddress = (value) => {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return null;
  }

  const match = normalized.match(EMAIL_ADDRESS_REGEX);
  return match ? match[1].toLowerCase() : null;
};

const normalizeDomainCandidate = (value) => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^@+/, '');

  if (!normalized) {
    return null;
  }

  if (normalized.includes('@')) {
    const extractedEmail = extractConfiguredEmailAddress(normalized);
    if (!extractedEmail) {
      return null;
    }
    return extractedEmail.split('@')[1] || null;
  }

  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(normalized) ? normalized : null;
};

const splitGuardianFullName = (fullName) => {
  const normalizedName = String(fullName || '')
    .trim()
    .replace(/\s+/g, ' ');

  if (!normalizedName) {
    return {
      firstName: 'guardian',
      remainingName: 'user',
    };
  }

  const parts = normalizedName.split(' ').filter(Boolean);
  const firstName = parts[0] || 'guardian';
  const remainingName = parts.slice(1).join(' ') || firstName;

  return {
    firstName,
    remainingName,
  };
};

const composeGuardianFullName = ({
  fullName = null,
  firstName = null,
  middleName = null,
  lastName = null,
} = {}) => {
  const explicitFullName = String(fullName || '')
    .trim()
    .replace(/\s+/g, ' ');

  if (explicitFullName) {
    return explicitFullName;
  }

  return [firstName, middleName, lastName]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const buildGuardianUsernameBase = (options = {}) => {
  const guardianFullName = composeGuardianFullName(options);
  const { firstName, remainingName } = splitGuardianFullName(guardianFullName);

  const normalizedFirst = normalizeGuardianUsernamePart(firstName);
  const normalizedRemaining = normalizeGuardianUsernamePart(remainingName);

  const safeFirst = normalizedFirst || 'guardian';
  const safeRemaining = normalizedRemaining || safeFirst || 'user';

  const baseUsername = `${safeFirst}.${safeRemaining}`
    .replace(/\.{2,}/g, '.')
    .replace(/^\.+|\.+$/g, '');

  return baseUsername || 'guardian.user';
};

const buildGuardianEmail = (username, emailDomain) => {
  const normalizedUsername = normalizeGuardianUsernamePart(username);
  const normalizedDomain = normalizeDomainCandidate(emailDomain);

  if (!normalizedUsername || !normalizedDomain) {
    return null;
  }

  return `${normalizedUsername}@${normalizedDomain}`;
};

const resolveGuardianEmailDomain = (env = process.env) => {
  const directCandidates = [
    env.GUARDIAN_ACCOUNT_EMAIL_DOMAIN,
    env.GUARDIAN_EMAIL_DOMAIN,
  ];

  for (const candidate of directCandidates) {
    const normalized = normalizeDomainCandidate(candidate);
    if (normalized) {
      return normalized;
    }
  }

  const emailCandidates = [
    env.GUARDIAN_ACCOUNT_EMAIL,
    env.GUARDIAN_EMAIL,
    env.MAIL_FROM_EMAIL,
    env.EMAIL_FROM,
    env.RESEND_EMAIL_FROM,
  ];

  for (const candidate of emailCandidates) {
    const extractedEmail = extractConfiguredEmailAddress(candidate);
    if (extractedEmail) {
      return extractedEmail.split('@')[1] || 'immunicare.local';
    }
  }

  return 'immunicare.local';
};

const isSeedStyleGuardianUsername = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return LEGACY_GUARDIAN_USERNAME_PATTERNS.some((pattern) => pattern.test(normalized));
};

const isSeedStyleGuardianEmail = (value) => {
  const normalizedEmail = normalizeGuardianEmail(value);
  if (!normalizedEmail || !normalizedEmail.includes('@')) {
    return false;
  }

  const localPart = normalizedEmail.split('@')[0];
  return isSeedStyleGuardianUsername(localPart);
};

const queryTakenGuardianUsernames = async (client, baseUsername, { excludeUserId = null } = {}) => {
  let query = `
    SELECT username
    FROM users
    WHERE (
      lower(username) = lower($1)
      OR lower(username) LIKE lower($2)
    )
  `;
  const params = [baseUsername, `${baseUsername}.%`];

  if (excludeUserId) {
    query += ' AND id <> $3';
    params.push(excludeUserId);
  }

  const result = await client.query(query, params);
  return new Set(
    result.rows
      .map((row) => String(row.username || '').trim().toLowerCase())
      .filter(Boolean),
  );
};

const queryTakenGuardianEmails = async (
  client,
  baseUsername,
  emailDomain,
  { excludeUserId = null } = {},
) => {
  const baseEmail = buildGuardianEmail(baseUsername, emailDomain);
  if (!baseEmail) {
    return new Set();
  }

  let query = `
    SELECT email
    FROM users
    WHERE email IS NOT NULL
      AND (
        lower(email) = lower($1)
        OR lower(email) LIKE lower($2)
      )
  `;
  const params = [baseEmail, `${baseUsername}.%@${emailDomain}`];

  if (excludeUserId) {
    query += ' AND id <> $3';
    params.push(excludeUserId);
  }

  const result = await client.query(query, params);
  return new Set(
    result.rows
      .map((row) => normalizeGuardianEmail(row.email))
      .filter(Boolean),
  );
};

const resolveUniqueGuardianUsername = async (
  client,
  { excludeUserId = null, ...nameOptions } = {},
) => {
  const baseUsername = buildGuardianUsernameBase(nameOptions);

  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`guardian-username:${baseUsername}`]);

  const takenUsernames = await queryTakenGuardianUsernames(client, baseUsername, { excludeUserId });

  if (!takenUsernames.has(baseUsername.toLowerCase())) {
    return baseUsername;
  }

  for (let suffix = 2; suffix <= MAX_GUARDIAN_USERNAME_SUFFIX; suffix += 1) {
    const candidate = `${baseUsername}.${suffix}`;
    if (!GUARDIAN_USERNAME_FORMAT_REGEX.test(candidate)) {
      continue;
    }

    if (!takenUsernames.has(candidate.toLowerCase())) {
      return candidate;
    }
  }

  throw new Error('Unable to allocate unique guardian username');
};

const resolveUniqueGuardianAccountIdentity = async (
  client,
  {
    emailDomain = null,
    excludeUserId = null,
    ...nameOptions
  } = {},
) => {
  const baseUsername = buildGuardianUsernameBase(nameOptions);
  const resolvedEmailDomain = normalizeDomainCandidate(emailDomain) || resolveGuardianEmailDomain();

  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
    `guardian-account:${baseUsername}@${resolvedEmailDomain}`,
  ]);

  const takenUsernames = await queryTakenGuardianUsernames(client, baseUsername, {
    excludeUserId,
  });
  const takenEmails = await queryTakenGuardianEmails(
    client,
    baseUsername,
    resolvedEmailDomain,
    { excludeUserId },
  );

  const buildCandidate = (suffix = null) => {
    const username = suffix ? `${baseUsername}.${suffix}` : baseUsername;
    return {
      username,
      email: buildGuardianEmail(username, resolvedEmailDomain),
    };
  };

  const baseCandidate = buildCandidate();
  if (
    GUARDIAN_USERNAME_FORMAT_REGEX.test(baseCandidate.username) &&
    !takenUsernames.has(baseCandidate.username.toLowerCase()) &&
    !takenEmails.has(baseCandidate.email)
  ) {
    return {
      ...baseCandidate,
      baseUsername,
      collisionRank: 1,
      emailDomain: resolvedEmailDomain,
    };
  }

  for (let suffix = 2; suffix <= MAX_GUARDIAN_USERNAME_SUFFIX; suffix += 1) {
    const candidate = buildCandidate(suffix);
    if (!GUARDIAN_USERNAME_FORMAT_REGEX.test(candidate.username)) {
      continue;
    }

    if (
      !takenUsernames.has(candidate.username.toLowerCase()) &&
      !takenEmails.has(candidate.email)
    ) {
      return {
        ...candidate,
        baseUsername,
        collisionRank: suffix,
        emailDomain: resolvedEmailDomain,
      };
    }
  }

  throw new Error('Unable to allocate unique guardian account credentials');
};

module.exports = {
  MAX_GUARDIAN_USERNAME_SUFFIX,
  GUARDIAN_USERNAME_FORMAT_REGEX,
  buildGuardianEmail,
  buildGuardianUsernameBase,
  composeGuardianFullName,
  extractConfiguredEmailAddress,
  isSeedStyleGuardianEmail,
  isSeedStyleGuardianUsername,
  normalizeGuardianEmail,
  normalizeGuardianUsernamePart,
  resolveGuardianEmailDomain,
  resolveUniqueGuardianAccountIdentity,
  resolveUniqueGuardianUsername,
  splitGuardianFullName,
};
