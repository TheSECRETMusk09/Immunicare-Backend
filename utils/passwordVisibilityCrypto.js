const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const PAYLOAD_VERSION = 1;

function resolveEncryptionKey() {
  const secret =
    process.env.GUARDIAN_PASSWORD_VISIBILITY_KEY ||
    process.env.PASSWORD_VISIBILITY_ENCRYPTION_KEY ||
    process.env.JWT_SECRET ||
    'immunicare-dev-password-visibility-key';

  return crypto.createHash('sha256').update(String(secret)).digest();
}

function encryptPasswordForVisibility(plainPassword) {
  if (!plainPassword || typeof plainPassword !== 'string') {
    return null;
  }

  const key = resolveEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plainPassword, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return JSON.stringify({
    v: PAYLOAD_VERSION,
    iv: iv.toString('base64'),
    tag: authTag.toString('base64'),
    content: encrypted.toString('base64'),
  });
}

function decryptPasswordVisibilityPayload(payload) {
  if (!payload) {
    return null;
  }

  const parsed = typeof payload === 'string' ? JSON.parse(payload) : payload;
  const key = resolveEncryptionKey();

  const iv = Buffer.from(parsed.iv, 'base64');
  const authTag = Buffer.from(parsed.tag, 'base64');
  const encrypted = Buffer.from(parsed.content, 'base64');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}

module.exports = {
  encryptPasswordForVisibility,
  decryptPasswordVisibilityPayload,
};

