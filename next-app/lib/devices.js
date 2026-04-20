const db = require("./db");
const { randomBytes } = require("node:crypto");
let devicesSchemaReadyPromise;

function generateDeviceSecret() {
  return randomBytes(18).toString("base64url");
}

async function ensureDevicesSchema() {
  if (!devicesSchemaReadyPromise) {
    devicesSchemaReadyPromise = db.query(`
      ALTER TABLE devices
      ADD COLUMN IF NOT EXISTS wifi_ssid VARCHAR(150);

      ALTER TABLE devices
      ADD COLUMN IF NOT EXISTS wifi_password TEXT;

      ALTER TABLE devices
      ADD COLUMN IF NOT EXISTS wifi_configured_at TIMESTAMPTZ;

      ALTER TABLE devices
      ADD COLUMN IF NOT EXISTS board_model VARCHAR(150);

      ALTER TABLE devices
      ADD COLUMN IF NOT EXISTS fqbn VARCHAR(200);

      ALTER TABLE devices
      ADD COLUMN IF NOT EXISTS serial_number VARCHAR(150);

      ALTER TABLE devices
      ADD COLUMN IF NOT EXISTS led_state VARCHAR(10) NOT NULL DEFAULT 'OFF';
    `);
  }

  await devicesSchemaReadyPromise;
}

async function listDevices(userId) {
  await ensureDevicesSchema();
  const result = await db.query(
    `
      SELECT
        device_id,
        device_name,
        device_type,
        board_model,
        fqbn,
        serial_number,
        location,
        wifi_ssid,
        wifi_configured_at,
        device_secret,
        last_seen_at,
        last_status,
        led_state,
        created_at
      FROM devices
      WHERE owner_user_id = $1
      ORDER BY created_at ASC
    `,
    [userId]
  );

  return result.rows;
}

async function listKnownWifiNetworks(userId) {
  await ensureDevicesSchema();
  const result = await db.query(
    `
      SELECT DISTINCT wifi_ssid
      FROM devices
      WHERE owner_user_id = $1
        AND wifi_ssid IS NOT NULL
        AND wifi_ssid <> ''
      ORDER BY wifi_ssid ASC
    `,
    [userId]
  );

  return result.rows.map((row) => row.wifi_ssid);
}

async function listRecentCommands(userId, limit = 20) {
  const result = await db.query(
    `
      SELECT c.id, c.device_id, c.command, c.source, c.created_at
      FROM led_commands c
      JOIN devices d ON d.device_id = c.device_id
      WHERE d.owner_user_id = $1
      ORDER BY c.created_at DESC
      LIMIT $2
    `,
    [userId, limit]
  );

  return result.rows;
}

async function createDevice({
  deviceId,
  deviceName,
  deviceType,
  location,
  ownerUserId
}) {
  const deviceSecret = generateDeviceSecret();

  return db.query(
    `
      INSERT INTO devices (
        device_id,
        device_name,
        device_type,
        location,
        device_secret,
        owner_user_id
      )
      VALUES ($1, $2, $3, $4, $5, $6)
    `,
    [deviceId, deviceName, deviceType, location || null, deviceSecret, ownerUserId]
  );
}

async function provisionDeviceForUser({
  deviceId,
  deviceName,
  deviceType,
  boardModel,
  fqbn,
  serialNumber,
  location,
  userId
}) {
  await ensureDevicesSchema();
  const result = await db.query(
    `
      INSERT INTO devices (
        device_id,
        device_name,
        device_type,
        board_model,
        fqbn,
        serial_number,
        location,
        device_secret,
        owner_user_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (device_id) DO UPDATE
      SET
        owner_user_id = EXCLUDED.owner_user_id,
        device_name = COALESCE(NULLIF(EXCLUDED.device_name, ''), devices.device_name),
        device_type = COALESCE(NULLIF(EXCLUDED.device_type, ''), devices.device_type),
        board_model = COALESCE(NULLIF(EXCLUDED.board_model, ''), devices.board_model),
        fqbn = COALESCE(NULLIF(EXCLUDED.fqbn, ''), devices.fqbn),
        serial_number = COALESCE(NULLIF(EXCLUDED.serial_number, ''), devices.serial_number),
        location = COALESCE(NULLIF(EXCLUDED.location, ''), devices.location),
        device_secret = COALESCE(devices.device_secret, EXCLUDED.device_secret)
      WHERE devices.owner_user_id IS NULL
        OR devices.owner_user_id = EXCLUDED.owner_user_id
      RETURNING device_id, device_secret
    `,
    [
      deviceId,
      deviceName || deviceId,
      deviceType || "arduino",
      boardModel || "Arduino UNO R4 WiFi",
      fqbn || "arduino:renesas_uno:unor4wifi",
      serialNumber || null,
      location || null,
      generateDeviceSecret(),
      userId
    ]
  );

  return result.rows[0] || null;
}

