const { randomBytes, randomInt, scrypt: scryptCallback, timingSafeEqual } = require("node:crypto");
const { promisify } = require("node:util");
const nodemailer = require("nodemailer");
const db = require("./db");

const scrypt = promisify(scryptCallback);
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const OTP_TTL_MINUTES = 10;
let authSchemaReadyPromise;

async function ensureAuthSchema() {
  if (!authSchemaReadyPromise) {
    authSchemaReadyPromise = db.query(`
      CREATE TABLE IF NOT EXISTS pending_user_registrations (
        id SERIAL PRIMARY KEY,
        full_name VARCHAR(150) NOT NULL,
        email VARCHAR(200) NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        otp_code VARCHAR(6) NOT NULL,
        otp_expires_at TIMESTAMPTZ NOT NULL,
        verified_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  }

  await authSchemaReadyPromise;
}

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

  return keyBuffer.length === derivedBuffer.length && timingSafeEqual(keyBuffer, derivedBuffer);
}

function generateOtpCode() {
  return String(randomInt(0, 1000000)).padStart(6, "0");
}

function getTransportConfig() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    return null;
  }

  return {
    host,
    port,
    secure: port === 465,
    auth: {
      user,
      pass
    }
  };
}

async function sendOtpEmail({ email, fullName, otpCode }) {
  const transportConfig = getTransportConfig();

  if (!transportConfig) {
    throw new Error("SMTP is not configured");
  }

  const transporter = nodemailer.createTransport(transportConfig);
  const from = process.env.EMAIL_FROM || transportConfig.auth.user;

  await transporter.sendMail({
    from,
    to: email,
    subject: "Your Meenakshi verification code",
    text: [
      `Hi ${fullName},`,
      "",
      `Your verification code is ${otpCode}.`,
      `It expires in ${OTP_TTL_MINUTES} minutes.`,
      "",
      "If you did not request this, you can ignore this email."
    ].join("\n")
  });
}

async function createUser({ fullName, email, passwordHash }) {
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

async function beginPendingUserRegistration({ fullName, email, password }) {
  await ensureAuthSchema();
  const normalizedEmail = email.toLowerCase();
  const passwordHash = await hashPassword(password);
  const otpCode = generateOtpCode();
  const otpExpiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

  const existingUser = await db.query(
    `
      SELECT id
      FROM users
      WHERE email = $1
    `,
    [normalizedEmail]
  );

  if (existingUser.rows[0]) {
    throw new Error("EMAIL_ALREADY_USED");
  }

  await db.query(
    `
      INSERT INTO pending_user_registrations (
        full_name,
        email,
        password_hash,
        otp_code,
        otp_expires_at,
        verified_at
      )
      VALUES ($1, $2, $3, $4, $5, NULL)
      ON CONFLICT (email)
      DO UPDATE SET
        full_name = EXCLUDED.full_name,
        password_hash = EXCLUDED.password_hash,
        otp_code = EXCLUDED.otp_code,
        otp_expires_at = EXCLUDED.otp_expires_at,
        verified_at = NULL,
        created_at = NOW()
    `,
    [fullName, normalizedEmail, passwordHash, otpCode, otpExpiresAt]
  );

  await sendOtpEmail({
    email: normalizedEmail,
    fullName,
    otpCode
  });

  return {
    email: normalizedEmail,
    expiresAt: otpExpiresAt
  };
}

async function verifyPendingUserRegistration({ email, otpCode }) {
  await ensureAuthSchema();
  const normalizedEmail = email.toLowerCase();
  const result = await db.query(
    `
      SELECT id, full_name, email, password_hash, otp_code, otp_expires_at
      FROM pending_user_registrations
      WHERE email = $1
    `,
    [normalizedEmail]
  );

  const pendingRegistration = result.rows[0];

  if (!pendingRegistration) {
    throw new Error("OTP_NOT_FOUND");
  }

  if (pendingRegistration.otp_expires_at < new Date()) {
    throw new Error("OTP_EXPIRED");
  }

  if (String(pendingRegistration.otp_code) !== String(otpCode)) {
    throw new Error("OTP_INVALID");
  }

  const user = await createUser({
    fullName: pendingRegistration.full_name,
    email: pendingRegistration.email,
    passwordHash: pendingRegistration.password_hash
  });

  await db.query(
    `
      DELETE FROM pending_user_registrations
      WHERE id = $1
    `,
    [pendingRegistration.id]
  );

  return user;
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
  OTP_TTL_MINUTES,
  SESSION_TTL_MS,
  authenticateUser,
  beginPendingUserRegistration,
  createSession,
  deleteSession,
  getUserBySessionToken,
  verifyPendingUserRegistration
};
