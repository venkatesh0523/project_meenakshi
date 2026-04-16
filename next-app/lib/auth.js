const { randomBytes, scrypt: scryptCallback, timingSafeEqual } = require("node:crypto");
const { promisify } = require("node:util");
const db = require("./db");

const scrypt = promisify(scryptCallback);
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = await scrypt(password, salt, 64);

  return `${salt}:${Buffer.from(derivedKey).toString("hex")}`;
}

async function verifyPassword(password, storedHash) {
  const [salt, key] = String(storedHash || "").split(":");

  if (!salt || !key) {
    return false;
  }

  const derivedKey = await scrypt(password, salt, 64);
  const keyBuffer = Buffer.from(key, "hex");
  const derivedBuffer = Buffer.from(derivedKey);

  return (
    keyBuffer.length === derivedBuffer.length &&
    timingSafeEqual(keyBuffer, derivedBuffer)
  );
}

async function createUser({ fullName, email, password }) {
  const passwordHash = await hashPassword(password);
  const result = await db.query(
    `
      INSERT INTO users (full_name, email, password_hash)
      VALUES ($1, $2, $3)
      RETURNING id, full_name, email, created_at
    `,
    [fullName, email.toLowerCase(), passwordHash]
  );

  return result.rows[0];
}

async function authenticateUser({ email, password }) {
  const result = await db.query(
    `
      SELECT id, full_name, email, password_hash
      FROM users
      WHERE email = $1
    `,
    [email.toLowerCase()]
  );

  const user = result.rows[0];

  if (!user) {
    return null;
  }

  const isValid = await verifyPassword(password, user.password_hash);

  if (!isValid) {
    return null;
  }

  return {
    id: user.id,
    full_name: user.full_name,
    email: user.email
  };
}

async function createSession(userId) {
  const sessionToken = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await db.query(
    `
      INSERT INTO user_sessions (user_id, session_token, expires_at)
      VALUES ($1, $2, $3)
    `,
    [userId, sessionToken, expiresAt]
  );

  return {
    sessionToken,
    expiresAt
  };
}

async function getUserBySessionToken(sessionToken) {
  if (!sessionToken) {
    return null;
  }

  const result = await db.query(
    `
      SELECT u.id, u.full_name, u.email
      FROM user_sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.session_token = $1
        AND s.expires_at > NOW()
    `,
    [sessionToken]
  );

  return result.rows[0] || null;
}

async function deleteSession(sessionToken) {
  if (!sessionToken) {
    return;
  }

  await db.query(
    `
      DELETE FROM user_sessions
      WHERE session_token = $1
    `,
    [sessionToken]
  );
}

module.exports = {
  SESSION_TTL_MS,
  authenticateUser,
  createSession,
  createUser,
  deleteSession,
  getUserBySessionToken
};