async function connectDeviceToUser({ deviceId, userId }) {
  const result = await db.query(
    `
      UPDATE devices
      SET
        owner_user_id = $2,
        device_secret = COALESCE(device_secret, $3)
      WHERE device_id = $1
        AND (owner_user_id IS NULL OR owner_user_id = $2)
      RETURNING device_id, device_secret
    `,
    [deviceId, userId, generateDeviceSecret()]
  );

  return result.rows[0] || null;
}

async function getDeviceForUser(deviceId, userId) {
  await ensureDevicesSchema();
  const result = await db.query(
    `
      SELECT device_id, device_name, wifi_ssid, last_seen_at, last_status
      FROM devices
      WHERE device_id = $1 AND owner_user_id = $2
    `,
    [deviceId, userId]
  );

  return result.rows[0] || null;
}

async function saveDeviceWifiConfiguration({
  deviceId,
  userId,
  wifiSsid,
  wifiPassword
}) {
  await ensureDevicesSchema();
  const result = await db.query(
    `
      UPDATE devices
      SET
        wifi_ssid = $3,
        wifi_password = $4,
        wifi_configured_at = NOW()
      WHERE device_id = $1
        AND owner_user_id = $2
      RETURNING device_id, wifi_ssid, wifi_configured_at, last_seen_at, last_status
    `,
    [deviceId, userId, wifiSsid, wifiPassword]
  );

  return result.rows[0] || null;
}

async function saveCommand({ deviceId, command, source = "next-app" }) {
  return db.query(
    `
      INSERT INTO led_commands (device_id, command, source)
      VALUES ($1, $2, $3)
    `,
    [deviceId, command, source]
  );
}

async function setDeviceLedState({ deviceId, userId, command, source = "next-app" }) {
  await ensureDevicesSchema();
  const result = await db.query(
    `
      UPDATE devices
      SET led_state = $3
      WHERE device_id = $1
        AND owner_user_id = $2
      RETURNING device_id, led_state
    `,
    [deviceId, userId, command]
  );

  if (!result.rows[0]) {
    return null;
  }

  await saveCommand({
    deviceId,
    command,
    source
  });

  return result.rows[0];
}

async function deleteDeviceForUser({ deviceId, userId }) {
  await ensureDevicesSchema();
  const result = await db.query(
    `
      DELETE FROM devices
      WHERE device_id = $1
        AND owner_user_id = $2
      RETURNING device_id
    `,
    [deviceId, userId]
  );

  return result.rows[0] || null;
}

async function getDeviceCommandForHeartbeat({ deviceId, deviceSecret }) {
  await ensureDevicesSchema();
  const result = await db.query(
    `
      UPDATE devices
      SET
        last_seen_at = NOW(),
        last_status = 'online'
      WHERE device_id = $1
        AND device_secret = $2
      RETURNING device_id, led_state, last_seen_at, last_status
    `,
    [deviceId, deviceSecret]
  );

  return result.rows[0] || null;
}

async function updateDeviceHeartbeat({ deviceId, deviceSecret, status = "online" }) {
  const result = await db.query(
    `
      UPDATE devices
      SET
        last_seen_at = NOW(),
        last_status = $3
      WHERE device_id = $1
        AND device_secret = $2
      RETURNING device_id, last_seen_at, last_status
    `,
    [deviceId, deviceSecret, status]
  );

  return result.rows[0] || null;
}

module.exports = {
  connectDeviceToUser,
  createDevice,
  deleteDeviceForUser,
  generateDeviceSecret,
  getDeviceCommandForHeartbeat,
  getDeviceForUser,
  listKnownWifiNetworks,
  listDevices,
  listRecentCommands,
  provisionDeviceForUser,
  saveCommand,
  saveDeviceWifiConfiguration,
  setDeviceLedState,
  updateDeviceHeartbeat
};
